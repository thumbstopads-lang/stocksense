const express = require('express');
const { get, run, insertReturningId, transaction } = require('../db');
const { hashPassword, verifyPassword, signJWT, requireAuth } = require('../auth');

const router = express.Router();

async function ensureSettings(userId, businessName) {
  const existing = await get('SELECT id FROM settings WHERE user_id = ?', userId);
  if (!existing) {
    await run(
      'INSERT INTO settings (user_id, business_name) VALUES (?, ?)',
      userId, businessName || ''
    );
  }
}

router.post('/register', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const businessName = String(req.body?.businessName || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (await get('SELECT id FROM users WHERE email = ?', email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const userId = await transaction(async () => {
    const id = await insertReturningId(
      'INSERT INTO users (email, password_hash, business_name) VALUES (?, ?, ?)',
      email, hashPassword(password), businessName
    );
    await ensureSettings(id, businessName);
    return id;
  });
  res.status(201).json({ token: signJWT(userId), user: { id: userId, email, businessName } });
});

router.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const user = await get('SELECT id, email, password_hash, business_name FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  await ensureSettings(user.id, user.business_name);
  res.json({
    token: signJWT(user.id),
    user: { id: user.id, email: user.email, businessName: user.business_name },
  });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await get('SELECT id, email, business_name, created_at FROM users WHERE id = ?', req.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, businessName: user.business_name, createdAt: user.created_at });
});

module.exports = router;
