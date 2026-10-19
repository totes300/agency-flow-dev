/**
 * The outbound RFC 2822 / MIME builder (docs/prd-email-triage.md §5.4, D9,
 * I4). Pure — no Convex, no network, no clock: the send action passes the
 * date, our Message-ID and the attachment bytes in, and gets the message
 * back as text (`buildMimeMessage`) or as Gmail's `raw` (`buildGmailRaw`,
 * base64url).
 *
 * Encoding rules (Gmail-safe, UTF-8 throughout):
 *   - every header value is ASCII on the wire: a non-ASCII Subject or display
 *     name becomes RFC 2047 encoded-words (`=?UTF-8?B?…?=`), each ≤ 75
 *     chars, split on character boundaries (never inside a UTF-8 sequence)
 *     and folded with CRLF + space;
 *   - CR / LF inside any header value are removed (no header injection);
 *     addresses are validated, never re-encoded;
 *   - the body is `text/plain; charset=UTF-8`, base64 in 76-char lines;
 *   - attachments make it `multipart/mixed` (text part first), each part
 *     base64 with an encoded `name` / `filename`;
 *   - no line is longer than 998 characters (RFC 5322 §2.1.1): encoded
 *     display names and filenames are folded one encoded-word per line,
 *     names / filenames are capped, `References` keeps the last 20 ids and
 *     drops any id longer than 250 chars; a line that would still be too
 *     long is refused (`MimeBuildError`), never sent;
 *   - `In-Reply-To` + `References` (folded, one id per line) keep a reply in
 *     the client's thread; our own `Message-ID` lets an unknown outcome be
 *     confirmed by searching the mailbox (`rfc822msgid:`).
 */

export type MimeAddress = { name?: string; email: string };

export type MimeAttachment = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type MimeMessageInput = {
  from: MimeAddress;
  to: readonly MimeAddress[];
  cc: readonly MimeAddress[];
  subject: string;
  bodyText: string;
  /** Our Message-ID, with angle brackets (`generateMessageId`). */
  messageId: string;
  /** The message replied to (angle brackets), for a reply in a thread. */
  inReplyTo?: string;
  /** The thread's Message-IDs, oldest first (angle brackets). */
  references?: readonly string[];
  /** Epoch ms — the Date header. */
  date: number;
  attachments?: readonly MimeAttachment[];
  /** Multipart boundary (tests pin it); derived from the Message-ID otherwise. */
  boundary?: string;
};

const CRLF = "\r\n";
/** RFC 2047: an encoded-word is at most 75 characters. */
const ENCODED_WORD_MAX = 75;
const ENCODED_WORD_OVERHEAD = "=?UTF-8?B??=".length; // 12
/** Base64 payload ≤ 63 chars → at most 45 source bytes (60 chars) per word. */
const ENCODED_WORD_MAX_BYTES = Math.floor((ENCODED_WORD_MAX - ENCODED_WORD_OVERHEAD) / 4) * 3;
const BASE64_LINE = 76;
/** RFC 5322 §2.1.1: a line is at most 998 characters (excluding CRLF). */
export const MAX_LINE_LENGTH = 998;
/** `References` keeps the thread's latest ids only. */
export const REFERENCES_MAX = 20;
/** A longer Message-ID is dropped from References (and refused elsewhere). */
export const MESSAGE_ID_MAX = 250;
const NAME_MAX = 200;
const FILENAME_MAX = 150;
const FOLD = `${CRLF} `;

const EMAIL_RE = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]{2,}$/;
const MESSAGE_ID_RE = /^<[^<>\s]+@[^<>\s]+>$/;

export class MimeBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MimeBuildError";
  }
}

// ─── Base64 ─────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder();

