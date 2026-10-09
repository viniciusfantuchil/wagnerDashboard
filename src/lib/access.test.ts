import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as BOARD_LOGIN } from "@/app/api/board/login/route";
import { proxy } from "@/proxy";
import { ACCESS_COOKIE, cookieValue, decideAccess } from "./access";
import { hashPassword } from "./control/password";
import { MemoryUserStore, setUserStoreForTests } from "./control/store";
import { CONTROL_COOKIE, sessionCookie } from "./control/users";

const TOKEN = "s3cr3t-token-for-the-tv-0123456789";

describe("decideAccess", () => {
  it("allows requests with the board cookie", () => {
    expect(decideAccess({ token: TOKEN, cookie: cookieValue(TOKEN), production: true })).toEqual({ action: "allow" });
  });

  it.each([
    ["no cookie", undefined],
    ["the raw token as cookie", TOKEN],
    ["a cookie from an old token", cookieValue("an-older-token-that-was-rotated")],
  ])("denies %s", (_, cookie) => {
    expect(decideAccess({ token: TOKEN, cookie, production: true })).toEqual({ action: "deny" });
  });

  it("refuses everything in production when no token, or a short one, is configured", () => {
    expect(decideAccess({ token: undefined, cookie: undefined, production: true })).toEqual({ action: "misconfigured" });
    expect(decideAccess({ token: "short", cookie: undefined, production: true })).toEqual({ action: "misconfigured" });
  });

  it("stays open in local development when no token is configured", () => {
    expect(decideAccess({ token: undefined, cookie: undefined, production: false })).toEqual({ action: "allow" });
  });
});

describe("TV setup at /login", () => {
  afterEach(() => vi.unstubAllEnvs());
  const login = (token: string, ip = "203.0.113.20", origin = "https://board.example.com") =>
    BOARD_LOGIN(
      new Request("https://board.example.com/api/board/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", origin, "x-forwarded-for": ip },
        body: JSON.stringify({ token }),
      }),
    );

  it("sets the board cookie (a hash of the code, httpOnly) from the typed code, never from the address", async () => {
    vi.stubEnv("BOARD_ACCESS_TOKEN", TOKEN);
    const res = await login(TOKEN);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBe(`${ACCESS_COOKIE}=${cookieValue(TOKEN)}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax; Secure`);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("refuses a wrong code and a cross-site post", async () => {
    vi.stubEnv("BOARD_ACCESS_TOKEN", TOKEN);
    expect((await login("wrong-code", "203.0.113.21")).status).toBe(401);
    expect((await login(TOKEN, "203.0.113.22", "https://evil.example")).status).toBe(403);
  });

  it("no longer opens the board from a ?key= address", async () => {
    vi.stubEnv("BOARD_ACCESS_TOKEN", TOKEN);
    const res = await proxy(new NextRequest(`https://board.example.com/?key=${TOKEN}`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://board.example.com/login");
    expect(res.cookies.get(ACCESS_COOKIE)).toBeUndefined();
  });

  it("serves the board without caching, and lets the public map tiles be cached", async () => {
    vi.stubEnv("BOARD_ACCESS_TOKEN", TOKEN);
    const cookie = `${ACCESS_COOKIE}=${cookieValue(TOKEN)}`;
    const page = await proxy(new NextRequest("https://board.example.com/", { headers: { cookie } }));
    expect(page.headers.get("cache-control")).toBe("no-store, max-age=0");
    const tile = await proxy(new NextRequest("https://board.example.com/api/tiles/10/282/427", { headers: { cookie } }));
    expect(tile.headers.get("cache-control")).toBeNull();
    expect((await proxy(new NextRequest("https://board.example.com/api/board"))).status).toBe(401);
  });
});

describe("board from the Job Status screen", () => {
  afterEach(() => {
    setUserStoreForTests(null);
    vi.unstubAllEnvs();
  });

  it("opens for someone signed in to /control, without the TV code; others still go to /login", async () => {
    vi.stubEnv("BOARD_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("CONTROL_USERS", "");
    const store = new MemoryUserStore();
    await store.put({ username: "jorge", name: "Jorge", office: false, crew: "Crew 2", password: hashPassword("crew2-pass", 100_000), createdAt: "t", createdBy: "test" });
    setUserStoreForTests(store);
    const session = `${CONTROL_COOKIE}=${sessionCookie((await store.get("jorge"))!)}`;

    const page = await proxy(new NextRequest("https://board.example.com/", { headers: { cookie: session } }));
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect((await proxy(new NextRequest("https://board.example.com/api/board", { headers: { cookie: session } }))).status).toBe(200);

    const forged = await proxy(new NextRequest("https://board.example.com/", { headers: { cookie: `${CONTROL_COOKIE}=jorge.9999999999.${"A".repeat(43)}` } }));
    expect(forged.status).toBe(307);
    expect(forged.headers.get("location")).toBe("https://board.example.com/login");
  });
});
