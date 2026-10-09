import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, decideAccess } from "@/lib/access";
import { controlUserFromCookie, NO_STORE } from "@/lib/control/session";
import { CONTROL_COOKIE } from "@/lib/control/users";

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head>` +
  `<body style="font-family:Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#ecebe8;color:#1c1917">` +
  `<div style="text-align:center"><h1 style="margin:0 0 8px">${title}</h1><p style="margin:0;color:#57534e">${text}</p></div></body></html>`;

/** Pages and APIs that work without a session: the two sign-in forms and first-admin setup. */
const PUBLIC = new Set(["/login", "/api/board/login", "/control/login", "/control/setup", "/api/control/login", "/api/control/logout", "/api/control/setup"]);

/** Everything with people's data or a session is never stored by the browser or a proxy cache. */
function noStore(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

/** /control and /api/control: each person signs in with a username and password, not the TV token. */
async function controlProxy(request: NextRequest) {
  if (await controlUserFromCookie(request.cookies.get(CONTROL_COOKIE)?.value)) return noStore(NextResponse.next());
  if (request.nextUrl.pathname.startsWith("/api/")) return noStore(NextResponse.json({ error: "Sign in first" }, { status: 401 }));
  return noStore(NextResponse.redirect(new URL("/control/login", request.url)));
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (PUBLIC.has(path)) return noStore(NextResponse.next());
  if (path === "/control" || path.startsWith("/control/") || path.startsWith("/api/control/")) return controlProxy(request);

  const decision = decideAccess({
    token: process.env.BOARD_ACCESS_TOKEN,
    cookie: request.cookies.get(ACCESS_COOKIE)?.value,
    production: process.env.NODE_ENV === "production",
  });
  const api = path.startsWith("/api/");
  // Map tiles are public OpenStreetMap images: the browser may cache them (set by the tile route).
  const cacheable = path.startsWith("/api/tiles/") || path === "/wagner-logo.png";

  switch (decision.action) {
    case "allow":
      return cacheable ? NextResponse.next() : noStore(NextResponse.next());
    case "misconfigured":
      console.error("BOARD_ACCESS_TOKEN is missing or shorter than the minimum length; refusing all requests.");
      return api
        ? noStore(NextResponse.json({ error: "Board access is not configured" }, { status: 503 }))
        : new NextResponse(PAGE("Board not configured", "Set BOARD_ACCESS_TOKEN in the deployment settings."), {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
          });
    case "deny":
      if (api) return noStore(NextResponse.json({ error: "Access denied" }, { status: 401 }));
      return noStore(NextResponse.redirect(new URL("/login", request.url)));
  }
}

export const config = {
  // Everything except Next.js build assets. The logo and every page and API route are protected.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
