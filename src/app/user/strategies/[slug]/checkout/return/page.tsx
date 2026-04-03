import Link from "next/link";

import { CheckoutReturnPoller } from "@/components/user/CheckoutReturnPoller";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { requireUserIdForPage } from "@/server/auth/require-user";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ paymentId?: string }>;
};

export default async function StrategyCheckoutReturnPage({
  params,
  searchParams,
}: Props) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const sp = await searchParams;
  const paymentId = sp.paymentId?.trim() ?? "";

  const userId = await requireUserIdForPage(
    `/user/strategies/${encodeURIComponent(slug)}/checkout/return`,
  );

  if (!userId) {
    return (
      <div className="space-y-6">
        <GlassPanel>
          <p className="text-sm text-[var(--text-muted)]">Sign in to continue.</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/user/strategies/${slug}/checkout/return?paymentId=${paymentId}`)}`}
            className="mt-3 inline-block text-sm text-[var(--accent)] underline"
          >
            Go to sign in
          </Link>
        </GlassPanel>
      </div>
    );
  }

  if (!UUID.test(paymentId)) {
    return (
      <div className="space-y-6">
        <GlassPanel>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            Invalid return
          </h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Missing or invalid payment reference. Open checkout again from{" "}
            <Link href="/user/strategies" className="text-[var(--accent)] underline">
              Strategies
            </Link>
            .
          </p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/user/strategies/${encodeURIComponent(slug)}/checkout`}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Checkout
        </Link>
        <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Payment status
        </h1>
      </div>
      <CheckoutReturnPoller paymentId={paymentId} strategySlug={slug} />
    </div>
  );
}
