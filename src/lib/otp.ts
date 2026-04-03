import bcrypt from "bcryptjs";

import { OTP_LENGTH } from "./constants-auth";

export function generateOtpDigits(length: number = OTP_LENGTH): string {
  const max = 10 ** length;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const n = buf[0]! % max;
  return String(n).padStart(length, "0");
}

export function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export function verifyOtpHash(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
