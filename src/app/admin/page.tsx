import { redirect } from "next/navigation";

import { requireAdminSession } from "@/server/auth/require-admin";

export const dynamic = "force-dynamic";

/**
 * `/admin` → canonical dashboard route.
 */
export default async function AdminRootRedirectPage() {
  await requireAdminSession();
  redirect("/admin/dashboard");
}
