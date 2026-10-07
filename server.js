// Stocksense API server. Serves the front-end from public/ and the JSON API under /api.
const express = require('express');
const path = require('node:path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/movements', require('./routes/movements'));
app.use('/api/purchase-orders', require('./routes/pos'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use(express.static(path.join(__dirname, 'public')));
// SPA fallback for deep links
app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Final error handler (JSON)
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});

async function main() {
  // Seed the 5 demo business accounts (kirana, pharmacy, cafe, salon, hardware).
  // Idempotent — skips accounts that already exist. Disable with SEED_DEMO_ACCOUNTS=0.
  if (process.env.SEED_DEMO_ACCOUNTS !== '0') {
    try {
      await require('./seed').seedDemoAccounts();
    } catch (e) {
      console.error('Demo seed failed (continuing anyway):', e.message);
    }
  }

  app.listen(PORT, () => {
    console.log(`Stocksense listening on http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
