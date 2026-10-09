import { crewRank } from "@/lib/crews";
import { locateAll } from "@/lib/geo/geocode";
import { fitView } from "@/lib/geo/basemap";
import { buildAlerts } from "@/lib/rules/alerts";
import { nextWorkday, readyRows } from "@/lib/rules/readiness";
import { getSources, OFFLINE_GEOCODER, type Sources } from "@/lib/sources";
import { nyDate } from "@/lib/time";
import type { Board, BoardJob, BoardVisit, Job, Visit } from "@/lib/types";

/** Numbers today's jobs in crew order, then start time, and drops the street address. */
export function numberJobs(jobs: (Job & { approx?: true })[]): BoardJob[] {
  return [...jobs]
    .sort((a, b) => crewRank(a.crew) - crewRank(b.crew) || a.start.localeCompare(b.start))
    .map(({ address: _address, ...job }, i) => ({ ...job, pin: i + 1 }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.pin - b.pin);
}

/** Fills in lat/lon for items the source did not place, from the street address or the city center. */
async function placeOnMap<T extends Job | Visit>(items: T[], geocoder: Sources["geocoder"]): Promise<(T & { approx?: true })[]> {
  const missing = items.filter((i) => i.lat === undefined || i.lon === undefined);
  if (missing.length === 0) return items;
  const located = await locateAll(missing, geocoder ?? OFFLINE_GEOCODER);
  const byItem = new Map(missing.map((item, i) => [item, located[i]]));
  return items.map((item) => {
    const at = byItem.get(item);
    return at ? { ...item, lat: at.lat, lon: at.lon, ...(at.approx ? { approx: true as const } : {}) } : item;
  });
}

const onMap = (items: { lat?: number; lon?: number }[]) =>
  items.flatMap((i) => (i.lat !== undefined && i.lon !== undefined ? [{ lat: i.lat, lon: i.lon }] : []));

export async function buildBoard(now = new Date(), sources?: Sources): Promise<Board> {
  const date = nyDate(now);
  const next = nextWorkday(date);
  const { schedule, weather: weatherSource, geocoder, mapImage, office } = sources ?? getSources(date);

  const [today, tomorrow, weather, bookedThrough] = await Promise.all([
    schedule.getDay(date),
    schedule.getDay(next),
    // Weather is not worth losing the schedule over: without it the board shows "Weather unavailable".
    weatherSource.getForecast(date).catch((err: unknown) => {
      console.error("Weather forecast failed:", err);
      return null;
    }),
    schedule.getBookedThrough(date),
  ]);

  const [placedJobs, placedVisits] = await Promise.all([placeOnMap(today.jobs, geocoder), placeOnMap(today.visits, geocoder)]);

  const jobs = numberJobs(placedJobs);
  const visits: BoardVisit[] = [...placedVisits]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map(({ address: _address, ...v }, i) => ({ ...v, key: `K${i + 1}` }));

  return {
    generatedAt: now.toISOString(),
    date,
    jobs,
    visits,
    weather,
    alerts: buildAlerts({ today: jobs, nextWorkday: { date: next, jobs: tomorrow.jobs }, hourly: weather?.hourly ?? [] }),
    nextWorkday: { date: next, rows: readyRows(tomorrow.jobs) },
    bookedThrough,
    map: mapImage && office ? { ...fitView(onMap([...jobs, ...visits]), office), office } : null,
    sources: {
      schedule: schedule.label,
      weather: weatherSource.label,
      sample: schedule.sample || weatherSource.sample,
    },
  };
}
