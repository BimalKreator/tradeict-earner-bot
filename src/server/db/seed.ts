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

  const { admins, appSettings, strategies, termsVersions } = schema;

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
    .insert(termsVersions)
    .values({
      version: 1,
      title: "Terms & conditions v1",
      contentMd:
        "This is the initial seeded terms document. Replace via the admin panel in production. " +
        "All business dates use Asia/Kolkata (IST) unless stated otherwise.",
      effectiveFrom: new Date(),
      createdByAdminId: adminRow?.id ?? null,
    })
    .onConflictDoNothing({ target: termsVersions.version });

  console.log("Seed completed: admin (if new), strategies, app_settings, terms_versions v1.");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
