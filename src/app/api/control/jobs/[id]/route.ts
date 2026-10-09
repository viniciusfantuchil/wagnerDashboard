import { ChangeError, validateChanges } from "@/lib/control/changes";
import { toControlJob } from "@/lib/control/jobs";
import { controlUserFromRequest, sameOrigin, updatedLine } from "@/lib/control/session";
import { canEditCrew } from "@/lib/control/users";
import { getSources, getWriter } from "@/lib/sources";
import { WriteError } from "@/lib/sources/calendarWriter";

export const dynamic = "force-dynamic";

const STATUS: Record<WriteError["code"], number> = { not_found: 404, conflict: 409, no_write_access: 502, failed: 502 };

/** Saves a job's Status / Deposit / Permit / Material / Confirm48 / Note to its calendar event. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await controlUserFromRequest(request);
  if (!user) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: "Bad origin" }, { status: 403 });

  const writer = getWriter();
  if (!writer) return Response.json({ error: "Google Calendar is not connected; sample data is read-only." }, { status: 503 });

  let body: { crew?: unknown; date?: unknown; changes?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const { id } = await params;
  const crew = typeof body.crew === "string" ? body.crew : "";
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined;
  if (!crew || !date) return Response.json({ error: "Bad request" }, { status: 400 });
  if (!canEditCrew(user, crew)) return Response.json({ error: "You can only update your own crew's jobs" }, { status: 403 });

  try {
    const changes = validateChanges(body.changes, user);
    const job = await writer.update(crew, id, changes, updatedLine(user), date);
    getSources(date).schedule.forgetSearches?.();
    console.info(`Control: ${user.name} updated ${crew} event ${id}: ${Object.keys(changes).join(", ")}`);
    return Response.json({ job: toControlJob(job) });
  } catch (err) {
    if (err instanceof ChangeError) return Response.json({ error: err.message }, { status: err.status });
    if (err instanceof WriteError) {
      if (err.code !== "conflict") console.error(`Control write failed (${err.code}):`, err.message);
      return Response.json({ error: err.message, code: err.code }, { status: STATUS[err.code] });
    }
    console.error("POST /api/control/jobs failed:", err);
    return Response.json({ error: "Could not save the change" }, { status: 500 });
  }
}
