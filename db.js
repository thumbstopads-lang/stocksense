// Dual-backend storage for StockSense.
//   - Default (no DATABASE_URL): SQLite via Node's built-in node:sqlite (Node 22+).
//     DB file: ./data/stocksense.db (gitignored). Zero config, perfect for local dev.
//   - DATABASE_URL set: Postgres via the `pg` driver (used for Render + Neon hosting).
//     Neon requires SSL, so ssl: { rejectUnauthorized: false } is always on in pg mode.
//
// Helpers are ASYNC in both modes: rows/get/run/transaction/insertReturningId.
// Call sites keep writing `?` placeholders — db.js rewrites them to $1, $2... for pg.
// All tenant tables carry user_id; every query stays scoped to the authenticated user.

const path = require('node:path');
const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');

const USE_PG = !!process.env.DATABASE_URL;

// ---------------------------------------------------------------------------
// Schema (kept in sync across both backends — same tables, same constraints)
// ---------------------------------------------------------------------------

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'INR',
  default_reorder_level INTEGER NOT NULL DEFAULT 10,
  custom_fields TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  unit TEXT NOT NULL DEFAULT 'pcs',
  cost_price REAL NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  qty_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_movements_user_item ON movements(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_po_user ON purchase_orders(user_id);
`;

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'INR',
  default_reorder_level INTEGER NOT NULL DEFAULT 10,
  custom_fields TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  unit TEXT NOT NULL DEFAULT 'pcs',
  cost_price REAL NOT NULL DEFAULT 0,
  custom_fields TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS movements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  qty_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL,
  cost_price REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_user ON items(user_id);
CREATE INDEX IF NOT EXISTS idx_movements_user_item ON movements(user_id, item_id);
CREATE INDEX IF NOT EXISTS idx_po_user ON purchase_orders(user_id);
`;

// ---------------------------------------------------------------------------
// Backend init
// ---------------------------------------------------------------------------

let sqliteDb = null;
let pgPool = null;

if (USE_PG) {
  const pgMod = require('pg');
  const { Pool } = pgMod;
  // Return timestamps as 'YYYY-MM-DD HH:MM:SS' (UTC) strings — the exact shape
  // sqlite mode produces — so the API and front-end see zero difference between backends.
  // (Guarded: some pg-compatible drivers don't expose types.)
  if (pgMod.types && pgMod.types.setTypeParser) {
    pgMod.types.setTypeParser(pgMod.types.builtins.TIMESTAMPTZ, (v) => {
      const d = new Date(v);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
             `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    });
  }
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Neon requires SSL
  });
  pgPool.on('error', (err) => console.error('pg pool error:', err.message));
} else {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  sqliteDb = new DatabaseSync(path.join(dataDir, 'stocksense.db'));
  sqliteDb.exec('PRAGMA journal_mode = WAL');
  sqliteDb.exec('PRAGMA foreign_keys = ON');
}

// Schema is applied once at startup; helpers await `ready` so the first
// request never races table creation.
const ready = (async () => {
  if (USE_PG) {
    await pgPool.query(PG_SCHEMA);
  } else {
    sqliteDb.exec(SQLITE_SCHEMA);
  }
})().catch((e) => {
  console.error('DB schema init failed:', e.message);
  throw e;
});

// ---------------------------------------------------------------------------
// Placeholder conversion: call sites write `?`, pg needs $1, $2, ...
// Quote-aware so a literal '?' inside a string is never rewritten.
// ---------------------------------------------------------------------------

function toPg(sql) {
  let out = '';
  let idx = 0;
  let inStr = false;
  let quote = '';
  for (let n = 0; n < sql.length; n++) {
    const ch = sql[n];
    if (inStr) {
      out += ch;
      if (ch === quote) {
        if (sql[n + 1] === quote) { out += sql[n + 1]; n++; } // escaped quote
        else inStr = false;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { inStr = true; quote = ch; out += ch; continue; }
    if (ch === '?') { idx++; out += '$' + idx; continue; }
    out += ch;
  }
  return out;
}

// Inside a pg transaction, helpers must use the tx client; otherwise the pool.
const als = new AsyncLocalStorage();
function pgClient() {
  return als.getStore() || pgPool;
}

// ---------------------------------------------------------------------------
// Async query helpers (identical API in both modes)
// ---------------------------------------------------------------------------

async function rows(sql, ...params) {
  await ready;
  if (USE_PG) {
    const r = await pgClient().query(toPg(sql), params);
    return r.rows;
  }
  return sqliteDb.prepare(sql).all(...params);
}

async function get(sql, ...params) {
  const r = await rows(sql, ...params);
  return r[0]; // undefined when no row — same as sqlite's .get()
}

async function run(sql, ...params) {
  await ready;
  if (USE_PG) {
    const r = await pgClient().query(toPg(sql), params);
    return { changes: r.rowCount ?? 0, lastInsertRowid: undefined };
  }
  const r = sqliteDb.prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
}

// INSERT helper that returns the new row's numeric id on both backends.
// (Both modern SQLite and Postgres support `RETURNING id`.)
async function insertReturningId(sql, ...params) {
  await ready;
  const withReturning = `${sql} RETURNING id`;
  if (USE_PG) {
    const r = await pgClient().query(toPg(withReturning), params);
    return Number(r.rows[0].id);
  }
  const r = sqliteDb.prepare(withReturning).run(...params);
  return Number(r.lastInsertRowid);
}

// Run fn() inside a transaction; rolls back on throw.
// In pg mode the tx client is propagated via AsyncLocalStorage, so the same
// rows/get/run/insertReturningId helpers work unchanged inside fn().
async function transaction(fn) {
  await ready;
  if (USE_PG) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const out = await als.run(client, () => fn());
      await client.query('COMMIT');
      return out;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw e;
    } finally {
      client.release();
    }
  }
  sqliteDb.exec('BEGIN');
  try {
    const out = await fn();
    sqliteDb.exec('COMMIT');
    return out;
  } catch (e) {
    sqliteDb.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Backend-specific SQL fragments for call sites
// ---------------------------------------------------------------------------

// "now" for UPDATE ... SET updated_at = <NOW>
const NOW = USE_PG ? 'NOW()' : "datetime('now')";

// Case-insensitive search operator (SQLite LIKE is case-insensitive; pg LIKE is not)
const LIKE_OP = USE_PG ? 'ILIKE' : 'LIKE';

// Purchase-order line-items aggregation subquery, aliased as `line_items`.
// sqlite returns a JSON string; pg returns a parsed JSON array (or [] when empty).
const LINE_ITEMS_SUBQUERY = USE_PG
  ? `(SELECT COALESCE(json_agg(json_build_object('id', poi.id, 'itemId', poi.item_id, 'itemName', i.name, 'qty', poi.qty, 'costPrice', poi.cost_price) ORDER BY poi.id), '[]'::json)
      FROM purchase_order_items poi JOIN items i ON i.id = poi.item_id
      WHERE poi.po_id = po.id) AS line_items`
  : `(SELECT json_group_array(json_object('id', poi.id, 'itemId', poi.item_id, 'itemName', i.name, 'qty', poi.qty, 'costPrice', poi.cost_price))
      FROM purchase_order_items poi JOIN items i ON i.id = poi.item_id
      WHERE poi.po_id = po.id) AS line_items`;

// Normalize the line_items column (JSON string on sqlite, parsed array on pg).
function parseLineItems(raw) {
  if (Array.isArray(raw)) return raw;
  return parseJSON(raw, []) || [];
}

function parseJSON(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v === undefined ? fallback : v;
  } catch { return fallback; }
}

function stockStatus(qty, reorderLevel) {
  if (qty <= 0) return 'out';
  if (qty <= reorderLevel) return 'low';
  return 'ok';
}

module.exports = {
  db: sqliteDb, // underlying sqlite handle (null in pg mode); kept for compat
  rows, get, run, insertReturningId, transaction,
  parseJSON, stockStatus,
  NOW, LIKE_OP, LINE_ITEMS_SUBQUERY, parseLineItems,
  isPostgres: USE_PG,
  ready,
  toPg, // exported for tests: `?` -> $n conversion
};
