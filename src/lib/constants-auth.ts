/** HttpOnly cookie: short-lived JWT after password OK, before OTP verified. */
export const LOGIN_CHALLENGE_COOKIE = "tradeict_login_challenge";

/** HttpOnly cookie: after forgot-password email step, before OTP + new password. */
export const RESET_CHALLENGE_COOKIE = "tradeict_password_reset_challenge";

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = 10;
/** Minimum seconds between OTP emails (login or reset). */
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const MAX_OTP_VERIFY_ATTEMPTS = 5;
export const MAX_OTP_SENDS_PER_15M = 5;
export const MAX_PASSWORD_FAILS_PER_15M = 8;

export const RATE_WINDOW_MS = 15 * 60 * 1000;
