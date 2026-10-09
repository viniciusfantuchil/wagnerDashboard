import type { Job, Visit, Weather } from "@/lib/types";

/**
 * Where the crew schedule comes from. Phase 1: Google Calendar. Phase 2/3: Markate work orders.
 * The screen only sees the Board built from this, so a source can be swapped without touching the UI.
 */
export interface ScheduleSource {
  /** Shown in the footer, e.g. "Google Calendar" or "sample data". */
  readonly label: string;
  readonly sample: boolean;
  /** Jobs and estimate visits on a local date (YYYY-MM-DD, America/New_York). */
  getDay(date: string): Promise<{ jobs: Job[]; visits: Visit[] }>;
  /** How far ahead the crews are booked, e.g. "early Dec.", or null when unknown. */
  getBookedThrough(today: string): Promise<string | null>;
}

/** Hourly forecast for the office. Phase 1: api.weather.gov. */
export interface WeatherSource {
  readonly label: string;
  readonly sample: boolean;
  getForecast(date: string): Promise<Weather>;
}
