# Wagner Pavers – Operations Board

Wall display for the office TV: today's jobs by crew, a map of Brevard County, job status, alerts and next-day readiness.

## Status

Phase 1 in progress. The board reads the crew schedule from Google Calendar when it is configured (below), and falls back to the prototype's sample data otherwise. Weather is still sample data until the NWS source lands.

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
| `src/lib/google/auth.ts` | Service account access tokens (no Google SDK) |
| `src/lib/parse/event.ts` | Google Calendar event → `Job` or `Visit`, per the calendar convention (spec §6) |
| `src/lib/rules/alerts.ts` | Alert rules (spec §7) |
| `src/lib/rules/readiness.ts` | Next workday and ready-check rows |
| `src/components/` | Screen components; styles in `src/app/globals.css` are copied from the prototype |

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
