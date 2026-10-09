import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE_S, cookieValue, MIN_TOKEN_LENGTH, safeEqual } from "@/lib/access";
import { NO_STORE, sameOrigin } from "@/lib/control/session";
import { loginThrottle } from "@/lib/control/throttle";

export const dynamic = "force-dynamic";

/** TV setup: the access token typed into /login (never in the address) → long-lived board cookie. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Bad origin" }, { status: 403, headers: NO_STORE });
  const token = process.env.BOARD_ACCESS_TOKEN;
  if (!token || token.length < MIN_TOKEN_LENGTH) return Response.json({ error: "Board access is not configured" }, { status: 503, headers: NO_STORE });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const keys = [`board-ip:${ip}`];
  const wait = loginThrottle.waitMs(keys);
  if (wait > 0) return Response.json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` }, { status: 429, headers: NO_STORE });

  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  if (typeof body.token !== "string" || !safeEqual(body.token.trim(), token)) {
    loginThrottle.fail(keys);
    return Response.json({ error: "Wrong access code." }, { status: 401, headers: NO_STORE });
  }
  loginThrottle.succeed(keys);
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [`${ACCESS_COOKIE}=${cookieValue(token)}`, "Path=/", `Max-Age=${ACCESS_COOKIE_MAX_AGE_S}`, "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])].join("; ");
  return Response.json({ ok: true }, { headers: { ...NO_STORE, "Set-Cookie": cookie } });
}
