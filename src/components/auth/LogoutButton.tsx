"use client";

import { logoutAction } from "@/server/actions/logout";

export function LogoutButton() {
  return (
    <form action={logoutAction}>
      <button
        type="submit"
        className="btn-secondary w-full justify-start text-left text-sm"
      >
        Log out
      </button>
    </form>
  );
}
