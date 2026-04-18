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
  hedgeScalpingSymbolOptions,
}: {
  strategyId: string;
  sessionUserId: string | null;
  hedgeScalpingSymbolOptions: string[] | null;
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

  const hsOptions = hedgeScalpingSymbolOptions ?? [];

  return (
    <form action={formAction} className="w-full space-y-2">
      <input type="hidden" name="strategyId" value={strategyId} />
      {hsOptions.length > 0 ? (
        <div>
          <label
            htmlFor={`paper-symbol-${strategyId}`}
            className="block text-[10px] font-medium uppercase tracking-wide text-slate-500"
          >
            Paper symbol
          </label>
          <select
            id={`paper-symbol-${strategyId}`}
            name="hedge_scalping_symbol"
            required
            defaultValue={hsOptions[0]}
            className="mt-1 w-full rounded-lg border border-white/[0.12] bg-black/30 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-sky-500/30 focus:ring-2"
          >
            {hsOptions.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
      ) : null}
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
