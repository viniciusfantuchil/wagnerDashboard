import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE_S, decideAccess } from "@/lib/access";

const PAGE = (title: string, text: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head>` +
  `<body style="font-family:Arial,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#ecebe8;color:#1c1917">` +
  `<div style="text-align:center"><h1 style="margin:0 0 8px">${title}</h1><p style="margin:0;color:#57534e">${text}</p></div></body></html>`;

export function proxy(request: NextRequest) {
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
