import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as LOGIN } from "@/app/api/control/login/route";
import { POST as LOGOUT } from "@/app/api/control/logout/route";
import { POST as SETUP } from "@/app/api/control/setup/route";
import { DELETE, PATCH } from "@/app/api/control/users/[username]/route";
import { GET as LIST, POST as ADD } from "@/app/api/control/users/route";
import { ACCESS_COOKIE, cookieValue } from "@/lib/access";
import { AdminError, createUser, needsSetup, removeUser, updateUser } from "./admin";
import { hashPassword } from "./password";
import { getUserStore, GoogleSheetsUserStore, MemoryUserStore, setUserStoreForTests, SHEET_COLUMNS, storeHint, type StoredUser } from "./store";
import { CONTROL_COOKIE, directory, parseControlUsers, sessionCookie, userForSession, type ControlUser } from "./users";

const ADMIN: ControlUser = { username: "vinicius", name: "Vinicius", office: true, admin: true };
const ORIGIN = "https://board.example.com";

describe("GoogleSheetsUserStore", () => {
  const auth = { token: async () => "TOKEN" };
  const jorge: StoredUser = { username: "jorge", name: "Jorge", password: hashPassword("pw-123456", 100_000), office: false, crew: "Crew 2", createdAt: "t", createdBy: "Vinicius" };

  function fakeSheet(initial: (string | boolean)[][] = []) {
    let values = initial;
    const calls: { method: string; url: string; auth: string | null; body?: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, auth: new Headers(init.headers).get("Authorization"), body: init.body as string | undefined });
      if (init.method === "PUT") {
        values = (JSON.parse(init.body as string) as { values: string[][] }).values;
        return new Response("{}");
      }
      return new Response(JSON.stringify({ values }));
    }) as unknown as typeof fetch;
    return { fetchImpl, calls, values: () => values };
  }

  it("keeps one user per row of the private sheet, with the hash and never the password", async () => {
    const sheet = fakeSheet();
    const store = new GoogleSheetsUserStore("SHEET1", auth, sheet.fetchImpl);
    await store.put(jorge);
    expect(await store.get("jorge")).toEqual(jorge);
    expect(sheet.values()).toEqual([[...SHEET_COLUMNS], ["jorge", "Jorge", "crew lead", "Crew 2", jorge.password, "t", "Vinicius", "", ""]]);
    await store.put({ ...ADMIN, password: jorge.password, createdAt: "t", createdBy: "setup" });
    expect((await store.list()).map((u) => [u.username, u.admin ?? false, u.office])).toEqual([["jorge", false, false], ["vinicius", true, true]]);
    await store.remove("jorge");
    // The emptied last row is blanked, not left behind.
    expect(sheet.values()).toEqual([[...SHEET_COLUMNS], ["vinicius", "Vinicius", "admin", "", jorge.password, "t", "setup", "", ""], ["", "", "", "", "", "", "", "", ""]]);
    expect(await store.get("jorge")).toBeUndefined();
    expect(sheet.calls.every((c) => c.url.startsWith("https://sheets.googleapis.com/v4/spreadsheets/SHEET1/values/") && c.auth === "Bearer TOKEN")).toBe(true);
    expect(sheet.calls.filter((c) => c.method === "PUT").every((c) => c.url.includes("valueInputOption=RAW"))).toBe(true);
    expect(JSON.stringify(sheet.calls)).not.toContain("pw-123456");
  });

  it("reads rows the office typed by hand, and skips rows without a username or hash", async () => {
    const sheet = fakeSheet([[...SHEET_COLUMNS], [" Diandra ", "Diandra", "Office", "", jorge.password, "t", "x"], ["", "blank"], ["nohash", "No hash", "admin"]]);
    const store = new GoogleSheetsUserStore("S", auth, sheet.fetchImpl);
    expect(await store.list()).toEqual([{ username: "diandra", name: "Diandra", password: jorge.password, office: true, createdAt: "t", createdBy: "x" }]);
  });

  it("caches reads for 30 seconds and re-reads after a change", async () => {
    let now = 0;
    const sheet = fakeSheet([[...SHEET_COLUMNS]]);
    const store = new GoogleSheetsUserStore("S", auth, sheet.fetchImpl, () => now);
    await store.list();
    await store.get("jorge");
    expect(sheet.calls.length).toBe(1);
    now = 31_000;
    await store.list();
    expect(sheet.calls.length).toBe(2);
    await store.put(jorge);
    expect(await store.get("jorge")).toEqual(jorge);
  });

  it("is used when USERS_SHEET_ID and the service account are set", () => {
    expect(getUserStore({})).toBeNull();
    expect(getUserStore({ USERS_SHEET_ID: "S" })).toBeNull();
    const key = JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: "k" });
    expect(getUserStore({ USERS_SHEET_ID: "S", GOOGLE_SERVICE_ACCOUNT_JSON: key })).toBeInstanceOf(GoogleSheetsUserStore);
  });

  it.each([
    [403, '{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}', /Sheets API is off/],
    [403, '{"error":{"status":"PERMISSION_DENIED","message":"The caller does not have permission"}}', /Share the sheet/],
    [404, '{"error":{"message":"Requested entity was not found."}}', /Check USERS_SHEET_ID/],
    [400, '{"error":{"message":"This operation is not supported for this document"}}', /Excel file/],
    [500, "oops", /HTTP 500/],
  ])("explains Google error %i in plain English", (status, body, hint) => {
    expect(storeHint(status, body)).toMatch(hint);
  });

  it("reports Google errors", async () => {
    const store = new GoogleSheetsUserStore("S", auth, (async () => new Response("PERMISSION_DENIED", { status: 403 })) as unknown as typeof fetch);
    await expect(store.get("a")).rejects.toThrow(/User store: HTTP 403/);
  });
});

