import { describe, expect, it } from "vitest";
import { cookieValue, decideAccess } from "./access";

const TOKEN = "s3cr3t-token-for-the-tv-0123456789";
const url = (path: string) => new URL(`https://board.example.com${path}`);

describe("decideAccess", () => {
  it("lets the TV in with the key once, sets a hashed cookie and redirects to the clean URL", () => {
    const d = decideAccess({ token: TOKEN, url: url("/?key=" + TOKEN), cookie: undefined, production: true });
    expect(d).toEqual({ action: "grant", location: "/", cookie: cookieValue(TOKEN) });
    expect(d.action === "grant" && d.cookie).not.toContain(TOKEN);
  });

  it("keeps other query parameters when stripping the key", () => {
    const d = decideAccess({ token: TOKEN, url: url(`/?a=1&key=${TOKEN}&b=2`), cookie: undefined, production: true });
    expect(d).toMatchObject({ action: "grant", location: "/?a=1&b=2" });
  });

  it("allows requests with the cookie", () => {
    expect(decideAccess({ token: TOKEN, url: url("/api/board"), cookie: cookieValue(TOKEN), production: true })).toEqual({ action: "allow" });
  });

  it.each([
    ["no key and no cookie", "/", undefined],
    ["a wrong key", "/?key=wrong", undefined],
    ["an empty key", "/?key=", undefined],
    ["the raw token as cookie", "/", TOKEN],
    ["a cookie from an old token", "/", cookieValue("an-older-token-that-was-rotated")],
  ])("denies %s", (_, path, cookie) => {
    expect(decideAccess({ token: TOKEN, url: url(path), cookie, production: true })).toEqual({ action: "deny" });
  });

  it("denies a wrong key even with a valid cookie", () => {
    expect(decideAccess({ token: TOKEN, url: url("/?key=wrong"), cookie: cookieValue(TOKEN), production: true })).toEqual({ action: "deny" });
  });

  it("refuses everything in production when no token is configured", () => {
    expect(decideAccess({ token: undefined, url: url("/"), cookie: undefined, production: true })).toEqual({ action: "misconfigured" });
    expect(decideAccess({ token: "", url: url("/"), cookie: undefined, production: true })).toEqual({ action: "misconfigured" });
  });

  it("refuses a token that is too short", () => {
    expect(decideAccess({ token: "short", url: url("/?key=short"), cookie: undefined, production: true })).toEqual({ action: "misconfigured" });
  });

  it("stays open in local development when no token is configured", () => {
    expect(decideAccess({ token: undefined, url: url("/"), cookie: undefined, production: false })).toEqual({ action: "allow" });
  });
});
