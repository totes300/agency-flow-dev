import { clerkClient } from "@clerk/nextjs/server";
import { fallbackClientName } from "./client-name";

/**
 * Resolves an OAuth client's display name for "via <client>" (docs/prd-mcp.md
 * D15, §11). Server-only (Clerk secret key); used by app/mcp/route.ts.
 *
 * - Clients registered in Clerk (dynamic client registration or created in
 *   the dashboard) have an OAuth application. The list API filters by name,
 *   not client ID, so the instance's applications are paged through (at
 *   most `MAX_PAGES` pages) into a client ID → name map, refreshed hourly.
 * - CIMD clients (the client ID is the URL of their metadata document, e.g.
 *   Claude) are not OAuth applications in Clerk — the dev instance listed
 *   none while Claude Code was connected (2026-10-24) — so they show the
 *   URL's host (`claude.ai`; owner decision 2026-10-25). The metadata
 *   document is never fetched: the server downloads no URLs (§10).
 *
 * Display text only; Convex sanitizes it again and never authorizes on it.
 * A failed lookup falls back and never throws.
 */

const TTL_MS = 60 * 60 * 1000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

let registered: { names: Map<string, string>; at: number } | null = null;
let loading: Promise<Map<string, string>> | null = null;

/** The minimal list API this module needs (Clerk's `oauthApplications.list`). */
export type OAuthApplicationLister = (params: {
  limit: number;
  offset: number;
}) => Promise<{ data: Array<{ clientId: string; name: string }>; totalCount: number }>;

/** Every registered OAuth application's name by client ID (bounded paging). */
export async function loadRegisteredClientNames(list: OAuthApplicationLister): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, totalCount } = await list({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    for (const app of data) if (app.name) names.set(app.clientId, app.name);
    if (data.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= totalCount) break;
  }
  return names;
}

async function registeredNames(now: number): Promise<Map<string, string>> {
  if (registered && now - registered.at < TTL_MS) return registered.names;
  loading ??= (async () => {
    const client = await clerkClient();
    return await loadRegisteredClientNames((params) => client.oauthApplications.list(params));
  })().finally(() => {
    loading = null;
  });
  try {
    const names = await loading;
    registered = { names, at: now };
    return names;
  } catch (error) {
    // Do not ask Clerk again on every call while it fails: retry in a few minutes.
    registered = { names: new Map(), at: now - TTL_MS + RETRY_AFTER_FAILURE_MS };
    throw error;
  }
}

export async function resolveClientName(clientId: string): Promise<string> {
  if (/^https?:\/\//i.test(clientId)) return fallbackClientName(clientId);
  try {
    return (await registeredNames(Date.now())).get(clientId) ?? fallbackClientName(clientId);
  } catch (error) {
    console.error("[mcp] OAuth client name lookup failed:", error instanceof Error ? error.message : "unknown error");
    return fallbackClientName(clientId);
  }
}

/** Tests only: forget the cached names. */
export function resetClientNameCache(): void {
  registered = null;
  loading = null;
}
