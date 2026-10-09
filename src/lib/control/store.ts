// Where control-screen users live: an Upstash Redis database (Vercel → Storage → Upstash), reached only by the
// server over its REST API. Each user is one field of the hash "control:users": username → JSON with the
// password HASH (never the password). Users in the CONTROL_USERS variable, if any, are read-only here.

import { safeText } from "@/lib/google/auth";
import type { UserEntry } from "./users";

const KEY = "control:users";

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

export class RedisUserStore implements UserStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async command<T>(...args: string[]): Promise<T> {
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`User store: HTTP ${res.status} ${await safeText(res)}`);
    const body = (await res.json()) as { result?: T; error?: string };
    if (body.error) throw new Error(`User store: ${body.error}`);
    return body.result as T;
  }

  async get(username: string) {
    const raw = await this.command<string | null>("HGET", KEY, username);
    return raw ? (JSON.parse(raw) as StoredUser) : undefined;
  }

  async list() {
    const flat = (await this.command<string[] | null>("HGETALL", KEY)) ?? [];
    const out: StoredUser[] = [];
    for (let i = 1; i < flat.length; i += 2) out.push(JSON.parse(flat[i]) as StoredUser);
    return out.sort((a, b) => a.username.localeCompare(b.username));
  }

  async put(user: StoredUser) {
    await this.command("HSET", KEY, user.username, JSON.stringify(user));
  }

  async remove(username: string) {
    await this.command("HDEL", KEY, username);
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

/** Upstash Redis from the variables the Vercel integration sets (either naming), or null if not connected. */
export function getUserStore(env: Env = process.env): UserStore | null {
  if (testStore) return testStore;
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const key = `${url}\n${token}`;
  if (cached?.key !== key) cached = { key, store: new RedisUserStore(url, token) };
  return cached.store;
}

/** Tests only: route handlers and the proxy use this store instead of Redis. */
export function setUserStoreForTests(store: UserStore | null) {
  testStore = store;
}
