// OAuth access tokens for a Google Cloud service account (JWT bearer flow), using only node:crypto.
// https://developers.google.com/identity/protocols/oauth2/service-account#httprest

import { createSign } from "node:crypto";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const CALENDAR_READONLY = "https://www.googleapis.com/auth/calendar.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Refresh this long before the token expires. */
const EXPIRY_MARGIN_S = 300;

/** Reads the key from GOOGLE_SERVICE_ACCOUNT_JSON: base64 of the key file (spec §9), or the raw JSON. */
export function parseServiceAccount(value: string): ServiceAccount {
  const text = value.trim().startsWith("{") ? value : Buffer.from(value, "base64").toString("utf8");
  let key: Partial<ServiceAccount>;
  try {
    key = JSON.parse(text);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 of a JSON key file");
  }
  if (!key.client_email || !key.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }
  return { client_email: key.client_email, private_key: key.private_key, token_uri: key.token_uri };
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** A signed JWT assertion for the token endpoint. */
export function signAssertion(account: ServiceAccount, scope: string, nowS: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: account.token_uri ?? DEFAULT_TOKEN_URI,
      iat: nowS,
      exp: nowS + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(account.private_key))}`;
}

export class ServiceAccountAuth {
  private cached: { token: string; expiresAtS: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly scope: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async token(): Promise<string> {
    const nowS = Math.floor(this.clock() / 1000);
    if (this.cached && this.cached.expiresAtS - EXPIRY_MARGIN_S > nowS) return this.cached.token;
    // Calendars are read in parallel; they share one token request.
    this.pending ??= this.fetchToken(nowS).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchToken(nowS: number): Promise<string> {
    const res = await this.fetchImpl(this.account.token_uri ?? DEFAULT_TOKEN_URI, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signAssertion(this.account, this.scope, nowS),
      }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Google token request failed: HTTP ${res.status} ${await safeText(res)}`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error("Google token response has no access_token");
    this.cached = { token: body.access_token, expiresAtS: nowS + (body.expires_in ?? 3600) };
    return body.access_token;
  }
}

/** Response text for error messages, trimmed. Never includes request credentials. */
export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}
