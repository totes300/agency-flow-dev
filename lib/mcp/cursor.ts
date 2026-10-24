/**
 * Opaque paging cursors for MCP `search` (docs/prd-mcp.md §7). Pure.
 *
 * A cursor holds, per result type, how many rows earlier pages already
 * showed, plus a fingerprint of the search it belongs to. A cursor replayed
 * with different filters is refused instead of paging a different result.
 * Offsets index the search's deterministic result order; Convex re-applies
 * every access rule on each page, so a hand-edited cursor reveals nothing.
 */

const CURSOR_VERSION = 1;

export type SearchCursor<Type extends string = string> = {
  fingerprint: string;
  /** Rows already shown per type; types absent from the map are finished. */
  offsets: Partial<Record<Type, number>>;
};

/** JSON with object keys sorted (undefined members dropped), so equal inputs serialize identically. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a (32-bit) of the stable JSON, as hex: identifies a search, not a secret. */
export function searchFingerprint(search: unknown): string {
  let hash = 0x811c9dc5;
  for (const ch of stableJson(search)) {
    hash ^= ch.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return atob(padded);
}

export function encodeCursor<Type extends string>(cursor: SearchCursor<Type>): string {
  return toBase64Url(JSON.stringify({ v: CURSOR_VERSION, f: cursor.fingerprint, o: cursor.offsets }));
}

/** The decoded cursor, or null when it is malformed (never trusted beyond offsets). */
export function decodeCursor<Type extends string>(
  raw: string,
  types: readonly Type[],
): SearchCursor<Type> | null {
  let data: unknown;
  try {
    data = JSON.parse(fromBase64Url(raw.trim()));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { v, f, o } = data as { v?: unknown; f?: unknown; o?: unknown };
  if (v !== CURSOR_VERSION || typeof f !== "string" || !o || typeof o !== "object") return null;
  const offsets: Partial<Record<Type, number>> = {};
  for (const [key, value] of Object.entries(o as Record<string, unknown>)) {
    if (!(types as readonly string[]).includes(key)) return null;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
    offsets[key as Type] = value;
  }
  if (Object.keys(offsets).length === 0) return null;
  return { fingerprint: f, offsets };
}

// ─── Changes feed cursor (fetch("changes"), docs/prd-mcp.md D22) ─────────────

const CHANGES_CURSOR_VERSION = 1;

/**
 * A position in the org's activity stream: the last change consumed, as
 * its `createdAt` and `_creationTime` (the `activityLog.by_org` index order).
 * The next call returns changes strictly after it, so nothing comes twice.
 */
export type ChangesPosition = { createdAt: number; creationTime: number };

export function encodeChangesCursor(position: ChangesPosition): string {
  return toBase64Url(
    JSON.stringify({ v: CHANGES_CURSOR_VERSION, k: "changes", t: position.createdAt, c: position.creationTime }),
  );
}

/** The decoded position, or null when the cursor is malformed or of another kind. */
export function decodeChangesCursor(raw: string): ChangesPosition | null {
  let data: unknown;
  try {
    data = JSON.parse(fromBase64Url(raw.trim()));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { v, k, t, c } = data as { v?: unknown; k?: unknown; t?: unknown; c?: unknown };
  if (v !== CHANGES_CURSOR_VERSION || k !== "changes") return null;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return null;
  if (typeof c !== "number" || !Number.isFinite(c) || c < 0) return null;
  return { createdAt: t, creationTime: c };
}
