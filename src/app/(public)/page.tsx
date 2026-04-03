import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";

const faqs = [
  {
    q: "What is Tradeict Earner?",
    a: "Tradeict Earner is a platform that connects your Delta Exchange India account to curated trading strategies. You subscribe per strategy, control capital and leverage, and settle revenue share weekly.",
  },
  {
    q: "Which exchange is supported?",
    a: "We support Delta Exchange India. You add your API key and secret from your exchange profile; you can test the connection and toggle connectivity on or off from your dashboard.",
  },
  {
    q: "How does pricing work?",
    a: "Each strategy has a fixed monthly access fee (default ₹499/month). Admins can override the fee globally per strategy or for specific users. Renewals extend your access by 30 days and stack from your current end date so you do not lose unused time.",
  },
  {
    q: "What is revenue sharing?",
    a: "A percentage of bot-related profits (default 50%) is settled weekly. If revenue share is due, new entries can be paused until payment. Admins can waive fees or send payment reminders.",
  },
  {
    q: "When can I log in after registering?",
    a: "New accounts stay in pending approval until an administrator approves them. You will be notified by email once your account is approved.",
  },
  {
    q: "Where are dates and settlements calculated?",
    a: "Business logic uses Asia/Kolkata (IST) for billing periods, weekly revenue windows, and cutoffs.",
  },
];

