import type { ExchangeTradingAdapter } from "@/server/trading/adapters/exchange-adapter-types";
import { tradingLog } from "@/server/trading/trading-log";

export type TplCancelLogContext = Record<string, unknown>;

function trimExternalId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const t = id.trim();
  return t.length > 0 ? t : null;
}

/**
 * Collects venue `external_order_id` values the TPL engine may store on `trendProfitLockRuntime`.
 * D1 conditional orders use the **primary** Delta connection; D2 step orders use **secondary**.
 */
export function collectTplConditionalExternalOrderIds(
  runtime: Record<string, unknown> | null | undefined,
): { externalOrderId: string; venue: "primary" | "secondary"; label: string }[] {
  const out: { externalOrderId: string; venue: "primary" | "secondary"; label: string }[] = [];
  const seen = new Set<string>();
  const add = (id: unknown, venue: "primary" | "secondary", label: string) => {
    const s = trimExternalId(id);
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push({ externalOrderId: s, venue, label });
  };

  const d1 = runtime?.d1;
  if (d1 && typeof d1 === "object" && !Array.isArray(d1)) {
    const o = d1 as Record<string, unknown>;
    add(o.stopLossOrderExternalId, "primary", "d1_stop_loss");
    add(o.takeProfitOrderExternalId, "primary", "d1_take_profit");
  }

  const d2 = runtime?.d2StepsState;
  if (d2 && typeof d2 === "object" && !Array.isArray(d2)) {
    for (const [stepKey, st] of Object.entries(d2)) {
      if (!st || typeof st !== "object" || Array.isArray(st)) continue;
      const s = st as Record<string, unknown>;
      add(s.takeProfitOrderExternalId, "secondary", `d2_step_${stepKey}_take_profit`);
      add(s.stopLossOrderExternalId, "secondary", `d2_step_${stepKey}_stop_loss`);
    }
  }

  return out;
}

export function extractTrendProfitLockRuntimeFromRunSettingsJson(
  runSettingsJson: unknown,
): Record<string, unknown> | null {
  if (!runSettingsJson || typeof runSettingsJson !== "object" || Array.isArray(runSettingsJson)) {
    return null;
  }
  const runtime = (runSettingsJson as Record<string, unknown>).trendProfitLockRuntime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) return null;
  return runtime as Record<string, unknown>;
}

/**
 * Best-effort cancel of reduce-only / conditional orders still resting at Delta after a flat or manual exit.
 * Ignores adapter or "already gone" failures so callers can always clear runtime IDs afterward.
 */
export async function cancelAllTplLingeringOrders(params: {
  runtime: Record<string, unknown> | null | undefined;
  primaryAdapter: ExchangeTradingAdapter | null | undefined;
  secondaryAdapter: ExchangeTradingAdapter | null | undefined;
  log?: TplCancelLogContext;
}): Promise<void> {
  const items = collectTplConditionalExternalOrderIds(params.runtime);
  if (items.length === 0) return;

  for (const { externalOrderId, venue, label } of items) {
    const adapter =
      venue === "primary" ? params.primaryAdapter : params.secondaryAdapter;
    if (!adapter?.cancelOrderByExternalId) {
      tradingLog("warn", "tpl_lingering_order_cancel_skipped_no_adapter", {
        event: "tpl_lingering_order_cancel_skipped_no_adapter",
        ...params.log,
        externalOrderId,
        venue,
        label,
      });
      continue;
    }
    try {
      const r = await adapter.cancelOrderByExternalId(externalOrderId);
      tradingLog(r.ok ? "info" : "warn", "tpl_lingering_order_cancel", {
        event: "tpl_lingering_order_cancel",
        ...params.log,
        externalOrderId,
        venue,
        label,
        ok: r.ok,
        cancelled: r.ok ? r.cancelled : undefined,
        error: r.ok ? null : r.error,
      });
      if (!r.ok) {
        tradingLog("error", "tpl_lingering_order_cancel_error", {
          event: "tpl_lingering_order_cancel_error",
          ...params.log,
          externalOrderId,
          venue,
          label,
          error: r.error,
          raw: r.raw ?? null,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      tradingLog("warn", "tpl_lingering_order_cancel_exception", {
        event: "tpl_lingering_order_cancel_exception",
        ...params.log,
        externalOrderId,
        venue,
        label,
        error: msg.slice(0, 400),
      });
      tradingLog("error", "tpl_lingering_order_cancel_error", {
        event: "tpl_lingering_order_cancel_error",
        ...params.log,
        externalOrderId,
        venue,
        label,
        error: msg.slice(0, 400),
      });
    }
  }
}

/**
 * Removes stored venue order id fields from `trendProfitLockRuntime` inside a cloned `run_settings_json`
 * so subsequent ticks do not repeat cancel calls.
 */
export function stripTrendProfitLockVenueOrderIdsFromRunSettingsJson(raw: unknown): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  const rt = base.trendProfitLockRuntime;
  if (!rt || typeof rt !== "object" || Array.isArray(rt)) return base;

  const rto = { ...(rt as Record<string, unknown>) };

  const d1 = rto.d1;
  if (d1 && typeof d1 === "object" && !Array.isArray(d1)) {
    const d1o = { ...(d1 as Record<string, unknown>) };
    delete d1o.stopLossOrderExternalId;
    delete d1o.stopLossOrderClientId;
    delete d1o.stopLossPlacedAt;
    delete d1o.takeProfitOrderExternalId;
    delete d1o.takeProfitOrderClientId;
    delete d1o.takeProfitPlacedAt;
    rto.d1 = d1o;
  }

  const d2 = rto.d2StepsState;
  if (d2 && typeof d2 === "object" && !Array.isArray(d2)) {
    const d2o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d2)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        d2o[k] = v;
        continue;
      }
      const step = { ...(v as Record<string, unknown>) };
      delete step.takeProfitOrderExternalId;
      delete step.takeProfitOrderClientId;
      delete step.takeProfitPlacedAt;
      delete step.stopLossOrderExternalId;
      delete step.stopLossOrderClientId;
      delete step.stopLossPlacedAt;
      d2o[k] = step;
    }
    rto.d2StepsState = d2o;
  }

  base.trendProfitLockRuntime = rto;
  return base;
}
