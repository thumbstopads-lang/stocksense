# StockSense — inventory management SaaS

Multi-tenant inventory API + web app. Each business signs up, manages its own items, categories, suppliers, purchase orders and stock history — and can define custom per-item fields (e.g. brand, expiry date, shelf) so the app molds to the business.

## Stack

- **Node.js 22+** (uses the built-in `node:sqlite` module — no native DB driver needed)
- **Express 5** + **`pg`** (Postgres driver, only used when `DATABASE_URL` is set)
- Auth: `scrypt` password hashing + hand-rolled HS256 JWT via `node:crypto` (no auth libraries)
- Storage: **SQLite** file at `./data/stocksense.db` by default; **Postgres** when `DATABASE_URL` is set (same API, same schema, automatic)

## Prerequisites

Node.js 22 or newer (`node --version`).

## Install & run

```bash
npm install
node server.js        # default port 3000
```

Or with a custom port / JWT secret:

```bash
PORT=3100 JWT_SECRET="a-long-random-secret" node server.js
```

Then open http://localhost:3000 in a browser. Register a business account — or skip signup and
click one of the **demo businesses** on the login screen:

| Demo login | Password | Business |
|---|---|---|
| `kirana@demo` | `kirana123` | Sharma Kirana Store (groceries) |
| `pharmacy@demo` | `pharmacy123` | CityCare Pharmacy (medicines, expiry tracking) |
| `cafe@demo` | `cafe123` | Brew & Bean Cafe |
| `salon@demo` | `salon123` | Glamour Salon |
| `hardware@demo` | `hardware123` | Gupta Hardware Store |

Each demo account is a fully separate business with its own tailored items, categories,
suppliers and custom fields (e.g. the pharmacy tracks *Expiry date* / *Batch no.*).
Your login session persists — you won't be asked to log in again on the same browser.
Demo accounts are seeded automatically on first start (idempotent); disable with
`SEED_DEMO_ACCOUNTS=0`.

## Troubleshooting

- **"Cannot reach the StockSense server" / buttons do nothing:** you must open the app
  through the server — `http://localhost:3000` — not by double-clicking `public/index.html`.
  The HTML file alone has no backend to talk to.
- **Port already in use:** start with a different port: `PORT=3100 node server.js`.
- **Starting over:** stop the server and delete `data/stocksense.db*`; demo accounts
  are re-seeded on next start.

## Environment variables

| Var | Default | Notes |
|-----|---------|-------|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | `dev-secret-change-in-production` | **Change this in production.** Signs all auth tokens. |
| `DATABASE_URL` | *(unset)* | When set, the app uses **Postgres** (via `pg`, SSL on) instead of the local SQLite file. This is how the hosted version runs. |
| `SEED_DEMO_ACCOUNTS` | *(unset = seed)* | Set to `0` to skip seeding the 5 demo businesses. |

## Deploy free (Render + Neon) — $0

This is the recommended free hosting path. The app detects `DATABASE_URL` and automatically
switches from SQLite to Postgres — no code changes needed.

**1. Create a free Postgres database (Neon)**
- Sign up at [neon.tech](https://neon.tech) (free tier, no credit card).
- Create a project → copy the **connection string** (it looks like
  `postgresql://user:password@ep-xxx.neon.tech/dbname?sslmode=require`).

**2. Create a free web service (Render)**
- Sign up at [render.com](https://render.com) (free tier, no credit card).
- **New → Web Service** → connect your GitHub repo containing this `app/` folder.
- Build command: `npm install` · Start command: `npm start`
- Add environment variables:
  - `DATABASE_URL` → paste the Neon connection string
  - `JWT_SECRET` → a long random secret — generate one with:
    `openssl rand -base64 32`
  - `SEED_DEMO_ACCOUNTS` → `0` (optional; keeps other people's demo data out of your production DB)
- Deploy. Your app will be live at `https://<your-app>.onrender.com`.

**Free-tier realities (so there are no surprises):**
- Render's free service **sleeps after 15 minutes** of no traffic — the first visitor
  then waits ~30 seconds while it wakes up. Fine for demos and early users.
- When you have paying customers, Render's **~$7/month Starter plan** removes the
  sleeping entirely (plus faster CPU). That's the normal upgrade path.
- Neon's free Postgres does not expire and survives Render's sleeps/restarts —
  your data is safe there, not on Render's throwaway disk.

## API overview

All routes under `/api` return JSON. Auth routes are public; everything else requires `Authorization: Bearer <token>`.

| Method & path | Purpose |
|---|---|
| `POST /api/auth/register` `{email, password, businessName}` | Create account → `{token, user}` |
| `POST /api/auth/login` `{email, password}` | Log in → `{token, user}` |
| `GET /api/auth/me` | Current user |
| `GET /api/items?q=&category=&status=ok\|low\|out&sort=&order=` | List items (search/filter/sort) |
| `POST /api/items` | Create item |
| `GET /api/items/:id` · `PUT /api/items/:id` · `DELETE /api/items/:id` | Item CRUD (qty only changes via `/adjust`) |
| `POST /api/items/:id/adjust` `{delta, reason}` | Adjust stock; writes a movement row; 400 if it would go negative |
| `GET /api/categories` · `POST /api/categories` · `DELETE /api/categories/:id` | Categories |
| `GET/POST/PUT/DELETE /api/suppliers` | Suppliers (name, phone, email, notes) |
| `GET /api/movements?itemId=&limit=` | Immutable stock history |
| `GET /api/purchase-orders` · `POST /api/purchase-orders` `{items:[{itemId,qty,costPrice?}], supplierId?, notes?}` | Purchase orders |
| `PATCH /api/purchase-orders/:id` `{status: draft\|ordered\|received}` | Status change; receiving adds stock + movements (once) |
| `GET /api/settings` · `PUT /api/settings` `{businessName, currency, defaultReorderLevel, customFields:[{key,label,type}]}` | Tenant settings + custom field schema |
| `GET /api/dashboard` | `{totalItems, totalValue, lowCount, outCount, recentMovements}` |
| `GET /api/health` | Public health check |

Multi-tenancy: every table carries `user_id` and every query is scoped to the authenticated user.

## Deployment notes

- **Data persistence (local SQLite mode):** the SQLite file lives in `./data/` (gitignored). On any Node host (VPS, Render, Railway, Fly.io…), mount a **persistent volume** at `./data` or the database resets on every redeploy.
- **Data persistence (hosted Postgres mode):** set `DATABASE_URL` and data lives in Postgres (e.g. Neon free tier) — safe across sleeps, restarts and redeploys. This is the mode the Render + Neon free deploy above uses.
- **Concurrency:** SQLite + WAL mode handles a small-to-medium multi-user load fine. Postgres mode (via `DATABASE_URL`) handles heavier write concurrency.
- **Secrets:** set a strong `JWT_SECRET` env var; never ship the dev default.
- **Backups:** back up `data/stocksense.db` on a schedule (it's a single file).
- **TLS:** run behind HTTPS in production (reverse proxy or the host's TLS).

## Project layout

```
app/
├── server.js        # Express app, static front-end, /api routes
├── db.js            # Dual-backend storage: SQLite (default) or Postgres (DATABASE_URL)
├── auth.js          # scrypt hashing, hand-rolled JWT, auth middleware
├── routes/          # auth, items, categories, suppliers, movements, pos, settings, dashboard
├── public/          # front-end: index.html, styles.css, app.js
└── data/            # SQLite file (created at runtime, gitignored)
```
