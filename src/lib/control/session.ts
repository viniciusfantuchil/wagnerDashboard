import { TZ } from "@/lib/time";
import { CONTROL_COOKIE, parseControlUsers, userForCookie, type ControlUser } from "./users";

/** The control-screen user a request's cookie identifies, or null. Route handlers check this themselves. */
export function controlUserFromCookie(cookie: string | undefined, env = process.env): ControlUser | null {
  return userForCookie(parseControlUsers(env.CONTROL_USERS), cookie);
}

export function controlUserFromRequest(request: Request, env = process.env): ControlUser | null {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONTROL_COOKIE}=`))
    ?.slice(CONTROL_COOKIE.length + 1);
  return controlUserFromCookie(cookie, env);
}

const stamp = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "Jorge · Oct 9, 2:15 PM" for the event's "Updated:" line. */
export function updatedLine(user: ControlUser, at = new Date()): string {
  return `${user.name} · ${stamp.format(at)}`;
}
