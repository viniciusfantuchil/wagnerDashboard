// People who can update jobs from the control screen (/control). Each person has a personal link,
// /control?key=<their key>, opened once on their phone; it sets a cookie that identifies them.
// CONTROL_USERS is JSON: {"Diandra": {"key": "…", "office": true}, "Jorge": {"key": "…", "crew": "Crew 2"}}.

import { createHash, timingSafeEqual } from "node:crypto";
import { CREW_ORDER, crewRank } from "@/lib/crews";
import { MIN_TOKEN_LENGTH } from "@/lib/access";

export const CONTROL_COOKIE = "board_control";
export const CONTROL_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

export interface ControlUser {
  name: string;
  /** Office users change every field on every crew's jobs, including the deposit (D-003). */
  office: boolean;
  /** Crew leads change Status and Note on their own crew's jobs only. */
  crew?: string;
}

interface UserEntry extends ControlUser {
  key: string;
}

export function parseControlUsers(value: string | undefined): UserEntry[] {
  if (!value) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new Error("CONTROL_USERS is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("CONTROL_USERS must be a JSON object");
  return Object.entries(raw as Record<string, { key?: unknown; office?: unknown; crew?: unknown }>).map(([name, u]) => {
    if (typeof u?.key !== "string" || u.key.length < MIN_TOKEN_LENGTH) {
      throw new Error(`CONTROL_USERS["${name}"].key must be at least ${MIN_TOKEN_LENGTH} characters`);
    }
    const office = u.office === true;
    const crew = typeof u.crew === "string" ? u.crew.trim() : undefined;
    if (!office && (!crew || crewRank(crew) >= CREW_ORDER.length)) {
      throw new Error(`CONTROL_USERS["${name}"] needs "office": true or a crew (${CREW_ORDER.join(", ")})`);
    }
    return { name: name.trim(), key: u.key, office, ...(crew ? { crew } : {}) };
  });
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function signature(user: UserEntry): string {
  return createHash("sha256").update(`wagner-control:${user.name}:${user.key}`).digest("base64url");
}

/** Cookie value for a user: their name and a hash of their key (never the key itself). */
export function controlCookie(user: UserEntry): string {
  return `${encodeURIComponent(user.name)}.${signature(user)}`;
}

/** The user a personal link's key belongs to. */
export function userForKey(users: UserEntry[], key: string): ControlUser | null {
  const u = users.find((x) => same(x.key, key));
  return u ? { name: u.name, office: u.office, ...(u.crew ? { crew: u.crew } : {}) } : null;
}

/** The user a cookie identifies; changing someone's key logs them out. */
export function userForCookie(users: UserEntry[], cookie: string | undefined): ControlUser | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return null;
  let name: string;
  try {
    name = decodeURIComponent(cookie.slice(0, dot));
  } catch {
    return null;
  }
  const u = users.find((x) => x.name === name);
  if (!u || !same(cookie.slice(dot + 1), signature(u))) return null;
  return { name: u.name, office: u.office, ...(u.crew ? { crew: u.crew } : {}) };
}

export function entryFor(users: UserEntry[], name: string): UserEntry | undefined {
  return users.find((u) => u.name === name);
}

/** Whether the user may change this crew's jobs at all. */
export function canEditCrew(user: ControlUser, crew: string): boolean {
  if (user.office) return true;
  return !!user.crew && crewRank(user.crew) === crewRank(crew) && crewRank(crew) < CREW_ORDER.length;
}
