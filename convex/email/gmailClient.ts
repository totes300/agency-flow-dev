/**
 * A minimal Gmail REST client (docs/prd-email-triage.md B1; B5 adds send +
 * the Message-ID search; B3 adds history / messages). Plain `fetch` against
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

/** A message Gmail accepted / found: its provider ids. */
export type GmailMessageRef = { id: string; threadId: string };

/** What the email jobs depend on. B3 extends it (history, messages). */
export interface GmailClient {
  getProfile(): Promise<GmailProfile>;
  /**
   * users.messages.send (B5). `raw` = the RFC 2822 message, base64url
   * (email/mime.ts `buildGmailRaw`); `threadId` keeps a reply in the
   * sending mailbox's Gmail thread. A network failure or timeout here is
   * AMBIGUOUS — Gmail may have accepted it — and throws kind `unknown`
   * (never `transient`), as does a 5xx / 408 answer, so the caller confirms
   * by Message-ID before any retry (I4).
   */
  sendMessage(args: { raw: string; threadId?: string }): Promise<GmailMessageRef>;
  /**
   * The mailbox's message with this RFC Message-ID (Gmail search
   * `rfc822msgid:`, any folder), or null. Confirms an unknown send (§5.4).
   */
  findSentByMessageId(rfcMessageId: string): Promise<GmailMessageRef | null>;
}

/** A send that got no answer within this long counts as an unknown outcome. */
export const GMAIL_SEND_TIMEOUT_MS = 60_000;
/** Other calls (profile, search) time out sooner; that is a plain transient error. */
export const GMAIL_REQUEST_TIMEOUT_MS = 30_000;

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
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    opts: { timeoutMs?: number; ambiguous?: boolean } = {},
  ): Promise<T> {
    const token = typeof accessToken === "string" ? accessToken : await accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // The path may carry a query string; log only the route, never its values.
    const route = path.split("?")[0];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? GMAIL_REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await transport(`${GMAIL_API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // A send that may have reached Gmail is not "transient": it is unknown.
      throw new GmailApiError(
        opts.ambiguous ? "unknown" : "transient",
        0,
        null,
        `Gmail ${method} ${route} failed: network error or timeout`,
      );
    } finally {
      clearTimeout(timer);
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const { kind, reason } = classifyGmailHttpError(res.status, parsed);
      throw new GmailApiError(kind, res.status, reason, `Gmail ${method} ${route} failed (${res.status}${reason ? ` ${reason}` : ""})`);
    }
    return parsed as T;
  }

  const readRef = (raw: Record<string, unknown> | null): GmailMessageRef | null =>
    raw && typeof raw.id === "string" && raw.id
      ? { id: raw.id, threadId: typeof raw.threadId === "string" ? raw.threadId : "" }
      : null;

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

    async sendMessage({ raw, threadId }) {
      const body: Record<string, string> = { raw };
      if (threadId) body.threadId = threadId;
      let res: Record<string, unknown> | null;
      try {
        res = await request<Record<string, unknown> | null>("POST", "/users/me/messages/send", body, {
          timeoutMs: GMAIL_SEND_TIMEOUT_MS,
          ambiguous: true,
        });
      } catch (err) {
        // A 5xx / 408 on SEND may still have delivered the message: it is an
        // unknown outcome (confirm by Message-ID), never a blind resend.
        if (err instanceof GmailApiError && (err.status >= 500 || err.status === 408)) {
          throw new GmailApiError("unknown", err.status, err.reason, err.message);
        }
        throw err;
      }
      const ref = readRef(res);
      // 2xx without an id: Gmail took it, but we can't prove it — confirm later.
      if (!ref) throw new GmailApiError("unknown", 200, null, "Gmail accepted the send without a message id");
      return ref;
    },

    async findSentByMessageId(rfcMessageId) {
      const bare = rfcMessageId.trim().replace(/^<|>$/g, "");
      if (!bare) return null;
      const q = encodeURIComponent(`rfc822msgid:${bare}`);
      const res = await request<{ messages?: unknown } | null>(
        "GET",
        `/users/me/messages?q=${q}&maxResults=5&includeSpamTrash=true`,
      );
      const list = Array.isArray(res?.messages) ? (res.messages as Record<string, unknown>[]) : [];
      for (const m of list) {
        const ref = readRef(m);
        if (ref) return ref;
      }
      return null;
    },
  };
}
