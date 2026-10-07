// Shared per-tenant helpers: settings row (auto-created) and custom-field validation.
const { get, run, parseJSON } = require('../db');

async function getSettings(userId) {
  let row = await get('SELECT * FROM settings WHERE user_id = ?', userId);
  if (!row) {
    const user = await get('SELECT business_name FROM users WHERE id = ?', userId);
    await run('INSERT INTO settings (user_id, business_name) VALUES (?, ?)', userId, user?.business_name || '');
    row = await get('SELECT * FROM settings WHERE user_id = ?', userId);
  }
  return {
    id: row.id,
    businessName: row.business_name,
    currency: row.currency,
    defaultReorderLevel: row.default_reorder_level,
    customFields: parseJSON(row.custom_fields, []),
  };
}

// Light validation of item custom fields against the tenant's declared schema:
// unknown keys are dropped; number-typed fields are coerced; text fields stringified.
async function sanitizeCustomFields(userId, input) {
  const schema = (await getSettings(userId)).customFields;
  if (!Array.isArray(schema) || schema.length === 0) return {};
  const byKey = new Map(schema.map((f) => [String(f.key), f]));
  const raw = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const def = byKey.get(k);
    if (!def) continue; // drop undeclared keys
    if (def.type === 'number') {
      const n = Number(v);
      if (!Number.isNaN(n)) out[k] = n;
    } else {
      out[k] = String(v ?? '');
    }
  }
  return out;
}

module.exports = { getSettings, sanitizeCustomFields };
