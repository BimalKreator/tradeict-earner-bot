/**
 * Boot-time validation for exchange credential encryption.
 * Missing key: warning only (some deploys/builds omit it until exchange is used).
 * Set but invalid: throw so the process never serves with a broken key.
 */
export function validateExchangeSecretsKeyForBoot(): void {
  const raw = process.env.EXCHANGE_SECRETS_ENCRYPTION_KEY?.trim();

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[Tradeict Earner] EXCHANGE_SECRETS_ENCRYPTION_KEY is not set. Saving or testing Delta API keys will fail until you set exactly 32 ASCII characters. See DEPLOYMENT.md.",
      );
    }
    return;
  }

  if (raw.length !== 32) {
    throw new Error(
      `[Tradeict Earner] EXCHANGE_SECRETS_ENCRYPTION_KEY must be exactly 32 UTF-8 code units (got ${raw.length}). ` +
        "Use ASCII only, e.g. `openssl rand -hex 16`. See DEPLOYMENT.md.",
    );
  }

  const buf = Buffer.from(raw, "utf8");
  if (buf.length !== 32) {
    throw new Error(
      "[Tradeict Earner] EXCHANGE_SECRETS_ENCRYPTION_KEY must encode to exactly 32 bytes in UTF-8. " +
        "Use 32 ASCII characters (e.g. `openssl rand -hex 16`). See DEPLOYMENT.md.",
    );
  }
}
