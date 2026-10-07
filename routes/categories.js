const express = require('express');
const { rows, run, insertReturningId } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await rows('SELECT id, name, created_at AS createdAt FROM categories WHERE user_id = ? ORDER BY name', req.userId));
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  try {
    const id = await insertReturningId('INSERT INTO categories (user_id, name) VALUES (?, ?)', req.userId, name);
    res.status(201).json({ id, name });
  } catch (e) {
    // SQLite: "UNIQUE constraint failed"; Postgres: code 23505 / "duplicate key ... unique constraint"
    if (e.code === '23505' || /unique/i.test(String(e.message))) {
      return res.status(409).json({ error: 'Category already exists' });
    }
    throw e;
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const r = await run('DELETE FROM categories WHERE id = ? AND user_id = ?', id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Category not found' });
  res.json({ ok: true });
});

module.exports = router;
