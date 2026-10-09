import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE_S, ACCESS_PARAM, decideAccess } from "@/lib/access";
import { CONTROL_COOKIE, CONTROL_COOKIE_MAX_AGE_S, controlCookie, entryFor, parseControlUsers, userForCookie, userForKey } from "@/lib/control/users";

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head>` +
  `<body style="font-family:Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#ecebe8;color:#1c1917">` +
  `<div style="text-align:center"><h1 style="margin:0 0 8px">${title}</h1><p style="margin:0;color:#57534e">${text}</p></div></body></html>`;

const html = (title: string, text: string, status: number) =>
  new NextResponse(PAGE(title, text), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

/** /control and /api/control: each person signs in with their personal link (CONTROL_USERS), not the TV token. */
function controlProxy(request: NextRequest) {
  const api = request.nextUrl.pathname.startsWith("/api/");
  let users: ReturnType<typeof parseControlUsers>;
  try {
    users = parseControlUsers(process.env.CONTROL_USERS);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    users = [];
  }
  if (users.length === 0) {
    return api
      ? NextResponse.json({ error: "Control screen is not configured" }, { status: 503 })
      : html("Control screen not configured", "Set CONTROL_USERS in the deployment settings.", 503);
  }

  const key = request.nextUrl.searchParams.get(ACCESS_PARAM);
  if (key !== null) {
    const user = userForKey(users, key);
    if (!user) return html("Access denied", "This link is not valid. Ask the office for your personal link.", 401);
    const clean = new URL(request.nextUrl);
    clean.searchParams.delete(ACCESS_PARAM);
    const res = NextResponse.redirect(clean);
    res.cookies.set(CONTROL_COOKIE, controlCookie(entryFor(users, user.name)!), {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: CONTROL_COOKIE_MAX_AGE_S,
    });
    return res;
  }

  if (userForCookie(users, request.cookies.get(CONTROL_COOKIE)?.value)) return NextResponse.next();
  return api
    ? NextResponse.json({ error: "Sign in with your personal link" }, { status: 401 })
    : html("Access denied", "Open your personal link from the office once on this phone.", 401);
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/control" || path.startsWith("/control/") || path.startsWith("/api/control/")) return controlProxy(request);

  const decision = decideAccess({
    token: process.env.BOARD_ACCESS_TOKEN,
    url: request.nextUrl,
    cookie: request.cookies.get(ACCESS_COOKIE)?.value,
    production: process.env.NODE_ENV === "production",
  });
  const api = request.nextUrl.pathname.startsWith("/api/");

  switch (decision.action) {
    case "allow":
      return NextResponse.next();
    case "grant": {
      const res = NextResponse.redirect(new URL(decision.location, request.url));
      res.cookies.set(ACCESS_COOKIE, decision.cookie, {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_COOKIE_MAX_AGE_S,
      });
      return res;
    }
    case "misconfigured":
      console.error("BOARD_ACCESS_TOKEN is missing or shorter than the minimum length; refusing all requests.");
      return api
        ? NextResponse.json({ error: "Board access is not configured" }, { status: 503 })
        : new NextResponse(PAGE("Board not configured", "Set BOARD_ACCESS_TOKEN in the deployment settings."), {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
    case "deny":
      return api
        ? NextResponse.json({ error: "Access denied" }, { status: 401 })
        : new NextResponse(PAGE("Access denied", "This screen is private to Wagner Pavers."), {
            status: 401,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
  }
}

export const config = {
  // Everything except Next.js build assets. The logo and every page and API route are protected.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
