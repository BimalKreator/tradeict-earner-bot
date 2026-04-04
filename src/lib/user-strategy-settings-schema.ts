import { z } from "zod";

function parsePositiveNumber(raw: string): number | null {
  const n = Number(String(raw).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type UserStrategySettingsConstraints = {
  recommendedCapitalInr: string | null;
  maxLeverage: string | null;
};

/**
 * Shared client + server validation for strategy run capital / leverage.
 * When `maxLeverage` is missing, leverage is not validated and must not be persisted (fail closed for leverage updates).
 */
export function createUserStrategyRunSettingsSchema(
  constraints: UserStrategySettingsConstraints,
) {
  const recRaw = constraints.recommendedCapitalInr;
  const recStr =
    recRaw != null && String(recRaw).trim() !== "" ? String(recRaw) : null;
  const recNum = recStr != null ? Number(recStr) : null;

  const maxLevRaw = constraints.maxLeverage;
  const maxLevStr =
    maxLevRaw != null && String(maxLevRaw).trim() !== ""
      ? String(maxLevRaw)
      : null;
  const maxLevNum = maxLevStr != null ? Number(maxLevStr) : null;

  const base = z.object({
    capitalToUseInr: z.string(),
    leverage: z.string(),
  });

  if (maxLevNum == null || !Number.isFinite(maxLevNum)) {
    return base.superRefine((data, ctx) => {
      const cap = parsePositiveNumber(data.capitalToUseInr);
      if (cap == null) {
        ctx.addIssue({
          code: "custom",
          path: ["capitalToUseInr"],
          message: "Capital must be a positive number.",
        });
        return;
      }
      if (recNum != null && Number.isFinite(recNum) && cap < recNum) {
        ctx.addIssue({
          code: "custom",
          path: ["capitalToUseInr"],
          message: `Capital must be at least $${recNum} (recommended minimum, USD).`,
        });
      }
    });
  }

  return base.superRefine((data, ctx) => {
    const cap = parsePositiveNumber(data.capitalToUseInr);
    if (cap == null) {
      ctx.addIssue({
        code: "custom",
        path: ["capitalToUseInr"],
        message: "Capital must be a positive number.",
      });
    } else if (
      recNum != null &&
      Number.isFinite(recNum) &&
      cap < recNum
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["capitalToUseInr"],
        message: `Capital must be at least $${recNum} (recommended minimum, USD).`,
      });
    }

    const lev = parsePositiveNumber(data.leverage);
    if (lev == null) {
      ctx.addIssue({
        code: "custom",
        path: ["leverage"],
        message: "Leverage must be a positive number.",
      });
    } else if (lev > maxLevNum) {
      ctx.addIssue({
        code: "custom",
        path: ["leverage"],
        message: `Leverage must be at most ${maxLevNum}×.`,
      });
    }
  });
}
