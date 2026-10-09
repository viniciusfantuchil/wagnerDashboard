// Slows down password guessing on /api/control/login: after 5 failed attempts for a username (or from one
// address), further attempts are refused for 15 minutes. In memory per server instance; together with the slow
// PBKDF2 check that is enough for a small team's login.

export const MAX_FAILURES = 5;
export const LOCK_MS = 15 * 60_000;

interface Entry {
  failures: number;
  lockedUntil: number;
}

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly clock: () => number = Date.now) {}

  /** Milliseconds until any of these keys may try again; 0 = allowed. */
  waitMs(keys: string[]): number {
    const now = this.clock();
    return Math.max(0, ...keys.map((k) => (this.entries.get(k)?.lockedUntil ?? 0) - now));
  }

  fail(keys: string[]): void {
    const now = this.clock();
    for (const k of keys) {
      const e = this.entries.get(k) ?? { failures: 0, lockedUntil: 0 };
      if (e.lockedUntil && e.lockedUntil <= now) e.failures = 0;
      e.failures += 1;
      if (e.failures >= MAX_FAILURES) e.lockedUntil = now + LOCK_MS;
      this.entries.set(k, e);
    }
    if (this.entries.size > 5_000) this.entries.clear(); // bound memory
  }

  succeed(keys: string[]): void {
    for (const k of keys) this.entries.delete(k);
  }
}

export const loginThrottle = new LoginThrottle();
