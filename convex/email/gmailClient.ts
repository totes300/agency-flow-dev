/**
 * A minimal Gmail REST client (docs/prd-email-triage.md B1; B3 adds history /
 * messages, B5 adds send). Plain `fetch` against
 * `https://gmail.googleapis.com/gmail/v1` — no SDK — so it runs in the default
 * Convex runtime (no "use node").
 *
 * Shape for tests: `GmailClient` is the interface the email jobs depend on;
 * `createGmailClient` builds the real one over a `GmailTransport`, a
 * fetch-compatible function. A test injects a fake transport (or a fake
 * `GmailClient` outright) — nothing here reaches for the network on its own.
 *
 * Errors: every non-2xx and every network failure becomes a `GmailApiError`
 * with a `kind` the send pipeline keys its fix off (PRD §5.4):
 *   disconnected → Reconnect · permission → reconnect with the scope ·
 *   recipient → edit To/Cc · quota / transient → Retry · unknown → show it.
 * The message never carries the access token or the response body verbatim.
 */

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

export type GmailErrorKind = "disconnected" | "permission" | "recipient" | "quota" | "transient" | "unknown";

export class GmailApiError extends Error {
  readonly kind: GmailErrorKind;
  /** HTTP status; 0 for a network failure. */
  readonly status: number;
  /** Google's first `errors[].reason` (e.g. `rateLimitExceeded`), when given. */
  readonly reason: string | null;
  constructor(kind: GmailErrorKind, status: number, reason: string | null, message: string) {
    super(message);
    this.name = "GmailApiError";
    this.kind = kind;
    this.status = status;
    this.reason = reason;
  }
}

/** A fetch-compatible transport — the real `fetch` in production, a fake in tests. */
export type GmailTransport = (url: string, init: RequestInit) => Promise<Response>;

export type GmailProfile = {
  emailAddress: string;
  /** The mailbox's current history id — B3's "start from now" cursor (D34). */
  historyId: string;
  messagesTotal: number | null;
  threadsTotal: number | null;
};

/** What the email jobs depend on. B3 / B5 extend it. */
export interface GmailClient {
  getProfile(): Promise<GmailProfile>;
}

const RATE_LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
]);

/** Google's error envelope: `{ error: { code, message, status, errors: [{ reason, message }] } }`. */
function readErrorBody(body: unknown): { reason: string | null; message: string | null; status: string | null } {
  const err = (body as { error?: unknown } | null)?.error;
  if (typeof err !== "object" || err === null) return { reason: null, message: null, status: null };
  const e = err as { message?: unknown; status?: unknown; errors?: unknown };
  const first = Array.isArray(e.errors) ? (e.errors[0] as { reason?: unknown } | undefined) : undefined;
  return {
    reason: typeof first?.reason === "string" ? first.reason : null,
    message: typeof e.message === "string" ? e.message : null,
    status: typeof e.status === "string" ? e.status : null,
  };
}

/**
 * Map an HTTP failure to a kind (PRD §5.4). Pure — unit-tested.
 *   401                                  → disconnected (token revoked / expired)
 *   403 + a rate-limit reason            → quota
 *   403 otherwise                        → permission (scope missing)
 *   429                                  → quota
 *   400 that names a recipient / address → recipient (B5 send)
 *   408, 5xx                             → transient
 *   anything else                        → unknown
 */
export function classifyGmailHttpError(status: number, body: unknown): { kind: GmailErrorKind; reason: string | null } {
  const { reason, message } = readErrorBody(body);
  if (status === 401) return { kind: "disconnected", reason };
  if (status === 403) {
    return { kind: reason && RATE_LIMIT_REASONS.has(reason) ? "quota" : "permission", reason };
  }
  if (status === 429) return { kind: "quota", reason };
  if (status === 400 && message && /recipient|invalid (to|cc|bcc) header|address/i.test(message)) {
    return { kind: "recipient", reason };
  }
  if (status === 408 || status >= 500) return { kind: "transient", reason };
  return { kind: "unknown", reason };
}

/**
 * The real client. `accessToken` is a getter so a long-running job can hand
 * in `() => getGmailAccessToken(ctx, connectorId)` and get a refreshed token
 * per call.
 */
export function createGmailClient(
  accessToken: string | (() => Promise<string>),
  transport: GmailTransport = (url, init) => fetch(url, init),
): GmailClient {
  async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const token = typeof accessToken === "string" ? accessToken : await accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await transport(`${GMAIL_API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new GmailApiError("transient", 0, null, `Gmail ${method} ${path} failed: network error`);
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const { kind, reason } = classifyGmailHttpError(res.status, parsed);
      throw new GmailApiError(kind, res.status, reason, `Gmail ${method} ${path} failed (${res.status}${reason ? ` ${reason}` : ""})`);
    }
    return parsed as T;
  }

  return {
    async getProfile() {
      const raw = await request<Record<string, unknown> | null>("GET", "/users/me/profile");
      const emailAddress = typeof raw?.emailAddress === "string" ? raw.emailAddress.trim().toLowerCase() : "";
      if (!emailAddress) {
        throw new GmailApiError("unknown", 200, null, "Gmail profile has no email address");
      }
      return {
        emailAddress,
        historyId: typeof raw?.historyId === "string" ? raw.historyId : String(raw?.historyId ?? ""),
        messagesTotal: typeof raw?.messagesTotal === "number" ? raw.messagesTotal : null,
        threadsTotal: typeof raw?.threadsTotal === "number" ? raw.threadsTotal : null,
      };
    },
  };
}
