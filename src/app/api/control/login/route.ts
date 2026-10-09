import { controlDirectory, envUsers, NO_STORE, sameOrigin } from "@/lib/control/session";
import { getUserStore } from "@/lib/control/store";
import { loginThrottle } from "@/lib/control/throttle";
import { checkLogin, CONTROL_COOKIE, SESSION_DAYS, sessionCookie } from "@/lib/control/users";

export const dynamic = "force-dynamic";

/** Username + password → session cookie for the control screen. The password is never stored or echoed. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Bad origin" }, { status: 403, headers: NO_STORE });
  if (envUsers().length === 0 && !getUserStore()) {
    return Response.json({ error: "Logins are not set up yet." }, { status: 503, headers: NO_STORE });
  }

  const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase().slice(0, 64) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
  if (!username || !password) return Response.json({ error: "Enter your username and password." }, { status: 400, headers: NO_STORE });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const keys = [`user:${username}`, `ip:${ip}`];
  const wait = loginThrottle.waitMs(keys);
  if (wait > 0) {
    return Response.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  const dir = controlDirectory();
  let user;
  try {
    user = await checkLogin(dir, username, password);
  } catch (err) {
    console.error("Login check failed:", err);
    return Response.json({ error: "Sign-in is unavailable right now. Try again shortly." }, { status: 502, headers: NO_STORE });
  }
  if (!user) {
    loginThrottle.fail(keys);
    console.warn(`Control login failed for "${username}"`);
    return Response.json({ error: "Wrong username or password." }, { status: 401, headers: NO_STORE });
  }
  loginThrottle.succeed(keys);
  const entry = (await dir.find(user.username))!;
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `${CONTROL_COOKIE}=${sessionCookie(entry)}`,
    "Path=/",
    `Max-Age=${SESSION_DAYS * 86_400}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
  console.info(`Control login: ${user.name}`);
  return Response.json({ user }, { headers: { ...NO_STORE, "Set-Cookie": cookie } });
}
