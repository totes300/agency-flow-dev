/**
 * Display names of OAuth clients for "via <client>" attribution
 * (docs/prd-mcp.md D15). Pure: the route resolves the name (Clerk) and
 * Convex sanitizes what it receives with the same rules.
 *
 * The name is DISPLAY TEXT ONLY. The route passes it to Convex as an
 * argument, so a caller holding its own token could choose the label shown
 * on its own writes; nothing ever authorizes, filters or matches on it.
 * The client's identity (`clientId`) always comes from the verified token.
 */

/** Longest name shown; longer names are cut. */
export const CLIENT_NAME_MAX_LENGTH = 60;

/**
 * A fallback name from the client ID alone: the host of a CIMD client ID
 * (a metadata document URL, e.g. `https://claude.ai/oauth/…` → `claude.ai`),
 * else a generic label. Nothing is fetched.
 */
export function fallbackClientName(clientId: string): string {
  try {
    const url = new URL(clientId);
    if (url.protocol === "https:" && url.hostname) return url.hostname.replace(/^www\./, "");
  } catch {
    // Not a URL: a Clerk-registered (DCR) client ID.
  }
  return "MCP client";
}

/**
 * One-line, length-capped display text: control characters dropped,
 * whitespace collapsed. Empty input yields the client ID's fallback.
 */
export function sanitizeClientName(raw: string | undefined, clientId: string): string {
  const cleaned = (raw ?? "")
    .replace(/\p{Cc}|\p{Cf}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CLIENT_NAME_MAX_LENGTH)
    .trim();
  return cleaned || fallbackClientName(clientId);
}
