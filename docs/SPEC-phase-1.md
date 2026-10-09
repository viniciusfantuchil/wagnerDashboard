# Operations Board – Phase 1 Spec

Status: draft, 2026-10-09 · Owner: Vinicius Fantuchi Lopes (Operations Manager)

## 1. Goal

A wall display on the office TV that shows, at a glance and without anyone touching it:

- every job scheduled today, by crew, with its status;
- where each job is on a map of Brevard County;
- what needs attention now (missing deposit, stopped job, weather risk);
- whether the next workday's jobs are ready to start.

The visual reference is `prototype/index.html` (sample data). Phase 1 replaces the sample data with live data from Google Calendar and the National Weather Service. Layout, wording and colors follow the prototype unless this spec says otherwise.

## 2. Out of scope for Phase 1

- Markate integration (Phase 2: deposit and invoice status from the Markate API).
- Crews updating status from their phones (Phase 3).
- Commercial and capacity screens, screen rotation (Phase 4).
- Live crew GPS.
- Any dollar amount on the screen, per customer or aggregated.

## 3. Display requirements

- Fixed 1920×1080 stage, scaled to fit any 16:9 screen. **No scrolling, ever.**
- If content does not fit, shrink text down to a legible minimum (13 px at 1080p). With more than ~10 jobs in a day, show the first 10 by start time and a "+N more" row. Phase 4 will add a second screen.
- Refresh data every 5 minutes without reloading the page. Clock updates every 15 s.
- If a refresh fails, keep the last good data and show "Last updated N min ago". The label turns red after 15 minutes.
- Request a screen wake lock. Reload the page once a day at 4:00 AM to clear memory.
- Light theme by default on the TV. Dark theme supported through `prefers-color-scheme`.
- UI text in US English: 12-hour clock, "Fri, Oct 9", °F, mph.

## 4. Stack

| Concern | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript, deployed on Vercel |
| Styling | Plain CSS with the Wagner Pavers 2.0 tokens (copy them from the prototype `:root`) |
| Map | Mapbox GL JS or Leaflet with a commercial tile provider, styled close to the prototype |
| Calendar | Google Calendar API, read-only, via a Google Cloud service account |
| Weather | api.weather.gov (NWS), hourly forecast for Rockledge, FL |
| Geocoding | Mapbox or Google Geocoding API, results cached |
| Cache | A small key-value store (for example Upstash Redis from the Vercel Marketplace) for geocodes and the last good board payload |

All external calls run on the server. The browser only calls `GET /api/board`.

## 5. Architecture

```
TV browser ──GET /api/board (every 5 min)──▶ Next.js route
                                              ├─ sources/calendar.ts  (7 calendars → events)
                                              ├─ sources/weather.ts   (NWS hourly)
                                              ├─ parse/event.ts       (event → Job | Visit)
                                              ├─ geo/geocode.ts       (address → lat/lon, cached)
                                              ├─ rules/alerts.ts      (Job[] + weather → Alert[])
                                              └─ rules/readiness.ts   (next workday → ReadyRow[])
```

Keep each source behind an interface (`ScheduleSource`) so Phase 2/3 can swap Google Calendar for Markate work orders without touching the screen.

### Data model

```ts
type Status = "scheduled" | "in_progress" | "completed" | "issue" | "postponed";
type Check = "ok" | "missing" | "unknown";

interface Job {
  id: string;            // calendar event id
  crew: string;          // from the calendar name, e.g. "Crew 2 · Jorge"
  start: string; end: string;   // ISO, America/New_York
  customer: string;
  address: string; city: string; lat?: number; lon?: number;
  service: string;       // "Driveway", "Pool deck", "Sealing", ...
  size?: string;         // "420 sf", "65 lnft"
  day?: { n: number; of: number };
  status: Status;
  deposit: Check; permit: Check; material: Check; confirm48: Check;
  note?: string;
  parseWarnings: string[];
}

interface Visit { id: string; start: string; customer: string; city: string; lat?: number; lon?: number; service: string; }

interface Alert { severity: "danger" | "warning"; label: string; title: string; text: string; jobId?: string; }

interface Board { generatedAt: string; jobs: Job[]; visits: Visit[]; weather: HourlyRain[]; alerts: Alert[]; nextWorkday: { date: string; rows: Job[] }; }
```

## 6. Calendar convention (needs approval before go-live)

The board can only be as good as the calendar. Proposed convention for Diandra and Carlos:

| Field | Rule | Example |
|---|---|---|
| Title | `<Customer> – <Service> <size>` | `Hartley – Driveway 420 sf` |
| Estimate visits | Title starts with `EST –` (they live on the Excavation calendar) | `EST – Sorensen – Driveway` |
| Location | Full street address | `1234 Example Dr, Viera, FL 32940` |
| Description | One `Key: Value` per line | see below |
| Event color | Not read (the office uses colors to tell the crews apart) | |