export default function HomePage() {
  return (
    <div className="relative z-10">
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="space-y-6">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[var(--accent)]">
              Delta Exchange India
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.1] tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-[3.25rem]">
              Tradeict{" "}
              <span className="bg-gradient-to-r from-[var(--accent)] to-cyan-200 bg-clip-text text-transparent">
                Earner
              </span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-[var(--text-muted)]">
              Professional trading bots for Indian crypto derivatives — strategy
              subscriptions, transparent fixed fees, and weekly revenue sharing
              with full admin oversight.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-xl bg-[var(--accent-strong)] px-6 py-3.5 text-sm font-semibold text-[var(--bg-void)] shadow-lg shadow-sky-500/25 transition hover:brightness-110"
              >
                Create account
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-xl border border-[var(--border-glass)] bg-white/[0.03] px-6 py-3.5 text-sm font-medium text-[var(--text-primary)] backdrop-blur-sm transition hover:bg-white/[0.06]"
              >
                Sign in
              </Link>
            </div>
          </div>
          <GlassPanel className="relative overflow-hidden !p-0">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent" />
            <div className="relative space-y-5 p-8 sm:p-10">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
                How it works
              </h2>
              <ol className="space-y-4 text-sm text-[var(--text-muted)]">
                <li className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-dim)] text-xs font-bold text-[var(--accent)]">
                    1
                  </span>
                  <span>
                    Register — your account stays in{" "}
                    <strong className="text-[var(--text-primary)]">
                      pending approval
                    </strong>{" "}
                    until an admin approves you.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-dim)] text-xs font-bold text-[var(--accent)]">
                    2
                  </span>
                  <span>
                    Connect Delta India API keys, browse strategies, and pay the monthly fee (Cashfree — coming soon).
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-dim)] text-xs font-bold text-[var(--accent)]">
                    3
                  </span>
                  <span>
                    Activate or pause the bot, set capital and leverage, and track PnL, trades, and revenue dues in your panel.
                  </span>
                </li>
              </ol>
            </div>
          </GlassPanel>
        </div>
      </section>

      {/* Features */}
      <section className="border-y border-[var(--border-glass)] bg-black/20 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
            Built for serious traders
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-[var(--text-muted)]">
            Everything runs in your browser — mobile responsive, dark glass UI,
            and a clear separation between public marketing, your dashboard, and
            admin operations.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Prebuilt strategies",
                body: "Subscribe to curated strategies with default ₹499/mo and 50% revenue share — overrides per user or strategy when admins need flexibility.",
              },
              {
                title: "Exchange control",
                body: "Test your Delta India connection, toggle it on or off, and keep keys encrypted at the application layer.",
              },
              {
                title: "Weekly revenue share",
                body: "Ledger rows per IST week; bots can pause new entries if you have unpaid revenue dues until you settle.",
              },
              {
                title: "My strategies",
                body: "Activate, pause, or go inactive; update only capital to use and leverage within safe limits.",
              },
              {
                title: "Transparency",
                body: "Dashboard for PnL and today's profit; transactions and funds pages for trades, balances, and dues.",
              },
              {
                title: "Governed access",
                body: "Profile changes can require admin approval; terms are versioned and published from the database.",
              },
            ].map((f) => (
              <GlassPanel key={f.title} className="!p-5">
                <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-[var(--accent)]">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                  {f.body}
                </p>
              </GlassPanel>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing model */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-stretch">
          <GlassPanel className="flex flex-col justify-center !p-8">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
              Simple subscription economics
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
              You pay a <strong className="text-[var(--text-primary)]">fixed monthly fee per strategy</strong> for access (typically ₹499). That unlocks the strategy for <strong className="text-[var(--text-primary)]">30 days</strong>; when you renew before or after expiry, we extend from the later of today or your current end date so days are not wasted.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-muted)]">
              On profits attributable to the bot, <strong className="text-[var(--text-primary)]">revenue sharing</strong> (default 50%) is calculated <strong className="text-[var(--text-primary)]">weekly in IST</strong>. Admins can adjust default fees and revenue percentages per strategy and per user when required.
            </p>
          </GlassPanel>
          <GlassPanel className="flex flex-col justify-center border-[var(--accent)]/25 bg-gradient-to-b from-sky-500/5 to-transparent !p-8">
            <ul className="space-y-4 text-sm text-[var(--text-muted)]">
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>One fee per strategy — no surprise platform charges hidden in the UI.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>Revenue share aligns incentives; unpaid weekly dues can pause new bot entries.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>Admins can waive fees, send reminders, and manage terms versions over time.</span>
              </li>
            </ul>
            <Link
              href="/register"
              className="mt-8 inline-flex w-fit items-center rounded-xl bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-[var(--bg-void)] transition hover:brightness-110"
            >
              Get started
            </Link>
          </GlassPanel>
        </div>
      </section>

      {/* FAQ */}
      <section
        id="faq"
        className="scroll-mt-20 border-t border-[var(--border-glass)] bg-black/15 py-16 sm:py-20"
      >
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
            Frequently asked questions
          </h2>
          <p className="mt-3 text-center text-sm text-[var(--text-muted)]">
            Quick answers about the product. For account-specific help, visit{" "}
            <Link href="/contact" className="text-[var(--accent)] hover:underline">
              Contact
            </Link>
            .
          </p>
          <div className="mt-10 space-y-3">
            {faqs.map((item) => (
              <details
                key={item.q}
                className="group glass-panel rounded-2xl border border-[var(--border-glass)] px-5 py-1 transition-colors open:bg-white/[0.03]"
              >
                <summary className="cursor-pointer list-none py-4 font-medium text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {item.q}
                    <span className="text-[var(--accent)] transition group-open:rotate-180">▼</span>
                  </span>
                </summary>
                <p className="border-t border-[var(--border-glass)] pb-4 pt-2 text-sm leading-relaxed text-[var(--text-muted)]">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 pt-4 sm:px-6">
        <GlassPanel className="flex flex-col items-center gap-4 py-10 text-center sm:flex-row sm:justify-between sm:text-left">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-[var(--text-primary)]">
              Ready to connect Delta India?
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Register for access — approval required before login.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/register"
              className="rounded-xl bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-[var(--bg-void)] transition hover:brightness-110"
            >
              Register
            </Link>
            <Link
              href="/terms"
              className="rounded-xl border border-[var(--border-glass)] px-5 py-3 text-sm font-medium text-[var(--text-primary)] hover:bg-white/5"
            >
              Read terms
            </Link>
          </div>
        </GlassPanel>
      </section>
    </div>
  );
}
