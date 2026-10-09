import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/control/jobs/[id]/route";
import { GET } from "@/app/api/control/jobs/route";
import { parseEvent, type CalendarEvent } from "@/lib/parse/event";
import { GoogleCalendarWriter, WriteError } from "@/lib/sources/calendarWriter";
import { proxy } from "@/proxy";
import { applyChanges, ChangeError, currentValues, validateChanges } from "./changes";
import { updatedLine } from "./session";
import { canEditCrew, controlCookie, CONTROL_COOKIE, parseControlUsers, userForCookie, userForKey } from "./users";

const KEYS = { diandra: "diandra-key-0123456789abcdefghij", jorge: "jorge-key-0123456789abcdefghijkl", jardel: "jardel-key-0123456789abcdefghijk" };
const USERS_JSON = JSON.stringify({
  Diandra: { key: KEYS.diandra, office: true },
  Jorge: { key: KEYS.jorge, crew: "Crew 2" },
  Jardel: { key: KEYS.jardel, crew: "Sealing" },
});
const users = parseControlUsers(USERS_JSON);
const office = userForKey(users, KEYS.diandra)!;
const jorge = userForKey(users, KEYS.jorge)!;

describe("personal links", () => {
  it("identifies each person by their key", () => {
    expect(office).toEqual({ name: "Diandra", office: true });
    expect(jorge).toEqual({ name: "Jorge", office: false, crew: "Crew 2" });
    expect(userForKey(users, "not-a-key-0123456789abcdefgh")).toBeNull();
  });

  it("keeps the person signed in with a cookie that does not contain the key", () => {
    const cookie = controlCookie(users[1]);
    expect(cookie).not.toContain(KEYS.jorge);
    expect(userForCookie(users, cookie)).toEqual(jorge);
  });

  it("refuses forged or outdated cookies", () => {
    const cookie = controlCookie(users[1]);
    expect(userForCookie(users, cookie.replace("Jorge", "Diandra"))).toBeNull();
    const rotated = parseControlUsers(USERS_JSON.replace(KEYS.jorge, "jorge-new-key-0123456789abcdefgh"));
    expect(userForCookie(rotated, cookie)).toBeNull();
    expect(userForCookie(users, "garbage")).toBeNull();
  });

  it.each([
    ['{"A":{"key":"short","office":true}}', /at least 24/],
    ['{"A":{"key":"0123456789abcdefghijklmnop"}}', /needs "office": true or a crew/],
    ['{"A":{"key":"0123456789abcdefghijklmnop","crew":"Crew 9"}}', /needs "office": true or a crew/],
    ["[]", /JSON object/],
  ])("rejects bad CONTROL_USERS %j", (value, error) => {
    expect(() => parseControlUsers(value)).toThrow(error);
  });
});

describe("permissions", () => {
  it("lets crew leads edit only their own crew", () => {
    expect(canEditCrew(jorge, "Crew 2 · Jorge")).toBe(true);
    expect(canEditCrew(jorge, "Crew 3 · Darwin")).toBe(false);
    expect(canEditCrew(office, "Sealing · Jardel")).toBe(true);
    expect(canEditCrew(userForKey(users, KEYS.jardel)!, "Sealing · Jardel")).toBe(true);
  });

  it("lets crew leads change only Status and Note", () => {
    expect(validateChanges({ Status: "In progress", Note: "  Started   late " }, jorge)).toEqual({ Status: "In progress", Note: "Started late" });
    expect(() => validateChanges({ Deposit: "OK" }, jorge)).toThrow(/Only the office can change Deposit/);
  });

  it("lets the office change everything, with only the guide's values", () => {
    expect(validateChanges({ Deposit: "OK", Permit: "N/A", Confirm48: "SENT" }, office)).toEqual({ Deposit: "OK", Permit: "N/A", Confirm48: "SENT" });
    expect(() => validateChanges({ Deposit: "Paid" }, office)).toThrow(ChangeError);
    expect(() => validateChanges({ Status: "Finished" }, office)).toThrow(/Status must be one of/);
    expect(() => validateChanges({ Color: "11" }, office)).toThrow(/Unknown field/);
    expect(() => validateChanges({}, office)).toThrow(/No changes/);
  });

  it("caps notes at 200 characters", () => {
    expect(validateChanges({ Note: "x".repeat(500) }, office).Note).toHaveLength(200);
  });
});

