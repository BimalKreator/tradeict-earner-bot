"use client";

import { logoutAction } from "@/server/actions/logout";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="w-full rounded-lg border border-[var(--border-glass)] py-2 text-left text-sm text-[var(--text-muted)] transition hover:bg-white/5 hover:text-[var(--accent)]"
      >
        Log out
      </button>
    </form>
  );
}
