/**
 * Google OAuth for the Gmail connector (docs/prd-email-triage.md B1, §4.2):
 * the pure pieces — PKCE + state generation, the authorize URL, `returnTo`
 * validation, granted-scope checks, the app redirect after the callback —
 * plus thin `fetch` wrappers for Google's token / revoke endpoints.
 *
 * No Convex imports: unit-tested on its own (`googleOAuth.test.ts`). The
 * Convex entry points live in `convex/oauth.ts` (start + callback) and
 * `convex/email/gmailAuth.ts` (refresh + revoke).
 *
 * Secrets: `GOOGLE_CLIENT_SECRET` is read only on the server, inside the
 * token calls; nothing here logs a token or the secret.
 */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** What we ask Google for. `openid email` names the account on the consent screen. */
export const GMAIL_REQUESTED_SCOPES = ["openid", "email", GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] as const;
/** What the grant must contain or nothing is stored. */
export const GMAIL_REQUIRED_SCOPES = [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] as const;

/** The callback route on the deployment's `.convex.site` origin (convex/http.ts). */
export const GOOGLE_CALLBACK_PATH = "/oauth/google/callback";
/** A state row lives this long; an older callback is refused. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Where the user lands when no (valid) `returnTo` is known. */
export const DEFAULT_CONNECTORS_RETURN_TO = "/agents?view=connectors";
/** Dev fallback when the deployment has no `SITE_URL` (never an attacker origin). */
export const DEV_SITE_URL_FALLBACK = "http://localhost:3000";

const RETURN_TO_MAX_LEN = 512;

// ─── Random + PKCE ──────────────────────────────────────────────────────────

/** base64url without padding (RFC 7636 §A). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `byteLength` random bytes as base64url (32 bytes → 43 chars). */
export function randomUrlSafeToken(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** A fresh one-time `state` (opaque, 256 bits). */
export function generateOAuthState(): string {
  return randomUrlSafeToken(32);
}

/** SHA-256 of a one-time token, base64url — what `oauthPendingGrants` stores. */
export async function hashOneTimeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64UrlEncode(new Uint8Array(digest));
}

/** A PKCE code verifier: 43 chars from the unreserved alphabet (RFC 7636 §4.1). */
export function generateCodeVerifier(): string {
  return randomUrlSafeToken(32);
}

/** The S256 challenge: base64url(SHA-256(ascii(verifier))) (RFC 7636 §4.2). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

// ─── URLs ───────────────────────────────────────────────────────────────────

/** `${CONVEX_SITE_URL}/oauth/google/callback`, trailing slashes trimmed. */
export function googleRedirectUri(convexSiteUrl: string): string {
  return `${convexSiteUrl.replace(/\/+$/, "")}${GOOGLE_CALLBACK_PATH}`;
}

export function buildGoogleAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_REQUESTED_SCOPES.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

/**
 * Validate a post-connect return path. Only a same-app relative path is
 * accepted: it starts with a single `/`, has no backslash / control chars /
 * scheme, resolving it against a dummy origin keeps that origin, and the
 * normalised result does not start with `//` either (`/..//evil.com` resolves
 * to `//evil.com`) — so the callback can never become an open redirect.
 * Returns the normalised path (`pathname + search`, no fragment) or null.
 */
export function normalizeReturnTo(raw: string): string | null {
  if (raw.length === 0 || raw.length > RETURN_TO_MAX_LEN) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  const base = "https://app.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.origin !== base) return null;
  const normalized = `${url.pathname}${url.search}`;
  if (!normalized.startsWith("/") || normalized.startsWith("//") || normalized.startsWith("/\\")) return null;
  return normalized;
}

/** The app origin from `SITE_URL` (http/https only), else the dev fallback. */
export function resolveSiteUrl(raw: string | undefined): { origin: string; fromEnv: boolean } {
  if (raw) {
    try {
      const url = new URL(raw.trim());
      if (url.protocol === "https:" || url.protocol === "http:") {
        return { origin: url.origin, fromEnv: true };
      }
    } catch {
      // fall through to the fallback
    }
  }
  return { origin: DEV_SITE_URL_FALLBACK, fromEnv: false };
}

/** Why a connect did not finish — the `reason` the Connectors surface reads. */
export type GmailConnectErrorReason =
  | "denied" // the user cancelled on Google's consent screen
  | "invalid_state" // unknown or already-used state (replay)
  | "expired" // state older than 10 minutes
  | "disabled" // email triage is off for the org (I14)
  | "permission" // the grant lacks gmail.readonly or gmail.send
  | "demo_mailbox" // a dev seed mailbox occupies the slot
  | "not_member" // the user left the org mid-flow
  | "config" // client id / secret / site URL / KEK missing on the deployment
  | "failed"; // Google's token or profile call failed

/** The callback's outcome: a pending grant to finish in the app, or an error. */
export type CallbackOutcome = { kind: "pending"; token: string } | { kind: "error"; reason: GmailConnectErrorReason };

/**
 * The app URL the callback redirects to: `origin + returnTo` with
 * `gmail=pending&t=…` (finish in the app, `oauth.finishGmailConnect`) or
 * `gmail=error&reason=…`. Earlier gmail params are dropped.
 */
