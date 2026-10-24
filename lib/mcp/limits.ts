/**
 * MCP limits and enums shared by the Next.js route (lib/mcp/registry.ts)
 * and Convex (convex/mcp/*, convex/lib/mcp*.ts) — one source, no drift.
 * Pure and dependency-free (Convex imports it relatively).
 */

/** Maximum refs per `fetch` call (docs/prd-mcp.md §6). */
export const MAX_REFS = 25;

/** Search rows per type (docs/prd-mcp.md §7: default 25, max 100). */
export const SEARCH_LIMIT_DEFAULT = 25;
export const SEARCH_LIMIT_MAX = 100;

/** `fetch` include[] sections (docs/prd-mcp.md §6). */
export const FETCH_INCLUDES = ["subtasks", "comments", "activity", "time", "files", "attachment_text"] as const;
export type FetchInclude = (typeof FETCH_INCLUDES)[number];
