import { parseSearch, SearchError, searchJobs } from "@/lib/control/search";
import { controlUserFromRequest, NO_STORE } from "@/lib/control/session";
import { getSources } from "@/lib/sources";
import { nyDate } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Searches the jobs the signed-in user may update: ?q=&when=upcoming|past|all&crew=&status=&needs= */
export async function GET(request: Request) {
  const user = await controlUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401, headers: NO_STORE });
  let query;
  try {
    query = parseSearch(new URL(request.url).searchParams, user);
  } catch (err) {
    if (err instanceof SearchError) return Response.json({ error: err.message }, { status: 400, headers: NO_STORE });
    throw err;
  }
  try {
    const now = new Date();
    return Response.json(await searchJobs(user, getSources(nyDate(now)).schedule, query, now), { headers: NO_STORE });
  } catch (err) {
    console.error("GET /api/control/search failed:", err);
    return Response.json({ error: "Could not read the calendars" }, { status: 502, headers: NO_STORE });
  }
}
