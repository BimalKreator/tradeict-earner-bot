"use server";

import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logAdminAction } from "@/server/audit/audit-logger";
import { requireAdminId } from "@/server/auth/require-admin-id";
import { termsAndConditions } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";

export type AdminTermsActionState = { ok?: true; error?: string } | null;

const idSchema = z.string().uuid();
const versionNameSchema = z
  .string()
  .trim()
  .min(1, "Version name is required.")
  .max(200, "Version name is too long.");
const contentSchema = z
  .string()
  .min(1, "Content is required.")
  .max(512_000, "Content exceeds maximum length.");

function revalidateTermsPaths() {
  revalidatePath("/admin/terms");
  revalidatePath("/terms");
}

export async function createTermsDraftAction(
  _prev: AdminTermsActionState,
  formData: FormData,
): Promise<AdminTermsActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const vn = versionNameSchema.safeParse(formData.get("versionName"));
  const ct = contentSchema.safeParse(formData.get("content"));
  if (!vn.success) return { error: vn.error.flatten().formErrors[0] ?? "Invalid version name." };
  if (!ct.success) return { error: ct.error.flatten().formErrors[0] ?? "Invalid content." };

  const database = requireDb();
  const now = new Date();
  const [row] = await database
    .insert(termsAndConditions)
    .values({
      versionName: vn.data,
      content: ct.data,
      status: "draft",
      publishedAt: null,
      updatedAt: now,
    })
    .returning({ id: termsAndConditions.id });

  if (!row) return { error: "Could not create draft." };
  await logAdminAction({
    actorAdminId: adminId,
    action: "terms.draft_created",
    entityType: "terms_and_conditions",
    entityId: row.id,
    extra: { version_name: vn.data },
  });
  revalidateTermsPaths();
  redirect(`/admin/terms/${row.id}/edit`);
}

export async function updateTermsVersionAction(
  _prev: AdminTermsActionState,
  formData: FormData,
): Promise<AdminTermsActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const idRaw = formData.get("id");
  const idParsed = idSchema.safeParse(typeof idRaw === "string" ? idRaw : "");
  if (!idParsed.success) return { error: "Invalid terms id." };

  const vn = versionNameSchema.safeParse(formData.get("versionName"));
  const ct = contentSchema.safeParse(formData.get("content"));
  if (!vn.success) return { error: vn.error.flatten().formErrors[0] ?? "Invalid version name." };
  if (!ct.success) return { error: ct.error.flatten().formErrors[0] ?? "Invalid content." };

  const database = requireDb();
  const [existing] = await database
    .select({
      status: termsAndConditions.status,
      versionName: termsAndConditions.versionName,
      content: termsAndConditions.content,
    })
    .from(termsAndConditions)
    .where(eq(termsAndConditions.id, idParsed.data))
    .limit(1);

  if (!existing) return { error: "Terms version not found." };
  if (existing.status === "published") {
    return {
      error:
        "Published terms cannot be edited. Duplicate as a new draft or archive this version first.",
    };
  }

  const now = new Date();
  await database
    .update(termsAndConditions)
    .set({
      versionName: vn.data,
      content: ct.data,
      updatedAt: now,
    })
    .where(eq(termsAndConditions.id, idParsed.data));

  await logAdminAction({
    actorAdminId: adminId,
    action: "terms.updated",
    entityType: "terms_and_conditions",
    entityId: idParsed.data,
    oldValues: {
      version_name: existing.versionName,
      content_chars: existing.content.length,
    },
    newValues: {
      version_name: vn.data,
      content_chars: ct.data.length,
    },
  });

  revalidateTermsPaths();
  return { ok: true };
}

