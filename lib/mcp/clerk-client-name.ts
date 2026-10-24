import { clerkClient } from "@clerk/nextjs/server";
import { fallbackClientName } from "./client-name";

/**
 * Resolves an OAuth client's display name for "via <client>" (docs/prd-mcp.md
 * D15, §11). Server-only (Clerk secret key); used by app/mcp/route.ts.
 *
 * - Clients registered in Clerk (dynamic client registration or created in
 *   the dashboard) have an OAuth application: its `name`, found by exact
 *   client ID.
 * - CIMD clients (the client ID is the URL of their metadata document, e.g.
 *   Claude) are not OAuth applications in Clerk — the dev instance listed
 *   none while Claude Code was connected (2026-10-24) — so they show the
 *   URL's host (`claude.ai`). The metadata document is never fetched: the
 *   server downloads no URLs (§10).
 *
 * Display text only; Convex sanitizes it again and never authorizes on it.
 * Cached per client for an hour; a failed lookup falls back and never throws.
 */

const TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map<string, { name: string; at: number }>();

export async function resolveClientName(clientId: string): Promise<string> {
  const now = Date.now();
  const hit = cache.get(clientId);
  if (hit && now - hit.at < TTL_MS) return hit.name;

  let name = fallbackClientName(clientId);
  if (!/^https?:\/\//i.test(clientId)) {
    try {
      const client = await clerkClient();
      const { data } = await client.oauthApplications.list({ nameQuery: clientId, limit: 10 });
      const app = data.find((a) => a.clientId === clientId);
      if (app?.name) name = app.name;
    } catch (error) {
      console.error("[mcp] OAuth client name lookup failed:", error instanceof Error ? error.message : "unknown error");
    }
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(clientId, { name, at: now });
  return name;
}
