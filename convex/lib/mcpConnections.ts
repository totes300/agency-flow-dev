import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import type { McpAuthContext } from "./mcpAuth";
import { sanitizeClientName } from "../../lib/mcp/client-name";
import { CONNECTION_LAST_USED_INTERVAL_MS } from "../../lib/mcp/limits";

/**
 * Connected apps (docs/prd-mcp.md D17, §11): one `mcpConnections` row per
 * org + user + OAuth client, stamped by the /mcp route, revocable by its user
 * (owner decision D-REVOKE, 2026-10-25).
 *
 * Queries cannot write, so `getMcpAuthContext` does not stamp. Instead the
 * route calls `mcp/connections:touch` (a mutation, as the user, with the
 * same OAuth token) after a request it verified, at most once an hour per
 * user + client in each server instance; this function throttles again
 * across instances, so a row is written at most once per hour per client.
 */

/**
 * Whether the caller revoked this org + user + client in Connected apps
 * (D-REVOKE). Exactly one indexed read; `getMcpAuthContext` runs it on every
 * MCP call.
 */
export async function isConnectionRevoked(
  ctx: QueryCtx,
  orgId: string,
  userId: Id<"users">,
  clientId: string,
): Promise<boolean> {
  const row = await ctx.db
    .query("mcpConnections")
    .withIndex("by_orgId_userId_clientId", (q) => q.eq("orgId", orgId).eq("userId", userId).eq("clientId", clientId))
    .unique();
  return row?.revokedAt !== undefined;
}

/** "Last used" is stamped at most this often per connection. */
export const LAST_USED_INTERVAL_MS = CONNECTION_LAST_USED_INTERVAL_MS;

/**
 * Connections listed per user and org: the most recently used ones (a user
 * has a handful; older rows beyond the cap are left out, never mixed in).
 */
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

/** One row of Connected apps. */
export type ConnectionRow = {
  id: Doc<"mcpConnections">["_id"];
  /** The OAuth client ID: tells apart two connections with the same name. */
  clientId: string;
  clientName: string;
  connectedAt: number;
  lastUsedAt: number;
  /** When access was revoked; null while allowed. */
  revokedAt: number | null;
};

/** The caller's own connections in the caller's org, most recently used first. */
export async function listConnectionsForAuth(ctx: QueryCtx, auth: AuthContext): Promise<ConnectionRow[]> {
  const rows = await ctx.db
    .query("mcpConnections")
    .withIndex("by_orgId_userId_lastUsedAt", (q) => q.eq("orgId", auth.orgId).eq("userId", auth.userId))
    .order("desc")
    .take(CONNECTIONS_LIST_MAX);
  return rows.map((row) => ({
    id: row._id,
    clientId: row.clientId,
    clientName: row.clientName,
    connectedAt: row.firstUsedAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt ?? null,
  }));
}

/**
 * Revokes (`revoked: true`) or allows again one of the caller's own
 * connections in the caller's org. Anything else is "not found". Revoking
 * takes effect on the client's next call (getMcpAuthContext); allowing again
 * lets its existing tokens back in.
 */
export async function setConnectionRevokedForAuth(
  ctx: MutationCtx,
  auth: AuthContext,
  id: Id<"mcpConnections">,
  revoked: boolean,
  now: number,
): Promise<void> {
  const row = await ctx.db.get(id);
  if (!row || row.orgId !== auth.orgId || row.userId !== auth.userId) {
    throw new ConvexError("Connection not found");
  }
  if (revoked === (row.revokedAt !== undefined)) return;
  await ctx.db.patch(id, { revokedAt: revoked ? now : undefined });
}
