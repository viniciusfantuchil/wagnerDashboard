# Wagner Pavers – Operations Board

Office TV wall display for Wagner Paver Contractors Inc. (Rockledge, FL), a residential paver and hardscape company in Brevard County. It shows today's jobs by crew, a map, job status, alerts and next-day readiness.

## Read first

- `docs/SPEC-phase-1.md`: scope, data model, calendar convention, alert rules, done criteria.
- `docs/CALENDAR-GUIDE.md`: one-page guide for the office on how to fill in calendar events.
- `prototype/index.html`: the approved visual reference with sample data. Match its layout, wording and design tokens.

## People and data

- Crews (one Google Calendar each): Crew 1 Fernando, Crew 2 Jorge, Crew 3 Darwin, Crew 4 Jhonny, Felipe (occasional), Excavation (Bira; estimate visits also live here), Sealing (Jardel), plus a general calendar.
- Kevin is the field estimator. Diandra runs the office and maintains the calendars.
- Markate is the system of record for customers, estimates, work orders, invoices and payments (API integration is Phase 2). Google Calendar is the crew schedule until a migration to Markate is decided.

## Business rules the board enforces

- D-003: a 50% deposit is required before ordering material and before starting any job. Exceptions need written approval from Henrique or Lameck. Missing deposit is always a red alert. Never treat an unknown deposit as OK.
- D-007: the office (Diandra) sends routine customer messages, including the 7-day and 48-hour confirmations. A missing 48-hour confirmation for the next workday is an alert.

## Rules for this codebase

- Never commit secrets. All keys come from environment variables (see the spec).
- The screen is a fixed 1920×1080 stage scaled to the viewport. Nothing may scroll.
- Show city only on screen, never street addresses, and no dollar amounts.
- UI text is US English (12-hour clock, °F). Code, comments and docs in English.
- Use the Wagner Pavers 2.0 design tokens from the prototype `:root`. Status colors: in progress = warning, scheduled = navy, completed = success, issue = red, postponed = muted. Always show the status word, never color alone. Crew colors (`src/lib/crews.ts`, matching the crews' Google calendar colors) appear only as a card stripe, a dot by the crew name and a ring around the map pin; status keeps the pin and number fill.
- Keep data sources behind interfaces so Google Calendar can be replaced by Markate later. The control screen (`/control`) writes through `ScheduleWriter`; it changes only the board's description lines, and only the office may change Deposit (D-003).
- Every alert rule and the event parser need unit tests.
