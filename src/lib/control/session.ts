import { TZ } from "@/lib/time";
import { getUserStore } from "./store";
import { CONTROL_COOKIE, directory, parseControlUsers, userForSession, type ControlUser, type Directory } from "./users";

export function envUsers(env = process.env) {
  try {
    return parseControlUsers(env.CONTROL_USERS);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return [];
  }
}

/** Everyone who can sign in: CONTROL_USERS plus the user store (Upstash Redis). */
export function controlDirectory(env = process.env): Directory {
  return directory(envUsers(env), getUserStore(env));
}

/** The control-screen user a session cookie identifies, or null. Route handlers check this themselves. */
export async function controlUserFromCookie(cookie: string | undefined, env = process.env): Promise<ControlUser | null> {
  try {
    return await userForSession(controlDirectory(env), cookie);
  } catch (err) {
    console.error("Session check failed:", err);
    return null;
  }
}

export function cookieFrom(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function controlUserFromRequest(request: Request, env = process.env): Promise<ControlUser | null> {
  return controlUserFromCookie(cookieFrom(request, CONTROL_COOKIE), env);
}

/** Headers for every response that carries people's data or a session: never stored by browsers or proxies. */
export const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } as const;

/** POSTs must come from the board's own pages (cookies are SameSite=Lax too). */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

const stamp = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "Jorge · Oct 9, 2:15 PM" for the event's "Updated:" line. */
export function updatedLine(user: ControlUser, at = new Date()): string {
  return `${user.name} · ${stamp.format(at)}`;
}
