# Tradeict Earner — architecture & business rules

Internal reference for engineers and operators. For deploy steps and env vars, see **[DEPLOYMENT.md](./DEPLOYMENT.md)**. For table-level schema detail, see **[DB_SCHEMA.md](./DB_SCHEMA.md)**.

---

## 1. Architecture overview

### Tech stack

| Layer | Choice |
| ----- | ------ |
| Framework | **Next.js 15** (App Router), **React 19**, **TypeScript** |
| Styling | **Tailwind CSS v4**, glassmorphism tokens in `src/app/globals.css` |
| Data | **PostgreSQL** via **Drizzle ORM** (`src/server/db/schema/*`, migrations in `drizzle/`) |
| Auth | **jose** HS256 JWTs in httpOnly cookies; separate user vs admin sessions |
| Email | **Nodemailer** + SMTP; templates under `src/server/email/` and `src/server/notifications/` |
| Payments | **Cashfree** PG (orders, webhooks, Drop-in on client) |

### App structure (high level)

```text
src/app/
  (public)/          # Marketing, legal, auth entry (route group — not in URL)
  user/              # End-user panel (middleware: role user)
  admin/             # Staff panel (middleware: role admin)
  api/               # REST-style routes: health, cron, webhooks, user JSON helpers
src/components/      # UI: layout (PanelShell), user/admin feature components, ui primitives
src/server/
  actions/           # Next.js "use server" mutations (forms)
  queries/           # Read models for pages
  jobs/              # Cron-callable batch logic (PnL, revenue week, reminders)
  payments/          # Cashfree + fulfillment + subscription extension math
  trading/           # Job queue, execution worker, Delta adapter wiring
  exchange/          # Credential crypto, Delta India REST helpers
  revenue/           # Revenue-due blocking / release
  audit/             # audit_logs vocabulary + logger
  db/                # Client, seed, schema
src/lib/             # Shared helpers (auth constants, formatting, OTP, session)
middleware.ts        # Protects /user/* and /admin/*
```

---

## 2. Business rule audit (requirements ↔ implementation)

| Requirement | Implementation notes |
| ----------- | -------------------- |
| **Admin approval before login** | `submitLoginPasswordAction` blocks `pending_approval`, `rejected`, `archived`; only `approved` and `paused` proceed to OTP (`src/server/actions/authLogin.ts`). |
| **Email OTP login** | After password check, 6-digit OTP emailed; `verifyLoginOtpAction` verifies hash, rate limits (`src/lib/rate-limit-db.ts`, `src/lib/constants-auth.ts`). |
| **Delta connection: test + ON/OFF** | Save/test/toggle in `exchangeConnection.ts`; UI `ExchangeConnectionPanel`; IP whitelist banner reads `NEXT_PUBLIC_SERVER_OUTBOUND_IP` (`src/app/user/exchange/page.tsx`). |
| **Strategy listing (name, description, fee, rev %, chart)** | `/user/strategies` → `getUserStrategyCatalog` + `UserStrategyCatalogCard` + `UserStrategySparkline` from `performance_chart_json`. |
| **Cashfree fixed subscription** | `strategyCheckout.ts` creates `payments` row + Cashfree order; webhook `fulfill-strategy-payment.ts` fulfills. |
| **30-day access, stacked renewals** | `access_days_purchased` default 30; `computeStackedAccessValidUntil` anchors on `max(now, current_end)` (`src/server/payments/subscription-access-stack.ts`). |
| **My Strategies lifecycle** | Run states in `user_strategy_runs` enum; activate/pause/inactivate in `userStrategyRun.ts`; gates in `strategy-activation-gates.ts`. |
| **Capital / leverage (user)** | `UserStrategySettingsForm` + `userStrategyRunSettings.ts`; activation requires both set. |
| **User dashboard: bot PnL, revenue dues** | `user-dashboard.ts` / `UserDashboardClient`; aggregates from bot orders / positions / ledgers as implemented in queries. |
| **Transactions ledger + rev-share fee column** | `user-transactions-ledger.ts` exposes `revenueShareFeeInr`; `UserTransactionsView` shows “Rev share fee”. |
| **Funds: balance, dues, payment block** | `user-funds-platform.ts`, `/user/funds`; revenue block via `revenue-due-gate.ts` + run status `blocked_revenue_due`. |
| **Admin users & strategies** | Admin CRUD under `src/app/admin/(panel)/users`, `strategies`, `user-strategies`, etc.; actions in `adminUsers.ts`, `adminStrategies.ts`, … |
| **Per-user fee / rev % overrides** | `user_strategy_pricing_overrides` with `effective_from` / `effective_until` / `is_active`; resolution picks latest row covering “now” (`effectiveRevenueSharePercent` in revenue engine, checkout price queries). |
| **Reminders, waivers, payment links** | Daily cron runs `runDailyReminders`; admin sends revenue reminders / bulk from revenue UI; `adminApplyFeeWaiverFormAction`; Cashfree checkout for revenue rows (`revenueShareCheckout.ts`). |
| **Versioned terms** | `terms_and_conditions` with status/version; admin publish workflow (`adminTermsActions.ts`); public `/terms`. |
| **Audit logs** | `logAdminAction` / `audit_logs`; admin **Audit logs** page; catalog `src/server/audit/audit-catalog.ts`. |

**Known nuances (not bugs):**

