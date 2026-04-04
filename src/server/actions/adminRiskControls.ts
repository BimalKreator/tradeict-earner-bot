"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdminId } from "@/server/auth/require-super-admin";
import { setGlobalEmergencyStop } from "@/server/platform/global-emergency-stop";

export type AdminRiskControlState =
  | { ok: true; message: string; active: boolean }
  | { ok: false; message: string; active?: boolean }
  | null;

const initial: AdminRiskControlState = null;

export async function toggleGlobalEmergencyStopAction(
  _prev: AdminRiskControlState,
  formData: FormData,
): Promise<AdminRiskControlState> {
  let adminId: string;
  try {
    adminId = await requireSuperAdminId();
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const msg =
      code === "FORBIDDEN"
        ? "Only super admins can change the global emergency stop."
        : code === "UNAUTHORIZED"
          ? "Please sign in as an admin."
          : "Unauthorized.";
    return { ok: false, message: msg };
  }

  const next = formData.get("active");
  const active = next === "true" || next === "on" || next === "1";

  try {
    await setGlobalEmergencyStop(active, adminId);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to update emergency stop.";
    return { ok: false, message: msg };
  }

  revalidatePath("/admin/risk");
  revalidatePath("/admin/dashboard");

  return {
    ok: true,
    active,
    message: active
      ? "Global emergency stop is ON — all bot order submissions are blocked."
      : "Global emergency stop is OFF — normal execution gates apply.",
  };
}

export const adminRiskControlInitialState = initial;
