import { describe, expect, it } from "vitest";

import { defaultHedgeScalpingConfig } from "@/lib/hedge-scalping-config";

import { evaluateHedgeScalpingState } from "./engine-math";

describe("evaluateHedgeScalpingState D2 re-entry", () => {
  it("re-opens step 1 when no active clip exists at step 1", () => {
    const cfg = defaultHedgeScalpingConfig();
    const intents = evaluateHedgeScalpingState(
      {
        d1Side: "LONG",
        d1EntryPrice: 100,
        maxFavorablePrice: 100,
        activeD2Clips: [],
      },
      100,
      cfg,
    );

    expect(intents.some((i) => i.type === "OPEN_D2_CLIP" && i.stepLevel === 1)).toBe(
      true,
    );
  });

  it("does not open a step already active", () => {
    const cfg = defaultHedgeScalpingConfig();
    const intents = evaluateHedgeScalpingState(
      {
        d1Side: "LONG",
        d1EntryPrice: 100,
        maxFavorablePrice: 100,
        activeD2Clips: [
          {
            stepLevel: 1,
            entryPrice: 100,
            side: "SHORT",
            targetPrice: 95,
            stopLossPrice: 105,
          },
        ],
      },
      100,
      cfg,
    );

    expect(intents.some((i) => i.type === "OPEN_D2_CLIP" && i.stepLevel === 1)).toBe(
      false,
    );
  });
});