Description keys (case-insensitive; missing key = `unknown`):

```
Status: SCHEDULED | IN PROGRESS | ISSUE | DONE | POSTPONED
Deposit: OK | PENDING
Permit: OK | PENDING | N/A
Material: OK | PENDING
Confirm48: SENT | PENDING
Day: 2/2
Note: free text shown on the board
```

Status comes from the `Status:` line (missing line = Scheduled). It was first proposed as the event color, but the calendars already use colors to identify the crews (Crew 1 orange, Excavation red, …), so a red Excavation event would have read as "Issue". Decided 2026-10-09.

| `Status:` | Board status |
|---|---|
| `SCHEDULED` (or no line) | Scheduled |
| `IN PROGRESS` / `STARTED` | In progress |
| `ISSUE` / `STOPPED` | Issue |
| `DONE` / `COMPLETED` | Completed |
| `POSTPONED` | Postponed |

Today the payment status is written as free text in event titles. The parser must tolerate old-style titles: show the event, set unknown fields to `unknown` and add a `parseWarnings` entry. Never guess a deposit as OK.

## 7. Alert rules

Order alerts with Deposit (D-003) first, then the other danger alerts, then warnings; within each group by start time. Show at most 6; the rest collapse into "+N more".

| Rule | Severity | Label |
|---|---|---|
| Job today or next workday with `deposit = missing` | danger | Deposit · cite D-003 (no start without written approval from Henrique or Lameck) |
| Job today with status `issue` | danger | Stopped (use the event `Note`) |
| Sealing or excavation today with ≥ 40% rain during the job window | warning | Weather |
| Next-workday job with `confirm48 = missing` | warning | Customer · cite D-007 |
| Next-workday job with `permit = missing` or `material = missing` | warning | Permit / Material |
| Event today or next workday with parse warnings (no address, unknown deposit) | warning | Calendar · "Fix the event so the board can read it" |

## 8. Security and privacy

- The board shows customer names and cities. It must not be public.
- Protect the whole app (Vercel deployment protection, or a middleware check of a long random token in a cookie set once on the TV).
- Show the city only, never the street address, on the screen. The address is used for geocoding on the server.
- Secrets (service account key, map token) live in Vercel environment variables. Never commit them.
- The service account gets access to the 7 calendars and nothing else. Reading the board uses the read-only scope. The control screen (`/control`, added 2026-10-09) needs "Make changes to events" on each calendar and uses the `calendar.events` scope, writing only the board's description lines.

## 9. Environment variables

```
GOOGLE_SERVICE_ACCOUNT_JSON=      # base64 of the key file
CALENDAR_IDS=                     # JSON map: {"Crew 1 · Fernando": "...@group.calendar.google.com", ...}
MAP_STYLE=                        # optional: "schematic" to use the drawn map instead of OpenStreetMap
KV_REST_API_URL= / KV_REST_API_TOKEN=
BOARD_ACCESS_TOKEN=
CONTROL_USERS=                    # JSON: /control logins, {"jorge": {"name": "Jorge", "password": "<hash from /control/password>", "crew": "Crew 2"}}
HQ_LAT= / HQ_LON=
```

## 10. Done criteria for Phase 1

- [ ] The board reads all 7 calendars and shows today's jobs and estimate visits correctly for 5 consecutive workdays, checked against the calendars by Diandra.
- [ ] Every job with an address appears on the map within 1 km of the real location.
- [ ] Status changes on the board within 5 minutes of changing the event's `Status:` line.
- [ ] Every alert rule in section 7 has a unit test with a sample event.
- [ ] The parser has unit tests for new-style and old-style titles.
- [ ] Nothing scrolls at 1920×1080 with 10 jobs, 6 visits and 6 alerts.
- [ ] Network loss for 30 minutes leaves the last data on screen with a red "Last updated" label, and the board recovers on its own.
- [ ] The app is not reachable without the access token.
- [ ] The README explains setup, environment variables and how to rotate the keys.

## 11. TV setup (for reference)

A mini PC or Raspberry Pi 5 running Chromium in kiosk mode, starting on boot, pointed at the board URL. Disable screen sleep in the OS and the TV.

## 12. Open items

- Approve the calendar convention (section 6) with Diandra and Carlos.
- ~~Decide the map provider~~ OpenStreetMap tiles through the board's server (decided 2026-10-09). No account needed; Google Maps was dropped because it requires a billing account.
- Request Markate API access (api@markate.com) for Phase 2.
- Confirm whether crews work Saturdays (affects "next workday").
