import { z } from "zod";
import { ConvexError } from "convex/values";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { MAX_REFS, SPECIAL_REFS, parseRefs, type SpecialRefName } from "./refs";
import { renderMe, renderWorkspace } from "./render";

/**
 * The single source of truth for the MCP tool catalog (docs/prd-mcp.md §4,
 * §6). Each entry holds the name, zod input schema, annotations, the
 * model-facing description, the Convex functions it calls and their
 * renderers. `tools/list` is generated from this list; nothing is copied.
 *
 * Tools only adapt the protocol: Convex functions run as the calling user and
 * enforce every rule; tools never decide authorization.
 */

/** Runs a public Convex query as the caller (bearer token passed through). */
export type McpQueryRunner = <Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
) => Promise<FunctionReturnType<Query>>;

export type McpToolContext = { runQuery: McpQueryRunner };

export type McpToolResult = { text: string; isError: boolean };

/** An argument-less public query (the MCP functions derive everything from auth). */
type ArglessQuery = FunctionReference<"query", "public", Record<string, never>>;

/**
 * One Convex function a tool calls, paired with the renderer for its result.
 * Tools dispatch through `runOperation`, so this table is what actually runs.
 */
export type McpOperation = {
  query: ArglessQuery;
  render: (data: unknown) => string;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  annotations: ToolAnnotations & { readOnlyHint: boolean };
  operations: Record<string, McpOperation>;
  execute: (input: unknown, ctx: McpToolContext) => Promise<McpToolResult>;
};

/** Pairs a query with its renderer; the renderer is typed by the query's result. */
function queryOperation<Query extends ArglessQuery>(
  query: Query,
  render: (data: FunctionReturnType<Query>) => string,
): McpOperation {
  // Sound: `runOperation` only ever passes the result of `query` itself.
  return { query, render: (data) => render(data as FunctionReturnType<Query>) };
}

/** Runs an operation's Convex query as the caller and renders the result. */
export async function runOperation(operation: McpOperation, ctx: McpToolContext): Promise<string> {
  return operation.render(await ctx.runQuery(operation.query, {}));
}

/**
 * Error text safe to show the model: Convex user errors (`ConvexError`, e.g.
 * "No organization selected …") pass through. Anything else is logged on the
 * server and reported generically, so internals never reach the model. The
 * error comes from Convex or a renderer and never carries the bearer token.
 */
export function mcpErrorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  console.error("[mcp] tool error:", error);
  return "Internal error.";
}

// ─── fetch ──────────────────────────────────────────────────────────────────

const specialRefOperations: Record<SpecialRefName, McpOperation> = {
  me: queryOperation(api.mcp.fetch.me, renderMe),
  workspace: queryOperation(api.mcp.fetch.workspace, renderWorkspace),
};

const fetchInput = z.object({
  refs: z
    .array(z.string().min(1).max(500))
    .min(1)
    .max(MAX_REFS)
    .describe(`References to fetch (1–${MAX_REFS}). Special refs: ${SPECIAL_REFS.join(", ")}.`),
});

const fetchTool: McpTool = {
  name: "fetch",
  title: "Fetch Agency Flow records",
  description: [
    "Fetch Agency Flow records by reference and get compact markdown.",
    'Special refs: "me" (your user, organization and role) and "workspace" (statuses,',
    "labels, work categories, members with emails, project codes and client prefixes;",
    "use these exact values when writing).",
    'Example: {"refs": ["me", "workspace"]}',
  ].join(" "),
  inputSchema: fetchInput,
  annotations: { readOnlyHint: true, openWorldHint: false },
  operations: specialRefOperations,
  execute: async (input, ctx) => {
    const { refs } = fetchInput.parse(input);
    const sections: string[] = [];
    let failures = 0;
    for (const parsed of parseRefs(refs)) {
      if (!parsed.ok || parsed.ref.kind !== "special") {
        failures += 1;
        sections.push(`Error: ${parsed.ok ? `Unsupported reference "${parsed.input}".` : parsed.error}`);
        continue;
      }
      try {
        sections.push(await runOperation(fetchTool.operations[parsed.ref.name], ctx));
      } catch (error) {
        failures += 1;
        sections.push(`Error fetching "${parsed.input}": ${mcpErrorMessage(error)}`);
      }
    }
    return { text: sections.join("\n\n"), isError: failures === sections.length };
  },
};

/** Every MCP tool, in `tools/list` order. */
export const MCP_TOOLS: readonly McpTool[] = [fetchTool];
