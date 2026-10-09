"use client";

import { useState } from "react";

const MIN_PASSWORD_LENGTH = 8;
const ITERATIONS = 600_000; // must match lib/control/password.ts

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
      const res = await fetch("/api/control/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      location.href = "/control";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  };

  return (
    <div className="control-page">
      <header className="control-head">
        <div>
          <h1>Job Status</h1>
          <p>Wagner Pavers</p>
        </div>
      </header>
      <form className="control-form" onSubmit={submit}>
        <h2>Sign in</h2>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="control-banner error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="control-hint">Forgot your password? Ask the office to set a new one.</p>
      </form>
    </div>
  );
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Computes a PBKDF2 hash in the browser. The password is never sent anywhere. */
export function PasswordHashTool() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const problem =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? `At least ${MIN_PASSWORD_LENGTH} characters.`
      : again && again !== password
        ? "The two passwords are different."
        : null;

  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !password) return;
    setBusy(true);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, key, 256);
    setHash(`pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(bits)}`);
    setCopied(false);
    setBusy(false);
  };

  return (
    <div className="control-page">
      <header className="control-head">
        <div>
          <h1>Password hash</h1>
          <p>For CONTROL_USERS</p>
        </div>
      </header>
      <form className="control-form" onSubmit={make}>
        <p className="control-hint">
          Type the password you chose for one person. This page turns it into a hash right here in your browser; the
          password is not sent anywhere. Put the hash in that person&apos;s entry in CONTROL_USERS on Vercel, and give the
          password to the person.
        </p>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Password again
          <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
        </label>
        {problem && <p className="control-banner error">{problem}</p>}
        <button type="submit" disabled={busy || !!problem || !password || again !== password}>
          {busy ? "Working…" : "Make hash"}
        </button>
        {hash && (
          <>
            <textarea className="control-hash" readOnly value={hash} rows={3} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(hash);
                setCopied(true);
              }}
            >
              {copied ? "Copied ✓" : "Copy hash"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
