import { sameOrigin } from "@/lib/control/session";
import { loginThrottle } from "@/lib/control/throttle";
import { checkLogin, CONTROL_COOKIE, entryFor, parseControlUsers, SESSION_DAYS, sessionCookie } from "@/lib/control/users";

export const dynamic = "force-dynamic";

/** Username + password → session cookie for the control screen. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Bad origin" }, { status: 403 });
  let users: ReturnType<typeof parseControlUsers>;
  try {
    users = parseControlUsers(process.env.CONTROL_USERS);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    users = [];
  }
  if (users.length === 0) return Response.json({ error: "Logins are not set up yet." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!username || !password) return Response.json({ error: "Enter your username and password." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const keys = [`user:${username}`, `ip:${ip}`];
  const wait = loginThrottle.waitMs(keys);
  if (wait > 0) {
    return Response.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  const user = checkLogin(users, username, password);
  if (!user) {
    loginThrottle.fail(keys);
    console.warn(`Control login failed for "${username}"`);
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }
  loginThrottle.succeed(keys);
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `${CONTROL_COOKIE}=${sessionCookie(entryFor(users, user.username)!)}`,
    "Path=/",
    `Max-Age=${SESSION_DAYS * 86_400}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  console.info(`Control login: ${user.name}`);
  return Response.json({ user }, { headers: { "Set-Cookie": cookie } });
}
