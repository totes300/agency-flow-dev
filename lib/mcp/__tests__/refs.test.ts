import { describe, it, expect } from "vitest";
import { normalizeExternalRef, parseRef, parseRefs, type ParsedRef } from "../refs";

const ORIGIN = "https://localhost:3001";
const ID = "jd7f3k2m9x8q4w5e6r7t8y9u0i1o2p3a";

/** The parsed ref, or the error text. */
function parsed(raw: string, options: { appOrigin?: string } = { appOrigin: ORIGIN }): ParsedRef | string {
  const result = parseRef(raw, options);
  return result.ok ? result.ref : result.error;
}

describe("parseRef", () => {
  it("parses the special refs, lowercase only", () => {
    expect(parseRef("me")).toEqual({ ok: true, input: "me", ref: { kind: "special", name: "me" } });
    expect(parseRef("  workspace ")).toEqual({
      ok: true,
      input: "workspace",
      ref: { kind: "special", name: "workspace" },
    });
    // Uppercase stays free for project codes and client prefixes.
    expect(parsed("ME")).toEqual({ kind: "key", key: "ME" });
    expect(parsed("Workspace")).toEqual({ kind: "key", key: "Workspace" });
  });

  it("parses task identifiers case-insensitively, normalized to uppercase", () => {
    expect(parsed("ARLO-21")).toEqual({ kind: "task", identifier: "ARLO-21" });
    expect(parsed(" arlo-21 ")).toEqual({ kind: "task", identifier: "ARLO-21" });
    expect(parsed("K2-7")).toEqual({ kind: "task", identifier: "K2-7" });
  });

  it("parses a bare short key as a project code, as typed", () => {
    expect(parsed("ARLO")).toEqual({ kind: "key", key: "ARLO" });
    expect(parsed("konv")).toEqual({ kind: "key", key: "konv" });
    expect(parsed("3M")).toEqual({ kind: "key", key: "3M" });
  });

  it("parses client:KEY (qualifier case-insensitive) with the client prefix format", () => {
    expect(parsed("client:KONV")).toEqual({ kind: "client_key", key: "KONV" });
    expect(parsed("Client: acme2 ")).toEqual({ kind: "client_key", key: "acme2" });
    expect(parsed("client:A&B")).toBe(
      'Invalid client reference "client:A&B". Client prefixes are 1–10 letters or digits (client:KONV); clients without one are referenced by ID or link.',
    );
    expect(parsed("client:ABCDEFGHIJK")).toMatch(/^Invalid client reference/);
    expect(parsed("client:")).toMatch(/^Invalid client reference/);
  });

  it("parses external source refs as task refs: source lowercased, id exact", () => {
    expect(parsed("gmail:18C2f0a1")).toEqual({ kind: "external", ref: "gmail:18C2f0a1" });
    expect(parsed(" Gmail:thread-1#2 ")).toEqual({ kind: "external", ref: "gmail:thread-1#2" });
    expect(parsed("slack:1729.0042")).toEqual({ kind: "external", ref: "slack:1729.0042" });
    expect(parsed("gmail: spaced")).toMatch(/^Invalid external ref "gmail: spaced"\. Write <source>:<id>.*see save_tasks externalRefs/);
    expect(parsed("1bad:x")).toMatch(/^Invalid external ref/);
  });

  it("reserves client and project as qualifiers, never external-ref sources", () => {
    expect(parsed("project:ARLO")).toEqual({ kind: "key", key: "ARLO" });
    expect(parsed("project:A B")).toMatch(/^Invalid project reference/);
    expect(normalizeExternalRef("client:KONV")).toMatchObject({ ok: false });
    expect(normalizeExternalRef("Project:x")).toMatchObject({ ok: false });
    expect(normalizeExternalRef("granola:N1")).toEqual({ ok: true, ref: "granola:N1" });
  });

  it("parses member emails, lowercased", () => {
    expect(parsed("Ada@Konverted.io")).toEqual({ kind: "email", email: "ada@konverted.io" });
  });

  it("parses record IDs (no table known)", () => {
    expect(parsed(ID)).toEqual({ kind: "id", id: ID });
    // convex-test style ids (mixed case) too.
    expect(parsed("0000000000000000000012timeEntries")).toEqual({
      kind: "id",
      id: "0000000000000000000012timeEntries",
    });
  });

  it("parses app links by route", () => {
    expect(parsed(`${ORIGIN}/tasks/ARLO-21`)).toEqual({ kind: "task", identifier: "ARLO-21" });
    expect(parsed(`${ORIGIN}/tasks/arlo-21?view=x`)).toEqual({ kind: "task", identifier: "ARLO-21" });
    expect(parsed(`${ORIGIN}/tasks/ARLO-21?comment=${ID}`)).toEqual({ kind: "id", id: ID, table: "comments" });
    expect(parsed(`${ORIGIN}/my-tasks?task=ARLO-21`)).toEqual({ kind: "task", identifier: "ARLO-21" });
    expect(parsed(`${ORIGIN}/tasks?detail=${ID}`)).toEqual({ kind: "id", id: ID, table: "tasks" });
    expect(parsed(`${ORIGIN}/projects/${ID}`)).toEqual({ kind: "id", id: ID, table: "projects" });
    expect(parsed(`${ORIGIN}/projects/${ID}/reports/2026-10`)).toEqual({ kind: "id", id: ID, table: "projects" });
    expect(parsed(`${ORIGIN}/clients/${ID}`)).toEqual({ kind: "id", id: ID, table: "clients" });
    expect(parsed(`${ORIGIN}/my-tasks?user=${ID}`)).toEqual({ kind: "id", id: ID, table: "users" });
  });

  it("rejects links to other hosts and unsupported routes with actionable messages", () => {
    expect(parsed("https://evil.test/tasks/ARLO-21")).toBe(
      '"https://evil.test/tasks/ARLO-21" is not an Agency Flow link. Links must start with https://localhost:3001.',
    );
    // Without an origin (Convex re-parses after the route checked it) the host is not checked.
    expect(parsed("https://evil.test/tasks/ARLO-21", {})).toEqual({ kind: "task", identifier: "ARLO-21" });
    expect(parsed(`${ORIGIN}/invoices/${ID}`)).toMatch(/^Unsupported Agency Flow link/);
    expect(parsed(`${ORIGIN}/projects/not-an-id`)).toMatch(/^Unsupported Agency Flow link/);
    expect(parsed(`${ORIGIN}/tasks/nope!`)).toMatch(/^Invalid task link/);
    // A malformed escape fails this ref only, never the call.
    expect(parsed(`${ORIGIN}/tasks/%E0%A4%A`)).toBe(`Invalid link "${ORIGIN}/tasks/%E0%A4%A".`);
  });

  it("rejects empty and unrecognized refs with a model-actionable message", () => {
    expect(parseRef("   ")).toEqual({ ok: false, input: "", error: "Empty reference." });
    expect(parsed("Arlo website")).toBe(
      'Unrecognized reference "Arlo website". Use a task key (ARLO-21) or a task\'s external ref (gmail:<threadId>), project code (ARLO), client prefix (client:KONV), member email, record ID, an Agency Flow link, or "me" / "workspace".',
    );
    expect(parsed("PRJ-042-x")).toMatch(/^Unrecognized reference/);
    expect(parsed("abcdefghijklmno")).toMatch(/^Unrecognized reference/); // 11–19 chars: neither key nor ID
  });
});

describe("parseRefs", () => {
  it("drops duplicates and keeps input order", () => {
    const results = parseRefs(["workspace", "me", " me", "workspace", "ARLO-1"]);
    expect(results.map((r) => r.input)).toEqual(["workspace", "me", "ARLO-1"]);
  });
});
