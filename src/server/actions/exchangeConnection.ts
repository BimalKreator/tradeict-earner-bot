"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUserId } from "@/server/auth/require-user";
import { exchangeConnections } from "@/server/db/schema";
import { requireDb } from "@/server/db/require-db";
import {
  assertExchangeSecretsKeyConfigured,
  decryptExchangeSecret,
  encryptExchangeSecret,
} from "@/server/exchange/exchange-secrets-crypto";
import { testDeltaIndiaWalletAccess } from "@/server/exchange/delta-india-client";

const PROVIDER = "delta_india" as const;

function statusAfterSave(
  prev: string,
): "active" | "disabled_user" | "disabled_admin" | "error" {
  if (prev === "disabled_admin") return "disabled_admin";
  if (prev === "disabled_user") return "disabled_user";
  return "active";
}

async function loadRowForUser(userId: string) {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(exchangeConnections)
    .where(
      and(
        eq(exchangeConnections.userId, userId),
        eq(exchangeConnections.provider, PROVIDER),
        isNull(exchangeConnections.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

function encryptionConfigErrorMessage(e: unknown): string {
  if (
    e instanceof Error &&
    e.message === "EXCHANGE_SECRETS_ENCRYPTION_KEY_MISSING_OR_INVALID"
  ) {
    return "Server misconfiguration: EXCHANGE_SECRETS_ENCRYPTION_KEY must be set to exactly 32 characters (UTF-8).";
  }
  return "Could not encrypt credentials. Check server configuration.";
}

export type SaveDeltaIndiaExchangeState = {
  ok?: boolean;
  error?: string;
  message?: string;
};

const saveSchema = z.object({
  api_key: z
    .string()
    .trim()
    .min(8, "API key looks too short")
    .max(512, "API key is too long"),
  api_secret: z
    .string()
    .min(1, "API secret is required")
    .max(512, "API secret is too long"),
});

export async function saveDeltaIndiaExchangeAction(
  _prev: SaveDeltaIndiaExchangeState,
  formData: FormData,
): Promise<SaveDeltaIndiaExchangeState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { error: "Please sign in again." };
  }

  const parsed = saveSchema.safeParse({
    api_key: formData.get("api_key"),
    api_secret: formData.get("api_secret"),
  });
  if (!parsed.success) {
    const first = parsed.error.flatten().fieldErrors;
    const msg =
      first.api_key?.[0] ??
      first.api_secret?.[0] ??
      "Check API key and secret.";
    return { error: msg };
  }

  let encKey: Buffer;
  try {
    encKey = assertExchangeSecretsKeyConfigured();
  } catch (e) {
    return { error: encryptionConfigErrorMessage(e) };
  }

  let keyCipher: string;
  let secretCipher: string;
  try {
    keyCipher = encryptExchangeSecret(parsed.data.api_key, encKey);
    secretCipher = encryptExchangeSecret(parsed.data.api_secret, encKey);
  } catch {
    return { error: "Encryption failed unexpectedly." };
  }

  const db = requireDb();
  const now = new Date();
  const existing = await loadRowForUser(userId);

  try {
    if (existing) {
      await db
        .update(exchangeConnections)
        .set({
          apiKeyCiphertext: keyCipher,
          apiSecretCiphertext: secretCipher,
          status: statusAfterSave(existing.status),
          lastTestAt: null,
          lastTestStatus: "unknown",
          lastTestMessage: null,
          updatedAt: now,
        })
        .where(eq(exchangeConnections.id, existing.id));
    } else {
      await db.insert(exchangeConnections).values({
        userId,
        provider: PROVIDER,
        status: "active",
        apiKeyCiphertext: keyCipher,
        apiSecretCiphertext: secretCipher,
        encryptionKeyVersion: 1,
        lastTestStatus: "unknown",
        updatedAt: now,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `Could not save: ${msg}` };
  }

  revalidatePath("/user/exchange");
  return {
    ok: true,
    message: "Delta India credentials saved. Run a connection test before trading.",
  };
}

export type TestDeltaIndiaExchangeState = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export async function testDeltaIndiaExchangeAction(
  _prev: TestDeltaIndiaExchangeState,
  formData: FormData,
): Promise<TestDeltaIndiaExchangeState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { error: "Please sign in again." };
  }

  const rawKey = formData.get("api_key");
  const rawSecret = formData.get("api_secret");
  const formKey = typeof rawKey === "string" ? rawKey.trim() : "";
  const formSecret = typeof rawSecret === "string" ? rawSecret : "";

  let apiKey: string;
  let apiSecret: string;

  if (formKey.length > 0 && formSecret.length > 0) {
    apiKey = formKey;
    apiSecret = formSecret;
  } else {
    const row = await loadRowForUser(userId);
    if (
      !row ||
      !row.apiKeyCiphertext.trim() ||
      !row.apiSecretCiphertext.trim()
    ) {
      return {
        error:
          "Enter API key and secret to test, or save credentials and test with stored keys.",
      };
    }
    let encKey: Buffer;
    try {
      encKey = assertExchangeSecretsKeyConfigured();
    } catch (e) {
      return { error: encryptionConfigErrorMessage(e) };
    }
    try {
      apiKey = decryptExchangeSecret(row.apiKeyCiphertext, encKey);
      apiSecret = decryptExchangeSecret(row.apiSecretCiphertext, encKey);
    } catch {
      return {
        error:
          "Stored credentials could not be decrypted. Re-save keys or fix EXCHANGE_SECRETS_ENCRYPTION_KEY.",
      };
    }
  }

  const result = await testDeltaIndiaWalletAccess({ apiKey, apiSecret });

  const db = requireDb();
  const now = new Date();
  const row = await loadRowForUser(userId);

  if (row) {
    const lastStatus = result.ok
      ? "success"
      : result.kind === "invalid_credentials"
        ? "invalid_credentials"
        : result.kind === "permission_denied"
          ? "permission_denied"
          : "failure";
    const nextConnStatus =
      result.ok && row.status === "error" ? "active" : row.status;
    await db
      .update(exchangeConnections)
      .set({
        lastTestAt: now,
        lastTestStatus: lastStatus,
        lastTestMessage: result.ok ? result.message : result.message,
        status: nextConnStatus,
        updatedAt: now,
      })
      .where(eq(exchangeConnections.id, row.id));
  }

  revalidatePath("/user/exchange");

  if (result.ok) {
    return { ok: true, message: result.message };
  }
  return { error: result.message };
}

export type ToggleDeltaIndiaExchangeState = {
  ok?: boolean;
  error?: string;
  message?: string;
  enabled?: boolean;
};

export async function toggleDeltaIndiaExchangeAction(
  _prev: ToggleDeltaIndiaExchangeState,
  formData: FormData,
): Promise<ToggleDeltaIndiaExchangeState> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { error: "Please sign in again." };
  }

  const raw = formData.get("enable");
  const wantEnable = raw === "true" || raw === "1";

  const row = await loadRowForUser(userId);
  if (!row) {
    return { error: "Save Delta India credentials before enabling." };
  }
  if (
    !row.apiKeyCiphertext.trim() ||
    !row.apiSecretCiphertext.trim()
  ) {
    return { error: "Save Delta India credentials before enabling." };
  }

  if (row.status === "disabled_admin") {
    return {
      error:
        "An administrator disabled this connection. Contact support to re-enable.",
    };
  }

  const db = requireDb();
  const now = new Date();

  if (wantEnable) {
    if (row.status === "active") {
      return { ok: true, enabled: true, message: "Connection is already on." };
    }
    await db
      .update(exchangeConnections)
      .set({ status: "active", updatedAt: now })
      .where(eq(exchangeConnections.id, row.id));
    revalidatePath("/user/exchange");
    return { ok: true, enabled: true, message: "Delta India connection enabled." };
  }

  if (row.status === "disabled_user") {
    return { ok: true, enabled: false, message: "Connection is already off." };
  }

  await db
    .update(exchangeConnections)
    .set({ status: "disabled_user", updatedAt: now })
    .where(eq(exchangeConnections.id, row.id));
  revalidatePath("/user/exchange");
  return { ok: true, enabled: false, message: "Delta India connection disabled." };
}
