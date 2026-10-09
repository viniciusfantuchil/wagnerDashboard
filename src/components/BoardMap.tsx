// Schematic Brevard County map from the prototype. Kept until the map provider is decided (spec §12).

import { crewColor } from "@/lib/crews";
import { MAP_H, MAP_W, project, TILE_SIZE, tilePath, tilesFor } from "@/lib/geo/basemap";
import type { Board, BoardJob, BoardVisit } from "@/lib/types";
import { statusKey } from "./status";

type LatLon = [number, number];

const B = { latMax: 28.66, latMin: 27.94, lonMin: -80.92, lonMax: -80.48, W: 538, H: 1000 };
const P = (lat: number, lon: number): [number, number] => [
  ((lon - B.lonMin) / (B.lonMax - B.lonMin)) * B.W,
  ((B.latMax - lat) / (B.latMax - B.latMin)) * B.H,
];
const seg = (pts: LatLon[]) =>
  pts.map((p, i) => (i ? "L" : "M") + P(p[0], p[1]).map((v) => v.toFixed(1)).join(",")).join("");

const coast: LatLon[] = [[28.66, -80.58], [28.55, -80.56], [28.47, -80.53], [28.42, -80.56], [28.36, -80.59], [28.3, -80.595], [28.2, -80.585], [28.12, -80.57], [28.05, -80.55], [27.94, -80.51]];
const mainland: LatLon[] = [[28.66, -80.8], [28.6, -80.805], [28.52, -80.78], [28.45, -80.76], [28.39, -80.735], [28.34, -80.715], [28.28, -80.705], [28.22, -80.68], [28.15, -80.645], [28.09, -80.61], [28.03, -80.585], [27.94, -80.55]];
const irEast: LatLon[] = [[28.66, -80.75], [28.55, -80.73], [28.45, -80.7], [28.39, -80.7], [28.34, -80.69], [28.28, -80.66], [28.22, -80.625], [28.15, -80.605], [28.09, -80.59], [28.03, -80.57], [27.94, -80.53]];
const merrittEast: LatLon[] = [[28.45, -80.65], [28.38, -80.645], [28.3, -80.635], [28.25, -80.648]];
const barrierWest: LatLon[] = [[28.45, -80.59], [28.38, -80.615], [28.3, -80.622], [28.25, -80.63]];
const i95: LatLon[] = [[28.66, -80.86], [28.5, -80.82], [28.38, -80.78], [28.25, -80.745], [28.12, -80.71], [28.02, -80.68], [27.94, -80.65]];
const cities: [string, number, number][] = [["Titusville", 28.612, -80.87], ["Cocoa", 28.386, -80.79], ["Merritt Is.", 28.42, -80.69], ["Cocoa Beach", 28.345, -80.598], ["Viera", 28.265, -80.79], ["Satellite Bch", 28.19, -80.592], ["Melbourne", 28.115, -80.67], ["Palm Bay", 28.0, -80.7]];

const HQ: LatLon = [28.35, -80.748];

const placed = <T extends { lat?: number; lon?: number }>(items: T[]) =>
  items.filter((i): i is T & { lat: number; lon: number } => i.lat !== undefined && i.lon !== undefined);

/** A ring in the crew's calendar color around the status-colored pin. */
function CrewRing({ crew, x, y, r }: { crew: string; x: number; y: number; r: number }) {
  const color = crewColor(crew);
  return color ? <circle className="crew-ring" cx={x} cy={y} r={r} style={{ fill: color }} /> : null;
}

const MIN_GAP = 26; // px in map units; pins closer than this are fanned out
const FAN_RADIUS = 24;

/** Map positions, with pins that would overlap (e.g. several jobs at one city center) fanned out around it. */
export function spread(points: [number, number][], minGap = MIN_GAP, fanRadius = FAN_RADIUS): [number, number][] {
  const out: [number, number][] = [];
  const crowd = new Map<number, number>(); // index of the first pin at a spot → pins already fanned around it
  points.forEach(([x, y]) => {
    const anchor = out.findIndex(([ox, oy]) => Math.hypot(ox - x, oy - y) < minGap);
    if (anchor === -1) {
      out.push([x, y]);
      return;
    }
    const n = (crowd.get(anchor) ?? 0) + 1;
    crowd.set(anchor, n);
    const angle = (n - 1) * (Math.PI / 3) - Math.PI / 2;
    const ring = fanRadius * (1 + Math.floor((n - 1) / 6));
    out.push([out[anchor][0] + ring * Math.cos(angle), out[anchor][1] + ring * Math.sin(angle)]);
  });
  return out;
}

