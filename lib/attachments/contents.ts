/**
 * Pure rules of attachment content extraction (docs/prd-mcp.md §10: MCP
 * `fetch` include `attachment_text`). Ported from the closed email-triage
 * branch (c3972ab, A6) without its agent-runner readers.
 *
 * One row per stored file per org (keyed by orgId + storageId). The Convex
 * side (`convex/attachmentContents.ts` + the node action
 * `convex/attachmentExtraction.ts`) loads and writes rows; everything here is
 * deterministic and DB-free so it is unit-tested in isolation:
 *   - the format router (mime type first, file extension as the fallback);
 *   - text capping;
 *   - the status decision after an attempt (done / unsupported / retry / failed);
 *   - error → short readable reason;
 *   - the honest sentence an agent reads next to a file's status.
 */

// ─── Limits ──────────────────────────────────────────────────────────────────

/** Files above this are not read (Q6: 25 MB per attachment). */
export const EXTRACT_MAX_BYTES = 25 * 1024 * 1024;
/** Stored text cap per file. */
export const EXTRACT_TEXT_MAX = 50_000;
/** Attempts before a library error becomes `failed`. */
export const EXTRACT_MAX_ATTEMPTS = 3;
/** Backoff before retry n (1-based): base × 2^(n-1). */
export const EXTRACT_RETRY_BASE_MS = 5_000;
/**
 * An attempt still `pending` this long after it began is counted as a
 * transient failure (node actions time out at 10 minutes and are never
 * retried by the platform, so the row would otherwise stay pending forever).
 */
export const EXTRACT_ATTEMPT_TIMEOUT_MS = 11 * 60 * 1000;
/** Characters of one file's stored text returned per MCP `fetch` (the rest is counted, never dropped silently). */
export const ATTACHMENT_TEXT_FETCH_MAX = 12_000;
/**
 * Bytes of a text file decoded at most: UTF-8 is ≤ 4 bytes per char, so this
 * always covers EXTRACT_TEXT_MAX chars without decoding a 25 MB file whole.
 */
export const TEXT_BYTES_MAX = 4 * EXTRACT_TEXT_MAX;
/** A DOCX whose archive unpacks to more than this is not handed to mammoth. */
export const DOCX_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** …nor one whose word/document.xml (the text mammoth parses) unpacks to more than this. */
export const DOCX_DOCUMENT_XML_MAX_BYTES = 20 * 1024 * 1024;
/** Backfill: extractions scheduled this far apart. */
export const BACKFILL_STAGGER_MS = 2_000;
/** Slack on top of the watchdog window before a pending row counts as stuck. */
const STUCK_SLACK_MS = 60 * 1000;

/**
 * A `pending` row whose current attempt was due at `queuedAt` and still has
 * not settled after the watchdog window: its scheduled work was lost, and
 * `requestExtraction` re-queues it.
 */
export function isStuck(queuedAt: number, now: number): boolean {
  return now - queuedAt > EXTRACT_ATTEMPT_TIMEOUT_MS + STUCK_SLACK_MS;
}

// ─── Router ──────────────────────────────────────────────────────────────────

export type ExtractFormat = "pdf" | "docx" | "text" | "image" | "unsupported";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/** Text types outside `text/*` that browsers commonly send for MD / CSV. */
const TEXT_MIMES = new Set(["application/csv", "application/x-csv", "application/markdown"]);

const EXTENSION_FORMATS: Record<string, ExtractFormat> = {
  pdf: "pdf",
  docx: "docx",
  txt: "text",
  text: "text",
  md: "text",
  markdown: "text",
  csv: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
};

function formatFromMime(mimeType: string): ExtractFormat {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === DOCX_MIME) return "docx";
  if (IMAGE_MIMES.has(mime)) return "image";
  if (mime.startsWith("text/") || TEXT_MIMES.has(mime)) return "text";
  return "unsupported";
}

function formatFromName(name: string): ExtractFormat {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "unsupported";
  return EXTENSION_FORMATS[name.slice(dot + 1).toLowerCase()] ?? "unsupported";
}

/**
 * Which extractor reads a file. The mime type wins when it names a readable
 * format; a generic or unknown one (e.g. `application/octet-stream`, or a CSV
 * sent as `application/vnd.ms-excel`) falls back to the file extension.
 */
export function routeFormat(mimeType: string, name: string): ExtractFormat {
  const byMime = formatFromMime(mimeType);
  return byMime !== "unsupported" ? byMime : formatFromName(name);
}

/** Readable reasons a file is not read (stored in `error`). */
export const UNSUPPORTED_TYPE = "This file type can't be read";
export const TOO_LARGE = "File is too large to read (over 25 MB)";
export const FILE_MISSING = "The file is no longer in storage";

/**
 * The decision taken when extraction is requested, before any work is
 * scheduled: unknown formats and oversized files are `unsupported` right away,
 * a missing blob is `failed`; everything else is queued.
 */
export function initialDecision(input: {
  mimeType: string;
  name: string;
  /** Blob size from `_storage`; null when the blob does not exist. */
  size: number | null;
}): { status: "pending" } | { status: "unsupported" | "failed"; error: string } {
  if (routeFormat(input.mimeType, input.name) === "unsupported") {
    return { status: "unsupported", error: UNSUPPORTED_TYPE };
  }
  if (input.size === null) return { status: "failed", error: FILE_MISSING };
  if (input.size > EXTRACT_MAX_BYTES) return { status: "unsupported", error: TOO_LARGE };
  return { status: "pending" };
}

// ─── Text ────────────────────────────────────────────────────────────────────

/** Cap text at `max` chars without splitting a surrogate pair. */
export function capText(text: string, max = EXTRACT_TEXT_MAX): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // high surrogate at the cut
  return { text: text.slice(0, end), truncated: true };
}

