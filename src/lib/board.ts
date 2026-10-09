import { crewRank } from "@/lib/crews";
import { buildAlerts } from "@/lib/rules/alerts";
import { nextWorkday, readyRows } from "@/lib/rules/readiness";
import { getSources, type ScheduleSource, type WeatherSource } from "@/lib/sources";
import { nyDate } from "@/lib/time";
import type { Board, BoardJob, BoardVisit, Job } from "@/lib/types";

/** Numbers today's jobs in crew order, then start time, and drops the street address. */
export function numberJobs(jobs: Job[]): BoardJob[] {
  return [...jobs]
    .sort((a, b) => crewRank(a.crew) - crewRank(b.crew) || a.start.localeCompare(b.start))
    .map(({ address: _address, ...job }, i) => ({ ...job, pin: i + 1 }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.pin - b.pin);
}

export async function buildBoard(
  now = new Date(),
  sources?: { schedule: ScheduleSource; weather: WeatherSource },
): Promise<Board> {
  const date = nyDate(now);
  const next = nextWorkday(date);
  const { schedule, weather: weatherSource } = sources ?? getSources(date);

  const [today, tomorrow, weather, bookedThrough] = await Promise.all([
    schedule.getDay(date),
    schedule.getDay(next),
    weatherSource.getForecast(date),
    schedule.getBookedThrough(date),
  ]);

  const jobs = numberJobs(today.jobs);
  const visits: BoardVisit[] = [...today.visits]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((v, i) => ({ ...v, key: `K${i + 1}` }));

  return {
    generatedAt: now.toISOString(),
    date,
    jobs,
    visits,
    weather,
    alerts: buildAlerts({ today: jobs, nextWorkday: { date: next, jobs: tomorrow.jobs }, hourly: weather.hourly }),
    nextWorkday: { date: next, rows: readyRows(tomorrow.jobs) },
    bookedThrough,
    sources: {
      schedule: schedule.label,
      weather: weatherSource.label,
      sample: schedule.sample || weatherSource.sample,
    },
  };
}
