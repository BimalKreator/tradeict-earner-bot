import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Contact & support",
};

const DEFAULT_SUPPORT = "support@tradeictearner.online";

export default function ContactPage() {
  const email = process.env.SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Contact &amp; support
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
          For questions about Tradeict Earner, Delta Exchange India connectivity,
          billing, or your account status, reach out to our team. We respond on
          business days (IST).
        </p>
        <div className="mt-8 rounded-xl border border-[var(--border-glass)] bg-black/20 p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Email
          </p>
          <a
            href={`mailto:${email}?subject=Tradeict%20Earner%20Support`}
            className="mt-2 inline-block text-lg font-semibold text-[var(--accent)] hover:underline"
          >
            {email}
          </a>
        </div>
        <p className="mt-8 text-sm text-[var(--text-muted)]">
          Before writing in, you may find answers on the{" "}
          <Link href="/#faq" className="text-[var(--accent)] hover:underline">
            FAQ
          </Link>{" "}
          on the home page, or read the{" "}
          <Link href="/terms" className="text-[var(--accent)] hover:underline">
            terms &amp; conditions
          </Link>
          .
        </p>
      </GlassPanel>
    </div>
  );
}
