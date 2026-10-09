import { CALENDAR_READONLY, parseServiceAccount, ServiceAccountAuth } from "@/lib/google/auth";
import { GoogleCalendarSource, parseCalendarIds } from "./calendar";
import { SampleScheduleSource, SampleWeatherSource } from "./sample";
import type { ScheduleSource, WeatherSource } from "./types";

export type { ScheduleSource, WeatherSource } from "./types";

type Env = Record<string, string | undefined>;

let calendarSource: { key: string; source: GoogleCalendarSource } | null = null;

/**
 * Picks the schedule source: Google Calendar when GOOGLE_SERVICE_ACCOUNT_JSON and CALENDAR_IDS are set,
 * otherwise the prototype's sample data. Weather stays on sample data until the NWS source lands.
 */
export function getSources(today: string, env: Env = process.env): { schedule: ScheduleSource; weather: WeatherSource } {
  const weather = new SampleWeatherSource();
  const key = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const ids = env.CALENDAR_IDS;
  if (!key || !ids) return { schedule: new SampleScheduleSource(today), weather };

  // Reuse the source between requests so the access token is cached.
  const cacheKey = `${key}\n${ids}`;
  if (calendarSource?.key !== cacheKey) {
    const auth = new ServiceAccountAuth(parseServiceAccount(key), CALENDAR_READONLY);
    calendarSource = { key: cacheKey, source: new GoogleCalendarSource(parseCalendarIds(ids), auth) };
  }
  return { schedule: calendarSource.source, weather };
}
