# Tradeict Earner — production deployment

This guide covers environment variables, secrets, process managers, cron jobs, database setup, and creating the first super admin.

## 1. Environment variables

Copy the template and fill in values on the server (never commit `.env`).

```bash
cp .env.example .env
```

### Required for a full production stack

| Variable | Purpose |
| -------- | ------- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | At least **32 characters** — signs user/admin session JWTs |
| `CRON_SECRET` | Bearer secret for `/api/cron/*` (see [Cron](#4-cron-jobs)) |
| `EXCHANGE_SECRETS_ENCRYPTION_KEY` | Exactly **32 ASCII characters** — AES-256-GCM key for Delta API ciphertext at rest |
| `NEXT_PUBLIC_APP_URL` | Public site origin, no trailing slash (e.g. `https://tradeictearner.online`) — used for Cashfree return/webhook URLs when set |
| `NEXT_PUBLIC_SERVER_OUTBOUND_IP` | **Public** outbound IPv4/IPv6 of the VPS (or NAT gateway) shown on `/user/exchange` for Delta API IP whitelisting |
| SMTP + `EMAIL_FROM` | Transactional email (registration, OTP, billing) |

### Exchange encryption key (32 bytes as UTF-8)

The app expects **exactly 32 UTF-8 code units** that encode to **32 bytes** (use ASCII).

**Generate a strong random key (recommended):**

```bash
openssl rand -hex 16
```

The output is 32 hex characters. Put it in `.env`:

```env
EXCHANGE_SECRETS_ENCRYPTION_KEY=paste_the_32_char_hex_here
```

**Do not** base64-wrap the key; the literal string in `.env` is the key material.

On server start, if the key is **set but wrong length or not 32 UTF-8 bytes**, the Node process will **exit** with an error. If the key is **missing**, a **warning** is logged in production; saving/testing Delta keys will fail until you set it.

### Optional / feature flags

See `.env.example` for: `AUTH_PHASE1_BYPASS`, `AUTH_PHASE1_ALLOW_STUB`, Cashfree (`CASHFREE_*`), `DELTA_TRADING_ENABLED`, `REVENUE_SHARE_BLOCK_GRACE_HOURS`, `SEED_*`, `ALLOW_DB_SEED`, etc.

---

## 2. Database migrations and seed

```bash
npm install
npm run db:migrate
```

For a fresh dev database you may use `npm run db:push` instead; production should use **migrations**.

### Seed (first deploy)

1. Set strong `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (8+ chars), `SEED_ADMIN_NAME` in `.env`.
2. In production, set **`ALLOW_DB_SEED=true`** only for the run that creates the first admin, then remove it or set to `false`.

```bash
ALLOW_DB_SEED=true npm run db:seed
```

The seed is idempotent: it inserts a **`super_admin`** if that email is not already present, plus default app settings, sample strategies (if missing), and terms placeholder.

### First super admin without re-seeding

If you prefer not to use the seed script, insert an admin row manually (bcrypt hash of password) or run seed once with `ALLOW_DB_SEED=true` as above. The seed targets **`role: super_admin`** for `SEED_ADMIN_EMAIL`.

---

## 3. Build and PM2 (web + trading worker)

```bash
npm run build
```

### Web application

```bash
pm2 start npm --name tradeict -- start
```

Or use an ecosystem file that sets `cwd`, `NODE_ENV=production`, and loads env from a file.

### Trading queue worker (cron-friendly one-shot)

The worker drains `trading_execution_jobs` and exits:

```bash
pm2 start npm --name tradeict-worker -- run trading:worker --no-autorestart
```

Schedule it with **cron** or **PM2 cron** so it runs every minute (or as needed), e.g.:

```cron
* * * * * cd /path/to/tradeict-earner-bot && /usr/bin/npm run trading:worker >> /var/log/tradeict-worker.log 2>&1
```

Use the same `DATABASE_URL` and env as the web process.

### Native TA worker (RSI scalper, long-lived)

This process polls Delta public candles and may enqueue `trading_execution_jobs` via `dispatchStrategyExecutionSignal`. It does **not** run Next.js, so it stays off the web server’s event loop.

1. Set **`TA_RSI_SCALPER_ENABLED=true`**, **`TA_RSI_SCALPER_STRATEGY_ID`** (UUID of the strategy row), **`TA_RSI_SCALPER_QUANTITY`**, and the usual DB / trading env (see `.env.example`).
2. Align **`TA_RSI_SCALPER_SYMBOL`** with your Delta India product map (`DELTA_INDIA_SYMBOL_TO_PRODUCT_ID`) if execution uses India symbols (e.g. `BTCUSD` vs `BTC_USDT` on global API).
3. Start alongside the web app and the queue worker:

```bash
pm2 start npm --name tradeict-ta-worker -- run trading:ta-worker
```

The default interval is **60 seconds** (`TA_RSI_SCALPER_INTERVAL_MS`). Keep **`npm run trading:worker`** on cron or PM2 as well so enqueued jobs are drained.

---

## 4. Cron jobs

Jobs live under `src/app/api/cron/` and expect:

```http
Authorization: Bearer <CRON_SECRET>
```

or `?secret=<CRON_SECRET>` where implemented.

### OS cron + curl (VPS)

Example (adjust host and paths):

```cron
5 0 * * * curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" "https://tradeictearner.online/api/cron/daily-pnl-snapshot" >/dev/null
40 18 * * 1 curl -fsS -H "Authorization: Bearer YOUR_CRON_SECRET" "https://tradeictearner.online/api/cron/weekly-revenue-share" >/dev/null
```

Use UTC times that match your intended IST schedule (see route comments in each cron handler).

### Vercel Cron

If you deploy on Vercel, add `vercel.json` cron entries pointing at these routes and set `CRON_SECRET` in the project environment so the handler authorizes the request.

---

## 5. Health checks

| Endpoint | Use |
| -------- | --- |
| `GET /api/health` | Uptime monitoring — JSON `{ "status": "healthy", "timestamp": "..." }`, no database |
| `GET /api/health/db` | Confirms `DATABASE_URL` / `SELECT 1` |

---

## 6. Reverse proxy and TLS

Terminate TLS at **nginx**, **Caddy**, or a cloud load balancer. Proxy to `127.0.0.1:3000` (or your Node listen port). Set `NEXT_PUBLIC_APP_URL` and any cookie `secure` expectations to match HTTPS.

---

## 7. Security checklist

- `AUTH_PHASE1_BYPASS=false` and `AUTH_PHASE1_ALLOW_STUB=false` in real production.
- Strong `AUTH_SECRET`, `CRON_SECRET`, and `EXCHANGE_SECRETS_ENCRYPTION_KEY`.
- Restrict database and SMTP credentials to the app host.
- Set **`NEXT_PUBLIC_SERVER_OUTBOUND_IP`** to the real outbound IP users must whitelist on Delta.

For schema details, see [DB_SCHEMA.md](./DB_SCHEMA.md).
