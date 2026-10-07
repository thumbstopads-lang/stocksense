const express = require('express');
const { rows, get, run, insertReturningId, transaction, parseJSON, stockStatus, NOW, LIKE_OP } = require('../db');
const { requireAuth } = require('../auth');
const { getSettings, sanitizeCustomFields } = require('./helpers');

const router = express.Router();
router.use(requireAuth);

function serialize(item) {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    categoryId: item.category_id,
    categoryName: item.category_name,
    supplierId: item.supplier_id,
    supplierName: item.supplier_name,
    qty: item.qty,
    reorderLevel: item.reorder_level,
    unit: item.unit,
    costPrice: item.cost_price,
    customFields: parseJSON(item.custom_fields, {}),
    status: stockStatus(item.qty, item.reorder_level),
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

const ITEM_SELECT = `
  SELECT i.*, c.name AS category_name, s.name AS supplier_name
  FROM items i
  LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN suppliers s ON s.id = i.supplier_id`;

// GET /api/items?q=&category=&status=ok|low|out&sort=name|qty|reorder_level|updated_at&order=asc|desc
router.get('/', async (req, res) => {
  const { q, category, status } = req.query;
  const sortCols = { name: 'i.name', qty: 'i.qty', reorder_level: 'i.reorder_level', updated_at: 'i.updated_at' };
  const col = sortCols[String(req.query.sort)] || 'i.name';
  const dir = String(req.query.order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  let where = 'i.user_id = ?';
  const params = [req.userId];
  if (q) { where += ` AND (i.name ${LIKE_OP} ? OR i.sku ${LIKE_OP} ?)`; params.push(`%${q}%`, `%${q}%`); }
  if (category) { where += ' AND i.category_id = ?'; params.push(Number(category)); }
  if (status === 'out') where += ' AND i.qty = 0';
  else if (status === 'low') where += ' AND i.qty > 0 AND i.qty <= i.reorder_level';
  else if (status === 'ok') where += ' AND i.qty > i.reorder_level';

  const items = await rows(`${ITEM_SELECT} WHERE ${where} ORDER BY ${col} ${dir}`, ...params);
  res.json(items.map(serialize));
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Item name is required' });
  const qty = b.qty === undefined ? 0 : Number(b.qty);
  if (!Number.isInteger(qty) || qty < 0) return res.status(400).json({ error: 'qty must be a non-negative integer' });
  const settings = await getSettings(req.userId);
  const reorderLevel = b.reorderLevel === undefined ? settings.defaultReorderLevel : Number(b.reorderLevel);
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return res.status(400).json({ error: 'reorderLevel must be a non-negative integer' });

  const categoryId = b.categoryId == null ? null : Number(b.categoryId);
  const supplierId = b.supplierId == null ? null : Number(b.supplierId);
  if (categoryId != null && !await get('SELECT id FROM categories WHERE id = ? AND user_id = ?', categoryId, req.userId)) {
    return res.status(400).json({ error: 'Category not found' });
  }
  if (supplierId != null && !await get('SELECT id FROM suppliers WHERE id = ? AND user_id = ?', supplierId, req.userId)) {
    return res.status(400).json({ error: 'Supplier not found' });
  }

  const itemId = await transaction(async () => {
    const id = await insertReturningId(
      `INSERT INTO items (user_id, name, sku, category_id, supplier_id, qty, reorder_level, unit, cost_price, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      req.userId, name, String(b.sku || '').trim(), categoryId, supplierId, qty, reorderLevel,
      String(b.unit || 'pcs').trim(), Number(b.costPrice) || 0,
      JSON.stringify(await sanitizeCustomFields(req.userId, b.customFields))
    );
    if (qty > 0) {
      await run('INSERT INTO movements (user_id, item_id, delta, reason, qty_after) VALUES (?, ?, ?, ?, ?)',
        req.userId, id, qty, 'Initial stock', qty);
    }
    return id;
  });

  const item = await get(`${ITEM_SELECT} WHERE i.id = ? AND i.user_id = ?`, itemId, req.userId);
  res.status(201).json(serialize(item));
});

router.get('/:id', async (req, res) => {
  const item = await get(`${ITEM_SELECT} WHERE i.id = ? AND i.user_id = ?`, Number(req.params.id), req.userId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(serialize(item));
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await get('SELECT * FROM items WHERE id = ? AND user_id = ?', id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Item not found' });
  const b = req.body || {};
  const name = b.name === undefined ? existing.name : String(b.name).trim();
  if (!name) return res.status(400).json({ error: 'Item name is required' });
  const reorderLevel = b.reorderLevel === undefined ? existing.reorder_level : Number(b.reorderLevel);
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) return res.status(400).json({ error: 'reorderLevel must be a non-negative integer' });
  const categoryId = b.categoryId === undefined ? existing.category_id : (b.categoryId == null ? null : Number(b.categoryId));
  const supplierId = b.supplierId === undefined ? existing.supplier_id : (b.supplierId == null ? null : Number(b.supplierId));
  if (categoryId != null && !await get('SELECT id FROM categories WHERE id = ? AND user_id = ?', categoryId, req.userId)) {
    return res.status(400).json({ error: 'Category not found' });
  }
  if (supplierId != null && !await get('SELECT id FROM suppliers WHERE id = ? AND user_id = ?', supplierId, req.userId)) {
    return res.status(400).json({ error: 'Supplier not found' });
  }
  // qty is deliberately NOT editable here — use POST /items/:id/adjust so history stays intact.
  await run(
    `UPDATE items SET name = ?, sku = ?, category_id = ?, supplier_id = ?, reorder_level = ?,
     unit = ?, cost_price = ?, custom_fields = ?, updated_at = ${NOW} WHERE id = ? AND user_id = ?`,
    name, String(b.sku ?? existing.sku), categoryId, supplierId, reorderLevel,
    String(b.unit ?? existing.unit), Number(b.costPrice ?? existing.cost_price) || 0,
    JSON.stringify(b.customFields === undefined ? parseJSON(existing.custom_fields, {}) : await sanitizeCustomFields(req.userId, b.customFields)),
    id, req.userId
  );
  const item = await get(`${ITEM_SELECT} WHERE i.id = ? AND i.user_id = ?`, id, req.userId);
  res.json(serialize(item));
});

router.delete('/:id', async (req, res) => {
  const r = await run('DELETE FROM items WHERE id = ? AND user_id = ?', Number(req.params.id), req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Item not found' });
  res.json({ ok: true });
});

// POST /api/items/:id/adjust { delta, reason } — writes a movement row; never lets qty go negative.
router.post('/:id/adjust', async (req, res) => {
  const id = Number(req.params.id);
  const delta = Number(req.body?.delta);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'delta must be a non-zero integer' });
  }
  const out = await transaction(async () => {
    const item = await get('SELECT id, qty FROM items WHERE id = ? AND user_id = ?', id, req.userId);
    if (!item) return null;
    const newQty = item.qty + delta;
    if (newQty < 0) {
      const err = new Error('Insufficient stock: adjustment would take qty below zero');
      err.statusCode = 400;
      throw err;
    }
    await run(`UPDATE items SET qty = ?, updated_at = ${NOW} WHERE id = ?`, newQty, id);
    await run('INSERT INTO movements (user_id, item_id, delta, reason, qty_after) VALUES (?, ?, ?, ?, ?)',
      req.userId, id, delta, reason, newQty);
    return newQty;
  });
  if (out === null) return res.status(404).json({ error: 'Item not found' });
  const item = await get(`${ITEM_SELECT} WHERE i.id = ? AND i.user_id = ?`, id, req.userId);
  res.json(serialize(item));
});

// Transaction errors with .statusCode should surface as that status.
router.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

module.exports = router;
