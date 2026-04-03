# Tradeict Earner — database schema

PostgreSQL schema managed with **Drizzle ORM**. Migrations live in `drizzle/`. Source modules: `src/server/db/schema/`.

## Conventions

| Topic | Approach |
| ----- | -------- |
| **Money** | `numeric(precision, scale)` — INR amounts typically `numeric(12,2)` or `numeric(14,2)`; quantities/prices `numeric(24,8)`. |
| **Instants** | `timestamptz` — stored in UTC; application uses **Asia/Kolkata (IST)** for billing weeks and calendar dates. |
| **IST calendar** | `date` columns named `*_date_ist` or `*_start_date_ist` / `*_end_date_ist` for week/day buckets in IST. |
| **Statuses** | PostgreSQL **enums** (Drizzle `pgEnum`) — avoid boolean flags for lifecycle. |
| **Soft delete** | `deleted_at timestamptz` where noted — queries must filter `IS NULL` in app code. |
| **Secrets** | Exchange credentials stored as **AES-256-GCM** ciphertext; env key `EXCHANGE_SECRETS_ENCRYPTION_KEY` (exactly 32 ASCII chars); rotation via `encryption_key_version`. |

---

## Entity relationship (overview)

```text
admins ─────┬──────────────────────────────────────────────────────────────
            │ approved_by, reviewed_by, created_by, set_by, actor_admin_id
users ──────┼── login_otps, exchange_connections, user_strategy_subscriptions
            │   payments, trades, daily_pnl_snapshots, profile_change_requests
            │   reminders, fee_waivers, weekly_revenue_share_ledgers (user_id)
            │
strategies ─┴── strategy_performance_snapshots, user_strategy_subscriptions
                 user_strategy_pricing_overrides, trades, weekly_revenue_share_ledgers

user_strategy_subscriptions ── user_strategy_runs (1:1)
                             ├── payments, invoices
                             ├── weekly_revenue_share_ledgers
                             ├── daily_pnl_snapshots
                             └── trades

payments ── invoices (1:1)
weekly_revenue_share_ledgers ── fee_waivers (optional link)

terms_versions, app_settings, audit_logs, email_logs — global / cross-cutting
```

---

## Tables

### `connectivity_check` (Phase 1)

Health-check table. **Retained** for existing connectivity probes and migration history.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `label` | text | Default `phase1` |
| `created_at` | timestamptz | |

---

### `admins`

Staff accounts (separate from end users). **bcrypt** `password_hash`; roles `super_admin` \| `staff`.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `email` | text UNIQUE | Login identity (admin OTP/UI later) |
| `name` | text | |
| `password_hash` | text | |
| `role` | `admin_role` | |
| `deleted_at` | timestamptz | Soft delete |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `deleted_at`

---

### `users`

End customers. Login is allowed when `approval_status` is **`approved`** or **`paused`** (OTP + session). **`pending_approval`**, **`rejected`**, and **`archived`** cannot complete sign-in.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `email` | text UNIQUE | |
| `name`, `phone` | text | Nullable (`phone` = mobile) |
| `address` | text | Nullable; mailing / KYC-style address |
| `whatsapp_number` | text | Nullable |
| `password_hash` | text | bcrypt; login uses password then email OTP |
| `approval_status` | `user_approval_status` | `pending_approval` \| `approved` \| `rejected` \| `paused` \| `archived` |
| `approval_notes` | text | Shown to user on rejection when set |
| `admin_internal_notes` | text | Staff-only; never exposed to the user |
| `approved_at` | timestamptz | |
| `approved_by_admin_id` | uuid FK → `admins` | `ON DELETE SET NULL` |
| `deleted_at` | timestamptz | Soft delete |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `approval_status`, `deleted_at`

---

### `login_otps`

Email OTP storage — store **hash only**, never plaintext codes.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `email` | text | Target mailbox |
| `user_id` | uuid FK → `users` | Nullable pre-registration |
| `code_hash` | text | |
| `purpose` | `otp_purpose` | `login` \| `verify_email` \| `password_reset` |
| `expires_at`, `consumed_at` | timestamptz | |
| `ip_address` | text | |
| `attempt_count` | int | |
| `created_at` | timestamptz | |

