import Link from "next/link";

import { GlassPanel } from "@/components/ui/GlassPanel";
import { RevenueLedgerTable } from "@/components/user/funds/RevenueLedgerTable";
import { formatInrAmount } from "@/lib/format-inr";
import type {
  PlatformPaymentRow,
  RevenueLedgerRow,
  UserFundsPlatformSnapshot,
} from "@/server/queries/user-funds-platform";

function istDateInput(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return "";
  }
}

export function UserFundsPlatformPanels({
  snapshot,
  payments,
  ledgers,
  revenueReturnNotice = false,
  defaultPfrom = "",
  defaultPto = "",
  defaultPayKind = "all",
}: {
  snapshot: UserFundsPlatformSnapshot;
  payments: PlatformPaymentRow[];
  ledgers: RevenueLedgerRow[];
  /** Set when user returns from Cashfree after starting a revenue-share checkout. */
  revenueReturnNotice?: boolean;
  defaultPfrom?: string;
  defaultPto?: string;
  defaultPayKind?: "all" | "subscription";
}) {
  const formAction = "/user/funds";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <GlassPanel className="!p-5">
          <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">
            Revenue share — this week (IST)
          </p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-amber-200/90">
            {formatInrAmount(snapshot.revenueDueThisWeekInr)}
          </p>
        </GlassPanel>
        <GlassPanel className="!p-5">
          <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">
            Total revenue share paid
          </p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-emerald-300/90">
            {formatInrAmount(snapshot.revenueSharePaidTotalInr)}
          </p>
        </GlassPanel>
        <GlassPanel className="!flex !flex-col !justify-between !p-5">
          <p className="text-xs text-[var(--text-muted)]">
            Use <span className="text-[var(--accent)]">Pay</span> on each week row
            below. Checkout is powered by Cashfree; webhooks settle the ledger and
            can unblock your bot automatically.
          </p>
          <p className="mt-3 text-[10px] text-[var(--text-muted)]">
            Pending = Cashfree session in flight. Unpaid / partial = balance still
            owed for that IST week.
          </p>
        </GlassPanel>
      </div>

      {revenueReturnNotice ? (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
          Thanks — if you completed payment, your ledger usually updates within a
          few seconds. Refresh this page if amounts look unchanged.
        </div>
      ) : null}

      <GlassPanel className="!p-5">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
          Platform payments
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          Successful Cashfree payments. Strategy-linked rows are monthly
          subscriptions.
        </p>
        <form
          action={formAction}
          method="get"
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="tab" value="platform" />
          <label className="text-xs text-[var(--text-muted)]">
            From
            <input
              type="date"
              name="pfrom"
              defaultValue={defaultPfrom}
              className="ml-1 mt-1 rounded-lg border border-[var(--border-glass)] bg-black/35 px-2 py-1.5 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)]">
            To
            <input
              type="date"
              name="pto"
              defaultValue={defaultPto}
              className="ml-1 mt-1 rounded-lg border border-[var(--border-glass)] bg-black/35 px-2 py-1.5 text-sm text-[var(--text-primary)]"
            />
          </label>
          <label className="text-xs text-[var(--text-muted)]">
            Type
            <select
              name="pay_kind"
              defaultValue={defaultPayKind}
              className="ml-1 mt-1 rounded-lg border border-[var(--border-glass)] bg-black/35 px-2 py-1.5 text-sm text-[var(--text-primary)]"
            >
              <option value="all">All</option>
              <option value="subscription">Subscriptions only</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded-xl bg-[var(--accent)]/90 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            Filter
          </button>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border-glass)] text-xs uppercase text-[var(--text-muted)]">
                <th className="py-2 pr-3">Date (IST)</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Strategy</th>
                <th className="py-2 pr-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-[var(--text-muted)]">
                    No matching payments.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border-glass)]/40"
                  >
                    <td className="py-2 pr-3 text-xs text-[var(--text-muted)]">
                      {istDateInput(p.createdAt)}
                    </td>
                    <td className="py-2 pr-3 text-xs capitalize">
                      {p.kind === "subscription" ? (
                        <span className="text-emerald-400">Subscription</span>
                      ) : p.kind === "revenue_share" ? (
                        <span className="text-amber-200/90">Revenue share</span>
                      ) : (
                        <span className="text-[var(--text-muted)]">Other</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate py-2 pr-3 text-xs">
                      {p.strategyName ?? "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-[var(--text-primary)]">
                      {formatInrAmount(p.amountInr)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      <RevenueLedgerTable ledgers={ledgers} />

      <p className="text-center text-xs text-[var(--text-muted)]">
        <Link href="/user/transactions" className="text-[var(--accent)] hover:underline">
          View full trade ledger
        </Link>
      </p>
    </div>
  );
}
