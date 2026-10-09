// Jobs as the control screen lists them: today and the next workday, the user's own crew for crew leads.

import { crewColor, crewRank, crewShort } from "@/lib/crews";
import { nextWorkday } from "@/lib/rules/readiness";
import type { ScheduleSource } from "@/lib/sources";
import { nyDate } from "@/lib/time";
import type { Job } from "@/lib/types";
import { currentValues, type Field } from "./changes";
import { canEditCrew, type ControlUser } from "./users";

export interface ControlJob {
  id: string;
  crew: string;
  crewShort: string;
  color?: string;
  customer: string;
  city: string; // never the street address
  service: string;
  size?: string;
  start: string;
  allDay?: true;
  routeOrder?: number;
  values: Partial<Record<Field, string>>;
  updated?: string; // "Diandra · Oct 9, 2:15 PM"
  warnings: string[];
}

export interface ControlDay {
  date: string;
  jobs: ControlJob[];
}

export function toControlJob(j: Job): ControlJob {
  return {
    id: j.id,
    crew: j.crew,
    crewShort: crewShort(j.crew),
    ...(crewColor(j.crew) ? { color: crewColor(j.crew) } : {}),
    customer: j.customer,
    city: j.city,
    service: j.service,
    ...(j.size ? { size: j.size } : {}),
    start: j.start,
    ...(j.allDay ? { allDay: true as const } : {}),
    ...(j.routeOrder !== undefined ? { routeOrder: j.routeOrder } : {}),
    values: currentValues(j),
    ...(j.updated ? { updated: j.updated } : {}),
    warnings: j.parseWarnings,
  };
}

export async function controlDays(user: ControlUser, schedule: ScheduleSource, now = new Date()): Promise<ControlDay[]> {
  const today = nyDate(now);
  const dates = [today, nextWorkday(today)];
  const days = await Promise.all(dates.map((d) => schedule.getDay(d)));
  return dates.map((date, i) => ({
    date,
    jobs: days[i].jobs
      .filter((j) => canEditCrew(user, j.crew))
      .sort(
        (a, b) =>
          crewRank(a.crew) - crewRank(b.crew) ||
          a.start.localeCompare(b.start) ||
          (a.routeOrder ?? Infinity) - (b.routeOrder ?? Infinity),
      )
      .map(toControlJob),
  }));
}
