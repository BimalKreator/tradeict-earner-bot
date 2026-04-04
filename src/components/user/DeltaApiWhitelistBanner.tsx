"use client";

import { useCallback, useState } from "react";

const FALLBACK_LABEL = "IP not configured";

type Props = {
  /** Raw value from `NEXT_PUBLIC_SERVER_OUTBOUND_IP` (trimmed on server). */
  outboundIp: string;
};

export function DeltaApiWhitelistBanner({ outboundIp }: Props) {
  const ip = outboundIp.trim();
  const configured = ip.length > 0;
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!configured) return;
    try {
      await navigator.clipboard.writeText(ip);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [configured, ip]);

  return (
    <div className="rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 via-[var(--border-glass)]/30 to-black/40 px-4 py-4 backdrop-blur-md">
      <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-wide text-cyan-200/95">
        Delta Exchange API Whitelisting
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
        For secure trading, add your bot server&apos;s outbound IP to the IP whitelist in your
        Delta Exchange India API key settings. Only requests from that IP will be accepted when
        whitelist mode is enabled.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Server outbound IP
          </p>
          <p
            className={`mt-1 break-all font-mono text-base ${
              configured ? "text-[var(--text-primary)]" : "text-amber-200/90"
            }`}
          >
            {configured ? ip : FALLBACK_LABEL}
          </p>
          {!configured ? (
            <p className="mt-1 text-xs text-amber-200/80">
              Set <span className="font-mono">NEXT_PUBLIC_SERVER_OUTBOUND_IP</span> in your
              deployment environment and redeploy so users see the correct address.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={copy}
          disabled={!configured}
          className="btn-primary shrink-0 px-4 py-2.5 text-sm font-medium disabled:pointer-events-none disabled:opacity-40"
        >
          {copied ? "Copied" : "Copy IP"}
        </button>
      </div>
    </div>
  );
}
