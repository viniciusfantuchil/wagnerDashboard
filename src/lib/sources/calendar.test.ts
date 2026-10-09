import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildBoard } from "@/lib/board";
import { CALENDAR_READONLY, parseServiceAccount, ServiceAccountAuth, signAssertion } from "@/lib/google/auth";
import type { CalendarEvent } from "@/lib/parse/event";
import { GoogleCalendarSource, parseCalendarIds } from "./calendar";
import { getSources } from "./index";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_FILE = {
  type: "service_account",
  client_email: "board@wagner-ops.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};
const KEY_B64 = Buffer.from(JSON.stringify(KEY_FILE)).toString("base64");

const CALENDARS = { "Crew 2 · Jorge": "crew2@group.calendar.google.com", "Excavation · Bira": "exc@group.calendar.google.com" };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function ev(id: string, summary: string, over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    summary,
    location: "1234 Example Dr, Viera, FL 32940",
    description: "Deposit: OK\nPermit: OK\nMaterial: OK\nConfirm48: SENT",
    start: { dateTime: "2026-10-09T07:00:00-04:00" },
    end: { dateTime: "2026-10-09T16:00:00-04:00" },
    ...over,
  };
}

/** A fake Google: token endpoint plus events.list per calendar id. */
function fakeGoogle(byCalendar: Record<string, CalendarEvent[][]>, opts: { failCalendar?: string } = {}) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.hostname === "oauth2.googleapis.com") return json({ access_token: "tok-1", expires_in: 3600 });
    const id = decodeURIComponent(url.pathname.split("/")[4]);
    if (id === opts.failCalendar) return json({ error: { message: "Not Found" } }, 404);
    const pages = byCalendar[id] ?? [[]];
    const page = Number(url.searchParams.get("pageToken") ?? 0);
    return json({ items: pages[page], nextPageToken: page + 1 < pages.length ? String(page + 1) : undefined });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function source(google: ReturnType<typeof fakeGoogle>) {
  const auth = new ServiceAccountAuth(parseServiceAccount(KEY_B64), CALENDAR_READONLY, google.fetchImpl);
  return new GoogleCalendarSource(CALENDARS, auth, google.fetchImpl);
}

