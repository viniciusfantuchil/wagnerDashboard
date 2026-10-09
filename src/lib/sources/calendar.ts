// ScheduleSource backed by Google Calendar: one calendar per crew, read with a service account.

import { safeText, type ServiceAccountAuth } from "@/lib/google/auth";
import { parseEvent, type CalendarEvent } from "@/lib/parse/event";
import { addDays, nyIso, TZ } from "@/lib/time";
import type { Job, Visit } from "@/lib/types";
import type { ScheduleSource } from "./types";

const API = "https://www.googleapis.com/calendar/v3";
const PAGE_SIZE = 250;
const MAX_PAGES = 10;

/** Calendar name (used as the crew name, e.g. "Crew 2 · Jorge") → calendar id. */
export type CalendarIds = Record<string, string>;

/** Reads CALENDAR_IDS: a JSON object of calendar name → calendar id (spec §9). */
export function parseCalendarIds(value: string): CalendarIds {
  let ids: unknown;
  try {
    ids = JSON.parse(value);
  } catch {
    throw new Error("CALENDAR_IDS is not valid JSON");
  }
  if (!ids || typeof ids !== "object" || Array.isArray(ids)) throw new Error("CALENDAR_IDS must be a JSON object");
  const entries = Object.entries(ids as Record<string, unknown>);
  if (entries.length === 0) throw new Error("CALENDAR_IDS is empty");
  for (const [name, id] of entries) {
    if (typeof id !== "string" || !id.trim()) throw new Error(`CALENDAR_IDS["${name}"] must be a calendar id string`);
  }
  return Object.fromEntries(entries.map(([name, id]) => [name.trim(), (id as string).trim()]));
}

export class GoogleCalendarSource implements ScheduleSource {
  readonly label = "Google Calendar";
  readonly sample = false;

  constructor(
    private readonly calendars: CalendarIds,
    private readonly auth: Pick<ServiceAccountAuth, "token">,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getDay(date: string): Promise<{ jobs: Job[]; visits: Visit[] }> {
    const timeMin = nyIso(date, "00:00");
    const timeMax = nyIso(addDays(date, 1), "00:00");
    const perCalendar = await Promise.all(
      Object.entries(this.calendars).map(async ([crew, id]) => ({ crew, events: await this.list(crew, id, timeMin, timeMax) })),
    );

    const jobs: Job[] = [];
    const visits: Visit[] = [];
    const seen = new Set<string>();
    for (const { crew, events } of perCalendar) {
      for (const event of events) {
        // The same event can sit on two calendars (e.g. a crew invited to another crew's job); show it once.
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        const parsed = parseEvent(event, crew, date);
        if (parsed.kind === "job") jobs.push(parsed.job);
        else if (parsed.kind === "visit") visits.push(parsed.visit);
      }
    }
    return { jobs, visits };
  }

  /** Not available from the calendars in Phase 1; the footer hides it. */
  async getBookedThrough(): Promise<string | null> {
    return null;
  }

  private async list(crew: string, calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
    const token = await this.auth.token();
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        timeZone: TZ,
        singleEvents: "true",
        orderBy: "startTime",
        showDeleted: "false",
        maxResults: String(PAGE_SIZE),
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.fetchImpl(`${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Google Calendar "${crew}": HTTP ${res.status} ${await safeText(res)}`);
      const body = (await res.json()) as { items?: CalendarEvent[]; nextPageToken?: string };
      events.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return events;
  }
}
