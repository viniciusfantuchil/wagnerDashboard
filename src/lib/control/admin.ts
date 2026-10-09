// Adding, changing and removing control-screen users (admins only, on /control/users). Passwords arrive once over
// HTTPS, are hashed on the server and never stored, logged or sent back.

import { CREW_ORDER } from "@/lib/crews";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password";
import type { StoredUser, UserStore } from "./store";
import { publicUser, USERNAME, type ControlUser, type UserEntry } from "./users";

export type Role = "admin" | "office" | "crew";
export const MAX_PASSWORD_LENGTH = 128;

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409,
  ) {
    super(message);
  }
}

export interface UserRow extends ControlUser {
  role: Role;
  /** "vercel" = set in the CONTROL_USERS variable, read-only here. */
  source: "screen" | "vercel";
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const roleOf = (u: ControlUser): Role => (u.admin ? "admin" : u.office ? "office" : "crew");

export function toRow(u: UserEntry & Partial<StoredUser>, source: UserRow["source"]): UserRow {
  return {
    ...publicUser(u),
    role: roleOf(publicUser(u)),
    source,
    ...(u.createdAt ? { createdAt: u.createdAt, createdBy: u.createdBy } : {}),
    ...(u.updatedAt ? { updatedAt: u.updatedAt, updatedBy: u.updatedBy } : {}),
  };
}

function text(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) throw new AdminError(`${field} is required`, 400);
  if (v.trim().length > max) throw new AdminError(`${field} is too long`, 400);
  return v.trim();
}

function password(v: unknown): string {
  if (typeof v !== "string" || v.length < MIN_PASSWORD_LENGTH) throw new AdminError(`Password needs at least ${MIN_PASSWORD_LENGTH} characters`, 400);
  if (v.length > MAX_PASSWORD_LENGTH) throw new AdminError("Password is too long", 400);
  return v;
}

function role(v: unknown, crew: unknown): { office: boolean; admin?: true; crew?: string } {
  if (v === "admin") return { office: true, admin: true };
  if (v === "office") return { office: true };
  if (v === "crew") {
    if (typeof crew !== "string" || !CREW_ORDER.includes(crew)) throw new AdminError(`Pick a crew: ${CREW_ORDER.join(", ")}`, 400);
    return { office: false, crew };
  }
  throw new AdminError("Role must be admin, office or crew", 400);
}

const now = () => new Date().toISOString();

export async function createUser(store: UserStore, envUsers: UserEntry[], input: Record<string, unknown>, by: ControlUser): Promise<UserRow> {
  const username = text(input.username, "Username", 32).toLowerCase();
  if (!USERNAME.test(username)) throw new AdminError("Username: 2–32 letters, numbers, . _ or -", 400);
  if (envUsers.some((u) => u.username === username) || (await store.get(username))) {
    throw new AdminError(`"${username}" already exists`, 409);
  }
  const user: StoredUser = {
    username,
    name: text(input.name, "Name", 40),
    password: hashPassword(password(input.password)),
    ...role(input.role, input.crew),
    createdAt: now(),
    createdBy: by.name,
  };
  await store.put(user);
  return toRow(user, "screen");
}

export async function updateUser(
  store: UserStore,
  envUsers: UserEntry[],
  username: string,
  input: Record<string, unknown>,
  by: ControlUser,
): Promise<UserRow> {
  if (envUsers.some((u) => u.username === username)) throw new AdminError("This user is set in Vercel (CONTROL_USERS); change it there", 403);
  const current = await store.get(username);
  if (!current) throw new AdminError("User not found", 404);
  const next: StoredUser = { ...current, updatedAt: now(), updatedBy: by.name };
  if (input.name !== undefined) next.name = text(input.name, "Name", 40);
  if (input.password !== undefined) next.password = hashPassword(password(input.password)); // also signs them out
  if (input.role !== undefined) {
    if (username === by.username && input.role !== "admin") throw new AdminError("You can't remove your own admin role", 403);
    const r = role(input.role, input.crew);
    delete next.admin;
    delete next.crew;
    Object.assign(next, r);
  }
  await store.put(next);
  return toRow(next, "screen");
}

export async function removeUser(store: UserStore, envUsers: UserEntry[], username: string, by: ControlUser): Promise<void> {
  if (envUsers.some((u) => u.username === username)) throw new AdminError("This user is set in Vercel (CONTROL_USERS); remove it there", 403);
  if (username === by.username) throw new AdminError("You can't remove yourself", 403);
  if (!(await store.get(username))) throw new AdminError("User not found", 404);
  await store.remove(username);
}

export async function listUsers(store: UserStore | null, envUsers: UserEntry[]): Promise<UserRow[]> {
  const stored = store ? await store.list() : [];
  return [
    ...envUsers.map((u) => toRow(u, "vercel")),
    ...stored.filter((s) => !envUsers.some((e) => e.username === s.username)).map((u) => toRow(u, "screen")),
  ];
}

/** True when no admin exists yet, so /control/setup may create the first one. */
export async function needsSetup(store: UserStore | null, envUsers: UserEntry[]): Promise<boolean> {
  if (!store) return false;
  if (envUsers.some((u) => u.admin)) return false;
  return !(await store.list()).some((u) => u.admin);
}
