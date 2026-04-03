import { GlassPanel } from "@/components/ui/GlassPanel";
import { TermsMarkdown } from "@/components/public/TermsMarkdown";
import { getCurrentTermsVersion } from "@/lib/terms";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Terms & conditions",
};

export default async function TermsPage() {
  const terms = await getCurrentTermsVersion();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <GlassPanel>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-[var(--text-primary)]">
          Terms &amp; conditions
        </h1>
        {terms ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="rounded-md bg-[var(--accent-dim)] px-2 py-0.5 font-medium text-[var(--accent)]">
                Version {terms.version}
              </span>
              {terms.title ? (
                <span className="text-[var(--text-muted)]">{terms.title}</span>
              ) : null}
              <span>
                Effective{" "}
                {new Intl.DateTimeFormat("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Kolkata",
                }).format(new Date(terms.effectiveFrom))}{" "}
                IST
              </span>
            </div>
            <div className="mt-8 border-t border-[var(--border-glass)] pt-8">
              <TermsMarkdown content={terms.contentMd} />
            </div>
          </>
        ) : (
          <div className="mt-6 space-y-3 text-sm leading-relaxed text-[var(--text-muted)]">
            <p>
              No published terms are available yet. Please check back later or
              contact support at{" "}
              <a
                href={`mailto:${process.env.SUPPORT_EMAIL ?? "support@tradeictearner.online"}`}
                className="text-[var(--accent)] hover:underline"
              >
                {process.env.SUPPORT_EMAIL ?? "support@tradeictearner.online"}
              </a>
              .
            </p>
            <p>
              All business dates and settlement windows use{" "}
              <strong className="text-[var(--text-primary)]">
                Asia/Kolkata (IST)
              </strong>{" "}
              unless stated otherwise.
            </p>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
