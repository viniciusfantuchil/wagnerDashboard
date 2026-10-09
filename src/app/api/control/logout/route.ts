import { CONTROL_COOKIE } from "@/lib/control/users";

export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${CONTROL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` } });
}
