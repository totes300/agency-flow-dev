import { describe, expect, it } from "vitest";
import {
  validateUpsertArgs,
  buildNoteKey,
  type DailyNoteRecord,
} from "../dailyNotesHelpers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_ID = "org_123";
const USER_A = "user_a" as unknown as DailyNoteRecord["userId"];
const USER_B = "user_b" as unknown as DailyNoteRecord["userId"];

let idCounter = 0;
function makeNote(overrides: Partial<DailyNoteRecord> = {}): DailyNoteRecord {
  idCounter++;
  return {
    _id: `note_${idCounter}` as unknown as DailyNoteRecord["_id"],
    orgId: ORG_ID,
    userId: USER_A,
    date: "2026-04-04",
    content: JSON.stringify({ type: "doc", content: [] }),
    createdAt: 1000 + idCounter,
    updatedAt: 1000 + idCounter,
    ...overrides,
  };
}

// ─── buildNoteKey ─────────────────────────────────────────────────────────────

describe("buildNoteKey", () => {
  it("combines userId and date into a lookup key", () => {
    const key = buildNoteKey(USER_A, "2026-04-04");
    expect(key).toBe(`${USER_A}:2026-04-04`);
  });

  it("produces different keys for different dates", () => {
    const key1 = buildNoteKey(USER_A, "2026-04-04");
    const key2 = buildNoteKey(USER_A, "2026-04-05");
    expect(key1).not.toBe(key2);
  });

  it("produces different keys for different users", () => {
    const key1 = buildNoteKey(USER_A, "2026-04-04");
    const key2 = buildNoteKey(USER_B, "2026-04-04");
    expect(key1).not.toBe(key2);
  });
});

// ─── validateUpsertArgs ───────────────────────────────────────────────────────

describe("validateUpsertArgs", () => {
  it("accepts valid date format YYYY-MM-DD", () => {
    expect(() => validateUpsertArgs("2026-04-04", "some content")).not.toThrow();
  });

  it("rejects invalid date format", () => {
    expect(() => validateUpsertArgs("04-04-2026", "some content")).toThrow(
      "Invalid date format"
    );
  });

  it("rejects empty date string", () => {
    expect(() => validateUpsertArgs("", "some content")).toThrow(
      "Invalid date format"
    );
  });

  it("accepts undefined content (empty note)", () => {
    expect(() => validateUpsertArgs("2026-04-04", undefined)).not.toThrow();
  });

  it("rejects content exceeding 100KB", () => {
    const bigContent = "x".repeat(100 * 1024 + 1);
    expect(() => validateUpsertArgs("2026-04-04", bigContent)).toThrow(
      "content too large"
    );
  });

  it("accepts content within 100KB limit", () => {
    const okContent = "x".repeat(100 * 1024);
    expect(() => validateUpsertArgs("2026-04-04", okContent)).not.toThrow();
  });
});

// ─── DailyNoteRecord shape ───────────────────────────────────────────────────

describe("DailyNoteRecord shape", () => {
  it("has all required fields", () => {
    const note = makeNote();
    expect(note).toHaveProperty("_id");
    expect(note).toHaveProperty("orgId");
    expect(note).toHaveProperty("userId");
    expect(note).toHaveProperty("date");
    expect(note).toHaveProperty("content");
    expect(note).toHaveProperty("createdAt");
    expect(note).toHaveProperty("updatedAt");
  });

  it("content is JSON string or undefined", () => {
    const noteWithContent = makeNote({ content: '{"type":"doc"}' });
    expect(typeof noteWithContent.content).toBe("string");

    const noteEmpty = makeNote({ content: undefined });
    expect(noteEmpty.content).toBeUndefined();
  });
});
