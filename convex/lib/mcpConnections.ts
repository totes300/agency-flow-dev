import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import type { McpAuthContext } from "./mcpAuth";
import { sanitizeClientName } from "../../lib/mcp/client-name";

/**
 * Connected apps (docs/prd-mcp.md D17, §11): one `mcpConnections` row per
 * org + user + OAuth client, stamped by the /mcp route.
 *
 * Queries cannot write, so `getMcpAuthContext` does not stamp. Instead the
 * route calls `mcp/connections:touch` (a mutation, as the user, with the
 * same OAuth token) after a request it verified, at most once an hour per
 * user + client in each server instance; this function throttles again
 * across instances, so a row is written at most once per hour per client.
 */

/** "Last used" is stamped at most this often per connection. */
export const LAST_USED_INTERVAL_MS = 60 * 60 * 1000;

/** Connections listed per user and org (a user has a handful). */
export const CONNECTIONS_LIST_MAX = 50;

export type StampOutcome = "created" | "stamped" | "skipped";

/**
 * Records that the caller's OAuth client used /mcp at `now`: creates the
 * connection on first use, else moves `lastUsedAt` when it is at least an
 * hour old (the name is refreshed then too). A recent stamp writes nothing,
 * so concurrent requests do not contend on the row.
 */
export async function stampConnection(
  ctx: MutationCtx,
  auth: McpAuthContext,
  rawClientName: string | undefined,
  now: number,
): Promise<StampOutcome> {
  const clientName = sanitizeClientName(rawClientName, auth.clientId);
  const existing = await ctx.db
    .query("mcpConnections")
    .withIndex("by_orgId_userId_clientId", (q) =>
      q.eq("orgId", auth.orgId).eq("userId", auth.userId).eq("clientId", auth.clientId),
    )
    .unique();
  if (!existing) {
    await ctx.db.insert("mcpConnections", {
      orgId: auth.orgId,
      userId: auth.userId,
      clientId: auth.clientId,
      clientName,
      firstUsedAt: now,
      lastUsedAt: now,
    });
    return "created";
  }
  if (now - existing.lastUsedAt < LAST_USED_INTERVAL_MS) return "skipped";
  await ctx.db.patch(existing._id, {
    lastUsedAt: now,
    ...(clientName !== existing.clientName ? { clientName } : {}),
  });
  return "stamped";
}

/** One row of Settings → Connected apps. */
export type ConnectionRow = {
  id: Doc<"mcpConnections">["_id"];
  clientName: string;
  connectedAt: number;
  lastUsedAt: number;
};

/** The caller's own connections in the caller's org, most recently used first. */
export async function listConnectionsForAuth(ctx: QueryCtx, auth: AuthContext): Promise<ConnectionRow[]> {
  const rows = await ctx.db
    .query("mcpConnections")
    .withIndex("by_orgId_userId_clientId", (q) => q.eq("orgId", auth.orgId).eq("userId", auth.userId))
    .take(CONNECTIONS_LIST_MAX);
  return rows
    .map((row) => ({ id: row._id, clientName: row.clientName, connectedAt: row.firstUsedAt, lastUsedAt: row.lastUsedAt }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}
