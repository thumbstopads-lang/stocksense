const express = require('express');
const { rows } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/dashboard { totalItems, totalValue, lowCount, outCount, recentMovements }
router.get('/', async (req, res) => {
  const agg = (await rows(
    `SELECT COUNT(*) AS total_items,
            COALESCE(SUM(qty * cost_price), 0) AS total_value,
            COALESCE(SUM(CASE WHEN qty = 0 THEN 1 ELSE 0 END), 0) AS out_count,
            COALESCE(SUM(CASE WHEN qty > 0 AND qty <= reorder_level THEN 1 ELSE 0 END), 0) AS low_count
     FROM items WHERE user_id = ?`,
    req.userId
  ))[0];
  const recentMovements = await rows(
    `SELECT m.id, m.item_id AS itemId, i.name AS itemName, m.delta, m.reason,
            m.qty_after AS qtyAfter, m.created_at AS createdAt
     FROM movements m JOIN items i ON i.id = m.item_id
     WHERE m.user_id = ? ORDER BY m.id DESC LIMIT 8`,
    req.userId
  );
  // pg returns COUNT/SUM as strings (BIGINT/NUMERIC) — coerce to numbers for a stable API shape.
  res.json({
    totalItems: Number(agg.total_items),
    totalValue: Number(agg.total_value),
    lowCount: Number(agg.low_count),
    outCount: Number(agg.out_count),
    recentMovements,
  });
});

module.exports = router;
