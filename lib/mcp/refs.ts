/**
 * The one MCP reference parser (docs/prd-mcp.md §7): turns any `refs[]` input
 * into a typed reference. Pure: it only classifies the string; Convex resolves
 * and ownership-checks it (I3).
 *
 * Slice 1 knows the special refs `me` and `workspace`. Later slices add the
 * other `ParsedRef` kinds here (Convex ID, app URL, task key `KEY-N`, project
 * code, client prefix, member email, `inbox`, `changes`).
 */

export const SPECIAL_REFS = ["me", "workspace"] as const;
export type SpecialRefName = (typeof SPECIAL_REFS)[number];

export type ParsedRef = { kind: "special"; name: SpecialRefName };

export type RefParseResult =
  | { ok: true; input: string; ref: ParsedRef }
  | { ok: false; input: string; error: string };

/** Maximum refs per `fetch` call (§6). */
export const MAX_REFS = 25;

function isSpecialRef(value: string): value is SpecialRefName {
  return (SPECIAL_REFS as readonly string[]).includes(value);
}

/**
 * Special refs match lowercase only, so uppercase project codes and client
 * prefixes (`ME`, `WORK`) stay free for their own kinds in slice 2.
 */
export function parseRef(raw: string): RefParseResult {
  const input = raw.trim();
  if (input.length === 0) {
    return { ok: false, input, error: "Empty reference." };
  }
  if (isSpecialRef(input)) {
    return { ok: true, input, ref: { kind: "special", name: input } };
  }
  return {
    ok: false,
    input,
    error: `Unsupported reference "${input}". Supported refs: ${SPECIAL_REFS.map((r) => `"${r}"`).join(", ")}.`,
  };
}

/** Parses each ref once, dropping exact duplicates while keeping input order. */
export function parseRefs(raw: readonly string[]): RefParseResult[] {
  const seen = new Set<string>();
  const results: RefParseResult[] = [];
  for (const value of raw) {
    const result = parseRef(value);
    if (seen.has(result.input)) continue;
    seen.add(result.input);
    results.push(result);
  }
  return results;
}
