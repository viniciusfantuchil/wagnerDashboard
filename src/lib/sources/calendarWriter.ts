// Writes the control screen's changes back to the crew calendars. Only the event description changes, and only
// the board's own lines in it (see lib/control/changes.ts). Requires the service account to have
// "Make changes to events" on each calendar.

import { applyChanges, type Changes } from "@/lib/control/changes";
import { safeText, type ServiceAccountAuth } from "@/lib/google/auth";
import { parseEvent, type CalendarEvent } from "@/lib/parse/event";
import type { Job } from "@/lib/types";
import type { CalendarIds } from "./calendar";

const API = "https://www.googleapis.com/calendar/v3";

export type WriteErrorCode = "not_found" | "conflict" | "no_write_access" | "failed";

export class WriteError extends Error {
  constructor(
    readonly code: WriteErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface ScheduleWriter {
  update(crew: string, eventId: string, changes: Changes, updated: string, onDate: string): Promise<Job>;
}

export class GoogleCalendarWriter implements ScheduleWriter {
  constructor(
    private readonly calendars: CalendarIds,
    private readonly auth: Pick<ServiceAccountAuth, "token">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async update(crew: string, eventId: string, changes: Changes, updated: string, onDate: string): Promise<Job> {
    const calendarId = this.calendars[crew];
    if (!calendarId) throw new WriteError("not_found", `No calendar for "${crew}"`);
    const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
    const headers = { Authorization: `Bearer ${await this.auth.token()}` };

    const res = await this.fetchImpl(url, { headers, cache: "no-store" });
    if (res.status === 404 || res.status === 410) throw new WriteError("not_found", "The event is no longer on the calendar");
    if (!res.ok) throw new WriteError("failed", `Google Calendar: HTTP ${res.status} ${await safeText(res)}`);
    const event = (await res.json()) as CalendarEvent & { etag?: string };
    if (event.status === "cancelled") throw new WriteError("not_found", "The event was cancelled");

    // If-Match: if someone edited the event since we read it, Google refuses (412) instead of overwriting.
    const patch = await this.fetchImpl(url, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", ...(event.etag ? { "If-Match": event.etag } : {}) },
      body: JSON.stringify({ description: applyChanges(event.description, changes, updated) }),
      cache: "no-store",
    });
    if (patch.status === 412) throw new WriteError("conflict", "The event was just changed in the calendar. Reload and try again.");
    if (patch.status === 403) {
      const text = await safeText(patch);
      throw new WriteError(
        "no_write_access",
        /writer access|forbidden|insufficient/i.test(text)
          ? `The board can't edit the "${crew}" calendar yet: share it with the board's account as "Make changes to events".`
          : `Google Calendar refused the change: ${text}`,
      );
    }
    if (!patch.ok) throw new WriteError("failed", `Google Calendar: HTTP ${patch.status} ${await safeText(patch)}`);

    const parsed = parseEvent((await patch.json()) as CalendarEvent, crew, onDate);
    if (parsed.kind !== "job") throw new WriteError("failed", "The event is no longer a job");
    return parsed.job;
  }
}