/** Normalize extracted text: drop NULs and a BOM, unify newlines, trim. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Total uncompressed size of a ZIP archive (a DOCX) from its central
 * directory — read without inflating anything. Null when the archive has no
 * readable central directory (not a ZIP / damaged: the parser then fails on
 * its own). A ZIP64 marker reads as Infinity (only archives over 4 GB use it).
 */
export function zipUncompressedSize(bytes: Uint8Array): number | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const EOCD = 0x06054b50;
  const CENTRAL = 0x02014b50;
  const minEocd = Math.max(0, bytes.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdOffset === 0xffffffff) return Number.POSITIVE_INFINITY;
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL) return null;
    const size = view.getUint32(p + 24, true);
    if (size === 0xffffffff) return Number.POSITIVE_INFINITY;
    total += size;
    p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return total;
}

// ─── Status decision ─────────────────────────────────────────────────────────

/** What one extraction attempt produced (computed in the node action). */
export type ExtractionOutcome =
  | {
      kind: "done";
      text?: string;
      truncated?: boolean;
      pageCount?: number;
      width?: number;
      height?: number;
    }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; reason: string; permanent: boolean };

export type StatusDecision =
  | {
      status: "done";
      text?: string;
      truncated?: boolean;
      pageCount?: number;
      width?: number;
      height?: number;
    }
  | { status: "unsupported" | "failed"; error: string }
  /** Stay `pending`; the action is scheduled again after `retryInMs`. */
  | { status: "pending"; error: string; retryInMs: number };

/**
 * The row's next state after attempt number `attempts` (1-based) ended with
 * `outcome`. A transient error retries with exponential backoff until
 * EXTRACT_MAX_ATTEMPTS; a permanent one (encrypted / damaged PDF, missing
 * blob) fails immediately.
 */
export function decideStatus(outcome: ExtractionOutcome, attempts: number): StatusDecision {
  if (outcome.kind === "done") {
    return {
      status: "done",
      text: outcome.text,
      truncated: outcome.truncated,
      pageCount: outcome.pageCount,
      width: outcome.width,
      height: outcome.height,
    };
  }
  if (outcome.kind === "unsupported") return { status: "unsupported", error: outcome.reason };
  if (outcome.permanent || attempts >= EXTRACT_MAX_ATTEMPTS) {
    return { status: "failed", error: outcome.reason };
  }
  return {
    status: "pending",
    error: outcome.reason,
    retryInMs: EXTRACT_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1),
  };
}

/** The fixed reason for any other library failure (the raw message is never stored or shown). */
export const READ_FAILED = "Could not read the file";

/**
 * A short, fixed reason for a library error, and whether retrying can help.
 * pdf.js signals encrypted and damaged files by exception name; every other
 * failure reads "Could not read the file" — library messages are never
 * passed on (they could carry file content outside the data fence).
 */
export function describeExtractionError(err: unknown): { reason: string; permanent: boolean } {
  const name = err instanceof Error ? err.name : typeof err === "object" && err ? String((err as { name?: unknown }).name ?? "") : "";
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : String(err);
  if (name === "PasswordException" || /password/i.test(message)) {
    return { reason: "PDF is password-protected", permanent: true };
  }
  if (name === "InvalidPDFException" || /invalid pdf/i.test(message)) {
    return { reason: "PDF is damaged or not a valid PDF", permanent: true };
  }
  // Never the library's own message: it is not ours to show and may echo file content.
  return { reason: READ_FAILED, permanent: false };
}

// ─── Reading (MCP fetch) ───────────────────────────────────────────────────

export type ContentStatus = "pending" | "done" | "unsupported" | "failed";

/** The stored fields the readers need (a subset of the Convex row). */
export type ContentFields = {
  status: ContentStatus;
  text?: string;
  truncated?: boolean;
  pageCount?: number;
  width?: number;
  height?: number;
  error?: string;
};

/**
 * One page of stored text from `offset` (clamped to the text), at most `max`
 * characters, never splitting a surrogate pair; `nextOffset` is where the
 * next page starts, null at the end.
 */
export function pageStoredText(
  text: string,
  offset: number,
  max: number,
): { text: string; offset: number; nextOffset: number | null } {
  const start = Math.min(Math.max(0, Math.floor(offset)), text.length);
  let end = Math.min(text.length, start + max);
  const code = text.charCodeAt(end - 1);
  if (end < text.length && end > start + 1 && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(start, end), offset: start, nextOffset: end < text.length ? end : null };
}

/**
 * The plain sentence the agent reads next to the status. Every non-`done`
 * case says outright that the content is unknown, so the model never claims
 * to have read a file it couldn't.
 */
export function contentMessage(row: ContentFields | null): string {
  if (!row) {
    return "This file has not been processed for reading (it was attached before file reading existed). Its contents are unknown — do not describe them.";
  }
  switch (row.status) {
    case "pending":
      return "This file is still being read. Its contents are not available yet — do not describe them; check again shortly.";
    case "unsupported":
      return `This file can't be read (${row.error ?? UNSUPPORTED_TYPE}). Its contents are unknown — say so plainly; do not guess.`;
    case "failed":
      return `Reading this file failed (${row.error ?? "unknown error"}). Its contents are unknown — say so plainly; do not guess.`;
    case "done": {
      if (row.width !== undefined && row.height !== undefined) {
        return `Image ${row.width}×${row.height} px. Only the size is known; the picture itself was not read.`;
      }
      if (!row.text) {
        return "The file was read but contains no text (for example a scanned PDF). Do not describe its contents.";
      }
      return row.truncated
        ? `Text extracted; only the first ${EXTRACT_TEXT_MAX} characters were kept.`
        : "Text extracted.";
    }
  }
}
