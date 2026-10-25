import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpTool } from "./registry";

/**
 * The `tools/list` entry of a registry tool (docs/prd-mcp.md §6), compacted
 * for token cost (owner decision D-TOKENDIET): the zod schema as draft-7
 * JSON Schema in input mode, without what clients do not need —
 * `$schema`, `minLength: 1`, a YYYY-MM-DD pattern (advertised as
 * `format: "date"`) and `idempotentHint: false` (the spec default).
 * Advertising only: tools/call still validates every argument with the full
 * zod schema.
 */

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function compact(node: Json): Json {
  if (Array.isArray(node)) return node.map(compact);
  if (node === null || typeof node !== "object") return node;
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema") continue;
    if (key === "minLength" && value === 1) continue;
    if (key === "pattern" && value === DATE_PATTERN) {
      out.format = "date";
      continue;
    }
    out[key] = compact(value);
  }
  return out;
}

export function advertisedInputSchema(tool: McpTool): Tool["inputSchema"] {
  const json = z.toJSONSchema(tool.inputSchema, { target: "draft-7", io: "input" }) as Json;
  return compact(json) as Tool["inputSchema"];
}

export function advertisedTool(tool: McpTool): Tool {
  const { idempotentHint, ...annotations } = tool.annotations;
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: advertisedInputSchema(tool),
    annotations: idempotentHint ? { ...annotations, idempotentHint } : annotations,
  };
}
