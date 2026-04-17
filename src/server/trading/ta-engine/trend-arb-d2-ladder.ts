/**
 * Trend-arb Delta 2 "ladder" semantics (virtual + live):
 * - D2 Step 1 = initial hedge at HalfTrend entry (handled at dispatch time).
 * - D2 Steps 2–10 = optional adds when price moves stepMovePct% × (step−1) in D1's favour from D1 entry (cumulative rungs).
 * - Each clip uses stepQtyPct of **current** D1 size (contracts).
 * - Each open clip exits on its own when price retraces so unrealized on that clip reaches targetProfitPct (short: price falls).
 * - After exit, the same step can open again when price crosses the rung again and no clip is open at that step.
 */

import { isTrendArbSecondaryCorrelationId } from "@/lib/virtual-ledger-metrics";

export const TREND_ARB_D2_MAX_DISPLAY_STEP = 10;

export type D2LadderOrderRow = {
  createdAt: Date;
  correlationId: string | null;
  side: string;
  quantity: string;
  fillPrice: string | null;
  status: string;
  signalAction: string | null;
  rawSubmitResponse: Record<string, unknown> | null;
};

export type D2OpenClip = {
  correlationId: string;
  displayStep: number;
  qty: number;
  entryPx: number;
};

function num(s: string | null | undefined): number {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function isFilled(status: string): boolean {
  return status === "filled" || status === "partial_fill";
}

/** Trigger price for display step s (2..10). Step 1 is at-entry initial hedge (not computed here). */
export function d2RungTriggerPrice(params: {
  d1Side: "long" | "short";
  d1Entry: number;
  displayStep: number;
  stepMovePct: number;
}): number {
  const { d1Side, d1Entry, displayStep, stepMovePct } = params;
  if (!(d1Entry > 0) || displayStep < 2) return NaN;
  const need = (displayStep - 1) * (stepMovePct / 100);
  return d1Side === "long" ? d1Entry * (1 + need) : d1Entry * (1 - need);
}

/** Short clip: exit when price has dropped tpPct% from clip entry. Long clip: symmetric. */
export function d2ClipTpHit(params: {
  d2IsShort: boolean;
  clipEntryPx: number;
  mark: number;
  targetProfitPct: number;
}): boolean {
  const { d2IsShort, clipEntryPx, mark, targetProfitPct } = params;
  if (!(clipEntryPx > 0) || !(mark > 0) || !(targetProfitPct > 0)) return false;
  if (d2IsShort) {
    const favPct = ((clipEntryPx - mark) / clipEntryPx) * 100;
    return favPct >= targetProfitPct;
  }
  const favPct = ((mark - clipEntryPx) / clipEntryPx) * 100;
  return favPct >= targetProfitPct;
}

function readMetaSnapshot(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const snap = raw.signal_metadata_snapshot;
  return snap && typeof snap === "object" && !Array.isArray(snap) ? (snap as Record<string, unknown>) : {};
}

export function parseD2DisplayStepFromCorrelation(correlationId: string | null | undefined): number | null {
  const cid = (correlationId ?? "").toLowerCase();
  const mL = cid.match(/_d2l(\d+)_/);
  if (mL) {
    const n = Number(mL[1]);
    return Number.isFinite(n) && n >= 1 && n <= TREND_ARB_D2_MAX_DISPLAY_STEP ? n : null;
  }
  if (cid.includes("_d2_") && /_s0($|_)/.test(cid)) return 1;
  const mS = cid.match(/_v_[^_]+_s(\d+)_/);
  if (mS) {
    const legacy = Number(mS[1]);
    if (Number.isFinite(legacy) && legacy >= 0) {
      return legacy + 1;
    }
  }
  return null;
}

function displayStepFromOrder(o: D2LadderOrderRow): number | null {
  const snap = readMetaSnapshot(o.rawSubmitResponse);
  const fromMeta = snap.d2_display_step;
  if (typeof fromMeta === "number" && Number.isFinite(fromMeta)) {
    const n = Math.round(fromMeta);
    if (n >= 1 && n <= TREND_ARB_D2_MAX_DISPLAY_STEP) return n;
  }
  return parseD2DisplayStepFromCorrelation(o.correlationId);
}

function inferSignalAction(o: D2LadderOrderRow): string {
  if (o.signalAction && String(o.signalAction).trim()) {
    return String(o.signalAction).toLowerCase();
  }
  if (isD2ClipExit(o.correlationId, o.rawSubmitResponse)) return "exit";
  if (isD2FlattenAll(o.correlationId)) return "exit";
  return "entry";
}

function isD2FlattenAll(correlationId: string | null): boolean {
  const c = (correlationId ?? "").toLowerCase();
  return c.includes("_d2_flat_") || c.includes("delta2_flatten");
}

function isD2ClipExit(correlationId: string | null, raw: Record<string, unknown> | null): boolean {
  const c = (correlationId ?? "").toLowerCase();
  if (c.includes("_d2x")) return true;
  const snap = readMetaSnapshot(raw);
  return snap.leg === "delta2_clip_exit" || snap.closes_entry_correlation_id != null;
}

function closesEntryCorrelation(raw: Record<string, unknown> | null): string | null {
  const snap = readMetaSnapshot(raw);
  const v = snap.closes_entry_correlation_id;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function isD2SecondaryEntryClip(o: D2LadderOrderRow, d1Side: "long" | "short"): boolean {
  if (!isFilled(o.status)) return false;
  const cid = (o.correlationId ?? "").toLowerCase();
  if (!cid.includes("ta_trendarb")) return false;
  const act = inferSignalAction(o);
  if (act !== "entry") return false;
  if (isD2FlattenAll(o.correlationId)) return false;
  if (isD2ClipExit(o.correlationId, o.rawSubmitResponse)) return false;
  if (!isTrendArbSecondaryCorrelationId(o.correlationId)) return false;
  const hedgeSide = d1Side === "long" ? "sell" : "buy";
  return o.side === hedgeSide;
}

/**
 * Reconstructs open D2 clips (FIFO lots) from chronological fills.
 * - Entry: secondary hedge clip (short for long D1).
 * - Exit: `delta2_clip_exit` / `_d2X` buys with `closes_entry_correlation_id`, or flatten-all buys applied FIFO.
 */
export function buildOpenD2ClipsFromOrders(
  orders: D2LadderOrderRow[],
  d1Side: "long" | "short",
): D2OpenClip[] {
  const d2IsShort = d1Side === "long";
  const hedgeEntrySide = d2IsShort ? "sell" : "buy";
  const hedgeExitSide = d2IsShort ? "buy" : "sell";

  const sorted = [...orders]
    .filter((o) => isFilled(o.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  type Lot = { correlationId: string; displayStep: number; qty: number; entryPx: number };
  const lots: Lot[] = [];

  for (const o of sorted) {
    const qty = num(o.quantity);
    const fillPx = num(o.fillPrice);
    if (!(qty > 0) || !(fillPx > 0)) continue;

    if (o.side === hedgeExitSide) {
      if (isD2FlattenAll(o.correlationId)) {
        let rem = qty;
        while (rem > 1e-12 && lots.length > 0) {
          const first = lots[0]!;
          const take = Math.min(first.qty, rem);
          first.qty -= take;
          rem -= take;
          if (first.qty <= 1e-12) lots.shift();
        }
        continue;
      }
      if (isD2ClipExit(o.correlationId, o.rawSubmitResponse)) {
        const target = closesEntryCorrelation(o.rawSubmitResponse);
        if (target) {
          const idx = lots.findIndex((l) => l.correlationId === target);
          if (idx >= 0) {
            const lot = lots[idx]!;
            const take = Math.min(lot.qty, qty);
            lot.qty -= take;
            if (lot.qty <= 1e-12) lots.splice(idx, 1);
          }
        } else {
          let rem = qty;
          while (rem > 1e-12 && lots.length > 0) {
            const first = lots[0]!;
            const take = Math.min(first.qty, rem);
            first.qty -= take;
            rem -= take;
            if (first.qty <= 1e-12) lots.shift();
          }
        }
        continue;
      }
      // Other buys on secondary (ignore for clip stack)
      continue;
    }

    if (o.side === hedgeEntrySide && isD2SecondaryEntryClip(o, d1Side)) {
      const step = displayStepFromOrder(o);
      if (step == null) continue;
      lots.push({
        correlationId: (o.correlationId ?? "").trim() || `unknown_${o.createdAt.getTime()}`,
        displayStep: step,
        qty,
        entryPx: fillPx,
      });
    }
  }

  return lots
    .filter((l) => l.qty > 1e-10)
    .map((l) => ({
      correlationId: l.correlationId,
      displayStep: l.displayStep,
      qty: l.qty,
      entryPx: l.entryPx,
    }));
}

export function d2StepLabel(displayStep: number): string {
  return `D2 Step ${displayStep}`;
}
