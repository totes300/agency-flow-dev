/**
 * Pure composer layer (PRD: Composer, US 14–17). The Tiptap composer lets a
 * user @-mention the four domain entities and attach text files; both must
 * reach the agent as *authoritative, exact* context so the model never guesses
 * an entity by name (this is a determinism feature, not sugar — D1-adjacent).
 *
 * Everything here is deterministic and I/O-free so it unit-tests cleanly
 * (composer.test.ts) and is safe to import from BOTH the client composer and
 * the Convex runner. It must never reach `lib/format` / `lib/duration` — the
 * Convex bundler can't resolve that alias (see worksheetsHelpers).
 *
 * Two representations of a mention, derived from the same editor at send time:
 *  1. an inline token in the message text — `@[label](type:id)` — so the sent
 *     bubble can re-style references after a reload with no side table, and
 *  2. a structured `MentionRef[]` the runner re-resolves and injects as an
 *     authoritative "the user referenced these exact records" block.
 */

/** The four mentionable domain entities. */
export type MentionType = "task" | "project" | "client" | "user";

export const MENTION_TYPES: readonly MentionType[] = [
  "task",
  "project",
  "client",
  "user",
];

/** A structured entity reference produced by the composer on send. */
export type MentionRef = {
  type: MentionType;
  /** The entity's Convex id (string form on the wire). */
  id: string;
  /** Display label at authoring time (server re-resolves the canonical name). */
  label: string;
};

/** A composer file attachment, after upload (storageId) — extracted at run time. */
export type AttachmentRef = {
  /** Convex `_storage` id (string form on the wire). */
  storageId: string;
  name: string;
  mimeType: string;
  size: number;
};

// ─── Mention inline token ────────────────────────────────────────────────────

/**
 * Labels must not contain the token's structural characters, or the round-trip
 * regex would mis-parse. Brackets/parens/newlines are stripped and runs of
 * whitespace collapsed — display-only loss, the id stays authoritative.
 */
export function sanitizeMentionLabel(label: string): string {
  return label.replace(/[[\]()\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

/** Serialize one mention to its inline message token: `@[label](type:id)`. */
export function serializeMentionToken(ref: {
  type: MentionType;
  id: string;
  label: string;
}): string {
  return `@[${sanitizeMentionLabel(ref.label)}](${ref.type}:${ref.id})`;
}

/**
 * Matches an inline mention token. `id` is greedy-free up to the closing paren;
 * ids never contain `)`. Global + sticky-free so it can drive both `matchAll`
 * (parsing) and `test`.
 */
export const MENTION_TOKEN_RE =
  /@\[([^\]]*)\]\((task|project|client|user):([^)]+)\)/g;

/** A run of parsed message text: either literal prose or a styled mention. */
export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; type: MentionType; id: string; label: string };

/**
 * Split a stored message into literal-text and mention segments so the sent
 * bubble can render mentions as styled chips. Text with no tokens yields a
 * single text segment (or none when empty).
 */
export function parseMentionText(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;
  // Fresh regex per call — the shared literal carries lastIndex state.
  const re = new RegExp(MENTION_TOKEN_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, start) });
    }
    segments.push({
      kind: "mention",
      label: match[1],
      type: match[2] as MentionType,
      id: match[3],
    });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

// ─── Attachment support ──────────────────────────────────────────────────────

/**
 * Only plain-text formats are extractable inside a Convex action today. PDF is
 * deferred (PRD Open Q1) and rejected with a clear message — never a wasted run.
 */
const SUPPORTED_ATTACHMENT_EXTENSIONS = [".txt", ".csv"] as const;
const SUPPORTED_ATTACHMENT_MIME_PREFIXES = ["text/"];
const SUPPORTED_ATTACHMENT_MIMES = [
  "text/plain",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // some browsers label .csv this way
];

/**
 * Whether a file can be handed to the agent as extracted text. Extension wins
 * over MIME (browsers report `.csv` inconsistently), but a `text/*` MIME alone
 * also qualifies.
 */
export function isSupportedAttachment(name: string, mimeType: string): boolean {
  const lower = name.toLowerCase();
  if (SUPPORTED_ATTACHMENT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  const mime = mimeType.toLowerCase();
  if (SUPPORTED_ATTACHMENT_MIMES.includes(mime)) return true;
  return SUPPORTED_ATTACHMENT_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

/** Inline rejection copy for an unsupported/unreadable file (US 17). */
export function attachmentRejectionMessage(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return `PDF isn't supported yet — paste the text or attach a .txt/.csv (${name}).`;
  }
  return `Unsupported file: ${name}. Attach a .txt or .csv file.`;
}

// ─── Authoritative context assembly (runner-side) ────────────────────────────

/** Per-attachment extracted text, capped, handed to `buildComposerContext`. */
export type ExtractedAttachment = { name: string; text: string };

/** Hard caps so a huge paste/upload can't blow the model context or arg size. */
export const ATTACHMENT_CHAR_LIMIT = 50_000;
export const ATTACHMENT_TOTAL_CHAR_LIMIT = 120_000;

/** Truncate one attachment's text to the per-file cap, flagging when clipped. */
export function capAttachmentText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= ATTACHMENT_CHAR_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, ATTACHMENT_CHAR_LIMIT), truncated: true };
}

const MENTION_TYPE_NOUN: Record<MentionType, string> = {
  task: "Task",
  project: "Project",
  client: "Client",
  user: "Person",
};

/**
 * Build the authoritative context block appended to a run's system instructions.
 * `mentions` are the server-RE-RESOLVED refs (canonical names + verified ids),
 * so the model is told to use these exact ids and never resolve by name. File
 * contents follow verbatim, fenced by name. Returns "" when there's nothing to
 * add (so the caller appends nothing).
 */
export function buildComposerContext(input: {
  mentions: MentionRef[];
  attachments: ExtractedAttachment[];
}): string {
  const sections: string[] = [];

  if (input.mentions.length > 0) {
    const lines = input.mentions.map(
      (m) =>
        `- ${MENTION_TYPE_NOUN[m.type]} "${m.label}" — ${m.type} id: ${m.id}`,
    );
    sections.push(
      "The user explicitly referenced these records in their message. " +
        "Use these exact ids in any tool call; do NOT resolve them by name:\n" +
        lines.join("\n"),
    );
  }

  if (input.attachments.length > 0) {
    const files = input.attachments.map(
      (a) => `--- file: ${a.name} ---\n${a.text}\n--- end of ${a.name} ---`,
    );
    sections.push(
      "The user attached the following file(s). Treat their contents as " +
        "provided source material:\n" +
        files.join("\n\n"),
    );
  }

  return sections.join("\n\n");
}
