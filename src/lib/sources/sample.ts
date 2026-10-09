// Sample data from prototype/index.html, re-dated to "today" so the board always looks live.
// Addresses are placeholders: the screen shows city only.

import { nextWorkday } from "@/lib/rules/readiness";
import { nyIso } from "@/lib/time";
import type { Check, Job, Status, Visit, Weather } from "@/lib/types";
import type { ScheduleSource, WeatherSource } from "./types";

interface SampleJob {
  crew: string;
  start: string;
  end: string;
  customer: string;
  city: string;
  lat?: number;
  lon?: number;
  service: string;
  size?: string;
  day?: [number, number];
  status?: Status;
  deposit?: Check;
  permit?: Check;
  material?: Check;
  confirm48?: Check;
  note?: string;
}

const TODAY_JOBS: SampleJob[] = [
  { crew: "Crew 2 · Jorge", start: "07:00", end: "16:00", customer: "Hartley", city: "Viera", lat: 28.252, lon: -80.737, service: "Driveway", size: "420 sf", day: [2, 2], status: "in_progress" },
  { crew: "Crew 3 · Darwin", start: "07:00", end: "16:00", customer: "Brennan", city: "Satellite Beach", lat: 28.176, lon: -80.598, service: "Pool deck", size: "380 sf", day: [1, 2], status: "in_progress" },
  { crew: "Excavation · Bira", start: "07:00", end: "12:00", customer: "Marsh", city: "Rockledge", lat: 28.322, lon: -80.737, service: "Driveway excavation", size: "500 sf", status: "in_progress" },
  { crew: "Felipe", start: "07:30", end: "15:30", customer: "Nguyen", city: "West Melbourne", lat: 28.07, lon: -80.672, service: "Wall block", size: "65 lnft", status: "issue", material: "missing", note: "Material not delivered" },
  { crew: "Crew 4 · Jhonny", start: "08:00", end: "16:00", customer: "Okafor", city: "Melbourne", lat: 28.1, lon: -80.64, service: "Patio", size: "260 sf", deposit: "missing" },
  { crew: "Excavation · Bira", start: "12:30", end: "14:00", customer: "Delgado", city: "Palm Bay", lat: 28.02, lon: -80.632, service: "Patio excavation", size: "300 sf" },
  { crew: "Sealing · Jardel", start: "13:00", end: "17:00", customer: "Whitaker", city: "Indian Harbour Beach", lat: 28.148, lon: -80.596, service: "Sealing", size: "900 sf", note: "Rain 2–5 PM" },
];

const NEXT_DAY_JOBS: SampleJob[] = [
  { crew: "Crew 2 · Jorge", start: "07:00", end: "16:00", customer: "Pereira", city: "Viera", service: "Driveway", size: "450 sf", confirm48: "missing" },
  { crew: "Crew 3 · Darwin", start: "07:00", end: "16:00", customer: "Ostrowski", city: "Melbourne", service: "Pool deck", size: "520 sf", permit: "missing" },
  { crew: "Crew 4 · Jhonny", start: "07:00", end: "16:00", customer: "Lindqvist", city: "Rockledge", service: "Patio", size: "300 sf" },
  { crew: "Excavation · Bira", start: "07:00", end: "12:00", customer: "Fairbanks", city: "Palm Bay", service: "Driveway excavation", size: "480 sf" },
];

const TODAY_VISITS = [
  { start: "09:00", customer: "Sorensen", city: "Suntree", lat: 28.236, lon: -80.7, service: "Driveway" },
  { start: "11:00", customer: "Alvarez", city: "Merritt Island", lat: 28.362, lon: -80.675, service: "Pool deck" },
  { start: "14:00", customer: "Pike", city: "Titusville", lat: 28.605, lon: -80.83, service: "Patio + walk" },
  { start: "16:00", customer: "Romano", city: "Cocoa Beach", lat: 28.318, lon: -80.609, service: "Driveway" },
];

/** Rain probability, 7 AM to 6 PM. */
const RAIN = [10, 10, 10, 15, 20, 25, 35, 50, 50, 45, 30, 20];

function toJob(date: string, s: SampleJob, i: number): Job {
  return {
    id: `sample-${date}-${i}`,
    crew: s.crew,
    start: nyIso(date, s.start),
    end: nyIso(date, s.end),
    customer: s.customer,
    address: `Sample address, ${s.city}, FL`,
    city: s.city,
    lat: s.lat,
    lon: s.lon,
    service: s.service,
    size: s.size,
    day: s.day ? { n: s.day[0], of: s.day[1] } : undefined,
    status: s.status ?? "scheduled",
    deposit: s.deposit ?? "ok",
    permit: s.permit ?? "ok",
    material: s.material ?? "ok",
    confirm48: s.confirm48 ?? "ok",
    note: s.note,
    parseWarnings: [],
  };
}

export class SampleScheduleSource implements ScheduleSource {
  readonly label = "sample data";
  readonly sample = true;

  constructor(private readonly today: string) {}

  async getDay(date: string): Promise<{ jobs: Job[]; visits: Visit[] }> {
    if (date === this.today) {
      return {
        jobs: TODAY_JOBS.map((s, i) => toJob(date, s, i)),
        visits: TODAY_VISITS.map((v, i) => ({ id: `sample-visit-${date}-${i}`, ...v, start: nyIso(date, v.start) })),
      };
    }
    if (date === nextWorkday(this.today)) {
      return { jobs: NEXT_DAY_JOBS.map((s, i) => toJob(date, s, i)), visits: [] };
    }
    return { jobs: [], visits: [] };
  }

  async getJobs(from: string, to: string): Promise<Job[]> {
    const days = [this.today, nextWorkday(this.today)].filter((d) => d >= from && d <= to);
    return (await Promise.all(days.map((d) => this.getDay(d)))).flatMap((d) => d.jobs);
  }

  async getBookedThrough(): Promise<string | null> {
    return "early Dec.";
  }
}

export class SampleWeatherSource implements WeatherSource {
  readonly label = "sample data";
  readonly sample = true;

  async getForecast(date: string): Promise<Weather> {
    return {
      location: "Rockledge",
      tempF: 88,
      highF: 88,
      lowF: 75,
      wind: "NE 12 mph",
      lightning: "risk this afternoon",
      hourly: RAIN.map((pop, i) => ({ start: nyIso(date, `${String(7 + i).padStart(2, "0")}:00`), pop })),
    };
  }
}
