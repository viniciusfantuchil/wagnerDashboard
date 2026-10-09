// Password hashes for the control screen: PBKDF2-HMAC-SHA256, 600,000 iterations (OWASP 2023), 16-byte salt.
// Format: "pbkdf2$<iterations>$<salt base64url>$<hash base64url>". The same format is produced in the browser by
// /control/password (Web Crypto), so a hash can be made without installing anything; the password never leaves it.

import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;
const KEY_LENGTH = 32;
const FORMAT = /^pbkdf2\$(\d+)\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{40,})$/;

export function isPasswordHash(value: string): boolean {
  const m = value.match(FORMAT);
  return !!m && Number(m[1]) >= 100_000;
}

/** Server-side hashing (tests and scripts). The browser tool computes the same format. */
export function hashPassword(password: string, iterations = PBKDF2_ITERATIONS, salt = randomBytes(16)): string {
  const hash = pbkdf2Sync(password.normalize("NFC"), salt, iterations, KEY_LENGTH, "sha256");
  return `pbkdf2$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const m = stored.match(FORMAT);
  if (!m) return false;
  const expected = Buffer.from(m[3], "base64url");
  const actual = pbkdf2Sync(password.normalize("NFC"), Buffer.from(m[2], "base64url"), Number(m[1]), expected.length, "sha256");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
