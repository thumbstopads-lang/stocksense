const express = require('express');
const { run, parseJSON } = require('../db');
const { requireAuth } = require('../auth');
const { getSettings } = require('./helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await getSettings(req.userId));
});

// PUT /api/settings { businessName, currency, defaultReorderLevel, customFields: [{key,label,type}] }
router.put('/', async (req, res) => {
  const b = req.body || {};
  const businessName = b.businessName === undefined ? undefined : String(b.businessName).trim();
  const currency = b.currency === undefined ? undefined : String(b.currency).trim().toUpperCase().slice(0, 3);
  const defaultReorderLevel = b.defaultReorderLevel === undefined ? undefined : Number(b.defaultReorderLevel);

  let customFields;
  if (b.customFields !== undefined) {
    if (!Array.isArray(b.customFields)) return res.status(400).json({ error: 'customFields must be an array' });
    customFields = [];
    const seen = new Set();
    for (const f of b.customFields) {
      const key = String(f?.key || '').trim();
      const label = String(f?.label || '').trim() || key;
      const type = f?.type === 'number' ? 'number' : 'text';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        return res.status(400).json({ error: `Invalid custom field key: "${f?.key}" (letters, digits, underscore; must not start with a digit)` });
      }
      if (seen.has(key)) return res.status(400).json({ error: `Duplicate custom field key: "${key}"` });
      seen.add(key);
      customFields.push({ key, label, type });
    }
  }

  const s = await getSettings(req.userId);
  await run(
    'UPDATE settings SET business_name = ?, currency = ?, default_reorder_level = ?, custom_fields = ? WHERE user_id = ?',
    businessName === undefined ? s.businessName : businessName,
    currency === undefined ? s.currency : currency,
    defaultReorderLevel === undefined ? s.defaultReorderLevel
      : (Number.isInteger(defaultReorderLevel) && defaultReorderLevel >= 0 ? defaultReorderLevel : s.defaultReorderLevel),
    customFields === undefined ? JSON.stringify(s.customFields) : JSON.stringify(customFields),
    req.userId
  );
  res.json(await getSettings(req.userId));
});

module.exports = router;
