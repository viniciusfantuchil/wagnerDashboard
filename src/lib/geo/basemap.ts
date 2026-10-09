// OpenStreetMap basemap for the board map, with our own pins drawn on top. No account or key.
// Tiles are fetched by the server (GET /api/tiles/z/x/y) and cached, so the browser only talks to the board
// (spec §4) and the OpenStreetMap tile servers see one light, identified client (their tile usage policy).
// Pin positions use the same Web Mercator projection as the tiles.

import type { Point } from "./geocode";

/** Map size in tile pixels; shown at ~506×753 on the 1920×1080 stage (tiles drawn ~1.25× for TV legibility). */
export const MAP_W = 404;
export const MAP_H = 600;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 14;
/** Room kept around the outermost pins so they are not cut off at the edge. */
const PAD = 36;
const TILE = 256;

/** Brevard County and surroundings; tiles outside this box are refused by /api/tiles. */
const REGION = { latMin: 27.5, latMax: 29.0, lonMin: -81.3, lonMax: -80.2 };

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

function world(lat: number, lon: number, zoom: number): [number, number] {
  const scale = TILE * 2 ** zoom;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale];
}

function unworld(x: number, y: number, zoom: number): Point {
  const scale = TILE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lon };
}

/** Position of a point on the map image, in logical pixels (0..MAP_W, 0..MAP_H). */
export function project(lat: number, lon: number, view: MapView): [number, number] {
  const [cx, cy] = world(view.lat, view.lon, view.zoom);
  const [x, y] = world(lat, lon, view.zoom);
  return [x - cx + MAP_W / 2, y - cy + MAP_H / 2];
}

const round = (n: number, d = 5) => Math.round(n * 10 ** d) / 10 ** d;

/** The closest view that shows every point (plus the office), like "fit to markers" in Google Maps. */
export function fitView(points: Point[], office: Point): MapView {
  const all = [...points, office];
  let zoom = MAX_ZOOM;
  for (; zoom > MIN_ZOOM; zoom--) {
    const px = all.map((p) => world(p.lat, p.lon, zoom));
    const w = Math.max(...px.map((p) => p[0])) - Math.min(...px.map((p) => p[0]));
    const h = Math.max(...px.map((p) => p[1])) - Math.min(...px.map((p) => p[1]));
    if (w <= MAP_W - 2 * PAD && h <= MAP_H - 2 * PAD) break;
  }
  const px = all.map((p) => world(p.lat, p.lon, zoom));
  const cx = (Math.max(...px.map((p) => p[0])) + Math.min(...px.map((p) => p[0]))) / 2;
  const cy = (Math.max(...px.map((p) => p[1])) + Math.min(...px.map((p) => p[1]))) / 2;
  const c = unworld(cx, cy, zoom);
  // Rounded so the same day keeps the same image URL (and cache entry) between refreshes.
  return { lat: round(c.lat, 4), lon: round(c.lon, 4), zoom };
}

export interface Tile {
  z: number;
  x: number;
  y: number;
  /** Top-left corner on the map, in map pixels. */
  left: number;
  top: number;
}

/** The OpenStreetMap tiles that cover the map for a view. */
export function tilesFor(view: MapView): Tile[] {
  const [cx, cy] = world(view.lat, view.lon, view.zoom);
  const x0 = cx - MAP_W / 2;
  const y0 = cy - MAP_H / 2;
  const tiles: Tile[] = [];
  for (let ty = Math.floor(y0 / TILE); ty * TILE < y0 + MAP_H; ty++) {
    for (let tx = Math.floor(x0 / TILE); tx * TILE < x0 + MAP_W; tx++) {
      tiles.push({ z: view.zoom, x: tx, y: ty, left: tx * TILE - x0, top: ty * TILE - y0 });
    }
  }
  return tiles;
}

export const TILE_SIZE = TILE;

/** True for tiles the board can ask for: zoom 8–14, inside Brevard (with a margin of one tile). */
export function isBoardTile(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger) || z < MIN_ZOOM || z > MAX_ZOOM) return false;
  const [xMin, yMin] = world(REGION.latMax, REGION.lonMin, z).map((v) => Math.floor(v / TILE) - 1);
  const [xMax, yMax] = world(REGION.latMin, REGION.lonMax, z).map((v) => Math.floor(v / TILE) + 1);
  return x >= xMin && x <= xMax && y >= yMin && y <= yMax;
}

/** The board's own URL for a tile. */
export function tilePath(t: { z: number; x: number; y: number }): string {
  return `/api/tiles/${t.z}/${t.x}/${t.y}`;
}

/** Upstream OpenStreetMap tile URL. */
export function osmTileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}