describe("admin rules", () => {
  let store: MemoryUserStore;
  beforeEach(() => {
    store = new MemoryUserStore();
  });
  const add = (input: Record<string, unknown>, env: ReturnType<typeof parseControlUsers> = []) => createUser(store, env, input, ADMIN);

  it("adds a crew lead with a hashed password, never the password itself", async () => {
    const row = await add({ username: "Jorge", name: "Jorge", role: "crew", crew: "Crew 2", password: "crew2-pass" });
    expect(row).toMatchObject({ username: "jorge", name: "Jorge", role: "crew", crew: "Crew 2", office: false, source: "screen", createdBy: "Vinicius" });
    expect(JSON.stringify(row)).not.toMatch(/crew2-pass|pbkdf2/);
    const stored = (await store.get("jorge"))!;
    expect(stored.password).toMatch(/^pbkdf2\$600000\$/);
    expect(JSON.stringify(stored)).not.toContain("crew2-pass");
  });

  it.each([
    [{ username: "a", name: "A", role: "office", password: "12345678" }, /Username/],
    [{ username: "ana", name: "", role: "office", password: "12345678" }, /Name is required/],
    [{ username: "ana", name: "Ana", role: "office", password: "short" }, /at least 8/],
    [{ username: "ana", name: "Ana", role: "crew", crew: "Crew 9", password: "12345678" }, /Pick a crew/],
    [{ username: "ana", name: "Ana", role: "boss", password: "12345678" }, /Role must be/],
  ])("validates %#", async (input, error) => {
    await expect(add(input)).rejects.toThrow(error);
  });

  it("refuses a username that already exists, here or in Vercel", async () => {
    await add({ username: "ana", name: "Ana", role: "office", password: "12345678" });
    await expect(add({ username: "ANA", name: "Ana 2", role: "office", password: "12345678" })).rejects.toMatchObject({ status: 409 });
    const env = parseControlUsers(JSON.stringify({ vinicius: { password: hashPassword("x", 100_000), admin: true } }));
    await expect(add({ username: "vinicius", name: "V", role: "office", password: "12345678" }, env)).rejects.toMatchObject({ status: 409 });
  });

  it("changes role and password; a new password signs the person out", async () => {
    await add({ username: "jorge", name: "Jorge", role: "crew", crew: "Crew 2", password: "crew2-pass" });
    const before = sessionCookie((await store.get("jorge"))!);
    const dir = directory([], store);
    expect((await userForSession(dir, before))?.crew).toBe("Crew 2");
    const row = await updateUser(store, [], "jorge", { role: "office" }, ADMIN);
    expect(row).toMatchObject({ role: "office", office: true, updatedBy: "Vinicius" });
    expect(row.crew).toBeUndefined();
    await updateUser(store, [], "jorge", { password: "new-pass-99" }, ADMIN);
    expect(await userForSession(dir, before)).toBeNull();
  });

  it("protects admins from locking themselves out, and leaves Vercel users alone", async () => {
    await createUser(store, [], { username: "vinicius", name: "Vinicius", role: "admin", password: "admin-pass" }, ADMIN);
    await expect(updateUser(store, [], "vinicius", { role: "office" }, ADMIN)).rejects.toThrow(/own admin role/);
    await expect(removeUser(store, [], "vinicius", ADMIN)).rejects.toThrow(/remove yourself/);
    const env = parseControlUsers(JSON.stringify({ diandra: { password: hashPassword("x", 100_000), office: true } }));
    await expect(updateUser(store, env, "diandra", { name: "D" }, ADMIN)).rejects.toThrow(/set in Vercel/);
    await expect(removeUser(store, env, "diandra", ADMIN)).rejects.toBeInstanceOf(AdminError);
  });

  it("needs setup only while no admin exists anywhere", async () => {
    expect(await needsSetup(null, [])).toBe(false);
    expect(await needsSetup(store, [])).toBe(true);
    await add({ username: "diandra", name: "Diandra", role: "office", password: "12345678" });
    expect(await needsSetup(store, [])).toBe(true);
    await add({ username: "vinicius", name: "Vinicius", role: "admin", password: "12345678" });
    expect(await needsSetup(store, [])).toBe(false);
  });
});

// ---- Routes ----

