// Data model from docs/SPEC-phase-1.md §5. Times are ISO strings in America/New_York.

export type Status = "scheduled" | "in_progress" | "completed" | "issue" | "postponed";
export type Check = "ok" | "missing" | "unknown";

export interface Job {
  id: string; // calendar event id
  crew: string; // from the calendar name, e.g. "Crew 2 · Jorge"
  start: string;
  end: string;
  allDay?: true; // all-day calendar event: start/end are placeholders for the workday
  customer: string;
  address: string; // server only: never rendered on screen
  city: string;
  lat?: number;
  lon?: number;
  service: string; // "Driveway", "Pool deck", "Sealing", ...
  size?: string; // "420 sf", "65 lnft"
  day?: { n: number; of: number };
  status: Status;
  deposit: Check;
  permit: Check;
  material: Check;
  confirm48: Check;
  note?: string;
  parseWarnings: string[];
}

export interface Visit {
  id: string;
  start: string;
  allDay?: true;
  customer: string;
  address?: string; // server only: never rendered on screen
  city: string;
  lat?: number;
  lon?: number;
  service: string;
}

export interface HourlyRain {
  start: string; // start of the hour, ISO
  pop: number | null; // probability of precipitation, 0–100; null for hours with no forecast (already past)
}

export interface Weather {
  location: string; // "Rockledge"
  tempF: number | null;
  highF: number | null;
  lowF: number | null;
  wind: string; // "NE 12 mph"
  lightning?: string; // "risk this afternoon"
  hourly: HourlyRain[];
}

export interface Alert {
  severity: "danger" | "warning";
  label: string;
  title: string;
  text: string;
  jobId?: string;
}

/** A job on today's board, with the number shown on its pin and card. The street address stays on the server. */
export interface BoardJob extends Omit<Job, "address"> {
  pin: number;
  approx?: true; // map position is the city center, not the street address
}

/** A visit on today's board, with its map key (K1, K2, ...). */
export interface BoardVisit extends Omit<Visit, "address"> {
  key: string;
  approx?: true;
}

export interface ReadyRow {
  jobId: string;
  customer: string;
  city: string;
  crew: string; // short crew name, e.g. "Crew 2" or "Bira"
  deposit: Check;
  permit: Check;
  material: Check;
  confirm48: Check;
}

/** Payload of GET /api/board. Contains no street addresses. */
export interface Board {
  generatedAt: string;
  date: string; // today, YYYY-MM-DD in America/New_York
  jobs: BoardJob[]; // sorted by start time, then pin
  visits: BoardVisit[];
  weather: Weather | null; // null when the forecast could not be loaded
  alerts: Alert[]; // all alerts, ranked; the screen shows the first 6
  nextWorkday: { date: string; rows: ReadyRow[] };
  bookedThrough: string | null;
  sources: { schedule: string; weather: string; sample: boolean };
}
