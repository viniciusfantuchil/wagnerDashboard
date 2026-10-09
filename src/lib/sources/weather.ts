// WeatherSource backed by the National Weather Service (api.weather.gov): hourly forecast for the office.
// No API key; NWS asks for a User-Agent that identifies the app and a contact.

import { safeText } from "@/lib/google/auth";
import { minuteOfDay, nyDate, nyIso } from "@/lib/time";
import type { HourlyRain, Weather } from "@/lib/types";
import type { WeatherSource } from "./types";

const API = "https://api.weather.gov";
const USER_AGENT = "(wagner-operations-board, https://github.com/viniciusfantuchil/wagnerDashboard)";
/** NWS updates the hourly forecast about once an hour. */
const CACHE_MS = 10 * 60_000;
/** Hours shown on the board: 7 AM to 6 PM. */
export const FIRST_HOUR = 7;
export const LAST_HOUR = 18;

interface NwsPeriod {
  startTime: string;
  endTime: string;
  isDaytime?: boolean;
  temperature: number;
  temperatureUnit?: string;
  probabilityOfPrecipitation?: { value: number | null };
  windSpeed?: string;
  windDirection?: string;
  shortForecast?: string;
}

const toF = (p: NwsPeriod) => (p.temperatureUnit === "C" ? Math.round((p.temperature * 9) / 5 + 32) : p.temperature);
const hourOf = (iso: string) => Math.floor(minuteOfDay(iso) / 60);

/** "risk this afternoon" when thunderstorms are in the forecast during work hours, else undefined. */
export function lightningRisk(periods: NwsPeriod[]): string | undefined {
  const hours = periods.filter((p) => /thunder/i.test(p.shortForecast ?? "")).map((p) => hourOf(p.startTime));
  if (hours.length === 0) return undefined;
  const morning = hours.some((h) => h < 12);
  const afternoon = hours.some((h) => h >= 12);
  return morning && afternoon ? "risk today" : morning ? "risk this morning" : "risk this afternoon";
}

/** Builds the board's Weather for `date` from NWS hourly and daily periods. */
export function toWeather(date: string, location: string, hourly: NwsPeriod[], daily: NwsPeriod[], now: Date): Weather {
  const today = hourly.filter((p) => nyDate(new Date(p.startTime)) === date);
  const work = today.filter((p) => hourOf(p.startTime) >= FIRST_HOUR && hourOf(p.startTime) <= LAST_HOUR);
  const byHour = new Map(work.map((p) => [hourOf(p.startTime), p]));

  const slots: HourlyRain[] = [];
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    // Hours already past are not in the forecast; they stay empty rather than guessed.
    slots.push({ start: nyIso(date, `${String(h).padStart(2, "0")}:00`), pop: byHour.get(h)?.probabilityOfPrecipitation?.value ?? null });
  }

  const current =
    hourly.find((p) => Date.parse(p.startTime) <= now.getTime() && now.getTime() < Date.parse(p.endTime)) ?? today[0] ?? hourly[0];
  const startsToday = (p: NwsPeriod) => nyDate(new Date(p.startTime)) === date;
  const dayHigh = daily.find((p) => p.isDaytime && startsToday(p));
  const nightLow = daily.find((p) => p.isDaytime === false && startsToday(p));
  const temps = today.map(toF);

  return {
    location,
    tempF: current ? toF(current) : null,
    highF: dayHigh ? toF(dayHigh) : temps.length ? Math.max(...temps) : null,
    lowF: nightLow ? toF(nightLow) : temps.length ? Math.min(...temps) : null,
    wind: current?.windSpeed ? `${current.windDirection ?? ""} ${current.windSpeed}`.trim() : "–",
    lightning: lightningRisk(work),
    hourly: slots,
  };
}

export class NwsWeatherSource implements WeatherSource {
  readonly label = "National Weather Service";
  readonly sample = false;
  private points: { hourly: string; daily: string } | null = null;
  private cache: { date: string; at: number; weather: Weather } | null = null;

  constructor(
    private readonly lat: number,
    private readonly lon: number,
    private readonly location: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async getForecast(date: string): Promise<Weather> {
    const now = this.clock();
    if (this.cache && this.cache.date === date && now - this.cache.at < CACHE_MS) return this.cache.weather;

    if (!this.points) {
      const body = await this.get<{ properties: { forecast: string; forecastHourly: string } }>(
        `${API}/points/${this.lat.toFixed(4)},${this.lon.toFixed(4)}`,
      );
      this.points = { hourly: body.properties.forecastHourly, daily: body.properties.forecast };
    }
    const [hourly, daily] = await Promise.all([
      this.get<{ properties: { periods: NwsPeriod[] } }>(this.points.hourly),
      this.get<{ properties: { periods: NwsPeriod[] } }>(this.points.daily),
    ]);
    const weather = toWeather(date, this.location, hourly.properties.periods, daily.properties.periods, new Date(now));
    this.cache = { date, at: now, weather };
    return weather;
  }

  private async get<T>(url: string): Promise<T> {
    // NWS returns occasional 5xx; one retry covers most of them.
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json" },
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      if (attempt >= 1 || res.status < 500) throw new Error(`NWS ${url}: HTTP ${res.status} ${await safeText(res)}`);
    }
  }
}
