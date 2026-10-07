const express = require('express');
const { rows, get, run, insertReturningId, transaction, parseLineItems, NOW, LINE_ITEMS_SUBQUERY } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['draft', 'ordered', 'received'];

function serialize(po) {
  const items = parseLineItems(po.line_items);
  return {
    id: po.id,
    supplierId: po.supplier_id,
    supplierName: po.supplier_name,
    status: po.status,
    notes: po.notes,
    createdAt: po.created_at,
    updatedAt: po.updated_at,
    items,
    totalQty: items.reduce((a, l) => a + l.qty, 0),
  };
}

async function fetchPO(id, userId) {
  const po = await get(
    `SELECT po.*, s.name AS supplier_name, ${LINE_ITEMS_SUBQUERY}
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = ? AND po.user_id = ?`,
    id, userId
  );
  return po ? serialize(po) : null;
}

// GET /api/purchase-orders
router.get('/', async (req, res) => {
  const pos = await rows(
    `SELECT po.*, s.name AS supplier_name, ${LINE_ITEMS_SUBQUERY}
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.user_id = ? ORDER BY po.id DESC`,
    req.userId
  );
  res.json(pos.map(serialize));
});

// POST /api/purchase-orders { items: [{itemId, qty, costPrice?}], supplierId?, notes? }
router.post('/', async (req, res) => {
  const b = req.body || {};
  const lines = b.items;
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  const supplierId = b.supplierId == null ? null : Number(b.supplierId);
  if (supplierId != null && !await get('SELECT id FROM suppliers WHERE id = ? AND user_id = ?', supplierId, req.userId)) {
    return res.status(400).json({ error: 'Supplier not found' });
  }
  // Validate all lines belong to this tenant before writing anything.
  const clean = [];
  for (const l of lines) {
    const item = await get('SELECT id, cost_price FROM items WHERE id = ? AND user_id = ?', Number(l?.itemId), req.userId);
    if (!item) return res.status(400).json({ error: `Item not found: ${l?.itemId}` });
    const qty = Number(l?.qty);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: 'Each line qty must be a positive integer' });
    clean.push({ itemId: item.id, qty, costPrice: l?.costPrice === undefined ? item.cost_price : Number(l.costPrice) || 0 });
  }
  const poId = await transaction(async () => {
    const id = await insertReturningId('INSERT INTO purchase_orders (user_id, supplier_id, notes) VALUES (?, ?, ?)',
      req.userId, supplierId, String(b.notes || '').trim());
    for (const l of clean) {
      await run('INSERT INTO purchase_order_items (po_id, item_id, qty, cost_price) VALUES (?, ?, ?, ?)',
        id, l.itemId, l.qty, l.costPrice);
    }
    return id;
  });
  res.status(201).json(await fetchPO(poId, req.userId));
});

// PATCH /api/purchase-orders/:id { status } — receiving adds stock + movement entries.
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const po = await get('SELECT * FROM purchase_orders WHERE id = ? AND user_id = ?', id, req.userId);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  const status = String(req.body?.status || '');
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  await transaction(async () => {
    await run(`UPDATE purchase_orders SET status = ?, updated_at = ${NOW} WHERE id = ?`, status, id);
    // Receiving stock in: only the first time it becomes 'received'.
    if (status === 'received' && po.status !== 'received') {
      const lines = await rows('SELECT item_id, qty FROM purchase_order_items WHERE po_id = ?', id);
      for (const l of lines) {
        const item = await get('SELECT qty FROM items WHERE id = ?', l.item_id);
        if (!item) continue;
        const newQty = item.qty + l.qty;
        await run(`UPDATE items SET qty = ?, updated_at = ${NOW} WHERE id = ?`, newQty, l.item_id);
        await run('INSERT INTO movements (user_id, item_id, delta, reason, qty_after) VALUES (?, ?, ?, ?, ?)',
          req.userId, l.item_id, l.qty, `PO #${id} received`, newQty);
      }
    }
  });
  res.json(await fetchPO(id, req.userId));
});

module.exports = router;