describe("applyChanges", () => {
  const UPDATED = "Jorge · Oct 9, 2:15 PM";

  it("replaces the board's lines in place and keeps everything else", () => {
    const before = "Gate code 1234\nStatus: Scheduled\nDeposit: PENDING\nCall before arriving\nNote: old";
    expect(applyChanges(before, { Status: "In progress", Note: "Material on site" }, UPDATED)).toBe(
      "Gate code 1234\nStatus: In progress\nDeposit: PENDING\nCall before arriving\nNote: Material on site\nUpdated: Jorge · Oct 9, 2:15 PM",
    );
  });

  it("adds missing lines before the Updated line, which it refreshes", () => {
    const before = "Deposit: OK\nUpdated: Diandra · Oct 8, 9:00 AM";
    expect(applyChanges(before, { Status: "Issue" }, UPDATED)).toBe("Deposit: OK\nStatus: Issue\nUpdated: Jorge · Oct 9, 2:15 PM");
  });

  it("matches keys whatever their case, and fills an empty description", () => {
    expect(applyChanges("status: scheduled", { Status: "Done" }, UPDATED)).toBe("Status: Done\nUpdated: Jorge · Oct 9, 2:15 PM");
    expect(applyChanges(undefined, { Status: "Done" }, UPDATED)).toBe("Status: Done\nUpdated: Jorge · Oct 9, 2:15 PM");
  });

  it("turns an HTML description into lines, keeping link addresses", () => {
    const html = '<b>Deposit:</b> OK<br>Plan: <a href="https://markate.com/wo/77">work order</a><br>Status: Scheduled';
    expect(applyChanges(html, { Status: "In progress" }, UPDATED)).toBe(
      "Deposit: OK\nPlan: work order (https://markate.com/wo/77)\nStatus: In progress\nUpdated: Jorge · Oct 9, 2:15 PM",
    );
  });

  it("writes lines the parser reads back", () => {
    const desc = applyChanges("Deposit: PENDING", { Status: "Issue", Deposit: "OK", Note: "No material" }, UPDATED);
    const r = parseEvent({ id: "e", summary: "Hartley – Driveway", description: desc, start: { date: "2026-10-09" }, end: { date: "2026-10-10" } }, "Crew 2 · Jorge");
    expect(r.kind === "job" && [r.job.status, r.job.deposit, r.job.note]).toEqual(["issue", "ok", "No material"]);
    expect(r.kind === "job" && currentValues(r.job)).toMatchObject({ Status: "Issue", Deposit: "OK", Note: "No material" });
  });

  it("stamps who changed it, in New York time", () => {
    expect(updatedLine(jorge, new Date("2026-10-09T18:15:00Z"))).toBe("Jorge · Oct 9, 2:15 PM");
  });
});

// ---- Google Calendar writer ----

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const EVENT: CalendarEvent & { etag: string } = {
  id: "evt1",
  etag: '"3355"',
  summary: "Hartley – Driveway 420 sf",
  location: "1234 Example Dr, Viera, FL 32940",
  description: "Status: Scheduled\nDeposit: OK",
  start: { date: "2026-10-09" },
  end: { date: "2026-10-10" },
};

function fakeCalendar(opts: { patchStatus?: number; patchBody?: string } = {}) {
  const calls: { method: string; url: string; headers: Headers; body?: string }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(input), headers: new Headers(init?.headers), body: init?.body as string | undefined });
    if (String(input).includes("oauth2")) return json({ access_token: "tok", expires_in: 3600 });
    if (method === "GET") return json(EVENT);
    if (opts.patchStatus) return new Response(opts.patchBody ?? "", { status: opts.patchStatus });
    return json({ ...EVENT, description: JSON.parse(init!.body as string).description });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const writer = (cal: ReturnType<typeof fakeCalendar>) =>
  new GoogleCalendarWriter({ "Crew 2 · Jorge": "crew2@group.calendar.google.com" }, { token: async () => "tok" }, cal.fetchImpl);

describe("GoogleCalendarWriter", () => {
  it("reads the event, then patches only its description, guarded by its etag", async () => {
    const cal = fakeCalendar();
    const job = await writer(cal).update("Crew 2 · Jorge", "evt1", { Status: "In progress" }, "Jorge · Oct 9, 2:15 PM", "2026-10-09");
    expect(job.status).toBe("in_progress");
    const [get, patch] = cal.calls;
    expect(get.method).toBe("GET");
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe("https://www.googleapis.com/calendar/v3/calendars/crew2%40group.calendar.google.com/events/evt1");
    expect(patch.headers.get("If-Match")).toBe('"3355"');
    expect(JSON.parse(patch.body!)).toEqual({ description: "Status: In progress\nDeposit: OK\nUpdated: Jorge · Oct 9, 2:15 PM" });
  });

  it("does not overwrite an event someone changed meanwhile", async () => {
    const cal = fakeCalendar({ patchStatus: 412 });
    await expect(writer(cal).update("Crew 2 · Jorge", "evt1", { Status: "Done" }, "x", "2026-10-09")).rejects.toMatchObject({ code: "conflict" });
  });

  it("explains a calendar that is still shared read-only", async () => {
    const cal = fakeCalendar({ patchStatus: 403, patchBody: '{"error":{"message":"You need to have writer access to this calendar."}}' });
    const err = await writer(cal).update("Crew 2 · Jorge", "evt1", { Status: "Done" }, "x", "2026-10-09").catch((e) => e);
    expect(err).toBeInstanceOf(WriteError);
    expect(err.code).toBe("no_write_access");
    expect(err.message).toMatch(/Make changes to events/);
  });

  it("refuses crews it has no calendar for", async () => {
    await expect(writer(fakeCalendar()).update("Crew 9", "evt1", { Status: "Done" }, "x", "2026-10-09")).rejects.toMatchObject({ code: "not_found" });
  });
});

