import { and, desc, eq } from "drizzle-orm";

import { db } from "@/server/db";
import { profileChangeRequests, users } from "@/server/db/schema";

export async function getUserProfileChangeRequests(userId: string) {
  if (!db) return [];
  return db
    .select()
    .from(profileChangeRequests)
    .where(eq(profileChangeRequests.userId, userId))
    .orderBy(desc(profileChangeRequests.createdAt));
}

export async function getPendingProfileChangeRequestsForAdmin() {
  if (!db) return [];
  return db
    .select({
      id: profileChangeRequests.id,
      userId: profileChangeRequests.userId,
      userEmail: users.email,
      userName: users.name,
      changesJson: profileChangeRequests.changesJson,
      createdAt: profileChangeRequests.createdAt,
    })
    .from(profileChangeRequests)
    .innerJoin(users, eq(users.id, profileChangeRequests.userId))
    .where(eq(profileChangeRequests.status, "pending"))
    .orderBy(desc(profileChangeRequests.createdAt));
}

export async function userHasPendingProfileRequest(userId: string) {
  if (!db) return false;
  const [row] = await db
    .select({ id: profileChangeRequests.id })
    .from(profileChangeRequests)
    .where(
      and(
        eq(profileChangeRequests.userId, userId),
        eq(profileChangeRequests.status, "pending"),
      ),
    )
    .limit(1);
  return Boolean(row);
}
