/**
 * Route-side throttle for Connected apps "last used" stamps (docs/prd-mcp.md
 * D17, §11). Convex queries cannot write, so the /mcp route stamps the
 * connection with a mutation (`mcp/connections:touch`) after a request it
 * verified. This keeps that call to at most once per `intervalMs` per
 * org + user + client in each server instance; the mutation throttles again
 * across instances (convex/lib/mcpConnections.ts).
 *
 * Pure (no I/O; the caller passes the clock), so tests drive it directly.
 */

/** How long a failed stamp waits before it is tried again. */
export const STAMP_RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

export type LastUsedThrottleOptions = {
  intervalMs: number;
  /** Most connections remembered; the oldest are forgotten first. */
  maxEntries: number;
};

/**
 * Returns `due(key, now)`: true when `key` has not been stamped within the
 * interval (and records the attempt), else false. `failed(key, now)` lets a
 * failed stamp be retried after a short wait instead of a full interval.
 */
export function createLastUsedThrottle({ intervalMs, maxEntries }: LastUsedThrottleOptions) {
  const stampedAt = new Map<string, number>();

  function remember(key: string, at: number): void {
    stampedAt.delete(key);
    stampedAt.set(key, at);
    while (stampedAt.size > maxEntries) {
      const oldest = stampedAt.keys().next().value;
      if (oldest === undefined) break;
      stampedAt.delete(oldest);
    }
  }

  return {
    due(key: string, now: number): boolean {
      const last = stampedAt.get(key);
      if (last !== undefined && now - last < intervalMs) return false;
      remember(key, now);
      return true;
    },
    failed(key: string, now: number): void {
      remember(key, now - intervalMs + STAMP_RETRY_AFTER_FAILURE_MS);
    },
    size(): number {
      return stampedAt.size;
    },
  };
}

/**
 * The `org_id` claim of an access token the route has ALREADY verified,
 * for the throttle key only (never for authorization: Convex reads the org
 * from the verified token itself). Null when absent or unreadable.
 */
export function unverifiedOrgIdOf(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof json.org_id === "string" ? json.org_id : null;
  } catch {
    return null;
  }
}

/** The throttle key of one connection: org + user + OAuth client. */
export function connectionKey(token: string, userId: string, clientId: string): string {
  return JSON.stringify([unverifiedOrgIdOf(token), userId, clientId]);
}