describe("service account auth", () => {
  it("reads the key as base64 or raw JSON", () => {
    expect(parseServiceAccount(KEY_B64).client_email).toBe(KEY_FILE.client_email);
    expect(parseServiceAccount(JSON.stringify(KEY_FILE)).client_email).toBe(KEY_FILE.client_email);
  });

  it("rejects a key without client_email or private_key", () => {
    expect(() => parseServiceAccount(JSON.stringify({ client_email: "x" }))).toThrow(/missing client_email or private_key/);
    expect(() => parseServiceAccount("not a key")).toThrow(/not valid JSON/);
  });

  it("signs a read-only calendar assertion that verifies with the public key", () => {
    const jwt = signAssertion(parseServiceAccount(KEY_B64), CALENDAR_READONLY, 1_800_000_000);
    const [h, c, sig] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${h}.${c}`);
    expect(verifier.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
      iss: KEY_FILE.client_email,
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
  });

  it("caches the token until shortly before it expires", async () => {
    const google = fakeGoogle({});
    let now = 1_800_000_000_000;
    const auth = new ServiceAccountAuth(parseServiceAccount(KEY_B64), CALENDAR_READONLY, google.fetchImpl, () => now);
    await auth.token();
    now += 50 * 60_000;
    await auth.token();
    expect(google.calls).toHaveLength(1);
    now += 6 * 60_000; // within 5 minutes of expiry
    await auth.token();
    expect(google.calls).toHaveLength(2);
  });

  it("reports a failed token request", async () => {
    const fetchImpl = (async () => json({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
    const auth = new ServiceAccountAuth(parseServiceAccount(KEY_B64), CALENDAR_READONLY, fetchImpl);
    await expect(auth.token()).rejects.toThrow(/HTTP 400.*invalid_grant/);
  });
});

describe("CALENDAR_IDS", () => {
  it("reads a name → id map", () => {
    expect(parseCalendarIds(' { " Crew 1 · Fernando ": " c1@group.calendar.google.com " } ')).toEqual({
      "Crew 1 · Fernando": "c1@group.calendar.google.com",
    });
  });

  it.each([
    ["[]", /must be a JSON object/],
    ["{}", /is empty/],
    ['{"Crew 1": 5}', /must be a calendar id string/],
    ["nope", /not valid JSON/],
  ])("rejects %j", (value, error) => {
    expect(() => parseCalendarIds(value)).toThrow(error);
  });
});

describe("GoogleCalendarSource", () => {
  it("reads every calendar for the New York day and parses the events", async () => {
    const google = fakeGoogle({
      "crew2@group.calendar.google.com": [[ev("a", "Hartley – Driveway 420 sf", { colorId: "5" })]],
      "exc@group.calendar.google.com": [
        [ev("b", "Marsh – Driveway excavation 500 sf"), ev("c", "EST – Sorensen – Driveway", { start: { dateTime: "2026-10-09T09:00:00-04:00" } })],
      ],
    });
    const { jobs, visits } = await source(google).getDay("2026-10-09");

    expect(jobs.map((j) => [j.crew, j.customer, j.service, j.status])).toEqual([
      ["Crew 2 · Jorge", "Hartley", "Driveway", "in_progress"],
      ["Excavation · Bira", "Marsh", "Driveway excavation", "scheduled"],
    ]);
    expect(visits.map((v) => [v.customer, v.city])).toEqual([["Sorensen", "Viera"]]);

    const list = google.calls.find((c) => c.url.pathname.includes("crew2"))!;
    expect(list.url.pathname).toBe("/calendar/v3/calendars/crew2%40group.calendar.google.com/events");
    expect(Object.fromEntries(list.url.searchParams)).toMatchObject({
      timeMin: "2026-10-09T00:00:00-04:00",
      timeMax: "2026-10-10T00:00:00-04:00",
      timeZone: "America/New_York",
      singleEvents: "true",
      orderBy: "startTime",
    });
    expect(new Headers(list.init?.headers).get("Authorization")).toBe("Bearer tok-1");
    expect(google.calls.filter((c) => c.url.hostname === "oauth2.googleapis.com")).toHaveLength(1);
  });

  it("follows pagination", async () => {
    const google = fakeGoogle({ "crew2@group.calendar.google.com": [[ev("a", "A – Patio")], [ev("b", "B – Patio")]] });
    const { jobs } = await source(google).getDay("2026-10-09");
    expect(jobs.map((j) => j.customer)).toEqual(["A", "B"]);
  });

  it("shows an event on two calendars once, under the first calendar", async () => {
    const shared = ev("same", "Hartley – Driveway");
    const google = fakeGoogle({ "crew2@group.calendar.google.com": [[shared]], "exc@group.calendar.google.com": [[shared]] });
    const { jobs } = await source(google).getDay("2026-10-09");
    expect(jobs.map((j) => j.crew)).toEqual(["Crew 2 · Jorge"]);
  });

  it("skips cancelled events", async () => {
    const google = fakeGoogle({ "crew2@group.calendar.google.com": [[ev("a", "A – Patio", { status: "cancelled" })]] });
    expect((await source(google).getDay("2026-10-09")).jobs).toEqual([]);
  });

  it("fails the whole day when a calendar cannot be read, so the screen keeps its last good data", async () => {
    const google = fakeGoogle({}, { failCalendar: "exc@group.calendar.google.com" });
    await expect(source(google).getDay("2026-10-09")).rejects.toThrow(/Google Calendar "Excavation · Bira": HTTP 404/);
  });
});

describe("getSources", () => {
  it("uses sample data when the Google variables are not set", () => {
    expect(getSources("2026-10-09", {}).schedule.sample).toBe(true);
  });

  it("uses Google Calendar when both variables are set", () => {
    const { schedule } = getSources("2026-10-09", { GOOGLE_SERVICE_ACCOUNT_JSON: KEY_B64, CALENDAR_IDS: JSON.stringify(CALENDARS) });
    expect([schedule.label, schedule.sample]).toEqual(["Google Calendar", false]);
  });

  it("builds a board from Google Calendar without street addresses", async () => {
    const google = fakeGoogle({ "crew2@group.calendar.google.com": [[ev("a", "Hartley – Driveway 420 sf")]] });
    const { weather } = getSources("2026-10-09", {});
    const board = await buildBoard(new Date("2026-10-09T13:00:00Z"), { schedule: source(google), weather });
    expect(board.jobs.map((j) => [j.pin, j.customer, j.city])).toEqual([[1, "Hartley", "Viera"]]);
    expect(board.bookedThrough).toBeNull();
    expect(JSON.stringify(board)).not.toMatch(/Example Dr/);
  });
});
