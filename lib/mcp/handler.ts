import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { advertisedTool } from "./advertise";
import { MCP_SERVER_INSTRUCTIONS } from "./instructions";
import { protectedResourceMetadataPath } from "./config";
import { appOriginOf } from "./links";
import { MCP_TOOLS, mcpErrorMessage, type McpActionRunner, type McpMutationRunner, type McpQueryRunner } from "./registry";
import pkg from "../../package.json";

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
  /** Runs Convex mutations as the user who owns `token`. */
  mutationRunnerFor: (token: string) => McpMutationRunner;
  /** Runs Convex actions as the user who owns `token` (attach_file inline text). */
  actionRunnerFor: (token: string) => McpActionRunner;
  /** The display name of an OAuth client (attribution only, D15); never throws. */
  clientNameFor: (clientId: string) => Promise<string | undefined>;
};

/** What the tools need from the route besides the request. */
export type McpConvexAccess = Pick<
  McpHandlerOptions,
  "queryRunnerFor" | "mutationRunnerFor" | "actionRunnerFor" | "clientNameFor"
>;

/** The app's package.json version, so `initialize` names the deployed build. */
export const MCP_SERVER_INFO = { name: "agency-flow", version: pkg.version };

/**
 * Registers every registry tool (tools/call validates with their zod
 * schemas), then serves `tools/list` from the same registry in its compact
 * advertised form (lib/mcp/advertise.ts).
 */
export function registerMcpTools(server: McpServer, access: McpConvexAccess, appOrigin: string): void {
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
        const clientId = extra.authInfo?.clientId;
        const startedAt = Date.now();
        let result: { text: string; isError: boolean };
        try {
          result = await tool.execute(input, {
            runQuery: access.queryRunnerFor(token),
            runMutation: access.mutationRunnerFor(token),
            runAction: access.actionRunnerFor(token),
            appOrigin,
            now: Date.now,
            clientName: async () => (clientId ? await access.clientNameFor(clientId) : undefined),
          });
        } catch (error) {
          // A renderer or tool bug: the model gets the generic text with a
          // log ref (lib/mcp/registry.ts mcpErrorMessage), never the raw error.
          result = { text: `Error: ${mcpErrorMessage(error, tool.name)}`, isError: true };
        }
        // One line per call for operations: tool, duration, outcome. No arguments, no user content.
        console.info("[mcp] tool", tool.name, `${Date.now() - startedAt}ms`, result.isError ? "error" : "ok");
        return { content: [{ type: "text", text: result.text }], isError: result.isError };
      },
    );
  }
  // Replaces the SDK's own tools/list handler (installed by registerTool above).
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: MCP_TOOLS.map(advertisedTool) }));
}

export function createAgencyFlowMcpHandler(options: McpHandlerOptions): (req: Request) => Promise<Response> {
  const resource = new URL(options.resourceUrl);
  const handler = createMcpHandler(
    // The app and /mcp share one origin: deep links use the resource URL's.
    (server) => registerMcpTools(server, options, appOriginOf(options.resourceUrl)),
    { serverInfo: MCP_SERVER_INFO, instructions: MCP_SERVER_INSTRUCTIONS },
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
