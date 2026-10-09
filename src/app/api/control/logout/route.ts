import { NO_STORE } from "@/lib/control/session";
import { CONTROL_COOKIE } from "@/lib/control/users";

export const dynamic = "force-dynamic";

/** Ends the session and asks the browser to drop anything it cached or stored for the site. */
export async function POST() {
  return Response.json(
    { ok: true },
    {
      headers: {
        ...NO_STORE,
        "Set-Cookie": `${CONTROL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        "Clear-Site-Data": '"cache", "storage"',
      },
    },
  );
}
