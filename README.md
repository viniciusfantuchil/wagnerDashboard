# Wagner Pavers – Operations Board

Wall display for the office TV: today's jobs by crew, a map of Brevard County, job status, alerts and next-day readiness.

## Status

Phase 1 in progress. The Next.js app renders the board from the prototype's sample data behind the `ScheduleSource` and `WeatherSource` interfaces; Google Calendar and NWS sources come next.

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
| `src/lib/parse/event.ts` | Google Calendar event → `Job` or `Visit`, per the calendar convention (spec §6) |
| `src/lib/rules/alerts.ts` | Alert rules (spec §7) |
| `src/lib/rules/readiness.ts` | Next workday and ready-check rows |
| `src/components/` | Screen components; styles in `src/app/globals.css` are copied from the prototype |

## Roadmap

| Phase | Delivers | Data source |
|---|---|---|
| 1 | Today screen: map, jobs by crew, status by event color, weather, basic alerts | Google Calendar, NWS |
| 2 | Deposit and invoice status, readiness from real data | + Markate API |
| 3 | Crews update status from their phones; work orders as the source | Markate |
| 4 | Commercial and capacity screens, screen rotation | Markate + history |

## Owner

Vinicius Fantuchi Lopes, Operations Manager. This repository belongs to Wagner Paver Contractors Inc.
