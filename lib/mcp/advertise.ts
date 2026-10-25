import { z } from "zod";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpTool } from "./registry";

/**
 * The `tools/list` entry of a registry tool (docs/prd-mcp.md §6), compacted
 * for token cost (owner decision D-TOKENDIET): the zod schema as draft-7
 * JSON Schema in input mode, without what clients do not need —
 * `$schema`, `minLength: 1`, every `maxLength` / `maxItems` / `minItems`
 * (numeric `minimum` / `maximum` stay: they carry meaning), a YYYY-MM-DD
 * pattern (advertised as `format: "date"`) and `idempotentHint: false` (the
 * spec default). A nullable field (`anyOf: [T, null]`) is advertised as
 * `type: [T, "null"]` with T's keywords inlined. Advertising only:
 * tools/call still validates every argument with the full zod schema.
 */

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const DROPPED_KEYWORDS = new Set(["$schema", "maxLength", "maxItems", "minItems"]);

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (node: Json): node is JsonObject => node !== null && typeof node === "object" && !Array.isArray(node);

/** `anyOf: [{type: T, …}, {type: "null"}]` → the T branch, or null when the union is anything else. */
function nullableBranch(anyOf: Json): JsonObject | null {
  if (!Array.isArray(anyOf) || anyOf.length !== 2) return null;
  const [a, b] = anyOf;
  if (!isObject(a) || !isObject(b)) return null;
  const inner = a.type === "null" ? b : b.type === "null" ? a : null;
  return inner && typeof inner.type === "string" && inner.type !== "null" ? inner : null;
}

function compact(node: Json): Json {
  if (Array.isArray(node)) return node.map(compact);
  if (!isObject(node)) return node;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    if (key === "minLength" && value === 1) continue;
    if (key === "pattern" && value === DATE_PATTERN) {
      out.format = "date";
      continue;
    }
    if (key === "anyOf") {
      const inner = nullableBranch(value);
      if (inner) {
        // The outer node keeps its own keywords (description); T's follow.
        const { type, ...rest } = compact(inner) as JsonObject;
        Object.assign(out, rest, { type: [type as string, "null"] });
        continue;
      }
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
