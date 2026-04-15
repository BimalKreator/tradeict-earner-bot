/**
 * Barrel export for Drizzle schema — used by `drizzle.config.ts` and `db/index.ts`.
 * Table modules are split by domain to keep migrations reviewable on production deploys.
 */

export * from "./enums";
export * from "./phase1";
export * from "./admins";
export * from "./users";
export * from "./auth";
export * from "./exchange";
export * from "./strategies";
export * from "./subscriptions";
export * from "./billing";
export * from "./trading";
export * from "./trading-engine";
export * from "./virtual-trading";
export * from "./compliance";
export * from "./operations";
export * from "./settings";
export * from "./rateLimit";
export * from "./trend-arb";
