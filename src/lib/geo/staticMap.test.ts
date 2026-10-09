import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/map/route";
import { buildBoard } from "@/lib/board";
import { SampleScheduleSource, SampleWeatherSource } from "@/lib/sources/sample";
import { MAP_H, MAP_W, fitView, mapImagePath, parseView, project, staticMapUrl } from "./staticMap";

const OFFICE = { lat: 28.3506, lon: -80.7253 };

describe("project", () => {
  it("puts the view center in the middle of the image", () => {
    const view = { lat: 28.3, lon: -80.7, zoom: 10 };
    expect(project(28.3, -80.7, view)).toEqual([MAP_W / 2, MAP_H / 2]);
  });

  it("matches Web Mercator: east is right, north is up, one zoom level doubles distances", () => {
    const v10 = { lat: 28.3, lon: -80.7, zoom: 10 };
    const [ex] = project(28.3, -80.6, v10);
    const [, ny] = project(28.4, -80.7, v10);
    expect(ex).toBeGreaterThan(MAP_W / 2);
    expect(ny).toBeLessThan(MAP_H / 2);
    // 0.1° of longitude at zoom 10 is 256·2^10·0.1/360 ≈ 72.8 px
    expect(ex - MAP_W / 2).toBeCloseTo((256 * 1024 * 0.1) / 360, 5);
    const [ex11] = project(28.3, -80.6, { ...v10, zoom: 11 });
    expect(ex11 - MAP_W / 2).toBeCloseTo(2 * (ex - MAP_W / 2), 5);
  });
});

describe("fitView", () => {
  const brevard = [
    { lat: 28.612, lon: -80.807 }, // Titusville
    { lat: 28.034, lon: -80.589 }, // Palm Bay
    { lat: 28.32, lon: -80.607 }, // Cocoa Beach
  ];

  it("keeps every job and the office on the map, away from the edges", () => {
    const view = fitView(brevard, OFFICE);
    for (const p of [...brevard, OFFICE]) {
      const [x, y] = project(p.lat, p.lon, view);
      expect(x).toBeGreaterThanOrEqual(30);
      expect(x).toBeLessThanOrEqual(MAP_W - 30);
      expect(y).toBeGreaterThanOrEqual(30);
      expect(y).toBeLessThanOrEqual(MAP_H - 30);
    }
  });

  it("zooms in when the jobs are close together", () => {
    const wide = fitView(brevard, OFFICE).zoom;
    const near = fitView([{ lat: 28.33, lon: -80.73 }, { lat: 28.36, lon: -80.7 }], OFFICE).zoom;
    expect(near).toBeGreaterThan(wide);
    expect(wide).toBe(10); // Titusville to Palm Bay fits at zoom 10
  });

  it("shows the office when there are no jobs", () => {
    const view = fitView([], OFFICE);
    expect(project(OFFICE.lat, OFFICE.lon, view).map(Math.round)).toEqual([MAP_W / 2, MAP_H / 2]);
  });
});

describe("parseView", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("accepts a view the board would ask for", () => {
    expect(parseView(q("lat=28.3&lon=-80.7&z=10"))).toEqual({ lat: 28.3, lon: -80.7, zoom: 10 });
  });
  it.each(["lat=40.7&lon=-74&z=10", "lat=28.3&lon=-80.7&z=18", "lat=28.3&lon=-80.7&z=9.5", "lat=x&lon=-80.7&z=10", ""])("rejects %j", (s) => {
    expect(parseView(q(s))).toBeNull();
  });
});

describe("staticMapUrl", () => {
  it("asks Google for a hi-res roadmap without points of interest", () => {
    const url = new URL(staticMapUrl({ lat: 28.3, lon: -80.7, zoom: 10 }, "KEY"));
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/staticmap");
    expect(url.searchParams.get("center")).toBe("28.3,-80.7");
    expect(url.searchParams.get("size")).toBe(`${MAP_W}x${MAP_H}`);
    expect(url.searchParams.get("scale")).toBe("2");
    expect(url.searchParams.getAll("style")).toEqual(["feature:poi|visibility:off", "feature:transit|visibility:off"]);
  });
});

describe("GET /api/map", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const req = (s: string) => new Request(`https://board.example.com/api/map?${s}`);

  it("is off without GOOGLE_MAPS_API_KEY", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    expect((await GET(req("lat=28.3&lon=-80.7&z=10"))).status).toBe(404);
  });

  it("refuses views outside Brevard, so the key cannot be used as an open proxy", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "KEY");
    expect((await GET(req("lat=40.7&lon=-74&z=10"))).status).toBe(400);
  });

  it("returns Google's image, fetched once with the server key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "SERVER-KEY");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () => new Response(png, { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await GET(req("lat=28.31&lon=-80.71&z=11"));
    const b = await GET(req("lat=28.31&lon=-80.71&z=11"));
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(png);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("key=SERVER-KEY");
  });

  it("reports Google errors as 502 without leaking them", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "KEY");
    vi.stubGlobal("fetch", async () => new Response("The Google Maps Platform server rejected your request.", { status: 403 }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req("lat=28.32&lon=-80.72&z=12"));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("KEY");
    err.mockRestore();
  });
});

describe("board map", () => {
  const now = new Date("2026-10-09T13:00:00Z");
  it("is null without a Maps key, so the schematic map is drawn", async () => {
    const board = await buildBoard(now, { schedule: new SampleScheduleSource("2026-10-09"), weather: new SampleWeatherSource() });
    expect(board.map).toBeNull();
  });

  it("fits today's pins when the Maps key is set", async () => {
    const board = await buildBoard(now, {
      schedule: new SampleScheduleSource("2026-10-09"),
      weather: new SampleWeatherSource(),
      mapImage: true,
      office: OFFICE,
    });
    expect(board.map).toMatchObject({ zoom: 10, office: OFFICE });
    expect(mapImagePath(board.map!)).toMatch(/^\/api\/map\?lat=28\.\d+&lon=-80\.\d+&z=10$/);
  });
});
