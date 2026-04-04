"use client";

import { useCallback, useEffect, useState } from "react";

export type AppToastVariant = "success" | "error" | "info";

type ToastItem = { id: number; message: string; variant: AppToastVariant };

const TOAST_EVENT = "tradeict-toast";

export function showAppToast(message: string, variant: AppToastVariant = "info") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, {
      detail: { message, variant } satisfies Omit<ToastItem, "id">,
    }),
  );
}

export function GlobalToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, variant: AppToastVariant) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, variant }]);
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ message: string; variant: AppToastVariant }>;
      if (ce.detail?.message) push(ce.detail.message, ce.detail.variant ?? "info");
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, [push]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-0 right-0 z-[100] flex max-w-[min(100vw-1.5rem,22rem)] flex-col gap-2 p-4 md:bottom-4 md:right-4"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur-md ${
            t.variant === "success"
              ? "border-emerald-500/35 bg-emerald-950/80 text-emerald-100"
              : t.variant === "error"
                ? "border-red-500/40 bg-red-950/85 text-red-100"
                : "border-[var(--border-glass)] bg-[rgba(3,7,18,0.92)] text-[var(--text-primary)]"
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
