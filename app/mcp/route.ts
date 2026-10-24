import { clerkClient } from "@clerk/nextjs/server";
import { verifyClerkToken } from "@clerk/mcp-tools/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { resolveClientName } from "@/lib/mcp/clerk-client-name";
import { getMcpResourceUrl } from "@/lib/mcp/config";
import { createAgencyFlowMcpHandler } from "@/lib/mcp/handler";

/**
 * The Agency Flow MCP server (docs/prd-mcp.md §4): Streamable HTTP at /mcp.
 * This route only adapts the protocol. It verifies the Clerk OAuth access
 * token (exact audience = the resource URL), then calls Convex AS THE USER
 * with the same token; Convex derives org and role (getMcpAuthContext).
 * Write tools also pass the OAuth client's display name (attribution only).
 * proxy.ts keeps /mcp out of `auth.protect()` so failures are a 401.
 */

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
      return verifyClerkToken(state.toAuth(), bearerToken);
    },
    queryRunnerFor: (token) => (query, args) => fetchQuery(query, args, { token }),
    mutationRunnerFor: (token) => (mutation, args) => fetchMutation(mutation, args, { token }),
    // Display name for "via <client>" only; Convex takes the client ID from the token.
    clientNameFor: resolveClientName,
  });
  return handler;
}

async function handle(req: Request): Promise<Response> {
  return getHandler()(req);
}

export { handle as GET, handle as POST, handle as DELETE };