**Indexes:** `(email, expires_at)`, `user_id`

---

### `auth_rate_buckets` (Phase 4)

Fixed-window counters for auth rate limiting (password failures, OTP send/verify buckets). Keys are opaque strings such as `pwd:email@example.com`, `otp_send:email@example.com`, `forgot:email@example.com`.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `key` | text PK | Bucket identifier |
| `count` | int | Attempts in current window |
| `window_started_at` | timestamptz | Window start (UTC) |

---

### `exchange_connections`

Delta India (extensible) API credentials per user.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK → `users` | `ON DELETE CASCADE` |
| `provider` | `exchange_provider` | `delta_india` |
| `status` | `exchange_connection_status` | `active` \| `disabled_user` \| `disabled_admin` \| `error` |
| `api_key_ciphertext`, `api_secret_ciphertext` | text | AES-256-GCM payloads (`v1:iv:tag:data` segments, base64) |
| `encryption_key_version` | int | |
| `last_test_at` | timestamptz | |
| `last_test_status` | `exchange_connection_test_status` | `unknown` \| `success` \| `failure` \| `invalid_credentials` \| `permission_denied` |
| `last_test_message` | text | |
| `deleted_at` | timestamptz | Soft delete |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `user_id`, `(user_id, provider)`, **partial unique** `(user_id, provider)` where `deleted_at IS NULL` (`exchange_connections_user_provider_uidx`)

---

### `strategies`

Catalog of prebuilt strategies; default fee and revenue share (overridable per user).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `slug` | text UNIQUE | URL-safe key |
| `name`, `description` | text | |
| `default_monthly_fee_inr` | numeric(12,2) | Default ₹499 |
| `default_revenue_share_percent` | numeric(5,2) | e.g. 50.00 |
| `visibility` | `strategy_visibility` | `public` \| `hidden` — catalog visibility (Phase 9) |
| `status` | `strategy_status` | `active` \| `paused` \| `hidden` (legacy) \| `archived` — lifecycle |
| `risk_label` | `strategy_risk_label` | `low` \| `medium` \| `high` |
| `recommended_capital_inr` | numeric(14,2) | Nullable marketing hint |
| `max_leverage` | numeric(10,2) | Nullable cap hint |
| `performance_chart_json` | jsonb | Nullable; array of `{ date, value }` for admin chart |
| `deleted_at` | timestamptz | Soft delete |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `status`, `deleted_at`, `visibility`

---

### `strategy_performance_snapshots`

Point-in-time marketing / dashboard metrics for a strategy.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `strategy_id` | uuid FK → `strategies` | `ON DELETE CASCADE` |
| `captured_at` | timestamptz | |
| `metric_equity_inr` | numeric(24,8) | |
| `metric_return_pct` | numeric(10,4) | |
| `extra_metrics` | jsonb | |
| `created_at` | timestamptz | |

**Indexes:** `(strategy_id, captured_at)`

---

### `user_strategy_subscriptions`

Paid access to a strategy. **30-day** access is modeled by `access_valid_until`; renewals **stack** by extending from `max(now, current_end)` in application logic.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK → `users` | |
| `strategy_id` | uuid FK → `strategies` | `ON DELETE RESTRICT` |
| `status` | `user_strategy_subscription_status` | Includes `purchased_pending_activation` |
| `access_valid_until` | timestamptz | Stacked subscription end |
| `purchased_at` | timestamptz | |
| `first_activation_at` | timestamptz | When user first activated bot |
| `deleted_at` | timestamptz | Soft delete |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `user_id`, `strategy_id`, `(status, access_valid_until)`, `(user_id, strategy_id)`

---

### `user_strategy_runs`

**One row per subscription** — activation/pause state machine (bot may be purchased but not active).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `subscription_id` | uuid UNIQUE FK → `user_strategy_subscriptions` | |
| `status` | `user_strategy_run_status` | `inactive`, `active`, `paused`, `paused_revenue_due`, `paused_exchange_off`, `paused_admin`, `expired`, `blocked_revenue_due` |
| `capital_to_use_inr` | numeric(14,2) | User setting |
| `leverage` | numeric(10,2) | User setting |
| `activated_at`, `paused_at` | timestamptz | |
| `last_state_reason` | text | |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `status`

