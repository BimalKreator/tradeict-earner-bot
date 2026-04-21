import Link from "next/link";

import { UserStrategySettingsForm } from "@/components/user/UserStrategySettingsForm";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { getUserStrategySettingsPageData } from "@/server/queries/user-strategy-settings-access";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

function InitializeSettingsCTA() {
  return (
    <div className="space-y-6">
      <Link
        href="/user/my-strategies"
        className="text-sm text-[var(--accent)] hover:underline"
      >
        ← My strategies
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
        Strategy settings
      </h1>
      <GlassPanel className="space-y-3">
        <p className="text-sm text-[var(--text-muted)]">
          This strategy does not have initialized settings for your account yet.
        </p>
        <p className="text-xs text-slate-400">
          Click initialize to create your settings context, then configure capital,
          leverage, and exchange accounts.
        </p>
        <Link
          href="/user/my-strategies"
          className="inline-flex rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-sky-500/20"
        >
          Initialize Settings
        </Link>
      </GlassPanel>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return { title: `Strategy settings · ${safeDecodeURIComponent(slug)}` };
}

export default async function UserStrategySettingsPage({ params }: PageProps) {
  const { slug: raw } = await params;
  const slug = safeDecodeURIComponent(raw);

  const userId = await requireUserIdForPage(
    `/user/my-strategies/${encodeURIComponent(slug)}/settings`,
  );

  if (!userId) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Strategy settings
        </h1>
        <p className="text-sm text-amber-100/90">
          <Link
            href={`/login?next=${encodeURIComponent(`/user/my-strategies/${slug}/settings`)}`}
            className="text-[var(--accent)] underline underline-offset-2"
          >
            Sign in
          </Link>{" "}
          to open strategy settings.
        </p>
      </div>
    );
  }

  if (!db) {
    return (
      <div className="space-y-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Strategy settings
        </h1>
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">
            Database is not configured.
          </p>
        </GlassPanel>
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof getUserStrategySettingsPageData>> = null;
  try {
    data = await getUserStrategySettingsPageData(userId, slug);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("user_strategy_settings_page_load_failed", { slug, msg });
    data = null;
  }
  if (!data) return <InitializeSettingsCTA />;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/user/my-strategies"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← My strategies
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          {data?.strategyName ?? "Strategy"}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Capital and leverage for your bot run on this strategy.
        </p>
      </div>

      <UserStrategySettingsForm
        strategySlug={data.strategySlug ?? slug}
        constraints={{
          recommendedCapitalInr: data.recommendedCapitalInr ?? null,
          maxLeverage: data.maxLeverage ?? null,
        }}
        initialCapitalToUseInr={
          data.capitalToUseInr != null && String(data.capitalToUseInr).trim() !== ""
            ? String(data.capitalToUseInr)
            : ""
        }
        initialLeverage={
          data.leverage != null && String(data.leverage).trim() !== ""
            ? String(data.leverage)
            : data.maxLeverage != null &&
                String(data.maxLeverage).trim() !== "" &&
                Number.isFinite(Number(data.maxLeverage))
              ? "1"
              : ""
        }
        initialPrimaryExchangeId={data.primaryExchangeConnectionId ?? null}
        initialSecondaryExchangeId={data.secondaryExchangeConnectionId ?? null}
        deltaConnections={data.deltaConnections ?? []}
        runStatus={data.runStatus ?? "ready_to_activate"}
        canEditSettings={data.canEditSettings ?? false}
        isHedgeScalpingStrategy={data.isHedgeScalpingStrategy ?? false}
        hedgeScalpingAllowedSymbols={data.hedgeScalpingAllowedSymbols ?? []}
        initialHedgeScalpingSymbol={data.initialHedgeScalpingSymbol ?? null}
        hedgeScalpingResolvedConfig={data.hedgeScalpingResolvedConfig ?? null}
        isTrendProfitLockStrategy={data.isTrendProfitLockStrategy ?? false}
        trendProfitLockInitialConfig={data.trendProfitLockInitialConfig ?? null}
      />
    </div>
  );
}
