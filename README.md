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

## Control screen (update job status)

`/control` is a screen for phones and computers where the office and the crew leads update jobs. Each change is written to the job's Google Calendar event, so the calendar stays the single source and the TV updates within 5 minutes.

| Role | Can change |
|---|---|
| Admin | Everything an office user can, plus adding, changing and removing users at `/control/users` |
| Office | Status, Deposit, Permit, Material, 48-hour confirmation and Note, on every crew's jobs |
| Crew lead | Status and Note, on their own crew's jobs |

**Cards.** Each job is a short card: crew, time, customer and city, service, and chips for status and (office) Deposit, Permit, Material and 48-h confirmation. A chip always says its state in words (`Deposit ✓`, `Deposit ?`, `Deposit pending`); an unknown deposit is never shown as OK (D-003). One button does the usual next step (**Start**, **Done** or **Resume**); **Issue** asks why, with one-tap reasons, and saves the status and note together. Tapping the card opens the full editor. After every save a message offers **Undo** for a few seconds.

**Needs attention.** Above the cards, one chip per open item for today and the next workday, like the TV alerts: stopped jobs, deposit pending (or unknown), and for the next workday 48-h confirmation, material and permit pending. Crew leads see only stopped jobs. Tapping a chip shows just those jobs.

**Search.** The search bar finds jobs by customer, city, service, crew or note (every word must match; accents and case don't matter). It looks at the next 180 days by default, or the past 180 days, or both. Filters narrow the list by crew, status or a readiness item that is still pending (office only; an unknown deposit counts as pending, D-003). Each result is the same card, so a job can be updated from the search. On a computer, `/` jumps to the search bar and the cards sit side by side. Crew leads see only their own crew's jobs.

**Sign-in.** People sign in at `https://<board url>/control` with a username and password.
- A device stays signed in for 30 days. **Sign out** ends the session and asks the browser to clear the site's cache and storage.
- **Lockout:** after 5 wrong passwords, that username (and that network address) waits 15 minutes.

**Nothing secret in the browser or in caches:**
- Passwords are typed only into the sign-in and Users forms, sent once over HTTPS, and stored only as PBKDF2 hashes (600,000 iterations). They are never shown, logged or sent back. Forms ask the browser not to save what is typed.
- The session is an httpOnly cookie that scripts can't read. It is signed with the user's password hash, so a new password or a removed user signs that person out at once.
- No code or password is ever put in a page address.
- Every page and API response with people's data or a session is sent with `Cache-Control: no-store`. Only the public OpenStreetMap tiles and the logo are cacheable.

**What gets written.** Only the board's description lines change: `Status:`, `Deposit:`, `Permit:`, `Material:`, `Confirm48:` and `Note:`.

- Every save adds an `Updated: <name> · <date, time>` line.
- The title, time, location and every other line stay as they are.
- If someone edited the event in Google Calendar since the screen loaded it, the save is refused (no overwrite) and the person reloads.

**Setup**

1. **Users sheet (free):** the users live in a private Google Sheet of the Wagner account, read and written by the same service account as the calendars. No paid database.
   - In the Google Cloud project of the service account, open **APIs & Services → Library**, search **Google Sheets API** and click **Enable**.
   - In the Wagner Google account, create a blank Google Sheet named `Board users`. Leave it empty; the board writes the header row.
   - **Share** it with the service account's email (the same one the calendars are shared with) as **Editor**. Share it with no one else who should not manage logins.
   - Copy the sheet ID from its address (`https://docs.google.com/spreadsheets/d/<sheet ID>/edit`) and add it in Vercel as `USERS_SHEET_ID`.
   - Each row is one user: username, name, role, crew, password **hash** (never the password), and who created or changed it. Manage users on `/control/users`, not in the sheet. Deleting a row in the sheet removes that login.
2. **Calendar access:** in each crew calendar's **Settings and sharing**, change the board's service account from "See all event details" to **"Make changes to events"**. The board asks Google only for the `calendar.events` scope, for this screen.
3. Redeploy.
4. **First admin:** on a computer that already shows the TV board, open `https://<board url>/control/setup` and create your admin username and password.
   - This page works only while no admin exists.
   - It works only on a device that has the board's access.
5. **Everyone else:** sign in at `/control`, open **Users**, and add each person with a username, name, role (crew leads also pick their crew) and a first password. Give them their username and password in person.

**To reset a password,** use **Set new password** on `/control/users`. **To remove someone,** use **Remove**. Either takes effect at once.

*Optional:* users can also be set in the `CONTROL_USERS` variable, keyed by username with a PBKDF2 password hash (`{"vinicius": {"name": "Vinicius", "password": "pbkdf2$600000$…", "admin": true}}`). Such users are read-only on `/control/users`.

## Access control

The board shows customer names, so the whole app is private (spec §8). Every page, API route and asset needs `BOARD_ACCESS_TOKEN`:

1. Generate an access code (at least 24 characters). PowerShell: `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) -replace '\+','-' -replace '/','_' -replace '=',''`.
2. Set it as `BOARD_ACCESS_TOKEN` in Vercel (Production and Preview) and redeploy.
3. On the TV, open the board. It goes to `https://<board url>/login`. Type the code once. The board stores an httpOnly cookie (a hash of the code, valid 400 days). The code is never put in the address, so it does not end up in the browser history.

Without the cookie, pages go to `/login` and APIs answer 401. In production, a missing or short code blocks everything (503) rather than leaving the board open. Locally, without a code, the app stays open.

To rotate: set a new code, redeploy, and type it again at `/login` on each screen. The old cookies stop working immediately.

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
