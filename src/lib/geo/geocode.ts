// Address → map position, on the server only. Spec §4 leaves the provider open (Mapbox or Google, §12);
// until it is chosen this uses the US Census Bureau geocoder, which is free and needs no key.
// Anything it cannot place falls back to the city's center and is marked approximate.

import { safeText } from "@/lib/google/auth";

export interface Point {
  lat: number;
  lon: number;
}

export interface Located extends Point {
  approx: boolean; // true = city center, not the street address
}

export interface Geocoder {
  readonly label: string;
  /** Null when the address cannot be placed. Throws on service errors. */
  geocode(address: string): Promise<Point | null>;
}

const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const TIMEOUT_MS = 5_000;
const CONCURRENCY = 6;
/** Successful lookups are kept for the life of the server instance; misses are retried after an hour. */
const MISS_TTL_MS = 60 * 60_000;

/** Approximate centers of the places the crews work in, for jobs without a usable street address. */
export const CITY_CENTERS: Record<string, Point> = {
  Titusville: { lat: 28.6122, lon: -80.8076 },
  Mims: { lat: 28.665, lon: -80.8448 },
  "Port St. John": { lat: 28.4769, lon: -80.7887 },
  Cocoa: { lat: 28.3861, lon: -80.742 },
  Rockledge: { lat: 28.3506, lon: -80.7253 },
  "Merritt Island": { lat: 28.3584, lon: -80.6823 },
  "Cape Canaveral": { lat: 28.4058, lon: -80.6048 },
  "Cocoa Beach": { lat: 28.32, lon: -80.6076 },
  Viera: { lat: 28.2539, lon: -80.737 },
  Suntree: { lat: 28.2386, lon: -80.7031 },
  "Palm Shores": { lat: 28.1883, lon: -80.6609 },
  "Satellite Beach": { lat: 28.1761, lon: -80.5901 },
  "Indian Harbour Beach": { lat: 28.1489, lon: -80.5884 },
  Melbourne: { lat: 28.0836, lon: -80.6081 },
  "Melbourne Village": { lat: 28.0844, lon: -80.6631 },
  "West Melbourne": { lat: 28.0717, lon: -80.6534 },
  Indialantic: { lat: 28.0897, lon: -80.5656 },
  "Melbourne Beach": { lat: 28.0681, lon: -80.5603 },
  "Palm Bay": { lat: 28.034, lon: -80.589 },
  Malabar: { lat: 27.9969, lon: -80.5656 },
  "Grant-Valkaria": { lat: 27.9408, lon: -80.5481 },
};

export function cityCenter(city: string): Point | null {
  const key = Object.keys(CITY_CENTERS).find((c) => c.toLowerCase() === city.trim().toLowerCase());
  return key ? CITY_CENTERS[key] : null;
}

export class CensusGeocoder implements Geocoder {
  readonly label = "US Census geocoder";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async geocode(address: string): Promise<Point | null> {
    const params = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
    const res = await this.fetchImpl(`${CENSUS}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`Census geocoder: HTTP ${res.status} ${await safeText(res)}`);
    const body = (await res.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } };
    const match = body.result?.addressMatches?.[0];
    return match ? { lat: match.coordinates.y, lon: match.coordinates.x } : null;
  }
}

/** Wraps a geocoder with an in-memory cache. */
export class CachedGeocoder implements Geocoder {
  private readonly hits = new Map<string, Point>();
  private readonly misses = new Map<string, number>();

  constructor(
    private readonly inner: Geocoder,
    private readonly clock: () => number = Date.now,
  ) {}

  get label() {
    return this.inner.label;
  }

  async geocode(address: string): Promise<Point | null> {
    const key = address.trim().toLowerCase();
    const hit = this.hits.get(key);
    if (hit) return hit;
    const missedAt = this.misses.get(key);
    if (missedAt !== undefined && this.clock() - missedAt < MISS_TTL_MS) return null;

    const point = await this.inner.geocode(address);
    if (point) this.hits.set(key, point);
    else this.misses.set(key, this.clock());
    return point;
  }
}

/**
 * Places each item: the street address when the geocoder finds it, else the city center (approx),
 * else nothing. Geocoder errors never fail the board.
 */
export async function locateAll<T extends { address?: string; city: string }>(
  items: T[],
  geocoder: Geocoder,
): Promise<(Located | null)[]> {
  const out: (Located | null)[] = new Array(items.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const { address, city } = items[i];
      let point: Point | null = null;
      if (address && /^\d+\s+\S/.test(address.trim())) {
        try {
          point = await geocoder.geocode(address);
        } catch (err) {
          console.error("Geocoding failed:", err instanceof Error ? err.message : err);
        }
      }
      if (point) out[i] = { ...point, approx: false };
      else {
        const center = cityCenter(city);
        out[i] = center ? { ...center, approx: true } : null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}
