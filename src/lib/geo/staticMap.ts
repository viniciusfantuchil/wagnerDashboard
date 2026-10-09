// Google Maps Static API basemap for the board map, with our own pins drawn on top.
// The image is fetched by the server (GET /api/map), so the API key never reaches the browser (spec §4, §8).
// Pin positions use the same Web Mercator projection as the image.

import type { Point } from "./geocode";

/** Map image size in Google "logical" pixels. Requested at scale=2, shown at ~506×753 on the 1920×1080 stage. */
export const MAP_W = 404;
export const MAP_H = 600;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 14;
/** Room kept around the outermost pins so they are not cut off at the edge. */
const PAD = 36;
const TILE = 256;

/** Brevard County and surroundings; requests outside this box are refused by /api/map. */
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

/** Validates /api/map query parameters; null if they are not a view the board would ask for. */
export function parseView(params: URLSearchParams): MapView | null {
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const zoom = Number(params.get("z"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isInteger(zoom)) return null;
  if (lat < REGION.latMin || lat > REGION.latMax || lon < REGION.lonMin || lon > REGION.lonMax) return null;
  if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;
  return { lat: round(lat, 4), lon: round(lon, 4), zoom };
}

/** The board's own URL for the basemap image. */
export function mapImagePath(view: MapView): string {
  return `/api/map?lat=${view.lat}&lon=${view.lon}&z=${view.zoom}`;
}

/** Google Maps Static API URL. Points of interest and transit are hidden to keep the map calm on a TV. */
export function staticMapUrl(view: MapView, key: string): string {
  const params = new URLSearchParams({
    center: `${view.lat},${view.lon}`,
    zoom: String(view.zoom),
    size: `${MAP_W}x${MAP_H}`,
    scale: "2",
    maptype: "roadmap",
    key,
  });
  params.append("style", "feature:poi|visibility:off");
  params.append("style", "feature:transit|visibility:off");
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}
