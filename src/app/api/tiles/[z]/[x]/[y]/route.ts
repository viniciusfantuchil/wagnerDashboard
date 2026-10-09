import { isBoardTile, osmTileUrl } from "@/lib/geo/basemap";
import { safeText } from "@/lib/google/auth";

export const dynamic = "force-dynamic";

/** The OpenStreetMap tile usage policy asks for an identifying User-Agent. */
const USER_AGENT = "wagner-operations-board/1.0 (+https://github.com/viniciusfantuchil/wagnerDashboard)";
/** Tiles kept in memory (~15 KB each): enough for a few days of different map framings. */
const CACHE_SIZE = 400;
const cache = new Map<string, ArrayBuffer>();

/** One OpenStreetMap tile for the board map, fetched and cached by the server. Behind the access proxy. */
export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await params;
  const [zi, xi, yi] = [z, x, y].map(Number);
  if (![z, x, y].every((v) => /^\d+$/.test(v)) || !isBoardTile(zi, xi, yi)) {
    return Response.json({ error: "Tile outside the board map" }, { status: 400 });
  }

  const id = `${zi}/${xi}/${yi}`;
  let body = cache.get(id);
  if (body) {
    cache.delete(id); // keep recently used tiles at the end
    cache.set(id, body);
  } else {
    const res = await fetch(osmTileUrl(zi, xi, yi), { headers: { "User-Agent": USER_AGENT }, cache: "no-store" });
    if (!res.ok) {
      console.error(`OpenStreetMap tile ${id} failed: HTTP ${res.status} ${await safeText(res)}`);
      return Response.json({ error: "Tile unavailable" }, { status: 502 });
    }
    body = await res.arrayBuffer();
    cache.set(id, body);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return new Response(body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=604800" } });
}
