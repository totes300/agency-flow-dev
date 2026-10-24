import { describe, it, expect } from "vitest";
import { parseRef, parseRefs } from "../refs";

describe("parseRef", () => {
  it("parses the special refs", () => {
    expect(parseRef("me")).toEqual({ ok: true, input: "me", ref: { kind: "special", name: "me" } });
    expect(parseRef("  workspace ")).toEqual({
      ok: true,
      input: "workspace",
      ref: { kind: "special", name: "workspace" },
    });
  });

  it("keeps uppercase free for project codes and client prefixes", () => {
    expect(parseRef("ME").ok).toBe(false);
    expect(parseRef("Workspace").ok).toBe(false);
  });

  it("rejects empty and unsupported refs with a model-actionable message", () => {
    expect(parseRef("   ")).toEqual({ ok: false, input: "", error: "Empty reference." });
    const result = parseRef("ARLO-21");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Unsupported reference "ARLO-21". Supported refs: "me", "workspace".');
    }
  });
});

describe("parseRefs", () => {
  it("drops duplicates and keeps input order", () => {
    const results = parseRefs(["workspace", "me", " me", "workspace"]);
    expect(results.map((r) => r.input)).toEqual(["workspace", "me"]);
  });
});
