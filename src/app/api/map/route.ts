import { safeText } from "@/lib/google/auth";
import { mapImagePath, parseView, staticMapUrl } from "@/lib/geo/staticMap";

export const dynamic = "force-dynamic";

/** Recent basemap images, so a refresh every 5 minutes does not call Google again. */
const cache = new Map<string, { body: ArrayBuffer; type: string }>();
const CACHE_SIZE = 20;

/** Google Maps basemap for the board. The API key stays on the server; the access proxy protects this route. */
export async function GET(request: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return Response.json({ error: "Map not configured" }, { status: 404 });

  const view = parseView(new URL(request.url).searchParams);
  if (!view) return Response.json({ error: "Bad map view" }, { status: 400 });

  const id = mapImagePath(view);
  let image = cache.get(id);
  if (!image) {
    const res = await fetch(staticMapUrl(view, key), { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) {
      // Google answers errors (bad key, API not enabled, billing) as text; log it, never the key.
      console.error(`Google Static Maps failed: HTTP ${res.status} ${await safeText(res)}`);
      return Response.json({ error: "Map unavailable" }, { status: 502 });
    }
    image = { body: await res.arrayBuffer(), type };
    cache.set(id, image);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }
  return new Response(image.body, {
    headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=86400" },
  });
}
