// People who can update jobs from the control screen (/control). Each person signs in with a username and
// password. CONTROL_USERS is JSON keyed by username, with a password HASH (never the password; see password.ts):
//   {"diandra": {"name": "Diandra", "password": "pbkdf2$600000$…", "office": true},
//    "jorge":   {"name": "Jorge",   "password": "pbkdf2$600000$…", "crew": "Crew 2"}}

import { createHmac, timingSafeEqual } from "node:crypto";
import { CREW_ORDER, crewRank } from "@/lib/crews";
import { isPasswordHash, verifyPassword } from "./password";

export const CONTROL_COOKIE = "board_control";
/** Signed in on a phone for 90 days; changing the person's password signs them out at once. */
export const SESSION_DAYS = 90;

export interface ControlUser {
  /** Login name, lower case. */
  username: string;
  /** Name shown on screen and written in "Updated:" lines. */
  name: string;
  /** Office users change every field on every crew's jobs, including the deposit (D-003). */
  office: boolean;
  /** Crew leads change Status and Note on their own crew's jobs only. */
  crew?: string;
}

export interface UserEntry extends ControlUser {
  password: string; // PBKDF2 hash
}

const publicUser = (u: UserEntry): ControlUser => ({
  username: u.username,
  name: u.name,
  office: u.office,
  ...(u.crew ? { crew: u.crew } : {}),
});

export function parseControlUsers(value: string | undefined): UserEntry[] {
  if (!value) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new Error("CONTROL_USERS is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CONTROL_USERS must be a JSON object");
  return Object.entries(raw as Record<string, { name?: unknown; password?: unknown; office?: unknown; crew?: unknown }>).map(
    ([login, u]) => {
      const username = login.trim().toLowerCase();
      if (!/^[a-z0-9._-]{2,32}$/.test(username)) throw new Error(`CONTROL_USERS: "${login}" is not a valid username (letters, numbers, . _ -)`);
      if (typeof u?.password !== "string" || !isPasswordHash(u.password)) {
        throw new Error(`CONTROL_USERS["${login}"].password must be a hash made at /control/password, not the password itself`);
      }
      const office = u.office === true;
      const crew = typeof u.crew === "string" ? u.crew.trim() : undefined;
      if (!office && (!crew || crewRank(crew) >= CREW_ORDER.length)) {
        throw new Error(`CONTROL_USERS["${login}"] needs "office": true or a crew (${CREW_ORDER.join(", ")})`);
      }
      const name = typeof u.name === "string" && u.name.trim() ? u.name.trim() : username.charAt(0).toUpperCase() + username.slice(1);
      return { username, name, password: u.password, office, ...(crew ? { crew } : {}) };
    },
  );
}

/** Checks a username and password. Unknown usernames take as long as wrong passwords. */
const DUMMY = "pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export function checkLogin(users: UserEntry[], username: string, password: string): ControlUser | null {
  const u = users.find((x) => x.username === username.trim().toLowerCase());
  const ok = verifyPassword(password, u?.password ?? DUMMY);
  return u && ok ? publicUser(u) : null;
}

// Session cookie: "<username>.<expiry seconds>.<HMAC>". The HMAC key is the user's password hash, so changing the
// password invalidates every session of that user without a separate server secret.
const sign = (u: UserEntry, exp: number) =>
  createHmac("sha256", u.password).update(`wagner-control:${u.username}:${exp}`).digest("base64url");

export function sessionCookie(user: UserEntry, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_DAYS * 86_400;
  return `${user.username}.${exp}.${sign(user, exp)}`;
}

export function userForSession(users: UserEntry[], cookie: string | undefined, nowMs = Date.now()): ControlUser | null {
  const m = cookie?.match(/^([a-z0-9._-]{2,32})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/);
  if (!m) return null;
  const [, username, expStr, sig] = m;
  const exp = Number(expStr);
  if (exp * 1000 < nowMs) return null;
  const u = users.find((x) => x.username === username);
  if (!u) return null;
  const expected = Buffer.from(sign(u, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? publicUser(u) : null;
}

export function entryFor(users: UserEntry[], username: string): UserEntry | undefined {
  return users.find((u) => u.username === username);
}

/** Whether the user may change this crew's jobs at all. */
export function canEditCrew(user: ControlUser, crew: string): boolean {
  if (user.office) return true;
  return !!user.crew && crewRank(user.crew) === crewRank(crew) && crewRank(crew) < CREW_ORDER.length;
}
