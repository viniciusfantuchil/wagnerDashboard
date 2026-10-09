import { generateKeyPairSync, webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as LOGIN } from "@/app/api/control/login/route";
import { POST } from "@/app/api/control/jobs/[id]/route";
import { GET } from "@/app/api/control/jobs/route";
import { parseEvent, type CalendarEvent } from "@/lib/parse/event";
import { GoogleCalendarWriter, WriteError } from "@/lib/sources/calendarWriter";
import { proxy } from "@/proxy";
import { applyChanges, ChangeError, currentValues, validateChanges } from "./changes";
import { hashPassword, isPasswordHash, verifyPassword } from "./password";
import { updatedLine } from "./session";
import { LoginThrottle, MAX_FAILURES } from "./throttle";
import { canEditCrew, checkLogin, CONTROL_COOKIE, directory, parseControlUsers, sessionCookie, userForSession } from "./users";

// Fewer iterations than production (600,000) keeps the tests fast; the format is the same.
const ITER = 100_000;
const PASSWORDS = { diandra: "office-pass-123", jorge: "crew2-pass-456", jardel: "sealer-pass-789" };
const USERS_JSON = JSON.stringify({
  diandra: { name: "Diandra", password: hashPassword(PASSWORDS.diandra, ITER), office: true },
  Jorge: { password: hashPassword(PASSWORDS.jorge, ITER), crew: "Crew 2" },
  jardel: { name: "Jardel", password: hashPassword(PASSWORDS.jardel, ITER), crew: "Sealing" },
});
const users = parseControlUsers(USERS_JSON);
const dir = directory(users, null);
const entryFor = (u: string) => users.find((x) => x.username === u);
const office = (await checkLogin(dir, "diandra", PASSWORDS.diandra))!;
const jorge = (await checkLogin(dir, "jorge", PASSWORDS.jorge))!;

describe("passwords", () => {
  it("verifies the right password only", () => {
    const h = hashPassword("correct horse", ITER);
    expect(isPasswordHash(h)).toBe(true);
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("correct horsE", h)).toBe(false);
    expect(verifyPassword("correct horse", "not-a-hash")).toBe(false);
  });

  it("accepts the hash the /control/password page makes in the browser (Web Crypto)", async () => {
    const salt = webcrypto.getRandomValues(new Uint8Array(16));
    const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode("from the browser"), "PBKDF2", false, ["deriveBits"]);
    const bits = await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
    const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(new Uint8Array(b)).toString("base64url");
    expect(verifyPassword("from the browser", `pbkdf2$${ITER}$${b64(salt)}$${b64(bits)}`)).toBe(true);
  });
});