---

### `user_strategy_pricing_overrides`

Admin overrides for **monthly fee** and/or **revenue share %** per user per strategy, time-bounded.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id`, `strategy_id` | uuid FK | |
| `monthly_fee_inr_override` | numeric(12,2) | Nullable |
| `revenue_share_percent_override` | numeric(5,2) | Nullable |
| `effective_from`, `effective_until` | timestamptz | Open-ended if `effective_until` null |
| `set_by_admin_id` | uuid FK → `admins` | |
| `created_at` | timestamptz | |

**Indexes:** `(user_id, strategy_id, effective_from)`

---

### `payments`

Cashfree (extensible) payment records.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK → `users` | |
| `strategy_id` | uuid FK → `strategies` | Nullable on legacy rows; set for strategy checkout (Phase 11) |
| `provider` | `payment_provider` | `cashfree` |
| `external_order_id`, `external_payment_id` | text | Cashfree order / payment ids; `order_id` = payment row id |
| `amount_inr` | numeric(12,2) | Server-calculated from overrides + defaults |
| `currency` | text | Default `INR` |
| `status` | `payment_status` | Includes `created`, `pending`, `success`, `failed`, `expired`, `refunded` |
| `subscription_id` | uuid FK | Nullable until webhook fulfillment |
| `access_days_purchased` | int | Default 30 |
| `metadata` | jsonb | Provider payloads |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `(user_id, status)`, `subscription_id`, `strategy_id`  
**Unique (partial):** `(provider, external_order_id)` where `external_order_id IS NOT NULL`

---

### `invoices`

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `payment_id` | uuid UNIQUE FK → `payments` | 1:1 |
| `invoice_number` | text UNIQUE | |
| `amount_inr`, `tax_amount_inr` | numeric(12,2) | |
| `line_description` | text | |
| `status` | `invoice_status` | |
| `issued_at` | timestamptz | |
| `created_at` | timestamptz | |

**Indexes:** `status`

---

### `weekly_revenue_share_ledgers`

**Weekly** revenue share in **IST** week boundaries (`week_start_date_ist` / `week_end_date_ist` inclusive dates).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK → `users` | Denormalized for reporting |
| `subscription_id` | uuid FK | |
| `strategy_id` | uuid FK | Denormalized; keep in sync with subscription |
| `week_start_date_ist`, `week_end_date_ist` | date | |
| `amount_due_inr`, `amount_paid_inr` | numeric(14,2) | |
| `status` | `revenue_ledger_status` | `unpaid` \| `partial` \| `paid` \| `waived` |
| `due_at`, `paid_at` | timestamptz | |
| `metadata` | jsonb | |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `(user_id, status)`, `subscription_id`  
**Unique:** `(subscription_id, week_start_date_ist)` — one row per subscription per IST week

---

### `fee_waivers`

Admin waiver tied to user, optional strategy/subscription/ledger.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `strategy_id`, `subscription_id`, `revenue_ledger_id` | uuid FK | Nullable |
| `amount_inr` | numeric(14,2) | Null = full waiver of linked ledger |
| `reason` | text | |
| `created_by_admin_id` | uuid FK → `admins` | |
| `created_at` | timestamptz | |

**Indexes:** `user_id`, `revenue_ledger_id`

---

### `trades`

Executed bot/exchange trades (immutable fact table).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `subscription_id` | uuid FK | Nullable |
| `exchange_connection_id` | uuid FK | Nullable |
| `strategy_id` | uuid FK | |
| `external_trade_id` | text | Exchange id |
| `symbol` | text | |
| `side` | `trade_side` | `buy` \| `sell` |
| `quantity`, `price` | numeric(24,8) | |
| `fee_inr`, `realized_pnl_inr` | numeric(14,2) | |
| `executed_at` | timestamptz | |
| `raw_payload` | jsonb | |
| `created_at` | timestamptz | |

**Indexes:** `(user_id, executed_at)`, `subscription_id`, `strategy_id`  
**Unique (partial):** `(exchange_connection_id, external_trade_id)` where connection id not null

---

### `daily_pnl_snapshots`

Per subscription, per **IST calendar date**.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `subscription_id` | uuid FK | |
| `snapshot_date_ist` | date | |
| `realized_pnl_inr`, `unrealized_pnl_inr`, `total_pnl_inr` | numeric(14,2) | |
| `created_at` | timestamptz | |

**Indexes:** `(user_id, snapshot_date_ist)`  
**Unique:** `(subscription_id, snapshot_date_ist)`

---

### `profile_change_requests`

User profile edits requiring **admin approval** before applying to `users`.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `changes_json` | jsonb | Keys: `name`, `address`, `phone` (mobile), `whatsapp_number`, `email` — each `{ old, new }` (string or null). Only changed fields appear. |
| `status` | `profile_change_request_status` | |
| `reviewed_at` | timestamptz | |
| `reviewed_by_admin_id` | uuid FK → `admins` | |
| `review_note` | text | |
| `created_at`, `updated_at` | timestamptz | |

**Indexes:** `(user_id, status)`, `status`

---

### `terms_versions`

Versioned **terms & conditions** (markdown).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `version` | int UNIQUE | Monotonic display version |
| `title` | text | |
| `content_md` | text | |
| `effective_from` | timestamptz | |
| `created_by_admin_id` | uuid FK | |
| `created_at` | timestamptz | |

**Indexes:** `effective_from`

---

### `reminders`

Scheduled notifications (email channel first).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `user_id` | uuid FK | Nullable for non-user-scoped jobs |
| `type` | `reminder_type` | |
| `channel` | `reminder_channel` | `email` |
| `payload_json` | jsonb | |
| `scheduled_for`, `sent_at` | timestamptz | |
| `status` | `reminder_status` | |
| `created_at` | timestamptz | |

**Indexes:** `(scheduled_for, status)`, `user_id`

---

### `audit_logs`

Immutable **audit trail** (admin/user/system).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `actor_type` | `audit_actor_type` | |
| `actor_admin_id`, `actor_user_id` | uuid FK | Nullable |
| `action` | text | e.g. `user.approved` |
| `entity_type`, `entity_id` | text / uuid | |
| `metadata` | jsonb | |
| `ip_address` | text | |
| `created_at` | timestamptz | |

**Indexes:** `(entity_type, entity_id)`, `created_at`, `actor_admin_id`, `actor_user_id`

---

### `email_logs`

Outbound email delivery log.

| Column | Type | Notes |
| ------ | ---- | ----- |
| `id` | uuid PK | |
| `to_email` | text | |
| `subject`, `template_key` | text | |
| `status` | `email_log_status` | |
| `provider_message_id`, `error_message` | text | |
| `related_entity_type`, `related_entity_id` | text / uuid | |
| `created_at` | timestamptz | |

**Indexes:** `(to_email, created_at)`, `status`

---

### `app_settings`

Key/value JSON for platform defaults (seeded + editable later).

| Column | Type | Notes |
| ------ | ---- | ----- |
| `key` | text PK | e.g. `default_monthly_fee_inr` |
| `value_json` | jsonb | |
| `updated_at` | timestamptz | |

---

## Enum reference

Defined in `src/server/db/schema/enums.ts` (PostgreSQL types mirror names).

- `user_approval_status`, `admin_role`, `otp_purpose`
- `exchange_provider`, `exchange_connection_status`, `exchange_connection_test_status`
- `strategy_status`, `user_strategy_subscription_status`, `user_strategy_run_status`
- `payment_provider`, `payment_status`, `invoice_status`, `revenue_ledger_status`
- `profile_change_request_status`
- `reminder_type`, `reminder_channel`, `reminder_status`
- `email_log_status`, `audit_actor_type`, `trade_side`

---

## Migrations

1. `0000_phase1_connectivity.sql` — `connectivity_check`
2. `0001_phase2_domain_schema.sql` — enums + all domain tables + FKs + indexes

Apply on production (e.g. **tradeictearner.online**):

```bash
npm run db:migrate
```

Then optionally:

```bash
npm run db:seed
```

See `README.md` and `.env.example` for `ALLOW_DB_SEED`, `SEED_ADMIN_*`.
