// Access control for the board (spec §8): the whole app needs BOARD_ACCESS_TOKEN.
// The TV opens <board url>/?key=<token> once; that sets a long-lived cookie and redirects to the clean URL.

import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE = "board_access";
export const ACCESS_PARAM = "key";
/** 400 days, the maximum browsers keep a cookie. Rotating the token logs every screen out. */
export const ACCESS_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;
/** Tokens shorter than this are refused, so a weak value cannot be configured by mistake. */
export const MIN_TOKEN_LENGTH = 24;

export type AccessDecision =
  | { action: "allow" }
  | { action: "grant"; location: string; cookie: string }
  | { action: "deny" }
  | { action: "misconfigured" };

/** The cookie holds a hash of the token, never the token itself. */
export function cookieValue(token: string): string {
  return createHash("sha256").update(`wagner-board:${token}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

export function decideAccess(input: {
  token: string | undefined;
  url: URL;
  cookie: string | undefined;
  production: boolean;
}): AccessDecision {
  const { token, url, cookie, production } = input;
  if (!token) return production ? { action: "misconfigured" } : { action: "allow" };
  if (token.length < MIN_TOKEN_LENGTH) return { action: "misconfigured" };

  const key = url.searchParams.get(ACCESS_PARAM);
  if (key !== null) {
    if (!safeEqual(key, token)) return { action: "deny" };
    const clean = new URL(url);
    clean.searchParams.delete(ACCESS_PARAM);
    return { action: "grant", location: `${clean.pathname}${clean.search}`, cookie: cookieValue(token) };
  }

  if (cookie && safeEqual(cookie, cookieValue(token))) return { action: "allow" };
  return { action: "deny" };
}
