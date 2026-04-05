"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatInrAmount } from "@/lib/format-inr";
import { startStrategyCheckoutAction } from "@/server/actions/strategyCheckout";

function loadCashfreeScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as unknown as { Cashfree?: unknown };
  if (w.Cashfree) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Could not load Cashfree SDK"));
    document.body.appendChild(el);
  });
}

type CashfreeFactory = (opts: { mode: string }) => {
  checkout: (o: {
    paymentSessionId: string;
    redirectTarget?: "_self" | "_modal" | "_top";
  }) => void;
};

export function StrategyCashfreeCheckout({
  strategySlug,
  strategyName,
  amountInr,
  revenueSharePercent,
  hasPricingOverride,
  checkoutKind,
  forecastLine,
  isFreeAccess,
}: {
  strategySlug: string;
  strategyName: string;
  amountInr: string;
  revenueSharePercent: string;
  hasPricingOverride: boolean;
  checkoutKind: "new" | "renewal";
  forecastLine: string;
  /** Effective monthly fee is ₹0 — no Cashfree session. */
  isFreeAccess: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pay = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await startStrategyCheckoutAction(strategySlug);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }

      if (result.mode === "free") {
        router.push(
          `/user/strategies/${encodeURIComponent(strategySlug)}/checkout/return?paymentId=${result.paymentId}`,
        );
        return;
      }

      await loadCashfreeScript();
      const mode =
        result.cashfreeMode === "production" ? "PRODUCTION" : "SANDBOX";
      const cf = (window as unknown as { Cashfree?: CashfreeFactory }).Cashfree;
      if (!cf) {
        setError("Cashfree SDK did not initialize.");
        setBusy(false);
        return;
      }
      const inst = cf({ mode });
      inst.checkout({
        paymentSessionId: result.paymentSessionId,
        redirectTarget: "_self",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [router, strategySlug]);

  return (
    <GlassPanel className="space-y-4">
      <div className="rounded-xl border border-white/[0.08] bg-black/25 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-200/90">
          {checkoutKind === "renewal" ? "Renewal" : "New subscription"}
        </p>
        <p className="mt-1 text-sm text-[var(--text-primary)]">{forecastLine}</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Shown dates use India Standard Time. The exact instant is stored in UTC
          after payment confirms.
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
          Amount due (30 days access)
        </p>
        <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
          {formatInrAmount(amountInr)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          Revenue share (shown for reference): {revenueSharePercent}%
          {hasPricingOverride ? (
            <span className="ml-2 text-violet-300">· Account pricing applied</span>
          ) : null}
        </p>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        {isFreeAccess
          ? "No payment is required. Activate to add 30 days of access immediately."
          : "You will complete payment on Cashfree&apos;s secure page. Subscription activates after we confirm payment (usually within seconds)."}
      </p>
      {error ? (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-100"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="w-full rounded-xl bg-[var(--accent)] py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"
      >
        {busy
          ? isFreeAccess
            ? "Activating…"
            : "Starting checkout…"
          : isFreeAccess
            ? `Activate ${strategyName}`
            : `Pay for ${strategyName}`}
      </button>
    </GlassPanel>
  );
}