export function BoardMap({ jobs, visits }: { jobs: BoardJob[]; visits: BoardVisit[] }) {
  const [ix, iy] = P(28.45, -80.835);
  const [ox, oy] = P(28.25, -80.535);
  const [hx, hy] = P(...HQ);
  const shownVisits = placed(visits);
  const shownJobs = placed(jobs);
  const at = spread([...shownVisits, ...shownJobs].map((i) => P(i.lat, i.lon)));
  return (
    <svg id="map" viewBox="0 0 538 1000" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Schematic map of Brevard County with today's jobs and estimate visits">
      <path className="water" d={`${seg([...coast, [27.94, -80.48], [28.66, -80.48]])}Z`} />
      <path className="water" d={`${seg([...mainland, ...irEast.slice().reverse()])}Z`} />
      <path className="water" d={`${seg([...merrittEast, ...barrierWest.slice().reverse()])}Z`} />
      <path className="road" d={seg(i95)} />
      <text className="road-label" x={ix} y={iy}>I-95</text>
      <text className="road-label" x={ox} y={oy} style={{ letterSpacing: ".2em" }}>ATLANTIC</text>
      {cities.map(([n, la, lo]) => {
        const [x, y] = P(la, lo);
        return <text key={n} className="city" x={x} y={y} textAnchor="middle">{n}</text>;
      })}
      <g className="hq">
        <rect x={hx - 17} y={hy - 11} width={34} height={22} rx={3} />
        <text x={hx} y={hy}>HQ</text>
      </g>
      {shownVisits.map((v, i) => {
        const [x, y] = at[i];
        return (
          <g key={v.id} className={`visit${v.approx ? " approx" : ""}`}>
            <rect x={x - 12} y={y - 12} width={24} height={24} transform={`rotate(45 ${x} ${y})`} />
            <text x={x} y={y}>{v.key}</text>
          </g>
        );
      })}
      {shownJobs.map((j, i) => {
        const [x, y] = at[shownVisits.length + i];
        return (
          <g key={j.id} className={`pin s-${statusKey(j.status)}${j.approx ? " approx" : ""}`}>
            <CrewRing crew={j.crew} x={x} y={y} r={19.5} />
            <circle cx={x} cy={y} r={15} />
            <text x={x} y={y}>{j.pin}</text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * OpenStreetMap basemap (tiles served by /api/tiles) with the board's own pins on top, in the tiles' projection.
 * Pins keep the status colors and numbers of the schematic map.
 */
export function TileBoardMap({ map, jobs, visits }: { map: NonNullable<Board["map"]>; jobs: BoardJob[]; visits: BoardVisit[] }) {
  const shownVisits = placed(visits);
  const shownJobs = placed(jobs);
  const at = spread([...shownVisits, ...shownJobs].map((i) => project(i.lat, i.lon, map)), 16, 15);
  const [hx, hy] = project(map.office.lat, map.office.lon, map);
  return (
    <svg
      id="map"
      className="gmap"
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Map of Brevard County with today's jobs and estimate visits"
    >
      {tilesFor(map).map((t) => (
        <image key={tilePath(t)} href={tilePath(t)} x={t.left} y={t.top} width={TILE_SIZE} height={TILE_SIZE} />
      ))}
      <g className="hq">
        <rect x={hx - 11} y={hy - 7} width={22} height={14} rx={2} />
        <text x={hx} y={hy}>HQ</text>
      </g>
      {shownVisits.map((v, i) => {
        const [x, y] = at[i];
        return (
          <g key={v.id} className={`visit${v.approx ? " approx" : ""}`}>
            <rect x={x - 8} y={y - 8} width={16} height={16} transform={`rotate(45 ${x} ${y})`} />
            <text x={x} y={y}>{v.key}</text>
          </g>
        );
      })}
      {shownJobs.map((j, i) => {
        const [x, y] = at[shownVisits.length + i];
        return (
          <g key={j.id} className={`pin s-${statusKey(j.status)}${j.approx ? " approx" : ""}`}>
            <CrewRing crew={j.crew} x={x} y={y} r={12.5} />
            <circle cx={x} cy={y} r={9.5} />
            <text x={x} y={y}>{j.pin}</text>
          </g>
        );
      })}
      <text className="attribution" x={MAP_W - 3} y={MAP_H - 3} textAnchor="end">
        © OpenStreetMap contributors
      </text>
    </svg>
  );
}
