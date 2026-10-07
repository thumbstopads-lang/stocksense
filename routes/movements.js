// Movements: immutable stock history log (read-only API).
const express = require('express');
const { rows } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/movements?itemId=&limit=
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const itemId = req.query.itemId ? Number(req.query.itemId) : null;
  let where = 'm.user_id = ?';
  const params = [req.userId];
  if (itemId) { where += ' AND m.item_id = ?'; params.push(itemId); }
  const data = await rows(
    `SELECT m.id, m.item_id AS itemId, i.name AS itemName, m.delta, m.reason,
            m.qty_after AS qtyAfter, m.created_at AS createdAt
     FROM movements m JOIN items i ON i.id = m.item_id
     WHERE ${where} ORDER BY m.id DESC LIMIT ?`,
    ...params, limit
  );
  res.json(data);
});

module.exports = router;
