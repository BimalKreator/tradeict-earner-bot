import Link from "next/link";
import { notFound } from "next/navigation";

import { StrategyCashfreeCheckout } from "@/components/user/StrategyCashfreeCheckout";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { formatDateMediumIST } from "@/lib/access-remaining-days-ist";
import { requireUserIdForPage } from "@/server/auth/require-user";
import { db } from "@/server/db";
import {
  getStrategyCheckoutRenewalForecast,
  resolveStrategyCheckoutQuote,
} from "@/server/queries/strategy-checkout-price";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ intent?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return { title: `Checkout · ${decodeURIComponent(slug)}` };
}

export default async function UserStrategyCheckoutPage({
  params,
  searchParams,
}: Props) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const sp = await searchParams;
  const intentRenew = sp.intent?.toLowerCase() === "renew";

  const userId = await requireUserIdForPage(
    `/user/strategies/${encodeURIComponent(slug)}/checkout`,
  );

  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-[var(--text-primary)]">
            Checkout
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Sign in to continue to payment.
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/user/strategies/${slug}/checkout`)}`}
            className="mt-4 inline-block text-sm text-[var(--accent)] hover:underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  if (!db) {
    return (
      <GlassPanel>
        <p className="text-sm text-[var(--text-muted)]">Database not configured.</p>
      </GlassPanel>
    );
  }

  const quote = await resolveStrategyCheckoutQuote(userId, slug);
  if (!quote) {
    notFound();
  }

  const forecast = await getStrategyCheckoutRenewalForecast(
    userId,
    quote.strategyId,
    30,
  );
  if (!forecast) {
    notFound();
  }

  const expiryIst = formatDateMediumIST(forecast.projectedAccessValidUntil);
  const renewalForecastLine = `Adds ${forecast.accessDaysAdded} days. New expiry: ${expiryIst}`;
  const newSubForecastLine = `If you pay now, access is expected through ${expiryIst} (IST date).`;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/user/strategies"
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Strategies
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Checkout
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {quote.name}{" "}
          <span className="font-mono text-[var(--accent)]">({quote.slug})</span>
        </p>
      </div>

      {intentRenew ? (
        <p className="text-xs text-sky-200/80">
          Renewal checkout — stacking applies after payment is confirmed.
        </p>
      ) : null}

      <StrategyCashfreeCheckout
        strategySlug={quote.slug}
        strategyName={quote.name}
        amountInr={quote.monthlyFeeInr}
        revenueSharePercent={quote.revenueSharePercent}
        hasPricingOverride={quote.hasPricingOverride}
        checkoutKind={forecast.isRenewal ? "renewal" : "new"}
        forecastLine={
          forecast.isRenewal ? renewalForecastLine : newSubForecastLine
        }
      />
    </div>
  );
}
