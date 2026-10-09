"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role, UserRow } from "@/lib/control/admin";
import type { ControlUser } from "@/lib/control/users";
import { CREW_ORDER } from "@/lib/crews";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", office: "Office", crew: "Crew lead" };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}

function RolePicker({ role, crew, onChange }: { role: Role; crew: string; onChange: (r: Role, c: string) => void }) {
  return (
    <div className="users-role">
      <select value={role} onChange={(e) => onChange(e.target.value as Role, crew)} aria-label="Role">
        <option value="crew">Crew lead</option>
        <option value="office">Office</option>
        <option value="admin">Admin</option>
      </select>
      {role === "crew" && (
        <select value={crew} onChange={(e) => onChange(role, e.target.value)} aria-label="Crew">
          {CREW_ORDER.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      )}
    </div>
  );
}

const EMPTY = { username: "", name: "", role: "crew" as Role, crew: CREW_ORDER[0], password: "" };

export function UsersScreen({ me }: { me: ControlUser }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [connected, setConnected] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await call("/api/control/users", "GET");
      setUsers(j.users);
      setConnected(j.storeConnected);
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not load users" });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, crew: form.role === "crew" ? form.crew : undefined };
    run(async () => {
      await call("/api/control/users", "POST", body);
      setForm(EMPTY);
    }, `Added ${form.username.toLowerCase()}. Give them their username and password.`);
  };

  return (
    <div className="control-page">
      <header className="control-head">
        <div>
          <h1>Users</h1>
          <p>{me.name} · Admin</p>
        </div>
        <div className="control-actions">
          <a className="control-link" href="/control">
            Jobs
          </a>
        </div>
      </header>

      {!connected && <p className="control-banner">Set USERS_SHEET_ID in Vercel (see the README) to add users here.</p>}
      {msg && <p className={`control-banner${msg.ok ? " ok" : " error"}`}>{msg.text}</p>}

      <form className="control-form users-add" onSubmit={add} autoComplete="off">
        <h2>Add a user</h2>
        <label>
          Username
          <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label>
          Name shown on screen
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="off" required />
        </label>
        <label>
          Role
          <RolePicker role={form.role} crew={form.crew} onChange={(role, crew) => setForm({ ...form, role, crew })} />
        </label>
        <label>
          Password (8+ characters)
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={8} required />
        </label>
        <button type="submit" disabled={busy || !connected}>
          Add user
        </button>
      </form>

      <section className="control-day">
        <h2>People</h2>
        {!users && <p className="control-empty">Loading…</p>}
        {users?.map((u) => (
          <article key={u.username} className="cjob users-row">
            <header>
              <span>{u.username}</span>
              <span>{u.source === "vercel" ? "Set in Vercel" : u.updatedAt ? `Changed by ${u.updatedBy}` : u.createdBy ? `Added by ${u.createdBy}` : ""}</span>
            </header>
            <h3>
              {u.name} <small>· {ROLE_LABEL[u.role]}{u.crew ? ` · ${u.crew}` : ""}</small>
            </h3>
            {u.source === "screen" && (
              <div className="users-actions">
                {u.username !== me.username && (
                  <RolePicker
                    role={u.role}
                    crew={u.crew ?? CREW_ORDER[0]}
                    onChange={(role, crew) =>
                      run(() => call(`/api/control/users/${encodeURIComponent(u.username)}`, "PATCH", { role, crew: role === "crew" ? crew : undefined }), `Changed ${u.username}'s role.`)
                    }
                  />
                )}
                {reset?.username === u.username ? (
                  <form
                    className="cjob-note"
                    autoComplete="off"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const password = reset.password;
                      setReset(null);
                      run(() => call(`/api/control/users/${encodeURIComponent(u.username)}`, "PATCH", { password }), `New password set for ${u.username}. They are signed out everywhere.`);
                    }}
                  >
                    <input type="password" placeholder="New password (8+)" minLength={8} value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} autoComplete="new-password" autoFocus required />
                    <button type="submit" disabled={busy}>
                      Save
                    </button>
                  </form>
                ) : (
                  <button type="button" className="users-btn" disabled={busy} onClick={() => setReset({ username: u.username, password: "" })}>
                    Set new password
                  </button>
                )}
                {u.username !== me.username && (
                  <button
                    type="button"
                    className="users-btn danger"
                    disabled={busy}
                    onClick={() => window.confirm(`Remove ${u.name} (${u.username})? They are signed out at once.`) && run(() => call(`/api/control/users/${encodeURIComponent(u.username)}`, "DELETE"), `Removed ${u.username}.`)}
                  >
                    Remove
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
