import { getAuthorizationServerUrl } from "./config";

/**
 * Clerk's OAuth 2.0 Authorization Server Metadata (RFC 8414), fetched once
 * and kept in memory for an hour. Failures are never cached: the next request
 * retries upstream.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;

let cached: { metadata: unknown; expiresAt: number } | null = null;

/** The metadata document, or null when Clerk is unreachable or answers non-2xx. */
export async function getAuthorizationServerMetadata(now = Date.now()): Promise<unknown | null> {
  if (cached && cached.expiresAt > now) return cached.metadata;
  const upstream = `${getAuthorizationServerUrl()}/.well-known/oauth-authorization-server`;
  try {
    const response = await fetch(upstream, { cache: "no-store" });
    if (!response.ok) return null;
    cached = { metadata: await response.json(), expiresAt: now + CACHE_TTL_MS };
    return cached.metadata;
  } catch {
    return null;
  }
}

/** Test hook: forget the cached document. */
export function resetAuthorizationServerMetadataCache(): void {
  cached = null;
}
