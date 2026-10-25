// @vitest-environment node
//
// MCP invariants enforced on the source (docs/prd-mcp.md §5.3):
// - every export of convex/mcp/* is a plain Convex function constructor, so a
//   custom wrapper cannot slip past the checks below;
// - I1: every such function calls getMcpAuthContext before anything else;
// - I2: no MCP function accepts an org, user or role argument;
// - I4: identities are read only by the two auth builders, so an OAuth token
//   cannot reach a UI function through a direct `ctx.auth` read;
// - the I1/I2 scans cover convex/mcp/ only, so `getMcpAuthContext` must not be
//   imported anywhere else, and the connection check it relies on
//   (`connectionStatus`) is read only where the review listed it.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CONVEX_DIR = join(__dirname, "..");
const MCP_DIR = join(CONVEX_DIR, "mcp");

const FUNCTION_CONSTRUCTORS = [
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
];

const FORBIDDEN_ARGS = /\b(orgId|org_id|userId|clerkUserId|role|orgRole|isAdmin|tokenIdentifier)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "_generated" || name === "__tests__" ? [] : sourceFiles(path);
    }
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/**
 * Index of the bracket closing the one at `open`, skipping string literals,
 * template literals and comments. Enough for our own source files.
 */
function matchingClose(source: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const stack: string[] = [];
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i += 1; i < source.length && source[i] !== ch; i += 1) {
        if (source[i] === "\\") i += 1;
      }
    } else if (ch === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) return -1;
    } else if (ch === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i) + 1;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch === ")" || ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** The balanced `{…}` (or other bracket) that follows `key:` inside `text`. */
function propertyBlock(text: string, key: string): string | null {
  const match = new RegExp(`\\b${key}\\s*:\\s*`).exec(text);
  if (!match) return null;
  const open = match.index + match[0].length;
  const close = matchingClose(text, open);
  return close === -1 ? null : text.slice(open, close + 1);
}

/** The `{…}` body of `handler: async (…) => { … }`; null for any other form. */
function handlerBody(config: string): string | null {
  const match = /\bhandler\s*:\s*async\s*\([^)]*\)\s*=>\s*\{/.exec(config);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  const close = matchingClose(config, open);
  return close === -1 ? null : config.slice(open, close + 1);
}

type ExportInfo =
  | { kind: "function"; name: string; constructor: string; config: string }
  | { kind: "other"; statement: string };

/** Every top-level export statement of a file. Type-only exports are ignored. */
function exportsOf(source: string): ExportInfo[] {
  const result: ExportInfo[] = [];
  for (const match of source.matchAll(/^export\s+(.*)$/gm)) {
    const rest = match[1];
    if (/^(type|interface)\s/.test(rest)) continue;
    const fn = /^const\s+(\w+)\s*=\s*(\w+)\s*\(/.exec(rest);
    if (fn && FUNCTION_CONSTRUCTORS.includes(fn[2])) {
      const open = match.index + match[0].indexOf("(", match[0].indexOf(fn[2]));
      const close = matchingClose(source, open);
      result.push({ kind: "function", name: fn[1], constructor: fn[2], config: source.slice(open, close + 1) });
    } else {
      result.push({ kind: "other", statement: `export ${rest}` });
    }
  }
  return result;
}

describe("source scanner self-check", () => {
  it("handles nested braces and strings in args", () => {
    const source = [
      "export const f = query({",
      '  args: { filter: v.object({ note: v.string() }), label: v.literal("}") , orgId: v.string() },',
      "  handler: async (ctx) => { const a = await getMcpAuthContext(ctx); },",
      "});",
      "export const g = makeWrapped({ handler: async () => {} });",
      "export function h() {}",
    ].join("\n");
    const [f, g, h] = exportsOf(source);
    expect(f.kind).toBe("function");
    expect(f.kind === "function" && propertyBlock(f.config, "args")).toMatch(/orgId: v\.string\(\) }$/);
    expect(g).toEqual({ kind: "other", statement: "export const g = makeWrapped({ handler: async () => {} });" });
    expect(h.kind).toBe("other");
    expect(f.kind === "function" && handlerBody(f.config)).toBe(
      "{ const a = await getMcpAuthContext(ctx); }",
    );
  });
});

describe("convex/mcp invariants", () => {
  const files = sourceFiles(MCP_DIR);

  it("has MCP functions to check", () => {
    const functions = files.flatMap((f) => exportsOf(readFileSync(f, "utf8"))).filter((e) => e.kind === "function");
    expect(functions.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const label = relative(CONVEX_DIR, file);
    const exports = exportsOf(source);

    it(`${label} exports only plain Convex function constructors`, () => {
      expect(exports.filter((e) => e.kind === "other")).toEqual([]);
    });

    for (const info of exports) {
      if (info.kind !== "function") continue;
      const fnLabel = `${label}:${info.name}`;

      it(`${fnLabel} calls getMcpAuthContext first (I1)`, () => {
        const handler = handlerBody(info.config);
        expect(handler).not.toBeNull();
        const firstAwait = handler!.match(/await\s+([\w.]+)\s*\(/);
        expect(firstAwait?.[1]).toBe("getMcpAuthContext");
      });

      it(`${fnLabel} takes no org, user or role argument (I2)`, () => {
        const args = propertyBlock(info.config, "args");
        expect(args).not.toBeNull();
        expect(args!).not.toMatch(FORBIDDEN_ARGS);
      });
    }
  }
});

/** Files under convex/ (relative) whose import statements name `symbol`. */
function importersOf(symbol: string): string[] {
  const pattern = new RegExp(`^import\\s[^;]*\\b${symbol}\\b[^;]*\\sfrom\\s`, "m");
  return sourceFiles(CONVEX_DIR)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(CONVEX_DIR, file))
    .sort();
}

describe("identity reads (I4)", () => {
  it("only the auth builders call getUserIdentity, however the auth object is reached", () => {
    const readers = sourceFiles(CONVEX_DIR)
      .filter((file) => /\bgetUserIdentity\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(CONVEX_DIR, file))
      .sort();
    expect(readers).toEqual(["lib/auth.ts", "lib/mcpAuth.ts"]);
  });
});

describe("MCP auth reach (the I1/I2 scan covers convex/mcp/ only)", () => {
  // Files outside convex/mcp/ allowed to import getMcpAuthContext. None today:
  // every MCP function lives in convex/mcp/, where I1 and I2 are checked.
  const MCP_AUTH_IMPORTERS_OUTSIDE_MCP: string[] = [];

  it("getMcpAuthContext is imported only under convex/mcp/", () => {
    const importers = importersOf("getMcpAuthContext");
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((file) => !file.startsWith("mcp/"))).toEqual(MCP_AUTH_IMPORTERS_OUTSIDE_MCP);
  });

  it("connectionStatus is read only by the MCP auth builder and the MCP upload endpoint", () => {
    expect(importersOf("connectionStatus")).toEqual(["lib/mcpAuth.ts", "mcpFileUploads.ts"]);
  });
});
