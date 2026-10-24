import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { protectedResourceMetadataPath } from "./config";
import { MCP_TOOLS, type McpQueryRunner } from "./registry";

/**
 * Builds the Streamable HTTP MCP handler (no SSE) behind bearer auth. Kept
 * free of Clerk and Convex clients so tests can drive the real protocol path;
 * `app/mcp/route.ts` supplies both.
 */
export type McpHandlerOptions = {
  /** The exact resource URL; its origin and path locate the metadata. */
  resourceUrl: string;
  /** Verifies the bearer token (Clerk, exact audience); undefined = reject. */
  verifyToken: (req: Request, bearerToken?: string) => Promise<AuthInfo | undefined>;
  /** Runs Convex queries as the user who owns `token`. */
  queryRunnerFor: (token: string) => McpQueryRunner;
};

export const MCP_SERVER_INFO = { name: "agency-flow", version: "0.1.0" };

/** Registers every registry tool; `tools/list` is generated from this. */
export function registerMcpTools(
  server: McpServer,
  queryRunnerFor: McpHandlerOptions["queryRunnerFor"],
): void {
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (input, extra) => {
        const token = extra.authInfo?.token;
        if (!token) {
          return { content: [{ type: "text", text: "Not authenticated." }], isError: true };
        }
        const result = await tool.execute(input, { runQuery: queryRunnerFor(token) });
        return { content: [{ type: "text", text: result.text }], isError: result.isError };
      },
    );
  }
}

export function createAgencyFlowMcpHandler(options: McpHandlerOptions): (req: Request) => Promise<Response> {
  const resource = new URL(options.resourceUrl);
  const handler = createMcpHandler(
    (server) => registerMcpTools(server, options.queryRunnerFor),
    { serverInfo: MCP_SERVER_INFO },
    // Streamable HTTP answers exactly `/mcp` (app/mcp/route.ts, the resource
    // path); no SSE. No catch-all route, so other URLs stay untouched.
    { basePath: "", disableSse: true, maxDuration: 60 },
  );
  // Unauthenticated or invalid tokens get 401 + WWW-Authenticate pointing at
  // the protected resource metadata, never a sign-in redirect.
  return withMcpAuth(handler, options.verifyToken, {
    required: true,
    resourceUrl: resource.origin,
    resourceMetadataPath: protectedResourceMetadataPath(options.resourceUrl),
  });
}