- **Weekly revenue job** only auto-runs the previous IST week on **Monday IST** unless `week_start` / `week_end` query params are passed (backfill).
- **Delta live trading** is gated by `DELTA_TRADING_ENABLED` and product-id map env; otherwise a mock/safe path may be used for development.
- **Performance chart** on catalog cards is a **sparkline from JSON** configured by admins; empty/invalid JSON shows “Chart data pending”.

---

## 3. Major modules

### Auth (`src/server/actions/authLogin.ts`, `src/lib/session.ts`, `middleware.ts`)

- User: password → OTP → session cookie.
- Admin: dedicated login + bcrypt on `admins`.
- Middleware enforces role-scoped areas; optional dev bypass via env (documented in README / DEPLOYMENT).

### Billing (`src/server/payments/*`, `src/server/actions/strategyCheckout.ts`, `revenueShareCheckout.ts`)

- Strategy subscription payments linked to `payments.external_order_id` = payment row id (UUID).
- Webhook verifies Cashfree signature, fulfills idempotently (`already_success` short-circuit).
- Revenue-share payments link `payments.revenue_share_ledger_id`; success triggers ledger update and optional `releaseRevenueBlock`.

### Trading engine (`src/server/trading/*`)

- Jobs in `trading_execution_jobs`; worker script `npm run trading:worker`.
- **Execution gate hierarchy** (see `execution-worker.ts`): correlation dedupe → global emergency stop → revenue block rules → pause states → strategy catalog → exchange readiness → capital/leverage → place order; insufficient margin can auto-pause run.

### Cron & background tasks

| Entry | Purpose |
| ----- | ------- |
| `GET /api/cron/daily-pnl-snapshot` | IST daily PnL snapshot into `daily_pnl_snapshots`; then `enforceRevenueDueBlocks`; then subscription + revenue **email reminders**. |
| `GET /api/cron/weekly-revenue-share` | Closes prior Mon–Sun IST week into `weekly_revenue_share_ledgers` (Monday IST default; backfill via query params). |
| `npm run trading:worker` | Drains trading execution queue (intended to run every minute or similar via PM2/cron). |

All cron HTTP routes require `Authorization: Bearer $CRON_SECRET` (or documented `?secret=` where supported).

---

## 4. Key workflows

### Subscription extension (stacked renewal)

1. User pays via Cashfree for a strategy.
2. Webhook locks `payments` row, sets status `success`, updates **latest** non-deleted `user_strategy_subscriptions` for `(user_id, strategy_id)` or creates one.
3. `access_valid_until = computeStackedAccessValidUntil(now, previous_end, access_days_purchased)`.

### Weekly revenue ledger

1. Daily snapshots accumulate realized PnL per subscription per IST date.
2. Weekly job sums snapshots for `[week_start_ist, week_end_ist]`, applies **effective revenue %** at end of Sunday IST (override row or strategy default).
3. Inserts ledger row idempotently (`onConflictDoNothing` on subscription + week start).

### Revenue block & release

- Overdue unpaid/partial ledgers past grace (`REVENUE_SHARE_BLOCK_GRACE_HOURS`) can move runs from `active` to `blocked_revenue_due` (`enforceRevenueDueBlocks`).
- Successful revenue-share payment fulfillment can call `releaseRevenueBlock` for the user after webhook commit.

---

## 5. Setup: local vs production

| Concern | Local | Production |
| ------- | ----- | ---------- |
| Env | `.env` from `.env.example` | Secrets on host only; see **DEPLOYMENT.md** |
| DB | `db:push` or `db:migrate` | **migrate** only |
| Auth bypass | `AUTH_PHASE1_BYPASS` for quick UI dev | **disabled** |
| Cron | `curl` with `CRON_SECRET` or skip | OS cron or Vercel Cron |
| Worker | Optional manual `npm run trading:worker` | PM2 / systemd on a schedule |
| Seed | `npm run db:seed` | Once with `ALLOW_DB_SEED=true`, then off |

---

## 6. Assumptions made during development

1. **Single primary region clock** for “business day” is **IST** (`Asia/Kolkata`) for revenue weeks and snapshot dates; `access_valid_until` is stored as **timestamptz** (absolute instant).
2. **One logical subscription row** per `(user, strategy)` for renewals; renewals update the same row’s `access_valid_until`.
3. **Cashfree `order_id`** is the internal `payments.id` UUID (webhook validates shape).
4. **Exchange secrets** are AES-256-GCM with a **32-byte UTF-8 ASCII key** from env.
5. **Super admin** bootstrap via seed or manual DB insert; first admin email/password from env when seeding.

---

## 7. Future improvement suggestions

- **E2E tests** for login, checkout return path, and webhook idempotency (staging Cashfree sandbox).
- **Observability**: structured logging (JSON), request ids, metrics for job queue depth and webhook failures.
- **Vercel + long workers**: if the app moves fully serverless, replace or supplement `trading:worker` with a queue consumer that fits the host’s execution limits.
- **Stronger override conflict policy**: explicit UI validation when two override windows overlap for the same user/strategy.
- **User-facing invoice PDF** download from `invoices` rows.
- **Delta product catalog sync** job instead of static `DELTA_INDIA_SYMBOL_TO_PRODUCT_ID` JSON.

---

## 8. Related documents

- **[README.md](./README.md)** — quick start, feature summary, links.
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — production env, PM2, cron, health checks, first admin.
- **[DB_SCHEMA.md](./DB_SCHEMA.md)** — column-level reference.
