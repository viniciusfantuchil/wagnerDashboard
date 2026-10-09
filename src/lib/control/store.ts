// Where control-screen users live: a private Google Sheet, reached only by the server through the board's
// service account. Each row is one user with the password HASH (never the password). Users in the
// CONTROL_USERS variable, if any, are read-only here.

import { parseServiceAccount, safeText, ServiceAccountAuth } from "@/lib/google/auth";
import type { UserEntry } from "./users";

export interface StoredUser extends UserEntry {
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface UserStore {
  get(username: string): Promise<StoredUser | undefined>;
  list(): Promise<StoredUser[]>;
  put(user: StoredUser): Promise<void>;
  remove(username: string): Promise<void>;
}

export const SPREADSHEETS = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
/** Columns of the users sheet, in order. Row 1 holds these names; one user per row below it. */
export const SHEET_COLUMNS = ["username", "name", "role", "crew", "password", "createdAt", "createdBy", "updatedAt", "updatedBy"] as const;
const RANGE = "A1:I";
/** Sign-in checks read the sheet; this keeps Google's per-minute read quota out of reach. Writes clear it. */
const CACHE_MS = 30_000;

/** The sheet could not be read or written. `hint` tells an admin what to fix, without any secret in it. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/** Plain-English fix for a Google Sheets API error, from its status and message. */
export function storeHint(status: number, body: string): string {
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(body)) {
    return "The Google Sheets API is off. Enable it in the Google Cloud project of the service account, wait a minute and try again.";
  }
  if (status === 403 || status === 401) return "The service account cannot open the users sheet. Share the sheet with the service account's email as Editor.";
  if (status === 404) return "The users sheet was not found. Check USERS_SHEET_ID in Vercel (the ID between /d/ and /edit) and redeploy.";
  if (status === 400 && /not supported for this document/i.test(body)) {
    return "The users file is an Excel file, not a Google Sheet. In Google Drive create a new Google Sheet and use its ID.";
  }
  if (status === 429) return "Google is limiting requests to the users sheet. Try again in a minute.";
  return `The users sheet answered HTTP ${status}. Try again shortly.`;
}

type Row = (string | number | boolean | undefined)[];
const cell = (v: Row[number]) => (v === undefined || v === null ? "" : String(v).trim());

function fromRow(row: Row): StoredUser | undefined {
  const [username, name, role, crew, password, createdAt, createdBy, updatedAt, updatedBy] = SHEET_COLUMNS.map((_, i) => cell(row[i]));
  if (!username || !password) return undefined;
  const r = role.toLowerCase();
  const user: StoredUser = {
    username: username.toLowerCase(),
    name: name || username,
    password,
    office: r === "admin" || r === "office",
    createdAt,
    createdBy,
  };
  if (r === "admin") user.admin = true;
  if (crew) user.crew = crew;
  if (updatedAt) user.updatedAt = updatedAt;
  if (updatedBy) user.updatedBy = updatedBy;
  return user;
}

function toRow(u: StoredUser): string[] {
  const role = u.admin ? "admin" : u.office ? "office" : "crew lead";
  return [u.username, u.name, role, u.crew ?? "", u.password, u.createdAt, u.createdBy, u.updatedAt ?? "", u.updatedBy ?? ""];
}

/**
 * Users kept in a private Google Sheet of the Wagner account, shared with the board's service account as Editor.
 * Free, and it reuses GOOGLE_SERVICE_ACCOUNT_JSON. The first tab holds a header row and one user per row; the
 * password column is a PBKDF2 hash, never the password. Only the server reads or writes the sheet.
 */
export class GoogleSheetsUserStore implements UserStore {
  private cache: { at: number; users: StoredUser[] } | null = null;

  constructor(
    private readonly sheetId: string,
    private readonly auth: { token(): Promise<string> },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  private async call(method: "GET" | "PUT", query: string, body?: unknown): Promise<{ values?: Row[] }> {
    const url = `${SHEETS_API}/${encodeURIComponent(this.sheetId)}/values/${encodeURIComponent(RANGE)}?${query}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${await this.auth.token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new StoreError(`User store: HTTP ${res.status} ${text}`, storeHint(res.status, text));
    }
    return (await res.json()) as { values?: Row[] };
  }

  private async read(): Promise<{ users: StoredUser[]; rows: number }> {
    const { values = [] } = await this.call("GET", "majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE");
    const users = values
      .slice(1)
      .map(fromRow)
      .filter((u): u is StoredUser => !!u);
    return { users, rows: values.length };
  }

  async list() {
    if (this.cache && this.clock() - this.cache.at < CACHE_MS) return [...this.cache.users];
    const { users } = await this.read();
    const sorted = users.sort((a, b) => a.username.localeCompare(b.username));
    this.cache = { at: this.clock(), users: sorted };
    return [...sorted];
  }

  async get(username: string) {
    return (await this.list()).find((u) => u.username === username.toLowerCase());
  }

  /** Rewrites the whole (small) table from a fresh read, blanking rows a removal leaves behind. */
  private async write(change: (users: StoredUser[]) => StoredUser[]) {
    this.cache = null;
    const { users, rows } = await this.read();
    const next = change(users).sort((a, b) => a.username.localeCompare(b.username));
    const values: string[][] = [[...SHEET_COLUMNS], ...next.map(toRow)];
    while (values.length < rows) values.push(SHEET_COLUMNS.map(() => ""));
    // RAW: values are stored as typed text, never read as formulas.
    await this.call("PUT", "valueInputOption=RAW", { range: RANGE, majorDimension: "ROWS", values });
  }

  async put(user: StoredUser) {
    await this.write((users) => [...users.filter((u) => u.username !== user.username), user]);
  }

  async remove(username: string) {
    await this.write((users) => users.filter((u) => u.username !== username));
  }
}

/** For tests and local development. */
export class MemoryUserStore implements UserStore {
  private readonly users = new Map<string, StoredUser>();
  async get(username: string) {
    return this.users.get(username);
  }
  async list() {
    return [...this.users.values()].sort((a, b) => a.username.localeCompare(b.username));
  }
  async put(user: StoredUser) {
    this.users.set(user.username, { ...user });
  }
  async remove(username: string) {
    this.users.delete(username);
  }
}

type Env = Record<string, string | undefined>;
let cached: { key: string; store: UserStore } | null = null;
let testStore: UserStore | null = null;

/** The users sheet when USERS_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON are set, or null if not set up. */
export function getUserStore(env: Env = process.env): UserStore | null {
  if (testStore) return testStore;
  const sheetId = env.USERS_SHEET_ID?.trim();
  const key = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!sheetId || !key) return null;
  const cacheKey = `${sheetId}\n${key}`;
  if (cached?.key !== cacheKey) {
    cached = { key: cacheKey, store: new GoogleSheetsUserStore(sheetId, new ServiceAccountAuth(parseServiceAccount(key), SPREADSHEETS)) };
  }
  return cached.store;
}

/** Tests only: route handlers and the proxy use this store instead of the sheet. */
export function setUserStoreForTests(store: UserStore | null) {
  testStore = store;
}
