import { describe, expect, it, vi } from "vitest";
import { spread } from "@/components/BoardMap";
import { buildBoard } from "@/lib/board";
import { OFFLINE_GEOCODER } from "@/lib/sources";
import { SampleWeatherSource } from "@/lib/sources/sample";
import type { ScheduleSource } from "@/lib/sources/types";
import { nyIso } from "@/lib/time";
import type { Job, Visit } from "@/lib/types";
import { CachedGeocoder, CensusGeocoder, cityCenter, locateAll, type Geocoder } from "./geocode";

// Real Census geocoder response for Rockledge City Hall, fetched 2026-10-09.
const CENSUS_MATCH = {
  result: {
    input: { address: { address: "1600 Huntington Ln, Rockledge, FL 32955" } },
    addressMatches: [{ coordinates: { x: -80.734835373025, y: 28.331953048741 }, matchedAddress: "1600 HUNTINGTON LN, ROCKLEDGE, FL, 32955" }],
  },
};
const CENSUS_NO_MATCH = { result: { input: {}, addressMatches: [] } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("CensusGeocoder", () => {
  it("returns the first match's coordinates", async () => {
    const fetchImpl = vi.fn(async () => json(CENSUS_MATCH));
    const g = new CensusGeocoder(fetchImpl as unknown as typeof fetch);
    expect(await g.geocode("1600 Huntington Ln, Rockledge, FL 32955")).toEqual({ lat: 28.331953048741, lon: -80.734835373025 });
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      address: "1600 Huntington Ln, Rockledge, FL 32955",
      benchmark: "Public_AR_Current",
      format: "json",
    });
  });

  it("returns null when nothing matches", async () => {
    const g = new CensusGeocoder((async () => json(CENSUS_NO_MATCH)) as unknown as typeof fetch);
    expect(await g.geocode("1 Nowhere Rd, Viera, FL")).toBeNull();
  });

  it("throws on a service error", async () => {
    const g = new CensusGeocoder((async () => json({}, 502)) as unknown as typeof fetch);
    await expect(g.geocode("1 Main St, Viera, FL")).rejects.toThrow(/HTTP 502/);
  });
});

describe("CachedGeocoder", () => {
  it("looks each address up once", async () => {
    const inner = { label: "x", geocode: vi.fn(async () => ({ lat: 1, lon: 2 })) };
    const g = new CachedGeocoder(inner);
    await g.geocode("1 Main St, Viera, FL");
    await g.geocode("1 MAIN ST, VIERA, FL ");
    expect(inner.geocode).toHaveBeenCalledTimes(1);
  });

  it("retries a miss after an hour", async () => {
    const inner = { label: "x", geocode: vi.fn(async () => null) };
    let now = 0;
    const g = new CachedGeocoder(inner, () => now);
    await g.geocode("1 Main St, Viera, FL");
    now += 59 * 60_000;
    await g.geocode("1 Main St, Viera, FL");
    expect(inner.geocode).toHaveBeenCalledTimes(1);
    now += 2 * 60_000;
    await g.geocode("1 Main St, Viera, FL");
    expect(inner.geocode).toHaveBeenCalledTimes(2);
  });
});

describe("locateAll", () => {
  const found: Geocoder = { label: "x", geocode: async () => ({ lat: 28.33, lon: -80.73 }) };
  const failing: Geocoder = { label: "x", geocode: async () => Promise.reject(new Error("down")) };

  it("uses the street address when the geocoder finds it", async () => {
    expect(await locateAll([{ address: "1600 Huntington Ln, Rockledge, FL", city: "Rockledge" }], found)).toEqual([
      { lat: 28.33, lon: -80.73, approx: false },
    ]);
  });

  it("falls back to the city center, marked approximate", async () => {
    const items = [
      { address: "Satellite Beach", city: "Satellite Beach" }, // no street number: not sent to the geocoder
      { address: "12 Ocean Ave, Melbourne, FL", city: "Melbourne" }, // geocoder down
      { city: "Atlantis" }, // unknown city: not on the map
    ];
    const spy = vi.spyOn(failing, "geocode");
    expect(await locateAll(items, failing)).toEqual([
      { ...cityCenter("Satellite Beach"), approx: true },
      { ...cityCenter("Melbourne"), approx: true },
      null,
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("board map positions", () => {
  const DATE = "2026-10-09";
  const job = (id: string, address: string, city: string): Job => ({
    id,
    crew: "Crew 2 · Jorge",
    start: nyIso(DATE, "07:00"),
    end: nyIso(DATE, "16:00"),
    customer: id,
    address,
    city,
    service: "Driveway",
    status: "scheduled",
    deposit: "ok",
    permit: "ok",
    material: "ok",
    confirm48: "ok",
    parseWarnings: [],
  });
  const visit: Visit = { id: "v", start: nyIso(DATE, "09:00"), customer: "Pike", address: "9 Elm St, Titusville, FL", city: "Titusville", service: "Patio" };
  const schedule: ScheduleSource = {
    label: "test",
    sample: false,
    getDay: async (d) => (d === DATE ? { jobs: [job("a", "1600 Huntington Ln, Rockledge, FL", "Rockledge"), job("b", "", "Viera")], visits: [visit] } : { jobs: [], visits: [] }),
    getJobs: async () => [],
    getBookedThrough: async () => null,
  };

  it("geocodes jobs and visits, then drops every street address", async () => {
    const geocoder: Geocoder = { label: "x", geocode: async (a) => (a.startsWith("1600") || a.startsWith("9 Elm") ? { lat: 28.33, lon: -80.73 } : null) };
    const board = await buildBoard(new Date("2026-10-09T13:00:00Z"), { schedule, weather: new SampleWeatherSource(), geocoder });
    expect(board.jobs.map((j) => [j.customer, j.lat, j.lon, j.approx])).toEqual([
      ["a", 28.33, -80.73, undefined],
      ["b", cityCenter("Viera")!.lat, cityCenter("Viera")!.lon, true],
    ]);
    expect(board.visits[0]).toMatchObject({ lat: 28.33, lon: -80.73 });
    expect(JSON.stringify(board)).not.toMatch(/Huntington|Elm St|"address"/);
  });

  it("works offline with city centers only", async () => {
    const board = await buildBoard(new Date("2026-10-09T13:00:00Z"), { schedule, weather: new SampleWeatherSource(), geocoder: OFFLINE_GEOCODER });
    expect(board.jobs.every((j) => j.approx)).toBe(true);
  });
});

describe("spread", () => {
  it("leaves distant pins alone and fans out pins on the same spot", () => {
    const out = spread([[100, 100], [300, 300], [100, 100], [101, 99]]);
    expect(out[0]).toEqual([100, 100]);
    expect(out[1]).toEqual([300, 300]);
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(d(out[2], out[0])).toBeGreaterThanOrEqual(20);
    expect(d(out[3], out[0])).toBeGreaterThanOrEqual(20);
    expect(d(out[2], out[3])).toBeGreaterThanOrEqual(20);
  });
});
