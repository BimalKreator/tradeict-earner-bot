import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = 1;
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * `EXCHANGE_SECRETS_ENCRYPTION_KEY` must be exactly 32 UTF-8 code units
 * and exactly 32 bytes when encoded as UTF-8 (ASCII-only recommended).
 */
export function getExchangeSecretsKeyOrNull(): Buffer | null {
  const raw = process.env.EXCHANGE_SECRETS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (raw.length !== 32) return null;
  const buf = Buffer.from(raw, "utf8");
  if (buf.length !== 32) return null;
  return buf;
}

export function assertExchangeSecretsKeyConfigured(): Buffer {
  const key = getExchangeSecretsKeyOrNull();
  if (!key) {
    throw new Error("EXCHANGE_SECRETS_ENCRYPTION_KEY_MISSING_OR_INVALID");
  }
  return key;
}

/** Stored as: v{version}:{iv b64}:{tag b64}:{ciphertext b64} */
export function encryptExchangeSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    `v${VERSION}`,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptExchangeSecret(payload: string, key: Buffer): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || !parts[0]?.startsWith("v")) {
    throw new Error("INVALID_CIPHER_FORMAT");
  }
  const ver = Number.parseInt(parts[0].slice(1), 10);
  if (ver !== VERSION) {
    throw new Error("UNSUPPORTED_CIPHER_VERSION");
  }
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const data = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