export function buildAppRedirect(origin: string, returnTo: string, outcome: CallbackOutcome): string {
  const url = new URL(normalizeReturnTo(returnTo) ?? DEFAULT_CONNECTORS_RETURN_TO, origin);
  url.searchParams.delete("gmail");
  url.searchParams.delete("reason");
  url.searchParams.delete("t");
  if (outcome.kind === "pending") {
    url.searchParams.set("gmail", "pending");
    url.searchParams.set("t", outcome.token);
  } else {
    url.searchParams.set("gmail", "error");
    url.searchParams.set("reason", outcome.reason);
  }
  return url.toString();
}

// ─── Scopes ─────────────────────────────────────────────────────────────────

/** Google returns granted scopes space-separated. */
export function parseScopes(scope: string | undefined | null): string[] {
  if (!scope) return [];
  return Array.from(new Set(scope.split(/\s+/).filter((s) => s.length > 0)));
}

/** True when every required Gmail scope was granted. */
export function hasRequiredGmailScopes(granted: readonly string[]): boolean {
  return GMAIL_REQUIRED_SCOPES.every((s) => granted.includes(s));
}

// ─── Stored credentials ─────────────────────────────────────────────────────

/** What `connectors.credentialsCiphertext` decrypts to for `gmail`. */
export type GmailCredentials = {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token lapses. */
  expiresAt: number;
  /** Space-separated granted scopes. */
  scope: string;
};

export function parseGmailCredentials(value: unknown): GmailCredentials | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.accessToken !== "string" ||
    typeof v.refreshToken !== "string" ||
    typeof v.expiresAt !== "number" ||
    typeof v.scope !== "string"
  ) {
    return null;
  }
  return { accessToken: v.accessToken, refreshToken: v.refreshToken, expiresAt: v.expiresAt, scope: v.scope };
}

/** Refresh when the access token lapses within this window. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 2 * 60_000;

export function needsRefresh(credentials: GmailCredentials, now: number): boolean {
  return credentials.expiresAt - now <= ACCESS_TOKEN_REFRESH_MARGIN_MS;
}

// ─── Token endpoint ─────────────────────────────────────────────────────────

export type GoogleTokenResponse = {
  accessToken: string;
  /** Absent on most refreshes — Google keeps the refresh token stable. */
  refreshToken?: string;
  expiresInSec: number;
  scope?: string;
  /** The `email` claim of the returned id_token (scope `openid email`). */
  idTokenEmail?: string;
};

/**
 * The `email` claim of an id_token we just received from Google's token
 * endpoint over TLS (so no signature check). Used only to name the account
 * for the revoke guard when the Gmail profile can't be read.
 */
export function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json: unknown = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    const email = (json as { email?: unknown } | null)?.email;
    return typeof email === "string" && email.length > 0 ? email.trim().toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A failed token call. `oauthError` is Google's `error` code (e.g.
 * `invalid_grant`); `status` is 0 for a network failure. Never carries a token.
 */
export class GoogleTokenError extends Error {
  readonly status: number;
  readonly oauthError: string | null;
  constructor(status: number, oauthError: string | null) {
    super(`Google token endpoint failed (${status}${oauthError ? ` ${oauthError}` : ""})`);
    this.name = "GoogleTokenError";
    this.status = status;
    this.oauthError = oauthError;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function postForm(url: string, form: Record<string, string>, fetchImpl: FetchLike): Promise<Response> {
  return await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
}

async function callTokenEndpoint(form: Record<string, string>, fetchImpl: FetchLike): Promise<GoogleTokenResponse> {
  let res: Response;
  try {
    res = await postForm(GOOGLE_TOKEN_URL, form, fetchImpl);
  } catch {
    throw new GoogleTokenError(0, null);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (!res.ok) {
    throw new GoogleTokenError(res.status, typeof b.error === "string" ? b.error : null);
  }
  if (typeof b.access_token !== "string" || b.access_token.length === 0) {
    throw new GoogleTokenError(res.status, "missing_access_token");
  }
  const expiresIn = typeof b.expires_in === "number" && b.expires_in > 0 ? b.expires_in : 3600;
  return {
    accessToken: b.access_token,
    refreshToken: typeof b.refresh_token === "string" && b.refresh_token.length > 0 ? b.refresh_token : undefined,
    expiresInSec: expiresIn,
    scope: typeof b.scope === "string" ? b.scope : undefined,
    idTokenEmail: emailFromIdToken(b.id_token),
  };
}

/** Authorization-code exchange with the client secret and the PKCE verifier. */
export async function exchangeAuthorizationCode(
  args: { code: string; codeVerifier: string; clientId: string; clientSecret: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<GoogleTokenResponse> {
  return await callTokenEndpoint(
    {
      grant_type: "authorization_code",
      code: args.code,
      code_verifier: args.codeVerifier,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
    },
    fetchImpl,
  );
}

/** Refresh-token grant. */
export async function refreshAccessToken(
  args: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: FetchLike = fetch,
): Promise<GoogleTokenResponse> {
  return await callTokenEndpoint(
    {
      grant_type: "refresh_token",
      refresh_token: args.refreshToken,
      client_id: args.clientId,
      client_secret: args.clientSecret,
    },
    fetchImpl,
  );
}

/**
 * Revoke a grant (best-effort). Revoking the refresh token ends the whole
 * grant, access tokens included. Returns the HTTP status (0 = network error).
 */
export async function revokeGoogleToken(token: string, fetchImpl: FetchLike = fetch): Promise<number> {
  try {
    const res = await postForm(GOOGLE_REVOKE_URL, { token }, fetchImpl);
    return res.status;
  } catch {
    return 0;
  }
}

/** The OAuth client config from the deployment env, or null when incomplete. */
export function readGoogleClientConfig(env: Record<string, string | undefined>): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
