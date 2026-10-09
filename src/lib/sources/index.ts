import { SampleScheduleSource, SampleWeatherSource } from "./sample";
import type { ScheduleSource, WeatherSource } from "./types";

export type { ScheduleSource, WeatherSource } from "./types";

/**
 * Picks the data sources. Phase 1 will return the Google Calendar and NWS sources here once
 * their credentials are configured; until then the board runs on the prototype's sample data.
 */
export function getSources(today: string): { schedule: ScheduleSource; weather: WeatherSource } {
  return { schedule: new SampleScheduleSource(today), weather: new SampleWeatherSource() };
}
