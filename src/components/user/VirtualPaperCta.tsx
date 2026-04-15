"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";

import { startVirtualStrategyRunAction } from "@/server/actions/virtualTrading";

function SubmitLabel({ idle }: { idle: string }) {
  const { pending } = useFormStatus();
  return <>{pending ? "Starting…" : idle}</>;
}

export function VirtualPaperCta({
  strategyId,
  sessionUserId,
}: {
  strategyId: string;
  sessionUserId: string | null;
}) {
  const [state, formAction] = useFormState(startVirtualStrategyRunAction, undefined);

  if (!sessionUserId) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent("/user/strategies")}`}
        className="flex w-full items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] py-2.5 text-sm font-medium text-slate-100 transition hover:bg-white/[0.07]"
      >
        Sign in to test virtually
      </Link>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-1">
      <input type="hidden" name="strategyId" value={strategyId} />
      <button
        type="submit"
        className="flex w-full items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/10 py-2.5 text-sm font-semibold text-sky-100 shadow-inner shadow-sky-500/5 transition hover:bg-sky-500/15"
      >
        <SubmitLabel idle="Test Virtually" />
      </button>
      {state?.error ? (
        <p className="text-center text-xs text-amber-200/90">{state.error}</p>
      ) : null}
    </form>
  );
}
