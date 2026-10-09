import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE_S, decideAccess } from "@/lib/access";
import { CONTROL_COOKIE, parseControlUsers, userForSession } from "@/lib/control/users";

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head>` +
  `<body style="font-family:Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#ecebe8;color:#1c1917">` +
  `<div style="text-align:center"><h1 style="margin:0 0 8px">${title}</h1><p style="margin:0;color:#57534e">${text}</p></div></body></html>`;

/** Pages and APIs of the control screen that work without a session. */
const CONTROL_PUBLIC = new Set(["/control/login", "/control/password", "/api/control/login", "/api/control/logout"]);

/** /control and /api/control: each person signs in with a username and password (CONTROL_USERS), not the TV token. */
function controlProxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (CONTROL_PUBLIC.has(path)) return NextResponse.next();
  if (userForSession(safeUsers(), request.cookies.get(CONTROL_COOKIE)?.value)) return NextResponse.next();
  if (path.startsWith("/api/")) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.redirect(new URL("/control/login", request.url));
}

function safeUsers() {
  try {
    return parseControlUsers(process.env.CONTROL_USERS);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return [];
  }
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
