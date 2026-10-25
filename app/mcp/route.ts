import { clerkClient } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/server";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { resolveClientName } from "@/lib/mcp/clerk-client-name";
import { getMcpResourceUrl } from "@/lib/mcp/config";
import { createAgencyFlowMcpHandler } from "@/lib/mcp/handler";
import { connectionKey, createLastUsedThrottle } from "@/lib/mcp/last-used";
import { CONNECTION_LAST_USED_INTERVAL_MS } from "@/lib/mcp/limits";

/**
 * The Agency Flow MCP server (docs/prd-mcp.md §4): Streamable HTTP at /mcp.
 * This route only adapts the protocol. It verifies the Clerk OAuth access
 * token (exact audience = the resource URL), then calls Convex AS THE USER
 * with the same token; Convex derives org and role (getMcpAuthContext).
 * Write tools also pass the OAuth client's display name (attribution only).
 * proxy.ts keeps /mcp out of `auth.protect()` so failures are a 401.
 *
 * Connected apps (D17): getMcpAuthContext refuses a token whose connection
 * (org + user + client) has no `mcpConnections` row, so before handling a
 * verified request the route registers / stamps it with
 * `mcp/connections:touch` (a mutation as the user) — awaited, at most once an
 * hour per org + user + client in this instance; the mutation itself writes
 * at most hourly. A failed touch never fails the request: the tool call then
 * gets Convex's own answer.
 */

const lastUsed = createLastUsedThrottle({ intervalMs: CONNECTION_LAST_USED_INTERVAL_MS, maxEntries: 5_000 });

/** Registers / stamps the connection before the request is handled; never throws. */
async function registerConnection(info: AuthInfo): Promise<void> {
  const userId = info.extra?.userId;
  if (typeof userId !== "string" || !info.clientId) return;
  const key = connectionKey(info.token, userId, info.clientId);
  if (!lastUsed.due(key, Date.now())) return;
  try {
    const clientName = await resolveClientName(info.clientId);
    await fetchMutation(api.mcp.connections.touch, { clientName }, { token: info.token });
  } catch (error) {
    // A ConvexError is Convex refusing on purpose (revoked connection, no
    // organization, user not synced, not a member, MCP switched off): the
    // tool call is refused the same way, so wait the full interval quietly.
    if (error instanceof ConvexError) return;
    // Anything else (network, deployment): try again on the next request,
    // so a new connection is not left unregistered.
    lastUsed.forget(key);
    console.error("[mcp] connection stamp failed:", error instanceof Error ? error.message : "unknown error");
  }
}

let handler: ((req: Request) => Promise<Response>) | null = null;

function getHandler(): (req: Request) => Promise<Response> {
  if (handler) return handler;
  const resourceUrl = getMcpResourceUrl();
  handler = createAgencyFlowMcpHandler({
    resourceUrl,
    verifyToken: async (req, bearerToken) => {
      if (!bearerToken) return undefined;
      const client = await clerkClient();
      const state = await client.authenticateRequest(req, {
        acceptsToken: "oauth_token",
        audience: resourceUrl,
      });
      const info = verifyClerkToken(state.toAuth(), bearerToken);
      if (info) await registerConnection(info);
      return info;
    },
    queryRunnerFor: (token) => (query, args) => fetchQuery(query, args, { token }),
    mutationRunnerFor: (token) => (mutation, args) => fetchMutation(mutation, args, { token }),
    actionRunnerFor: (token) => (action, args) => fetchAction(action, args, { token }),
    // Display name for "via <client>" only; Convex takes the client ID from the token.
    clientNameFor: resolveClientName,
  });
  return handler;
}

async function handle(req: Request): Promise<Response> {
  return getHandler()(req);
}

export { handle as GET, handle as POST, handle as DELETE };
