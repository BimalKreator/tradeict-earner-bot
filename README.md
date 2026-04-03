# Tradeict Earner

Production-oriented foundation for a **multi-user trading bot platform** targeting **Delta Exchange India**: public site, **user panel** (`/user/...`), **admin panel** (`/admin/...`), plus future **billing**, **trading engine**, and **notification** modules.

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **React 19**
- **Tailwind CSS v4** — dark black + blue **glassmorphism** theme (`src/app/globals.css`, `GlassPanel`)
- **PostgreSQL** + **Drizzle ORM** — modular schema in `src/server/db/schema/`, migrations in `drizzle/`, documented in **[DB_SCHEMA.md](./DB_SCHEMA.md)**

## Getting started

1. Copy environment file:

   ```bash
   cp .env.example .env
   ```

2. Set `DATABASE_URL` to your PostgreSQL instance (local or VPS).

3. Apply schema (choose one):

   ```bash
   npm run db:push
   # or
   npm run db:migrate
   ```

4. Run the app:

   ```bash
   npm install
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

6. (Optional) Seed default admin, sample strategies, and settings:

   ```bash
   npm run db:seed
   ```

   Set `SEED_ADMIN_PASSWORD` (12+ characters) in `.env`. In production, set `ALLOW_DB_SEED=true` only for the initial deploy, then remove or disable.

### Authentication (Phase 4)

- **`AUTH_SECRET`**: at least **32 characters**. Signs **HS256 JWTs** for the user session (`tradeict_session` httpOnly cookie) and short-lived **login** / **password-reset** challenge cookies.
- **User sign-in**: **password** → **6-digit email OTP** → session. **`pending_approval`**, **`rejected`**, and **`archived`** users are blocked with clear messages; **`approved`** and **`paused`** may sign in.
- **Admin sign-in**: **`/admin/login`** — bcrypt against `admins`; separate JWT cookie and middleware checks (`role: admin`).
- **Forgot password**: **`/forgot-password`** → OTP email → **`/reset-password`** (challenge cookie + OTP + new password).
- **SMTP** (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_PORT` / `SMTP_SECURE`): **Nodemailer** sends transactional mail; set **`EMAIL_FROM`** / **`EMAIL_FROM_NAME`** as needed. Without SMTP config, mail calls fail gracefully and are logged to **`email_logs`** where applicable.
- **`AUTH_PHASE1_BYPASS=true`**: middleware does **not** block `/user/*` or `/admin/*` (local/VPS dev only).
- **Stub session** (`POST /api/auth/stub`): only when `NODE_ENV !== production` or **`AUTH_PHASE1_ALLOW_STUB=true`**. Disable in real production.
- **`SUPPORT_EMAIL`**: used on **`/contact`** and as a fallback on **`/terms`** if no published terms exist.
- **Migrations**: run **`npm run db:migrate`** so enum `user_approval_status` includes **`pending_approval`** and **`archived`** (see **`drizzle/0002_phase4_enum_rate.sql`**).

### Health check

- **`GET /api/health/db`** — returns JSON; verifies `SELECT 1` when `DATABASE_URL` is set.

---

## Architecture (Phase 1)

High-level layout:

```text
src/app/
  layout.tsx              # Root HTML, dark theme, fonts
  globals.css             # CSS variables + glass utilities
  (public)/               # Route group — marketing + legal + auth placeholders
    layout.tsx            # Public top header
    page.tsx              # /
    login/                # /login
    register/             # /register
    terms/                # /terms
  user/                   # /user/* — user panel (sidebar via PanelShell)
  admin/                  # /admin/* — admin panel
  api/
    auth/stub/            # Dev-only session cookie (Phase 1)
    health/db/            # DB connectivity
src/components/
  layout/                 # PublicHeader, PanelShell (responsive sidebar)
  ui/                     # GlassPanel, shared primitives
src/server/
  db/                     # Drizzle client; schema modules under db/schema/
  db/seed.ts              # Idempotent seed (admin, strategies, app_settings, terms v1)
  env.ts                  # Zod-validated server env (extend as features land)
src/lib/
  auth.ts                 # Session cookie name + helpers for middleware
middleware.ts             # Matcher: /user/:path*, /admin/:path*
```

### Route grouping

| Area        | URL prefix   | Purpose                                      |
| ----------- | ------------ | -------------------------------------------- |
| Public      | `/`, `/terms`, `/login`, `/register` | Marketing, legal, future OTP entry          |
| User panel  | `/user/...`  | Dashboard, strategies, transactions, funds    |
| Admin panel | `/admin/...` | Operations, users, strategies, revenue        |

`(public)` is a **route group** (parentheses do not appear in URLs). **`/user` and `/admin` are real path segments** so middleware and proxies can route clearly on a VPS.

### Timezone

Business logic must use **IST (`Asia/Kolkata`)** for subscriptions, revenue weeks, and cutoffs. Set `TZ=Asia/Kolkata` in `.env` and use explicit timezone handling in date libraries in later phases (do not rely on the server default alone).

### Planned modules (not implemented in Phase 1)

- **Billing engine** — Cashfree, subscription periods, renewals stacking  
- **Trading engine** — Delta India API adapter, strategy runners, pause-if-unpaid  
- **Notifications** — email OTP, admin reminders, payment links  

Keep new code in **`src/server/services/*`** and **`src/app/api/*`** as those features are added, without collapsing everything into page files.

---

## Scripts

| Script            | Description                |
| ----------------- | -------------------------- |
| `npm run dev`     | Next.js dev server         |
| `npm run build`   | Production build           |
| `npm run start`   | Start production server    |
| `npm run lint`    | ESLint                     |
| `npm run db:generate` | New Drizzle migration |
| `npm run db:migrate`  | Run migrations        |
| `npm run db:push`     | Push schema (dev)       |
| `npm run db:studio`   | Drizzle Studio          |
| `npm run db:seed`     | Seed admin + sample data |

---

## Deploy notes (Ubuntu VPS)

Run `npm run build` then `npm run start` behind **nginx** or **Caddy** with TLS. Process manager (**pm2**, **systemd**) recommended. Ensure `DATABASE_URL` and secrets live only on the server, not in git.