describe("logins", () => {
  it("signs people in with their username (any case) and password", async () => {
    expect(office).toEqual({ username: "diandra", name: "Diandra", office: true });
    expect(jorge).toEqual({ username: "jorge", name: "Jorge", office: false, crew: "Crew 2" });
    expect((await checkLogin(dir, " JORGE ", PASSWORDS.jorge))?.username).toBe("jorge");
    expect(await checkLogin(dir, "jorge", "wrong-password")).toBeNull();
    expect(await checkLogin(dir, "nobody", PASSWORDS.jorge)).toBeNull();
  });

  it("keeps a session for 30 days in a signed cookie without the password", async () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    const cookie = sessionCookie(entryFor("jorge")!, now);
    expect(cookie).not.toContain(PASSWORDS.jorge);
    expect(await userForSession(dir, cookie, now)).toEqual(jorge);
    expect(await userForSession(dir, cookie, now + 29 * 86_400_000)).toEqual(jorge);
    expect(await userForSession(dir, cookie, now + 31 * 86_400_000)).toBeNull();
  });

  it("refuses forged sessions and signs a person out when their password changes", async () => {
    const cookie = sessionCookie(entryFor("jorge")!);
    expect(await userForSession(dir, cookie.replace(/^jorge/, "diandra"))).toBeNull();
    expect(await userForSession(dir, cookie.replace(/\.(\d+)\./, (_, e) => `.${Number(e) + 1}.`))).toBeNull();
    const changed = parseControlUsers(USERS_JSON.replace(/"Jorge":\{"password":"[^"]+"/, `"Jorge":{"password":"${hashPassword("new-pass-000", ITER)}"`));
    expect(await userForSession(directory(changed, null), cookie)).toBeNull();
    expect(await userForSession(dir, "garbage")).toBeNull();
  });

  it.each([
    ['{"a b":{"password":"x","office":true}}', /not a valid username/],
    ['{"ana":{"password":"plain-text-password","office":true}}', /must be a password hash/],
    [`{"ana":{"password":"${hashPassword("x", ITER)}"}}`, /needs "office": true or a crew/],
    [`{"ana":{"password":"${hashPassword("x", ITER)}","crew":"Crew 9"}}`, /needs "office": true or a crew/],
    ["[]", /JSON object/],
  ])("rejects bad CONTROL_USERS %#", (value, error) => {
    expect(() => parseControlUsers(value)).toThrow(error);
  });
});

describe("login throttle", () => {
  it(`locks a username for 15 minutes after ${MAX_FAILURES} wrong passwords`, () => {
    let now = 0;
    const t = new LoginThrottle(() => now);
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.fail(["user:jorge"]);
    expect(t.waitMs(["user:jorge"])).toBe(0);
    t.fail(["user:jorge"]);
    expect(t.waitMs(["user:jorge"])).toBe(15 * 60_000);
    now += 15 * 60_000;
    expect(t.waitMs(["user:jorge"])).toBe(0);
    t.fail(["user:jorge"]);
    expect(t.waitMs(["user:jorge"])).toBe(0); // counting starts over after the lock
  });

  it("forgets failures after a successful login", () => {
    const t = new LoginThrottle(() => 0);
    for (let i = 0; i < MAX_FAILURES - 1; i++) t.fail(["user:jorge"]);
    t.succeed(["user:jorge"]);
    t.fail(["user:jorge"]);
    expect(t.waitMs(["user:jorge"])).toBe(0);
  });
});

describe("permissions", () => {
  it("lets crew leads edit only their own crew", async () => {
    expect(canEditCrew(jorge, "Crew 2 · Jorge")).toBe(true);
    expect(canEditCrew(jorge, "Crew 3 · Darwin")).toBe(false);
    expect(canEditCrew(office, "Sealing · Jardel")).toBe(true);
    expect(canEditCrew((await checkLogin(dir, "jardel", PASSWORDS.jardel))!, "Sealing · Jardel")).toBe(true);
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

const cookieFor = (name: string) => `${CONTROL_COOKIE}=${sessionCookie(users.find((u) => u.name === name)!)}`;
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

describe("login API", () => {
  beforeEach(() => vi.stubEnv("CONTROL_USERS", USERS_JSON));
  afterEach(() => vi.unstubAllEnvs());
  const login = (username: string, password: string, ip = "203.0.113.7", origin = "https://board.example.com") =>
    LOGIN(
      new Request("https://board.example.com/api/control/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin, "x-forwarded-for": ip },
        body: JSON.stringify({ username, password }),
      }),
    );

  it("sets a secure, httpOnly session cookie on the right password", async () => {
    const res = await login("Diandra", PASSWORDS.diandra);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^board_control=diandra\.\d+\.[\w-]{43}; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/);
    const value = setCookie.split(";")[0].split("=")[1];
    expect(await userForSession(dir, value)).toEqual(office);
  });

  it("answers the same way for a wrong password and an unknown user", async () => {
    const a = await login("jorge", "nope-nope", "198.51.100.1");
    const b = await login("ghost", "nope-nope", "198.51.100.2");
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(await a.json()).toEqual(await b.json());
    expect(a.headers.get("set-cookie")).toBeNull();
  });

  it(`blocks a username after ${MAX_FAILURES} wrong passwords, even with the right one`, async () => {
    for (let i = 0; i < MAX_FAILURES; i++) await login("jardel", "wrong-guess", `192.0.2.${i}`);
    const res = await login("jardel", PASSWORDS.jardel, "192.0.2.99");
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Too many attempts/);
  });

  it("refuses cross-site logins", async () => {
    expect((await login("diandra", PASSWORDS.diandra, "203.0.113.8", "https://evil.example")).status).toBe(403);
  });
});

describe("proxy for /control", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (path: string, cookie?: string) =>
    new NextRequest(`https://board.example.com${path}`, { headers: cookie ? { cookie } : {} });

  it("sends people without a session to the login page, without caching", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    const res = await proxy(req("/control"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://board.example.com/control/login");
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect((await proxy(req("/api/control/jobs"))).status).toBe(401);
  });

  it("keeps the sign-in and first-admin pages open", async () => {
    vi.stubEnv("CONTROL_USERS", "");
    for (const path of ["/control/login", "/control/setup", "/api/control/login", "/api/control/setup", "/login"]) {
      const res = await proxy(req(path));
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    }
  });

  it("lets a signed-in person through without the TV token, and the TV cookie does not open /control", async () => {
    vi.stubEnv("CONTROL_USERS", USERS_JSON);
    vi.stubEnv("BOARD_ACCESS_TOKEN", "tv-token-0123456789abcdefghijk");
    expect((await proxy(req("/control", cookieFor("Jorge")))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/control", "board_access=anything"))).status).toBe(307);
  });
});
