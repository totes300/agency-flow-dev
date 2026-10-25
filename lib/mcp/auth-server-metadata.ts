import { getAuthorizationServerUrl } from "./config";

/**
 * Clerk's OAuth 2.0 Authorization Server Metadata (RFC 8414), fetched once
 * and kept in memory for an hour. A failure (unreachable or non-2xx) is kept
 * for 30 seconds, so a Clerk outage is not retried upstream on every request.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;
export const FAILURE_TTL_MS = 30 * 1000;

/** `metadata: null` is a cached failure. */
let cached: { metadata: unknown | null; expiresAt: number } | null = null;

/** The metadata document, or null when Clerk is unreachable or answers non-2xx. */
export async function getAuthorizationServerMetadata(now = Date.now()): Promise<unknown | null> {
  if (cached && cached.expiresAt > now) return cached.metadata;
  const upstream = `${getAuthorizationServerUrl()}/.well-known/oauth-authorization-server`;
  try {
    const response = await fetch(upstream, { cache: "no-store" });
    if (response.ok) {
      cached = { metadata: await response.json(), expiresAt: now + CACHE_TTL_MS };
      return cached.metadata;
    }
  } catch {
    // Treated like a non-2xx answer below.
  }
  cached = { metadata: null, expiresAt: now + FAILURE_TTL_MS };
  return null;
}

/** Test hook: forget the cached document. */
export function resetAuthorizationServerMetadataCache(): void {
  cached = null;
}
