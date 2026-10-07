const express = require('express');
const { rows, get, run, insertReturningId } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function serialize(s) {
  return { id: s.id, name: s.name, phone: s.phone, email: s.email, notes: s.notes, createdAt: s.created_at };
}

router.get('/', async (req, res) => {
  res.json((await rows('SELECT * FROM suppliers WHERE user_id = ? ORDER BY name', req.userId)).map(serialize));
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Supplier name is required' });
  const id = await insertReturningId(
    'INSERT INTO suppliers (user_id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
    req.userId, name, String(b.phone || '').trim(), String(b.email || '').trim(), String(b.notes || '').trim()
  );
  res.status(201).json(serialize(await get('SELECT * FROM suppliers WHERE id = ?', id)));
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const existing = await get('SELECT * FROM suppliers WHERE id = ? AND user_id = ?', id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Supplier not found' });
  const b = req.body || {};
  const name = b.name === undefined ? existing.name : String(b.name).trim();
  if (!name) return res.status(400).json({ error: 'Supplier name is required' });
  await run('UPDATE suppliers SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? AND user_id = ?',
    name,
    b.phone === undefined ? existing.phone : String(b.phone).trim(),
    b.email === undefined ? existing.email : String(b.email).trim(),
    b.notes === undefined ? existing.notes : String(b.notes).trim(),
    id, req.userId);
  res.json(serialize(await get('SELECT * FROM suppliers WHERE id = ?', id)));
});

router.delete('/:id', async (req, res) => {
  const r = await run('DELETE FROM suppliers WHERE id = ? AND user_id = ?', Number(req.params.id), req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Supplier not found' });
  res.json({ ok: true });
});

module.exports = router;