const TV = "tv-token-0123456789abcdefghijk";
const req = (method: string, path: string, body?: unknown, cookie?: string, origin = ORIGIN) =>
  new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "Content-Type": "application/json", origin, "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}`, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (username: string) => ({ params: Promise.resolve({ username }) });
const sessionOf = async (store: MemoryUserStore, username: string) => `${CONTROL_COOKIE}=${sessionCookie((await store.get(username))!)}`;

describe("first admin and user management, end to end", () => {
  let store: MemoryUserStore;
  beforeEach(() => {
    store = new MemoryUserStore();
    setUserStoreForTests(store);
    vi.stubEnv("CONTROL_USERS", "");
    vi.stubEnv("BOARD_ACCESS_TOKEN", TV);
  });
  afterEach(() => {
    setUserStoreForTests(null);
    vi.unstubAllEnvs();
  });

  it("creates the first admin only from a device that has the TV board, and only once", async () => {
    const body = { username: "vinicius", name: "Vinicius", password: "admin-pass-1" };
    expect((await SETUP(req("POST", "/api/control/setup", body))).status).toBe(403);
    const tv = `${ACCESS_COOKIE}=${cookieValue(TV)}`;
    const ok = await SETUP(req("POST", "/api/control/setup", body, tv));
    expect(ok.status).toBe(201);
    expect((await ok.json()).user).toMatchObject({ username: "vinicius", role: "admin" });
    expect(ok.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect((await SETUP(req("POST", "/api/control/setup", { ...body, username: "intruder" }, tv))).status).toBe(409);
  });

  it("tells the admin what to fix when the users sheet cannot be reached, instead of a bare error 500", async () => {
    const forbidden = new GoogleSheetsUserStore("S", { token: async () => "T" }, (async () =>
      new Response('{"error":{"code":403,"status":"PERMISSION_DENIED","message":"The caller does not have permission"}}', { status: 403 })) as unknown as typeof fetch);
    setUserStoreForTests(forbidden);
    const res = await SETUP(req("POST", "/api/control/setup", { username: "vinicius", name: "Vinicius", password: "admin-pass-1" }, `${ACCESS_COOKIE}=${cookieValue(TV)}`));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Share the sheet with the service account's email as Editor/);
  });

  it("lets the admin add a person who can then sign in; nobody else can manage users", async () => {
    await createUser(store, [], { username: "vinicius", name: "Vinicius", role: "admin", password: "admin-pass-1" }, ADMIN);
    const admin = await sessionOf(store, "vinicius");

    const added = await ADD(req("POST", "/api/control/users", { username: "jorge", name: "Jorge", role: "crew", crew: "Crew 2", password: "crew2-pass" }, admin));
    expect(added.status).toBe(201);
    const login = await LOGIN(req("POST", "/api/control/login", { username: "jorge", password: "crew2-pass" }));
    expect(login.status).toBe(200);

    const jorge = await sessionOf(store, "jorge");
    expect((await ADD(req("POST", "/api/control/users", { username: "x1", name: "X", role: "admin", password: "12345678" }, jorge))).status).toBe(403);
    expect((await LIST(req("GET", "/api/control/users", undefined, jorge))).status).toBe(403);
    expect((await ADD(req("POST", "/api/control/users", { username: "x2", name: "X", role: "office", password: "12345678" }, admin, "https://evil.example"))).status).toBe(403);

    const list = await LIST(req("GET", "/api/control/users", undefined, admin));
    const text = await list.text();
    expect(text).toContain('"username":"jorge"');
    expect(text).not.toMatch(/pbkdf2|crew2-pass|password/);
    expect(list.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("resets a password (old one stops working) and removes people", async () => {
    await createUser(store, [], { username: "vinicius", name: "Vinicius", role: "admin", password: "admin-pass-1" }, ADMIN);
    await createUser(store, [], { username: "jorge", name: "Jorge", role: "crew", crew: "Crew 2", password: "crew2-pass" }, ADMIN);
    const admin = await sessionOf(store, "vinicius");
    expect((await PATCH(req("PATCH", "/api/control/users/jorge", { password: "brand-new-1" }, admin), ctx("jorge"))).status).toBe(200);
    expect((await LOGIN(req("POST", "/api/control/login", { username: "jorge", password: "crew2-pass" }))).status).toBe(401);
    expect((await LOGIN(req("POST", "/api/control/login", { username: "jorge", password: "brand-new-1" }))).status).toBe(200);
    expect((await DELETE(req("DELETE", "/api/control/users/jorge", undefined, admin), ctx("jorge"))).status).toBe(200);
    expect((await LOGIN(req("POST", "/api/control/login", { username: "jorge", password: "brand-new-1" }))).status).toBe(401);
  });

  it("signs out by expiring the cookie and asking the browser to drop cached data", async () => {
    const res = await LOGOUT();
    expect(res.headers.get("set-cookie")).toMatch(/^board_control=; Path=\/; Max-Age=0; HttpOnly/);
    expect(res.headers.get("clear-site-data")).toBe('"cache", "storage"');
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
  });
});
