import { ACCESS_COOKIE, cookieValue } from "@/lib/access";
import { AdminError, createUser, needsSetup } from "@/lib/control/admin";
import { cookieFrom, envUsers, NO_STORE, sameOrigin } from "@/lib/control/session";
import { getUserStore } from "@/lib/control/store";

export const dynamic = "force-dynamic";

/**
 * Creates the first admin. Works only while no admin exists, only with the user store connected, and only from a
 * device that already has the TV board's access (so a stranger who finds the page first can't use it).
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Bad origin" }, { status: 403, headers: NO_STORE });
  const token = process.env.BOARD_ACCESS_TOKEN;
  if (!token || cookieFrom(request, ACCESS_COOKIE) !== cookieValue(token)) {
    return Response.json({ error: "Open this page on a device that already shows the TV board." }, { status: 403, headers: NO_STORE });
  }
  const store = getUserStore();
  if (!store) return Response.json({ error: "Connect Upstash Redis in Vercel first." }, { status: 503, headers: NO_STORE });
  if (!(await needsSetup(store, envUsers()))) return Response.json({ error: "Setup is already done. Sign in instead." }, { status: 409, headers: NO_STORE });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const user = await createUser(store, envUsers(), { ...body, role: "admin" }, { username: "setup", name: "Setup", office: true });
    console.info(`Control setup: first admin ${user.username} created`);
    return Response.json({ user }, { status: 201, headers: NO_STORE });
  } catch (err) {
    if (err instanceof AdminError) return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    console.error("Setup failed:", err);
    return Response.json({ error: "Could not create the admin" }, { status: 502, headers: NO_STORE });
  }
}
