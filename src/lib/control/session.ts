import { TZ } from "@/lib/time";
import { CONTROL_COOKIE, parseControlUsers, userForSession, type ControlUser } from "./users";

/** The control-screen user a session cookie identifies, or null. Route handlers check this themselves. */
export function controlUserFromCookie(cookie: string | undefined, env = process.env): ControlUser | null {
  try {
    return userForSession(parseControlUsers(env.CONTROL_USERS), cookie);
  } catch {
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

export function controlUserFromRequest(request: Request, env = process.env): ControlUser | null {
  return controlUserFromCookie(cookieFrom(request, CONTROL_COOKIE), env);
}

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
