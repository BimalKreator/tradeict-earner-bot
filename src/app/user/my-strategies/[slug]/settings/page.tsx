import Link from "next/link";
import { notFound } from "next/navigation";

import { UserStrategySettingsForm } from "@/components/user/UserStrategySettingsForm";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import { getUserStrategySettingsPageData } from "@/server/queries/user-strategy-settings-access";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  return { title: `Strategy settings · ${decodeURIComponent(slug)}` };
}

export default async function UserStrategySettingsPage({ params }: PageProps) {
  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw);

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

  const data = await getUserStrategySettingsPageData(userId, slug);
  if (!data) {
    notFound();
  }

  const constraints = {
    recommendedCapitalInr: data.recommendedCapitalInr,
    maxLeverage: data.maxLeverage,
  };

  const maxLevN =
    data.maxLeverage != null && String(data.maxLeverage).trim() !== ""
      ? Number(data.maxLeverage)
      : null;
  const initialCapital = data.capitalToUseInr ?? "";
  const initialLeverage =
    data.leverage ??
    (maxLevN != null && Number.isFinite(maxLevN) ? "1" : "");

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
          {data.strategyName}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Capital and leverage for your bot run on this strategy.
        </p>
      </div>

      <UserStrategySettingsForm
        strategySlug={data.strategySlug}
        constraints={constraints}
        initialCapitalToUseInr={initialCapital}
        initialLeverage={initialLeverage}
        runStatus={data.runStatus}
        canEditSettings={data.canEditSettings}
      />
    </div>
  );
}
