import { describe, expect, it, vi } from "vitest";
import { buildBoard } from "@/lib/board";
import { buildAlerts } from "@/lib/rules/alerts";
import { nyIso } from "@/lib/time";
import type { Job } from "@/lib/types";
import daily from "./__fixtures__/nws-daily.json";
import hourly from "./__fixtures__/nws-hourly.json";
import points from "./__fixtures__/nws-points.json";
import { SampleScheduleSource } from "./sample";
import { lightningRisk, NwsWeatherSource, toWeather } from "./weather";

// Real NWS responses for Rockledge, fetched 2026-10-09 at 11:43 AM EDT.
const DATE = "2026-10-09";
const NOW = new Date("2026-10-09T15:43:00Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeNws(opts: { failHourly?: number[] } = {}) {
  const calls: { url: string; headers: Headers }[] = [];
  let hourlyCalls = 0;
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url.includes("/points/")) return json(points);
    if (url.endsWith("/forecast/hourly")) {
      const status = opts.failHourly?.[hourlyCalls++];
      return status ? json({ title: "Unexpected Problem" }, status) : json(hourly);
    }
    if (url.endsWith("/forecast")) return json(daily);
    return json({}, 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe("toWeather (real NWS data)", () => {
  const w = toWeather(DATE, "Rockledge", hourly.properties.periods, daily.properties.periods, NOW);

  it("shows 7 AM to 6 PM, leaving hours already past empty", () => {
    expect(w.hourly.map((h) => h.pop)).toEqual([null, null, null, null, 8, 16, 20, 30, 34, 43, 43, 38]);
    expect(w.hourly[0].start).toBe("2026-10-09T07:00:00-04:00");
  });

  it("reads current temperature, wind, today's high and tonight's low", () => {
    expect([w.tempF, w.highF, w.lowF, w.wind]).toEqual([83, 86, 79, "SSE 10 mph"]);
  });

  it("flags afternoon thunderstorms", () => {
    expect(w.lightning).toBe("risk this afternoon");
  });

  it("drives the Weather alert for sealing in the afternoon", () => {
    const job = {
      id: "j",
      pin: 7,
      crew: "Sealing · Jardel",
      customer: "Whitaker",
      city: "Viera",
      service: "Sealing",
      start: nyIso(DATE, "13:00"),
      end: nyIso(DATE, "17:00"),
      status: "scheduled",
      deposit: "ok",
      permit: "ok",
      material: "ok",
      confirm48: "ok",
      parseWarnings: [],
    } satisfies Omit<Job, "address"> & { pin: number };
    const [a] = buildAlerts({ today: [job], nextWorkday: { date: "2026-10-12", jobs: [] }, hourly: w.hourly });
    expect(a).toMatchObject({ label: "Weather", text: "43% rain 4–5 PM. Confirm with Jardel or reschedule." });
  });

  it("raises no Weather alert for hours that have no forecast", () => {
    const morning = { ...hourly.properties.periods[0], startTime: nyIso(DATE, "09:00") };
    const ww = toWeather(DATE, "Rockledge", [morning], [], NOW);
    expect(ww.hourly.every((h) => h.pop === null || h.start === nyIso(DATE, "09:00"))).toBe(true);
  });

  it("falls back to hourly temperatures after the daytime period has ended", () => {
    const evening = daily.properties.periods.slice(1); // "Tonight" first, as after 6 PM
    const ww = toWeather(DATE, "Rockledge", hourly.properties.periods, evening, NOW);
    expect(ww.highF).toBe(85);
    expect(ww.lowF).toBe(79);
  });
});

describe("lightningRisk", () => {
  const p = (hm: string, f: string) => ({ startTime: nyIso(DATE, hm), endTime: nyIso(DATE, hm), temperature: 80, shortForecast: f });
  it.each([
    [[p("09:00", "Sunny")], undefined],
    [[p("09:00", "Thunderstorms Likely")], "risk this morning"],
    [[p("14:00", "Chance Showers And Thunderstorms")], "risk this afternoon"],
    [[p("09:00", "Isolated Thunderstorms"), p("15:00", "Thunderstorms")], "risk today"],
  ])("%#", (periods, expected) => {
    expect(lightningRisk(periods)).toBe(expected);
  });
});

describe("NwsWeatherSource", () => {
  it("looks up the grid once, then reads hourly and daily forecasts with a User-Agent", async () => {
    const nws = fakeNws();
    const src = new NwsWeatherSource(28.3506, -80.7253, "Rockledge", nws.fetchImpl, () => NOW.getTime());
    const w = await src.getForecast(DATE);
    expect(w.tempF).toBe(83);
    expect(nws.calls.map((c) => c.url)).toEqual([
      "https://api.weather.gov/points/28.3506,-80.7253",
      "https://api.weather.gov/gridpoints/MLB/52,63/forecast/hourly",
      "https://api.weather.gov/gridpoints/MLB/52,63/forecast",
    ]);
    expect(nws.calls[0].headers.get("User-Agent")).toMatch(/wagner-operations-board/);
  });

  it("caches the forecast for 10 minutes", async () => {
    const nws = fakeNws();
    let now = NOW.getTime();
    const src = new NwsWeatherSource(28.35, -80.72, "Rockledge", nws.fetchImpl, () => now);
    await src.getForecast(DATE);
    now += 9 * 60_000;
    await src.getForecast(DATE);
    expect(nws.calls).toHaveLength(3);
    now += 2 * 60_000;
    await src.getForecast(DATE);
    expect(nws.calls).toHaveLength(5); // points is not fetched again
  });

  it("retries once on a server error", async () => {
    const nws = fakeNws({ failHourly: [503] });
    const src = new NwsWeatherSource(28.35, -80.72, "Rockledge", nws.fetchImpl, () => NOW.getTime());
    await expect(src.getForecast(DATE)).resolves.toMatchObject({ tempF: 83 });
  });

  it("gives up after a second server error", async () => {
    const nws = fakeNws({ failHourly: [503, 500] });
    const src = new NwsWeatherSource(28.35, -80.72, "Rockledge", nws.fetchImpl, () => NOW.getTime());
    await expect(src.getForecast(DATE)).rejects.toThrow(/HTTP 500/);
  });
});

describe("board without a forecast", () => {
  it("keeps the schedule and turns weather alerts off", async () => {
    const failing = { label: "National Weather Service", sample: false, getForecast: async () => Promise.reject(new Error("down")) };
    const board = await buildBoard(NOW, { schedule: new SampleScheduleSource(DATE), weather: failing });
    expect(board.weather).toBeNull();
    expect(board.jobs).toHaveLength(7);
    expect(board.alerts.map((a) => a.label)).not.toContain("Weather");
  });
});
