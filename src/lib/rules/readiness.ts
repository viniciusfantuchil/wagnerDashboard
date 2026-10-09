import { crewRank, crewShort } from "@/lib/crews";
import { addDays, weekday } from "@/lib/time";
import type { Job, ReadyRow } from "@/lib/types";

/**
 * Whether crews work Saturdays is still an open item (spec §12). Until it is decided,
 * the next workday skips Saturday and Sunday.
 */
export const WORKS_SATURDAY = false;

/** The next date after `date` (YYYY-MM-DD) that crews work. */
export function nextWorkday(date: string, worksSaturday = WORKS_SATURDAY): string {
  let d = addDays(date, 1);
  while (weekday(d) === 0 || (weekday(d) === 6 && !worksSaturday)) d = addDays(d, 1);
  return d;
}

/** Ready-check rows for the next workday, in crew order then start time. */
export function readyRows(jobs: Job[]): ReadyRow[] {
  return [...jobs]
    .sort((a, b) => crewRank(a.crew) - crewRank(b.crew) || a.start.localeCompare(b.start))
    .map((j) => ({
      jobId: j.id,
      customer: j.customer,
      city: j.city,
      crew: crewShort(j.crew),
      crewName: j.crew,
      deposit: j.deposit,
      permit: j.permit,
      material: j.material,
      confirm48: j.confirm48,
    }));
}
