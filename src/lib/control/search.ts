// Job search for the control screen: by customer, city, service, crew, note or status, across a date window.
// Works on any ScheduleSource, so it keeps working when Markate replaces Google Calendar.

import { CREW_ORDER, crewRank } from "@/lib/crews";
import type { ScheduleSource } from "@/lib/sources";
import { addDays, nyDate } from "@/lib/time";
import { FIELDS, type Field } from "./changes";
import { toControlJob, type ControlJob } from "./jobs";
import { MIN_QUERY, NEEDS, RESULT_LIMIT, WINDOWS, type Need, type SearchResult, type SearchWindow } from "./searchOptions";
import { canEditCrew, type ControlUser } from "./users";

export { MIN_QUERY, NEEDS, RESULT_LIMIT, WINDOWS, type SearchResult, type SearchWindow };

export interface SearchQuery {
  q: string;
  when: SearchWindow;
  crew?: string; // a CREW_ORDER name, e.g. "Crew 2"
  status?: string; // one of FIELDS.Status
  needs?: Need;
}

/** Readiness values that need nothing more. */
const DONE = new Set(["OK", "FINAL", "APPROVED", "N/A", "ORDERED", "SENT"]);

export class SearchError extends Error {}

/** Reads and checks the query string. Throws SearchError with a message for the screen. */
export function parseSearch(params: URLSearchParams, user: ControlUser): SearchQuery {
  const q = (params.get("q") ?? "").trim().slice(0, 80);
  const whenParam = params.get("when") ?? "upcoming";
  const when = (Object.hasOwn(WINDOWS, whenParam) ? whenParam : "upcoming") as SearchWindow;
  const crew = params.get("crew") || undefined;
  if (crew && !CREW_ORDER.includes(crew)) throw new SearchError("Unknown crew");
  const status = params.get("status") || undefined;
  if (status && !(FIELDS.Status as readonly string[]).includes(status)) throw new SearchError("Unknown status");
  const needsParam = params.get("needs") || undefined;
  if (needsParam && !(NEEDS as readonly string[]).includes(needsParam)) throw new SearchError("Unknown filter");
  // Crew leads don't see deposit, permit, material or confirmations, so they can't filter by them either.
  const needs = user.office ? (needsParam as Need | undefined) : undefined;
  if (q.length < MIN_QUERY && !status && !needs) throw new SearchError(`Type at least ${MIN_QUERY} letters, or pick a status or filter.`);
  return { q, when, ...(crew ? { crew } : {}), ...(status ? { status } : {}), ...(needs ? { needs } : {}) };
}

/** Lower case without accents, so "jose" finds "José". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Every word of the query must appear somewhere in the job's customer, city, service, crew, note or status. */
export function matchesText(job: ControlJob, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([job.customer, job.city, job.service, job.size, job.crew, job.values.Note, job.values.Status].filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
}

export function needsIt(job: ControlJob, need: Need): boolean {
  if (need === "Permit" && job.values.Permit === undefined) return false; // no permit line: not every job needs one
  return !DONE.has(job.values[need as Field] ?? "");
}

export async function searchJobs(
  user: ControlUser,
  schedule: ScheduleSource,
  query: SearchQuery,
  now = new Date(),
): Promise<{ results: SearchResult[]; total: number; from: string; to: string }> {
  const today = nyDate(now);
  const [a, b] = WINDOWS[query.when];
  const from = addDays(today, a);
  const to = addDays(today, b);
  const found = (await schedule.getJobs(from, to))
    .filter((j) => canEditCrew(user, j.crew))
    .filter((j) => !query.crew || crewRank(j.crew) === CREW_ORDER.indexOf(query.crew))
    .map((j) => ({ date: nyDate(new Date(j.start)), job: toControlJob(j) }))
    .filter(({ date }) => date >= from && date <= to)
    .filter(({ job }) => (!query.status || job.values.Status === query.status) && (!query.needs || needsIt(job, query.needs)) && matchesText(job, query.q));
  // Upcoming and all: soonest first. Past: most recent first.
  const dir = query.when === "past" ? -1 : 1;
  found.sort(
    (x, y) =>
      dir * x.date.localeCompare(y.date) ||
      crewRank(x.job.crew) - crewRank(y.job.crew) ||
      x.job.start.localeCompare(y.job.start) ||
      (x.job.routeOrder ?? Infinity) - (y.job.routeOrder ?? Infinity),
  );
  return { results: found.slice(0, RESULT_LIMIT), total: found.length, from, to };
}
