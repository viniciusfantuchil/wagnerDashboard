import { CALENDAR_READONLY, parseServiceAccount, ServiceAccountAuth } from "@/lib/google/auth";
import { GoogleCalendarSource, parseCalendarIds } from "./calendar";
import { SampleScheduleSource, SampleWeatherSource } from "./sample";
import type { ScheduleSource, WeatherSource } from "./types";
import { NwsWeatherSource } from "./weather";

export type { ScheduleSource, WeatherSource } from "./types";

type Env = Record<string, string | undefined>;

let calendarSource: { key: string; source: GoogleCalendarSource } | null = null;
let nwsSource: { key: string; source: NwsWeatherSource } | null = null;

/** Rockledge, FL (the office) unless HQ_LAT / HQ_LON say otherwise. */
const DEFAULT_HQ = { lat: 28.3506, lon: -80.7253 };

function nws(env: Env): NwsWeatherSource {
  const lat = Number(env.HQ_LAT) || DEFAULT_HQ.lat;
  const lon = Number(env.HQ_LON) || DEFAULT_HQ.lon;
  const key = `${lat},${lon}`;
  if (nwsSource?.key !== key) nwsSource = { key, source: new NwsWeatherSource(lat, lon, "Rockledge") };
  return nwsSource.source;
}

/**
 * Picks the schedule source: Google Calendar when GOOGLE_SERVICE_ACCOUNT_JSON and CALENDAR_IDS are set,
 * otherwise the prototype's sample data. Live schedules get the live NWS forecast; sample schedules keep the
 * sample weather so the board still matches the prototype.
 */
export function getSources(today: string, env: Env = process.env): { schedule: ScheduleSource; weather: WeatherSource } {
  const key = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const ids = env.CALENDAR_IDS;
  if (!key || !ids) return { schedule: new SampleScheduleSource(today), weather: new SampleWeatherSource() };

  // Reuse the source between requests so the access token is cached.
  const cacheKey = `${key}\n${ids}`;
  if (calendarSource?.key !== cacheKey) {
    const auth = new ServiceAccountAuth(parseServiceAccount(key), CALENDAR_READONLY);
    calendarSource = { key: cacheKey, source: new GoogleCalendarSource(parseCalendarIds(ids), auth) };
  }
  return { schedule: calendarSource.source, weather: nws(env) };
}
