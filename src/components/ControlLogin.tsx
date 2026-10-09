"use client";

import { useState } from "react";

/** Shared shell for the sign-in forms. Fields ask the browser not to save or suggest what is typed. */
function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="control-page">
      <header className="control-head">
        <div>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
      </header>
      {children}
    </div>
  );
}

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
}

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/control/login", { username, password });
      setPassword("");
      location.replace("/control");
    } catch (err) {
      setPassword("");
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  };

  return (
    <Shell title="Job Status" sub="Wagner Pavers">
      <form className="control-form" onSubmit={submit} autoComplete="off">
        <h2>Sign in</h2>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
        </label>
        {error && <p className="control-banner error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="control-hint">Forgot your password? Ask an admin to set a new one.</p>
      </form>
    </Shell>
  );
}

/** One-time setup of a TV or office computer: the board's access code is typed here, never put in the address. */
export function BoardLoginForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/board/login", { token });
      setToken("");
      location.replace("/");
    } catch (err) {
      setToken("");
      setError(err instanceof Error ? err.message : "Could not open the board");
      setBusy(false);
    }
  };
  return (
    <Shell title="Operations Board" sub="Set up this screen">
      <form className="control-form" onSubmit={submit} autoComplete="off">
        <p className="control-hint">Type the board&apos;s access code once on this TV or computer. It stays set up until the code changes.</p>
        <label>
          Access code
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" required />
        </label>
        {error && <p className="control-banner error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Checking…" : "Open the board"}
        </button>
      </form>
    </Shell>
  );
}

/** Creates the first admin; works only while there is none, on a device that already shows the TV board. */
export function SetupForm() {
  const [f, setF] = useState({ username: "", name: "", password: "", again: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const mismatch = f.again !== "" && f.again !== f.password;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/control/setup", { username: f.username, name: f.name, password: f.password });
      setF({ username: "", name: "", password: "", again: "" });
      location.replace("/control/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the admin");
      setBusy(false);
    }
  };
  return (
    <Shell title="Job Status" sub="First admin">
      <form className="control-form" onSubmit={submit} autoComplete="off">
        <p className="control-hint">Create the first admin. This works only once, while no admin exists.</p>
        <label>
          Username
          <input value={f.username} onChange={set("username")} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
        </label>
        <label>
          Name shown on screen
          <input value={f.name} onChange={set("name")} autoComplete="off" required />
        </label>
        <label>
          Password (8+ characters)
          <input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" minLength={8} required />
        </label>
        <label>
          Password again
          <input type="password" value={f.again} onChange={set("again")} autoComplete="new-password" required />
        </label>
        {mismatch && <p className="control-banner error">The two passwords are different.</p>}
        {error && <p className="control-banner error">{error}</p>}
        <button type="submit" disabled={busy || mismatch}>
          {busy ? "Creating…" : "Create admin"}
        </button>
      </form>
    </Shell>
  );
}
