import { GlassPanel } from "@/components/ui/GlassPanel";
import type { UserDashboardTradeRow } from "@/lib/user-dashboard-types";

function formatInr(n: string | null): string {
  if (n === null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return n;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(v);
}

export function DashboardTradeTable({
  title,
  rows,
  mode,
}: {
  title: string;
  rows: UserDashboardTradeRow[];
  mode: "bot" | "all";
}) {
  return (
    <GlassPanel className="!p-0 overflow-hidden">
      <div className="border-b border-[var(--border-glass)] px-5 py-4">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {mode === "bot"
            ? "Recent bot execution orders (trade_source = bot)."
            : "Recorded trades ledger (includes manual imports when present)."}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border-glass)]/60 bg-black/20 text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <th className="px-5 py-3 font-medium">Strategy</th>
              <th className="px-3 py-3 font-medium">Symbol</th>
              <th className="px-3 py-3 font-medium">Side</th>
              <th className="px-3 py-3 font-medium">Qty</th>
              <th className="px-3 py-3 font-medium">
                {mode === "bot" ? "Fill" : "Price"}
              </th>
              <th className="px-3 py-3 font-medium">PnL</th>
              {mode === "bot" ? (
                <th className="px-3 py-3 font-medium">Status</th>
              ) : null}
              <th className="px-5 py-3 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={mode === "bot" ? 8 : 7}
                  className="px-5 py-8 text-center text-[var(--text-muted)]"
                >
                  No rows yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[var(--border-glass)]/30 hover:bg-white/[0.03]"
                >
                  <td className="px-5 py-3 text-[var(--text-primary)]">
                    {r.strategyName ?? "—"}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-[var(--accent)]">
                    {r.symbol}
                  </td>
                  <td className="px-3 py-3 capitalize">{r.side}</td>
                  <td className="px-3 py-3 tabular-nums text-[var(--text-muted)]">
                    {r.quantity}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-[var(--text-muted)]">
                    {r.priceOrFill ?? "—"}
                  </td>
                  <td
                    className={`px-3 py-3 tabular-nums ${
                      r.pnlInr && Number(r.pnlInr) < 0
                        ? "text-red-300"
                        : r.pnlInr && Number(r.pnlInr) > 0
                          ? "text-emerald-300"
                          : "text-[var(--text-muted)]"
                    }`}
                  >
                    {formatInr(r.pnlInr)}
                  </td>
                  {mode === "bot" ? (
                    <td className="px-3 py-3 text-xs text-[var(--text-muted)]">
                      {r.orderStatus ?? "—"}
                    </td>
                  ) : null}
                  <td className="px-5 py-3 text-xs text-[var(--text-muted)]">
                    {new Date(r.at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </GlassPanel>
  );
}
