# Wagner Pavers – Operations Board

Wall display for the office TV: today's jobs by crew, a map of Brevard County, job status, alerts and next-day readiness.

## Status

Phase 1 in progress. The board reads the crew schedule from Google Calendar when it is configured (below), with the live National Weather Service forecast for Rockledge. Without Google credentials it falls back to the prototype's sample schedule and sample weather.

- Visual prototype (sample data): open `prototype/index.html` in a browser.
- Phase 1 spec: [`docs/SPEC-phase-1.md`](docs/SPEC-phase-1.md)
- Context for Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Development

Requires Node 20 or later.

```sh
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (event parser, alert rules, readiness)
npm run typecheck
npm run build
```

| Path | What it is |
|---|---|
| `src/app/page.tsx` | The board (server-rendered, then refreshed from `/api/board` every 5 min) |
| `src/app/api/board/route.ts` | `GET /api/board`: the only endpoint the browser calls |
| `src/lib/board.ts` | Builds the `Board` payload from the sources and rules |
| `src/lib/sources/` | `ScheduleSource` / `WeatherSource` interfaces and the sample implementation |
| `src/lib/sources/calendar.ts` | `GoogleCalendarSource`: reads each crew calendar with the service account |
| `src/lib/sources/weather.ts` | `NwsWeatherSource`: hourly forecast from api.weather.gov (no key needed) |
| `src/lib/geo/basemap.ts`, `src/app/api/tiles/` | OpenStreetMap basemap: framing, projection, server-side tile route |
| `src/lib/geo/geocode.ts` | Address → map position (US Census geocoder for now; city center as fallback) |
| `src/lib/google/auth.ts` | Service account access tokens (no Google SDK) |
| `src/proxy.ts`, `src/lib/access.ts` | Access control: every page and API route needs `BOARD_ACCESS_TOKEN` |
| `src/lib/parse/event.ts` | Google Calendar event → `Job` or `Visit`, per the calendar convention (spec §6) |
| `src/lib/rules/alerts.ts` | Alert rules (spec §7) |
| `src/lib/rules/readiness.ts` | Next workday and ready-check rows |
| `src/components/` | Screen components; styles in `src/app/globals.css` are copied from the prototype |

## Map

The live board draws an **OpenStreetMap** basemap, framed to fit today's jobs, visits and the office. The board's own numbered, status-colored pins are drawn on top. No account, key or payment is needed.

- **Tiles go through the board's server** (`GET /api/tiles/z/x/y`, behind the access token). The browser only talks to the board, and OpenStreetMap sees one identified, cached client, as its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) asks.
- **Tile limits:** only tiles around Brevard are served, so the route cannot be used as an open tile proxy.
- **Caching:** tiles are cached in memory, and the browser keeps them for 7 days.
- **Attribution:** "© OpenStreetMap contributors" stays visible on the map. The policy requires it.
- **Sample data** keeps the prototype's schematic map. Set `MAP_STYLE=osm` to preview OpenStreetMap locally, or `MAP_STYLE=schematic` to turn it off on the live board.

## Map positions

Job and visit addresses are placed on the map on the server, with the free **US Census Bureau geocoder** (no key). The spec leaves the provider open (Mapbox or Google, §12). The geocoder sits behind the `Geocoder` interface, so it can be swapped once an account exists.

- When the street address is found, the pin is exact.
- When the event has no street address, or the geocoder cannot find it, the pin goes to the city center with a dashed outline ("Approx. location").
- Lookups are cached in memory per server instance. A persistent cache (spec §4, KV) is still to do.
- Street addresses are sent to the Census geocoder only. They never reach the browser.

## Access control

The board shows customer names, so the whole app is private (spec §8). Every page, API route and asset needs `BOARD_ACCESS_TOKEN`:

1. Generate a token (at least 24 characters): `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`.
2. Set it as `BOARD_ACCESS_TOKEN` in Vercel (Production and Preview) and redeploy.
3. On the TV, open `https://<board url>/?key=<token>` once. The board stores a cookie (a hash of the token, valid 400 days) and redirects to the clean URL, so the token does not stay in the address bar.

Without the cookie, pages answer "Access denied" (401). In production, a missing or short token blocks everything (503) rather than leaving the board open. Locally, without a token, the app stays open.

To rotate: set a new token, redeploy, and open the `?key=` link again on each screen. The old cookies stop working immediately.

## Google Calendar setup

The board reads the crew calendars with a Google Cloud **service account** that has read-only access to them. Do this once, signed in with the company's Google account (the one that owns the crew calendars), not a personal account.

### 1. Create the service account

1. Open [console.cloud.google.com](https://console.cloud.google.com) and create a project, e.g. `wagner-operations-board`.
2. **APIs & Services → Library**: enable **Google Calendar API**.
3. **IAM & Admin → Service Accounts → Create service account**, e.g. `operations-board`. Grant it no project roles.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. Treat it like a password: do not email it, do not commit it.

If the organization blocks key creation (policy `iam.disableServiceAccountKeyCreation`), a Google Workspace admin has to allow it for this project.

### 2. Share the calendars with it

For each crew calendar (Crew 1 Fernando, Crew 2 Jorge, Crew 3 Darwin, Crew 4 Jhonny, Felipe, Excavation, Sealing):

1. Google Calendar → the calendar's **Settings and sharing**.
2. **Share with specific people → Add people**: the service account email (`operations-board@<project>.iam.gserviceaccount.com`), permission **See all event details**.
3. Under **Integrate calendar**, copy the **Calendar ID**.

The service account gets read-only access to these calendars and nothing else (spec §8).

If the company uses Google Workspace and the sharing option only offers "See only free/busy", a Workspace admin has to allow sharing calendar details outside the domain (Admin console → Apps → Google Workspace → Calendar → Sharing settings). The service account counts as an outside address.

### 3. Set the environment variables in Vercel

Project → **Settings → Environment Variables** (Production and Preview):

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Base64 of the key file: `base64 -w0 key.json` (macOS: `base64 -i key.json`). The raw JSON also works. |
| `CALENDAR_IDS` | JSON map of calendar name → Calendar ID, see `.env.example`. The name is what the board shows as the crew, e.g. `"Crew 2 · Jorge"`. |

Redeploy. The footer then reads "Schedule: Google Calendar". If a calendar cannot be read, `/api/board` returns 502, the server log names the calendar, and the screen keeps its last good data.

For local development, copy `.env.example` to `.env.local` and fill in the same values.

### Rotating the key

1. Service account → **Keys → Add key** to create a new JSON key.
2. Update `GOOGLE_SERVICE_ACCOUNT_JSON` in Vercel and redeploy.
3. Check the board shows "Schedule: Google Calendar" and today's jobs.
4. Delete the old key under **Keys**.

Rotate when someone with access to the key leaves, and at least once a year. To cut access immediately, delete the key or disable the service account.

## Roadmap

| Phase | Delivers | Data source |
|---|---|---|
| 1 | Today screen: map, jobs by crew, status by event color, weather, basic alerts | Google Calendar, NWS |
| 2 | Deposit and invoice status, readiness from real data | + Markate API |
| 3 | Crews update status from their phones; work orders as the source | Markate |
| 4 | Commercial and capacity screens, screen rotation | Markate + history |

## Owner

Vinicius Fantuchi Lopes, Operations Manager. This repository belongs to Wagner Paver Contractors Inc.
