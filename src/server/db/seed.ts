/**
 * Database seed — run after migrations: `npm run db:seed`
 * Requires DATABASE_URL. In production, also set ALLOW_DB_SEED=true and strong SEED_* secrets.
 */
import "dotenv/config";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

function assertSeedAllowed() {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && process.env.ALLOW_DB_SEED !== "true") {
    console.error(
      "Refusing to seed: set ALLOW_DB_SEED=true for production or use NODE_ENV!=production.",
    );
    process.exit(1);
  }
}

async function main() {
  assertSeedAllowed();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const adminEmail =
    process.env.SEED_ADMIN_EMAIL ?? "bimal@tradeictearner.online";
  const adminPassword =
    process.env.SEED_ADMIN_PASSWORD ?? "Tikhat@999";
  if (!adminPassword || adminPassword.length < 8) {
    console.error(
      "SEED_ADMIN_PASSWORD must be at least 8 characters (or rely on the built-in default for local seed only).",
    );
    process.exit(1);
  }

  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client, { schema });

  const { admins, appSettings, strategies, termsAndConditions } = schema;

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  await db
    .insert(admins)
    .values({
      email: adminEmail,
      name: process.env.SEED_ADMIN_NAME ?? "Platform Admin",
      passwordHash,
      role: "super_admin",
    })
    .onConflictDoNothing({ target: admins.email });

  const [adminRow] = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.email, adminEmail))
    .limit(1);

  const strategyRows = [
    {
      id: "1769ec34-73b5-4a59-bc2f-5315bc888c07",
      slug: "trend-profit-lock-scalping",
      name: "Trend Profit Lock Scalping",
      description:
        "Live dual-account scalping strategy for BTCUSD perpetual (D1 anchor + D2 step scalps).",
      defaultMonthlyFeeInr: "999.00",
      defaultRevenueSharePercent: "50.00",
      status: "active" as const,
      settingsJson: {
        timeframe: "1m",
        halftrendAmplitude: 2,
        symbol: "BTCUSD",
        d1CapitalAllocationPct: 100,
        d1TargetPct: 12,
        d1StoplossPct: 1,
        d1BreakevenTriggerPct: 30,
        d2Steps: [
          { step: 1, stepTriggerPct: 20, stepQtyPctOfD1: 20, targetLinkType: "D1_ENTRY", stepStoplossPct: 12 },
          { step: 2, stepTriggerPct: 30, stepQtyPctOfD1: 20, targetLinkType: "STEP_1_ENTRY", stepStoplossPct: 12 },
          { step: 3, stepTriggerPct: 40, stepQtyPctOfD1: 20, targetLinkType: "STEP_2_ENTRY", stepStoplossPct: 12 },
          { step: 4, stepTriggerPct: 50, stepQtyPctOfD1: 20, targetLinkType: "STEP_3_ENTRY", stepStoplossPct: 12 },
          { step: 5, stepTriggerPct: 60, stepQtyPctOfD1: 20, targetLinkType: "STEP_4_ENTRY", stepStoplossPct: 12 },
        ],
      },
    },
    {
      slug: "momentum-btc",
      name: "BTC Momentum",
      description:
        "Sample momentum strategy for Delta India — replace with real metadata in production.",
      defaultMonthlyFeeInr: "499.00",
      defaultRevenueSharePercent: "50.00",
      status: "active" as const,
    },
    {
      slug: "range-eth",
      name: "ETH Range",
      description: "Sample range-bound strategy placeholder.",
      defaultMonthlyFeeInr: "499.00",
      defaultRevenueSharePercent: "50.00",
      status: "active" as const,
    },
    {
      slug: "trend-alt",
      name: "Alt Trend",
      description: "Sample multi-asset trend strategy placeholder.",
      defaultMonthlyFeeInr: "699.00",
      defaultRevenueSharePercent: "45.00",
      status: "paused" as const,
    },
  ];

  for (const row of strategyRows) {
    await db.insert(strategies).values(row).onConflictDoNothing({
      target: strategies.slug,
    });
  }

  await db
    .insert(appSettings)
    .values({
      key: "default_monthly_fee_inr",
      valueJson: { inr: 499, currency: "INR" },
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueJson: { inr: 499, currency: "INR" },
        updatedAt: new Date(),
      },
    });

  await db
    .insert(appSettings)
    .values({
      key: "default_revenue_share_percent",
      valueJson: { percent: 50 },
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueJson: { percent: 50 },
        updatedAt: new Date(),
      },
    });

  await db
    .insert(appSettings)
    .values({
      key: "business_timezone",
      valueJson: { tz: "Asia/Kolkata", label: "IST" },
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueJson: { tz: "Asia/Kolkata", label: "IST" },
        updatedAt: new Date(),
      },
    });

  await db
    .insert(appSettings)
    .values({
      key: "global_emergency_stop",
      valueJson: { active: false },
    })
    .onConflictDoNothing({ target: appSettings.key });

  const [existingTerms] = await db
    .select({ id: termsAndConditions.id })
    .from(termsAndConditions)
    .limit(1);

  if (!existingTerms) {
    await db.insert(termsAndConditions).values({
      versionName: "v1.0 (seed)",
      content:
        "# Terms & conditions (seed)\n\n" +
        "This is the initial seeded terms document. **Replace** via **Admin → Terms** in production.\n\n" +
        "All business dates use **Asia/Kolkata (IST)** unless stated otherwise.\n",
      status: "published",
      publishedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  console.log(
    "Seed completed: admin (if new), strategies, app_settings, terms_and_conditions (if empty).",
  );
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