// ---- Routes and proxy ----

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_B64 = Buffer.from(
  JSON.stringify({ client_email: "board@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }),
).toString("base64");

const cookieFor = (name: string) => `${CONTROL_COOKIE}=${controlCookie(users.find((u) => u.name === name)!)}`;
const post = (cookie: string | null, body: unknown, origin = "https://board.example.com") =>
  POST(
    new Request("https://board.example.com/api/control/jobs/evt1", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "evt1" }) },
  );

describe("control API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lists sample jobs read-only when Google Calendar is not connected; crew leads see their crew", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    const res = await GET(new Request("https://board.example.com/api/control/jobs", { headers: { cookie: cookieFor("Jorge") } }));
    const body = await res.json();
    expect(body.writable).toBe(false);
    expect(body.days[0].jobs.every((j: { crew: string }) => j.crew === "Crew 2 · Jorge")).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/address/i);
  });

  it("requires a signed-in person", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    expect((await GET(new Request("https://board.example.com/api/control/jobs"))).status).toBe(401);
    expect((await post(null, {})).status).toBe(401);
  });

  it("saves a crew lead's status change to the calendar", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", KEY_B64);
    vi.stubEnv("CALENDAR_IDS", JSON.stringify({ "Crew 2 · Jorge": "crew2@group.calendar.google.com" }));
    const cal = fakeCalendar();
    vi.stubGlobal("fetch", cal.fetchImpl);
    const res = await post(cookieFor("Jorge"), { crew: "Crew 2 · Jorge", date: "2026-10-09", changes: { Status: "In progress" } });
    expect(res.status).toBe(200);
    expect((await res.json()).job.values.Status).toBe("In progress");
    const patch = cal.calls.find((c) => c.method === "PATCH")!;
    expect(JSON.parse(patch.body!).description).toMatch(/^Status: In progress\nDeposit: OK\nUpdated: Jorge · /);
    // The write token asks for the events scope, not full calendar access.
    const tokenCall = cal.calls.find((c) => c.url.includes("oauth2"))!;
    const assertion = new URLSearchParams(tokenCall.body!).get("assertion")!;
    expect(JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString()).scope).toBe("https://www.googleapis.com/auth/calendar.events");
  });

  it("refuses another crew's job, a deposit change by a lead, and cross-site posts", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", KEY_B64);
    vi.stubEnv("CALENDAR_IDS", JSON.stringify({ "Crew 2 · Jorge": "c2@group.calendar.google.com", "Crew 3 · Darwin": "c3@group.calendar.google.com" }));
    vi.stubGlobal("fetch", fakeCalendar().fetchImpl);
    expect((await post(cookieFor("Jorge"), { crew: "Crew 3 · Darwin", date: "2026-10-09", changes: { Status: "Done" } })).status).toBe(403);
    expect((await post(cookieFor("Jorge"), { crew: "Crew 2 · Jorge", date: "2026-10-09", changes: { Deposit: "OK" } })).status).toBe(403);
    expect((await post(cookieFor("Diandra"), { crew: "Crew 2 · Jorge", date: "2026-10-09", changes: { Deposit: "OK" } }, "https://evil.example")).status).toBe(403);
    expect((await post(cookieFor("Diandra"), { crew: "Crew 2 · Jorge", date: "2026-10-09", changes: { Deposit: "OK" } })).status).toBe(200);
  });

  it("returns 409 when the event changed in the calendar meanwhile", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", KEY_B64);
    vi.stubEnv("CALENDAR_IDS", JSON.stringify({ "Crew 2 · Jorge": "crew2@group.calendar.google.com" }));
    vi.stubGlobal("fetch", fakeCalendar({ patchStatus: 412 }).fetchImpl);
    const res = await post(cookieFor("Jorge"), { crew: "Crew 2 · Jorge", date: "2026-10-09", changes: { Status: "Done" } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("conflict");
  });
});

describe("proxy for /control", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (path: string, cookie?: string) =>
    new NextRequest(`https://board.example.com${path}`, { headers: cookie ? { cookie } : {} });

  it("signs a person in from their personal link and drops the key from the address", () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    const res = proxy(req(`/control?key=${KEYS.jorge}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://board.example.com/control");
    expect(res.cookies.get(CONTROL_COOKIE)?.value).toBe(controlCookie(users[1]));
  });

  it("does not need the TV token, and the TV token does not open /control", () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    vi.stubEnv("BOARD_ACCESS_TOKEN", "tv-token-0123456789abcdefghijk");
    expect(proxy(req("/control", cookieFor("Jorge"))).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/control?key=tv-token-0123456789abcdefghijk")).status).toBe(401);
    expect(proxy(req("/api/control/jobs")).status).toBe(401);
  });

  it("is closed when CONTROL_USERS is not set", () => {
    vi.stubEnv("CONTROL_USERS", "");
    expect(proxy(req("/control")).status).toBe(503);
  });
});
