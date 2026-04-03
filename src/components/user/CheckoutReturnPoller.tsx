"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { GlassPanel } from "@/components/ui/GlassPanel";

type Phase = "verifying" | "success" | "failed" | "expired" | "pending" | "timeout";

export function CheckoutReturnPoller({
  paymentId,
  strategySlug,
}: {
  paymentId: string;
  strategySlug: string;
}) {
  const [phase, setPhase] = useState<Phase>("verifying");

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 45;

    const tick = async () => {
      try {
        const res = await fetch(`/api/user/payments/${paymentId}`, {
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (res.status === 401) {
            if (!cancelled) setPhase("failed");
            return;
          }
          return;
        }
        const data = (await res.json()) as { status?: string };
        const st = data.status;
        if (!st || cancelled) return;

        if (st === "success") {
          setPhase("success");
          return;
        }
        if (st === "failed") {
          setPhase("failed");
          return;
        }
        if (st === "expired") {
          setPhase("expired");
          return;
        }
        if (st === "pending" || st === "created") {
          setPhase("pending");
        }
      } catch {
        /* network — keep polling */
      }
    };

    void tick();
    const id = window.setInterval(async () => {
      attempts += 1;
      if (attempts >= maxAttempts) {
        if (!cancelled) setPhase("timeout");
        window.clearInterval(id);
        return;
      }
      await tick();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [paymentId]);

  const strategiesHref = "/user/strategies";
  const slugPath = `/user/strategies/${encodeURIComponent(strategySlug)}/checkout`;

  if (phase === "success") {
    return (
      <GlassPanel className="space-y-3 border-emerald-500/25 bg-emerald-500/5">
        <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-emerald-100">
          Payment confirmed
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Your subscription is active. You can open{" "}
          <Link href={strategiesHref} className="text-[var(--accent)] underline">
            Strategies
          </Link>{" "}
          to see status.
        </p>
      </GlassPanel>
    );
  }

  if (phase === "failed") {
    return (
      <GlassPanel className="space-y-3 border-red-500/25 bg-red-500/5">
        <h2 className="text-xl font-bold text-red-100">Payment failed</h2>
        <p className="text-sm text-[var(--text-muted)]">
          No charge was completed. You can try again from checkout.
        </p>
        <Link
          href={slugPath}
          className="inline-block text-sm text-[var(--accent)] underline"
        >
          Back to checkout
        </Link>
      </GlassPanel>
    );
  }

  if (phase === "expired") {
    return (
      <GlassPanel className="space-y-3">
        <h2 className="text-xl font-bold text-amber-100">Session expired</h2>
        <p className="text-sm text-[var(--text-muted)]">
          The payment session ended before completion. Start again from checkout.
        </p>
        <Link
          href={slugPath}
          className="inline-block text-sm text-[var(--accent)] underline"
        >
          Back to checkout
        </Link>
      </GlassPanel>
    );
  }

  if (phase === "timeout") {
    return (
      <GlassPanel className="space-y-3">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          Still processing
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          We could not confirm the payment yet. Check{" "}
          <Link href={strategiesHref} className="text-[var(--accent)] underline">
            Strategies
          </Link>{" "}
          in a few minutes or contact support if money was debited.
        </p>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="space-y-4 border-sky-500/20 bg-sky-500/5">
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-10 w-10 animate-pulse rounded-full bg-sky-500/30"
          aria-hidden
        />
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
            Verifying payment…
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            {phase === "pending"
              ? "Waiting for confirmation from our payment partner."
              : "Checking your payment status. This usually takes a few seconds."}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Do not close this tab. Status is loaded only from our servers — not from
        the URL.
      </p>
    </GlassPanel>
  );
}
