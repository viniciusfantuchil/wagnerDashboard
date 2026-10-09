import { controlDays } from "@/lib/control/jobs";
import { controlUserFromRequest } from "@/lib/control/session";
import { getSources, getWriter } from "@/lib/sources";
import { nyDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Today's and the next workday's jobs the signed-in user may update. */
export async function GET(request: Request) {
  const user = await controlUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    const now = new Date();
    const days = await controlDays(user, getSources(nyDate(now)).schedule, now);
    return Response.json({ user, writable: getWriter() !== null, days }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("GET /api/control/jobs failed:", err);
    return Response.json({ error: "Could not read the calendars" }, { status: 502 });
  }
}
