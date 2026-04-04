import { TermsMarkdown } from "@/components/public/TermsMarkdown";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { getPublishedTerms } from "@/lib/terms";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Terms & conditions",
};

export default async function TermsPage() {
  const terms = await getPublishedTerms();

  return (
    <div className="relative min-h-[60vh]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56,189,248,0.22), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 50%, rgba(14,165,233,0.08), transparent 50%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-4 py-14 sm:px-6 lg:py-20">
        <GlassPanel className="border border-[var(--border-glass)]/80 bg-[rgba(8,12,22,0.72)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <header className="border-b border-[var(--border-glass)]/60 pb-8">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Legal
            </p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
              Terms &amp; conditions
            </h1>
            {terms ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[var(--text-muted)]">
                <span className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-200/95">
                  {terms.versionName}
                </span>
                <span className="hidden sm:inline text-[var(--border-glass)]">·</span>
                <span>
                  Published{" "}
                  <time dateTime={terms.publishedAt.toISOString()}>
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "long",
                      timeStyle: "short",
                      timeZone: "Asia/Kolkata",
                    }).format(new Date(terms.publishedAt))}{" "}
                    IST
                  </time>
                </span>
              </div>
            ) : null}
          </header>

          {terms ? (
            <div className="legal-markdown terms-prose pt-10">
              <TermsMarkdown content={terms.content} />
            </div>
          ) : (
            <div className="space-y-4 pt-10 text-sm leading-relaxed text-[var(--text-muted)]">
              <p>
                No published terms are available yet. Please check back later or contact support at{" "}
                <a
                  href={`mailto:${process.env.SUPPORT_EMAIL ?? "support@tradeictearner.online"}`}
                  className="text-sky-400 hover:underline"
                >
                  {process.env.SUPPORT_EMAIL ?? "support@tradeictearner.online"}
                </a>
                .
              </p>
              <p>
                All business dates and settlement windows use{" "}
                <strong className="text-[var(--text-primary)]">Asia/Kolkata (IST)</strong> unless
                stated otherwise.
              </p>
            </div>
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
