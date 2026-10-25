import { describe, it, expect } from "vitest";
import { decodeCursor, encodeCursor, searchFingerprint } from "../cursor";

const TYPES = ["task", "comment"] as const;

describe("search cursors", () => {
  it("round-trips offsets and the fingerprint", () => {
    const cursor = { fingerprint: searchFingerprint({ q: "logo" }), offsets: { task: 25, comment: 50 } };
    const encoded = encodeCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded, TYPES)).toEqual(cursor);
  });

  it("refuses malformed cursors", () => {
    expect(decodeCursor("not a cursor", TYPES)).toBeNull();
    expect(decodeCursor(encodeCursor({ fingerprint: "x", offsets: {} }), TYPES)).toBeNull();
    const bad = (o: unknown) => btoa(JSON.stringify({ v: 1, f: "x", o }));
    expect(decodeCursor(bad({ task: -1 }), TYPES)).toBeNull();
    expect(decodeCursor(bad({ task: 1.5 }), TYPES)).toBeNull();
    expect(decodeCursor(bad({ invoice: 5 }), TYPES)).toBeNull();
    expect(decodeCursor(btoa(JSON.stringify({ v: 2, f: "x", o: { task: 1 } })), TYPES)).toBeNull();
  });

  it("fingerprints a search independently of key order, and tells searches apart", () => {
    expect(searchFingerprint({ a: 1, b: [1, 2], c: undefined })).toBe(searchFingerprint({ b: [1, 2], a: 1 }));
    expect(searchFingerprint({ a: 1 })).not.toBe(searchFingerprint({ a: 2 }));
    expect(searchFingerprint({ q: "árvíztűrő" })).toMatch(/^[0-9a-f]{8}$/);
  });
});
