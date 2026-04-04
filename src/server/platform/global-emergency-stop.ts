import { eq } from "drizzle-orm";

import { db } from "@/server/db";
import { appSettings } from "@/server/db/schema";

const GLOBAL_EMERGENCY_STOP_KEY = "global_emergency_stop";

export type GlobalEmergencyStopPayload = {
  active: boolean;
  updatedAt?: string;
  updatedByAdminId?: string | null;
};

/**
 * Platform-wide kill switch: when active, the execution worker must reject every
 * order (entries and exits). Stored in `app_settings` so it survives deploys and
 * can be toggled without env churn.
 */
export async function getGlobalEmergencyStopActive(): Promise<boolean> {
  if (!db) return false;
  const [row] = await db
    .select({ valueJson: appSettings.valueJson })
    .from(appSettings)
    .where(eq(appSettings.key, GLOBAL_EMERGENCY_STOP_KEY))
    .limit(1);
  if (!row?.valueJson) return false;
  const v = row.valueJson as GlobalEmergencyStopPayload;
  return v.active === true;
}

export async function setGlobalEmergencyStop(
  active: boolean,
  adminId: string,
): Promise<void> {
  if (!db) throw new Error("Database unavailable.");
  const now = new Date();
  const valueJson: GlobalEmergencyStopPayload = {
    active,
    updatedAt: now.toISOString(),
    updatedByAdminId: adminId,
  };
  await db
    .insert(appSettings)
    .values({
      key: GLOBAL_EMERGENCY_STOP_KEY,
      valueJson: valueJson as Record<string, unknown>,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: {
        valueJson: valueJson as Record<string, unknown>,
        updatedAt: now,
      },
    });
}

export async function getGlobalEmergencyStopDetails(): Promise<GlobalEmergencyStopPayload | null> {
  if (!db) return null;
  const [row] = await db
    .select({ valueJson: appSettings.valueJson })
    .from(appSettings)
    .where(eq(appSettings.key, GLOBAL_EMERGENCY_STOP_KEY))
    .limit(1);
  if (!row?.valueJson) return { active: false };
  return row.valueJson as GlobalEmergencyStopPayload;
}