function bytesToBinary(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

/** base64url without padding (Gmail's `raw`). Input must be ASCII / binary-safe text. */
export function toBase64Url(text: string): string {
  // The built message is pure ASCII (all non-ASCII is encoded), so btoa is safe.
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) throw new MimeBuildError("The raw message must be ASCII");
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode base64url (tests, and reading Gmail's `raw` back). */
export function fromBase64Url(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function wrapLines(text: string, width: number): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join(CRLF);
}

// ─── Header encoding ────────────────────────────────────────────────────────

/** Header text without CR / LF / other control characters (no injection). */
export function sanitizeHeaderText(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

const isPrintableAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/**
 * RFC 2047 encoded-words (B encoding) for `text`, split on code points so no
 * word exceeds 75 chars and no UTF-8 sequence is cut. Returns the words; the
 * caller joins them with a fold (CRLF + space).
 */
export function encodeWords(text: string): string[] {
  const words: string[] = [];
  let chunk: number[] = [];
  const flush = () => {
    if (chunk.length === 0) return;
    words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
    chunk = [];
  };
  for (const ch of text) {
    const bytes = utf8.encode(ch);
    if (chunk.length + bytes.length > ENCODED_WORD_MAX_BYTES) flush();
    chunk.push(...bytes);
  }
  flush();
  return words;
}

/** An unstructured header value (Subject): as-is when printable ASCII, else encoded-words. */
export function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeaderText(value);
  if (isPrintableAscii(clean) && clean.length <= 900) return clean;
  return encodeWords(clean).join(FOLD);
}

/** `Name <a@b>` with the name quoted (ASCII) or encoded (non-ASCII). */
export function formatAddress(address: MimeAddress): string {
  const email = address.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new MimeBuildError("Invalid email address");
  const name = address.name ? sanitizeHeaderText(address.name).slice(0, NAME_MAX) : "";
  if (!name || name.toLowerCase() === email) return email;
  if (isPrintableAscii(name)) {
    return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
  }
  // One encoded-word per folded line — a long name never makes a long line.
  return `${encodeWords(name).join(FOLD)} <${email}>`;
}

/** An address list header value, one address per folded line. */
function formatAddressList(addresses: readonly MimeAddress[]): string {
  return addresses.map(formatAddress).join(`,${FOLD}`);
}

/** A quoted MIME parameter value (`name`, `filename`), encoded when non-ASCII. */
function encodeParam(value: string): string {
  const clean = sanitizeHeaderText(value).replace(/["\\]/g, "_").slice(0, FILENAME_MAX) || "attachment";
  if (isPrintableAscii(clean)) return `"${clean}"`;
  // Folded between encoded-words (unfolds to the space decoders ignore between words).
  return `"${encodeWords(clean).join(FOLD)}"`;
}

/** RFC 5322 date: `Mon, 19 Oct 2026 08:05:00 +0000`. */
export function formatRfc2822Date(ms: number): string {
  const d = new Date(ms);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`
  );
}

// ─── Message-ID ─────────────────────────────────────────────────────────────

/** A random v4 UUID from 16 random bytes (callers pass `crypto.getRandomValues`). */
export function uuidFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new MimeBuildError("Need 16 random bytes");
  const b = Uint8Array.from(bytes.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * `<uuid@domain-of-the-sending-mailbox>` — e.g. `<…@konverted.io>` for
 * adam@konverted.io. One per approval (§5.4 unknown-outcome check); the
 * domain is the From address's own, so the header matches the sender and
 * never names a domain we don't send from.
 */
export function generateMessageId(
  fromEmail: string,
  randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16)),
): string {
  const email = fromEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new MimeBuildError("The sending mailbox has no valid address");
  return `<${uuidFromBytes(randomBytes)}@${email.slice(email.lastIndexOf("@") + 1)}>`;
}

/** The id without angle brackets — what Gmail's `rfc822msgid:` search takes. */
export function bareMessageId(messageId: string): string {
  return messageId.trim().replace(/^<|>$/g, "");
}

function assertMessageId(id: string, label: string): string {
  const clean = sanitizeHeaderText(id);
  if (!MESSAGE_ID_RE.test(clean) || clean.length > MESSAGE_ID_MAX) {
    throw new MimeBuildError(`${label} must look like <id@domain> (at most ${MESSAGE_ID_MAX} chars)`);
  }
  return clean;
}

/** The ids References keeps: well-formed, ≤ 250 chars, the latest 20. */
export function capReferences(ids: readonly string[]): string[] {
  return ids
    .map((id) => sanitizeHeaderText(id))
    .filter((id) => MESSAGE_ID_RE.test(id) && id.length <= MESSAGE_ID_MAX)
    .slice(-REFERENCES_MAX);
}

function assertLineLengths(message: string): string {
  for (const line of message.split(CRLF)) {
    if (line.length > MAX_LINE_LENGTH) throw new MimeBuildError("A header line is too long to send");
  }
  return message;
}

/** A reply subject (D9 — locked to the thread): "Re: <thread subject without prefixes>". */
export function replySubject(normalizedThreadSubject: string): string {
  const base = sanitizeHeaderText(normalizedThreadSubject);
  return base ? `Re: ${base}` : "Re:";
}

// ─── The message ────────────────────────────────────────────────────────────

function textPart(bodyText: string): { headers: string[]; body: string } {
  // Normalise newlines; base64 keeps every byte (accents, emoji) exact.
  const normalized = bodyText.replace(/\r\n?/g, "\n").replace(/\n/g, CRLF);
  return {
    headers: ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"],
    body: wrapLines(bytesToBase64(utf8.encode(normalized)), BASE64_LINE),
  };
}

/** The whole message as RFC 2822 text (ASCII only, CRLF line ends). */
export function buildMimeMessage(input: MimeMessageInput): string {
  if (input.to.length === 0) throw new MimeBuildError("The email has no recipient");
  const headers: string[] = [
    `From: ${formatAddress(input.from)}`,
    `To: ${formatAddressList(input.to)}`,
  ];
  if (input.cc.length > 0) headers.push(`Cc: ${formatAddressList(input.cc)}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  headers.push(`Date: ${formatRfc2822Date(input.date)}`);
  const messageId = assertMessageId(input.messageId, "Message-ID");
  headers.push(`Message-ID: ${messageId}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${assertMessageId(input.inReplyTo, "In-Reply-To")}`);
  const references = capReferences(input.references ?? []);
  if (references.length > 0) headers.push(`References: ${references.join(FOLD)}`);
  headers.push("MIME-Version: 1.0");

  const text = textPart(input.bodyText);
  const attachments = input.attachments ?? [];
  if (attachments.length === 0) {
    return assertLineLengths([...headers, ...text.headers].join(CRLF) + CRLF + CRLF + text.body + CRLF);
  }

  const boundary =
    input.boundary ?? `=_af_${bareMessageId(messageId).replace(/[^A-Za-z0-9]/g, "").slice(0, 40)}`;
  if (!/^[A-Za-z0-9'()+_,\-./:=?]{1,70}$/.test(boundary)) throw new MimeBuildError("Invalid boundary");
  const parts: string[] = [[...text.headers].join(CRLF) + CRLF + CRLF + text.body];
  for (const att of attachments) {
    const mime = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(att.mimeType)
      ? att.mimeType.toLowerCase()
      : "application/octet-stream";
    parts.push(
      [
        `Content-Type: ${mime};${FOLD}name=${encodeParam(att.filename)}`,
        `Content-Disposition: attachment;${FOLD}filename=${encodeParam(att.filename)}`,
        "Content-Transfer-Encoding: base64",
      ].join(CRLF) +
        CRLF +
        CRLF +
        wrapLines(bytesToBase64(att.bytes), BASE64_LINE),
    );
  }
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  return assertLineLengths(
    headers.join(CRLF) +
    CRLF +
    CRLF +
    "This is a multi-part message in MIME format." +
    CRLF +
    parts.map((p) => `--${boundary}${CRLF}${p}${CRLF}`).join("") +
    `--${boundary}--${CRLF}`
  );
}

/** Gmail's `raw`: the message, base64url (users.messages.send). */
export function buildGmailRaw(input: MimeMessageInput): string {
  return toBase64Url(buildMimeMessage(input));
}