export async function publishTermsVersionAction(
  _prev: AdminTermsActionState,
  formData: FormData,
): Promise<AdminTermsActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const idRaw = formData.get("id");
  const idParsed = idSchema.safeParse(typeof idRaw === "string" ? idRaw : "");
  if (!idParsed.success) return { error: "Invalid terms id." };

  const database = requireDb();
  const id = idParsed.data;
  const now = new Date();

  const [preMeta] = await database
    .select({ versionName: termsAndConditions.versionName })
    .from(termsAndConditions)
    .where(eq(termsAndConditions.id, id))
    .limit(1);

  try {
    await database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM terms_and_conditions WHERE status = 'published' FOR UPDATE`,
      );

      const [target] = await tx
        .select({ status: termsAndConditions.status })
        .from(termsAndConditions)
        .where(eq(termsAndConditions.id, id))
        .for("update")
        .limit(1);

      if (!target) throw new Error("NOT_FOUND");
      if (target.status === "published") throw new Error("ALREADY_PUBLISHED");

      await tx
        .update(termsAndConditions)
        .set({ status: "archived", updatedAt: now })
        .where(eq(termsAndConditions.status, "published"));

      await tx
        .update(termsAndConditions)
        .set({
          status: "published",
          publishedAt: now,
          updatedAt: now,
        })
        .where(eq(termsAndConditions.id, id));

      await logAdminAction({
        actorAdminId: adminId,
        action: "terms.published",
        entityType: "terms_and_conditions",
        entityId: id,
        extra: { version_name: preMeta?.versionName ?? null },
        tx,
      });
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "NOT_FOUND") return { error: "Terms version not found." };
    if (msg === "ALREADY_PUBLISHED") return { error: "This version is already published." };
    console.error("[admin] publish terms failed:", e);
    return { error: "Could not publish (try again)." };
  }

  revalidateTermsPaths();
  return { ok: true };
}

export async function archiveTermsVersionAction(
  _prev: AdminTermsActionState,
  formData: FormData,
): Promise<AdminTermsActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const idRaw = formData.get("id");
  const idParsed = idSchema.safeParse(typeof idRaw === "string" ? idRaw : "");
  if (!idParsed.success) return { error: "Invalid terms id." };

  const database = requireDb();
  const now = new Date();

  const [row] = await database
    .select({
      status: termsAndConditions.status,
      versionName: termsAndConditions.versionName,
    })
    .from(termsAndConditions)
    .where(eq(termsAndConditions.id, idParsed.data))
    .limit(1);

  if (!row) return { error: "Terms version not found." };
  if (row.status === "archived") {
    return { error: "Already archived." };
  }

  await database
    .update(termsAndConditions)
    .set({ status: "archived", updatedAt: now })
    .where(eq(termsAndConditions.id, idParsed.data));

  await logAdminAction({
    actorAdminId: adminId,
    action: "terms.archived",
    entityType: "terms_and_conditions",
    entityId: idParsed.data,
    oldValues: { status: row.status },
    newValues: { status: "archived" as const },
    extra: { version_name: row.versionName },
  });

  revalidateTermsPaths();
  return { ok: true };
}

export async function duplicateTermsAsDraftAction(
  _prev: AdminTermsActionState,
  formData: FormData,
): Promise<AdminTermsActionState> {
  let adminId: string;
  try {
    adminId = await requireAdminId();
  } catch {
    return { error: "Not authorized." };
  }

  const idRaw = formData.get("id");
  const idParsed = idSchema.safeParse(typeof idRaw === "string" ? idRaw : "");
  if (!idParsed.success) return { error: "Invalid terms id." };

  const database = requireDb();
  const [src] = await database
    .select()
    .from(termsAndConditions)
    .where(eq(termsAndConditions.id, idParsed.data))
    .limit(1);

  if (!src) return { error: "Terms version not found." };

  const now = new Date();
  const copyName = `${src.versionName} (draft copy)`.slice(0, 200);
  const [inserted] = await database
    .insert(termsAndConditions)
    .values({
      versionName: copyName,
      content: src.content,
      status: "draft",
      publishedAt: null,
      updatedAt: now,
    })
    .returning({ id: termsAndConditions.id });

  if (!inserted) return { error: "Could not duplicate." };
  await logAdminAction({
    actorAdminId: adminId,
    action: "terms.duplicated",
    entityType: "terms_and_conditions",
    entityId: inserted.id,
    extra: { copied_from_id: idParsed.data, version_name: copyName },
  });
  revalidateTermsPaths();
  redirect(`/admin/terms/${inserted.id}/edit`);
}

export async function listTermsVersionsForAdmin() {
  const database = requireDb();
  return database
    .select({
      id: termsAndConditions.id,
      versionName: termsAndConditions.versionName,
      status: termsAndConditions.status,
      publishedAt: termsAndConditions.publishedAt,
      updatedAt: termsAndConditions.updatedAt,
    })
    .from(termsAndConditions)
    .orderBy(desc(termsAndConditions.updatedAt));
}

export async function getTermsVersionForAdminEdit(id: string) {
  const database = requireDb();
  const [row] = await database
    .select()
    .from(termsAndConditions)
    .where(eq(termsAndConditions.id, id))
    .limit(1);
  return row ?? null;
}
