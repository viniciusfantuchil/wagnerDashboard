import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/tiles/[z]/[x]/[y]/route";
import { buildBoard } from "@/lib/board";
import { getSources } from "@/lib/sources";
import { SampleScheduleSource, SampleWeatherSource } from "@/lib/sources/sample";
import { MAP_H, MAP_W, TILE_SIZE, fitView, isBoardTile, project, tilePath, tilesFor } from "./basemap";

const OFFICE = { lat: 28.3506, lon: -80.7253 };

describe("project", () => {
  it("puts the view center in the middle of the map", () => {
    expect(project(28.3, -80.7, { lat: 28.3, lon: -80.7, zoom: 10 })).toEqual([MAP_W / 2, MAP_H / 2]);
  });

  it("matches Web Mercator: east is right, north is up, one zoom level doubles distances", () => {
    const v10 = { lat: 28.3, lon: -80.7, zoom: 10 };
    const [ex] = project(28.3, -80.6, v10);
    const [, ny] = project(28.4, -80.7, v10);
    expect(ny).toBeLessThan(MAP_H / 2);
    expect(ex - MAP_W / 2).toBeCloseTo((256 * 1024 * 0.1) / 360, 5); // 0.1° of longitude at zoom 10
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
      expect(Math.min(x, y, MAP_W - x, MAP_H - y)).toBeGreaterThanOrEqual(30);
    }
  });

  it("uses the closest zoom that fits, zooming in for close-together jobs", () => {
    expect(fitView(brevard, OFFICE).zoom).toBe(10); // Titusville to Palm Bay
    expect(fitView([{ lat: 28.33, lon: -80.73 }, { lat: 28.36, lon: -80.7 }], OFFICE).zoom).toBeGreaterThan(10);
  });

  it("centers on the office when there are no jobs", () => {
    const view = fitView([], OFFICE);
    expect(project(OFFICE.lat, OFFICE.lon, view).map(Math.round)).toEqual([MAP_W / 2, MAP_H / 2]);
  });
});

describe("tilesFor", () => {
  it("covers the whole map with 256-pixel tiles, without gaps", () => {
    const view = { lat: 28.3129, lon: -80.713, zoom: 10 };
    const tiles = tilesFor(view);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + TILE_SIZE))).toBeGreaterThanOrEqual(MAP_W);
    expect(Math.max(...tiles.map((t) => t.top + TILE_SIZE))).toBeGreaterThanOrEqual(MAP_H);
    expect(tiles.length).toBeLessThanOrEqual(12); // 404×600 spans at most 3×4 tiles
    // Brevard at zoom 10 is around tile x 282, y 427.
    expect(tiles.every((t) => t.z === 10 && t.x >= 281 && t.x <= 283 && t.y >= 425 && t.y <= 430)).toBe(true);
    expect(tilePath(tiles[0])).toMatch(/^\/api\/tiles\/10\/\d+\/\d+$/);
  });

  it("only uses tiles the tile route accepts", () => {
    const view = fitView([{ lat: 28.612, lon: -80.807 }, { lat: 28.034, lon: -80.589 }], OFFICE);
    expect(tilesFor(view).every((t) => isBoardTile(t.z, t.x, t.y))).toBe(true);
  });
});

describe("isBoardTile", () => {
  it.each([
    [10, 282, 427, true],
    [10, 301, 385, false], // New York
    [15, 9000, 13900, false], // zoom too deep
    [7, 35, 54, false], // zoom too far out
    [10, 282.5, 434, false],
  ])("z%i x%s y%s → %s", (z, x, y, ok) => {
    expect(isBoardTile(z, x, y)).toBe(ok);
  });
});

describe("GET /api/tiles/z/x/y", () => {
  afterEach(() => vi.unstubAllGlobals());
  const call = (z: string, x: string, y: string) => GET(new Request("https://board.example.com"), { params: Promise.resolve({ z, x, y }) });

  it("refuses tiles outside Brevard, so it cannot be used as an open tile proxy", async () => {
    expect((await call("10", "301", "385")).status).toBe(400);
    expect((await call("10", "282", "427.png")).status).toBe(400);
  });

  it("fetches each tile once from OpenStreetMap with an identifying User-Agent", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn(async () => new Response(png, { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await call("10", "282", "427");
    const b = await call("10", "282", "427");
    expect(a.headers.get("content-type")).toBe("image/png");
    expect(a.headers.get("cache-control")).toBe("private, max-age=604800");
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(png);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://tile.openstreetmap.org/10/282/427.png");
    expect(new Headers(init.headers).get("User-Agent")).toMatch(/^wagner-operations-board\//);
  });

  it("answers 502 when OpenStreetMap fails", async () => {
    vi.stubGlobal("fetch", async () => new Response("busy", { status: 503 }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await call("10", "283", "428")).status).toBe(502);
    err.mockRestore();
  });
});

describe("board map", () => {
  const now = new Date("2026-10-09T13:00:00Z");
  const sample = () => ({ schedule: new SampleScheduleSource("2026-10-09"), weather: new SampleWeatherSource() });

  it("keeps the prototype's schematic map for sample data", async () => {
    expect((await buildBoard(now, sample())).map).toBeNull();
    expect(getSources("2026-10-09", {}).mapImage).toBe(false);
  });

  it("frames today's pins on OpenStreetMap for the live board", async () => {
    const board = await buildBoard(now, { ...sample(), mapImage: true, office: OFFICE });
    expect(board.map).toMatchObject({ zoom: 10, office: OFFICE });
  });

  it("lets MAP_STYLE switch the basemap", () => {
    expect(getSources("2026-10-09", { MAP_STYLE: "osm" }).mapImage).toBe(true);
  });
});
