// @vitest-environment node
//
// MCP invariants enforced on the source (docs/prd-mcp.md §5.3):
// - I1: every `convex/mcp/*` function calls getMcpAuthContext before anything else.
// - I2: no MCP function accepts an org, user or role argument.
// - I4: identities are read only by the two auth builders, so an OAuth token
//   cannot reach a UI function through a direct `ctx.auth` read.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CONVEX_DIR = join(__dirname, "..");
const MCP_DIR = join(CONVEX_DIR, "mcp");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "_generated" || name === "__tests__" ? [] : sourceFiles(path);
    }
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Each `export const x = query|mutation|action(...)` block of a file. */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const pattern = /export const (\w+) = (?:internal)?(?:query|mutation|action)\(/g;
  const starts = [...source.matchAll(pattern)];
  return starts.map((match, i) => ({
    name: match[1],
    body: source.slice(match.index, starts[i + 1]?.index ?? source.length),
  }));
}

describe("convex/mcp invariants", () => {
  const files = sourceFiles(MCP_DIR);

  it("has MCP functions to check", () => {
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap((f) => exportedFunctions(readFileSync(f, "utf8"))).length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const fn of exportedFunctions(source)) {
      const label = `${relative(CONVEX_DIR, file)}:${fn.name}`;

      it(`${label} calls getMcpAuthContext first (I1)`, () => {
        const firstAwait = fn.body.match(/await\s+([\w.]+)\s*\(/);
        expect(firstAwait?.[1]).toBe("getMcpAuthContext");
      });

      it(`${label} takes no org, user or role argument (I2)`, () => {
        const args = fn.body.match(/args:\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(args).not.toMatch(/\b(orgId|userId|clerkUserId|role|orgRole|isAdmin)\b/);
      });
    }
  }
});

describe("identity reads (I4)", () => {
  it("only the auth builders call ctx.auth.getUserIdentity", () => {
    const readers = sourceFiles(CONVEX_DIR)
      .filter((file) => /\.auth\.getUserIdentity\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(CONVEX_DIR, file))
      .sort();
    expect(readers).toEqual(["lib/auth.ts", "lib/mcpAuth.ts"]);
  });
});
