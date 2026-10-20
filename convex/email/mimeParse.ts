/**
 * The inbound RFC 822 / MIME parser (docs/prd-email-triage.md B3, §5.2
 * steps 3–4). Pure — no Convex, no network, no Node APIs: the sync action
 * hands it a Gmail `raw` message (base64url) and stores what comes back.
 * The outbound builder is `email/mime.ts`.
 *
 * What it reads:
 *   - headers, unfolded and decoded (RFC 2047 encoded-words — B / Q, any
 *     charset, a multi-byte character split across words — and raw 8-bit
 *     UTF-8); From / To / Cc / Subject / Date / Message-ID / In-Reply-To /
 *     References, and the whole list for the bulk signals
 *     (`model.isBulkOrAutomated`);
 *   - the body: `text/plain` (several inline parts — Apple Mail around an
 *     inline image — are joined), else `text/html` → text; the HTML kept as
 *     is (capped) for the Gmail-style view;
 *   - transfer encodings base64 / quoted-printable / 7bit / 8bit / binary;
 *     charsets utf-8, us-ascii, iso-8859-1, iso-8859-2 (Hungarian),
 *     windows-1250, windows-1252 built in, anything else through
 *     `TextDecoder` when the runtime knows it (else UTF-8);
 *   - nested multipart (mixed / alternative / related / digest …, depth
 *     capped), RFC 2231 parameters (`filename*=utf-8''…`, continuations);
 *   - attachments `{ name, mime, size, contentBytes }`; an inline `cid:`
 *     image under 10 KB is a signature logo and is dropped; a calendar
 *     invite (`text/calendar`, `.ics`) is not an attachment; one larger than
 *     `maxAttachmentBytes` is listed with its size but never decoded
 *     (`contentBytes: null`);
 *   - `message/rfc822` (a forward as attachment) becomes text: a
 *     "Forwarded message" block with its headers and body; its own
 *     attachments are collected too.
 *
 * Never throws on malformed input — a broken part degrades to text or is
 * skipped. Sizes are capped (`truncated` says so).
 *
 * Internals work on "binary strings" (one char per byte, 0–255): boundary
 * search and header parsing stay simple, and V8 stores them one byte per
 * char.
 */

import { parseAddressList, type EmailAddress } from "./model";

export const MIME_MAX_DEPTH = 12;
export const DEFAULT_MAX_TEXT_CHARS = 100_000;
export const DEFAULT_MAX_HTML_CHARS = 300_000;
/** Gmail's own attachment limit; a larger one is listed, not stored (B3). */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
/** An inline `cid:` image below this is a signature logo, not an attachment. */
export const INLINE_LOGO_MAX_BYTES = 10 * 1024;
export const MAX_ATTACHMENTS = 30;
/** To / Cc entries kept per message (the rest is counted in `toOverflow` / `ccOverflow`). */
export const MAX_ADDRESSES = 100;
/** htmlToText reads at most this much HTML (the stored HTML is capped lower anyway). */
export const HTML_TO_TEXT_INPUT_CAP = 1_000_000;
const MAX_HEADERS = 300;
const MAX_HEADER_VALUE_CHARS = 8_000;
const MAX_REFERENCES = 50;

export type ParsedHeader = { name: string; value: string };

export type ParsedAttachment = {
  name: string;
  mime: string;
  /** Decoded size in bytes (estimated from the encoding when not decoded). */
  size: number;
  /** null when larger than `maxAttachmentBytes` (listed only). */
  contentBytes: Uint8Array | null;
  contentId: string | null;
  inline: boolean;
};

export type ParsedEmail = {
  /** Top-level headers, decoded, in order (capped). */
  headers: ParsedHeader[];
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  /** Addresses beyond `MAX_ADDRESSES` (of those in the — capped — header). */
  toOverflow: number;
  ccOverflow: number;
  subject: string;
  /** Epoch ms of the Date header; null when missing or unreadable. */
  date: number | null;
  /** `<id@host>` with angle brackets; null when missing. */
  messageId: string | null;
  inReplyTo: string | null;
  /** Oldest first, angle brackets kept. */
  references: string[];
  /** The plain-text body (or the HTML rendered as text), CRLF → LF, capped. */
  text: string;
  textFromHtml: boolean;
  html: string | null;
  attachments: ParsedAttachment[];
  /** Something was cut: text / html over the cap, or too many attachments. */
  truncated: boolean;
  /** What was dropped on purpose: `calendar`, `inline_logo`. */
  skipped: string[];
};

export type ParseOptions = {
  maxTextChars?: number;
  maxHtmlChars?: number;
  maxAttachmentBytes?: number;
};

// ─── Bytes ───────────────────────────────────────────────────────────────────

const CHUNK = 0x8000;

/** Bytes → a binary string (one char per byte). */
export function bytesToBinary(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))));
  }
  return parts.join("");
}

/** A binary string → bytes (chars above 255 are masked). */
export function binaryToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

const B64_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < alphabet.length; i++) table[alphabet.charCodeAt(i)] = i;
  table["-".charCodeAt(0)] = 62; // base64url
  table["_".charCodeAt(0)] = 63;
  return table;
})();

/** Decoded size of base64 text without decoding it (whitespace / junk ignored). */
export function base64DecodedSize(input: string): number {
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c < 256 && B64_LOOKUP[c] >= 0) n++;
  }
  return Math.floor((n * 3) / 4);
}

/** base64 or base64url → bytes; whitespace, padding and junk are skipped. */
export function base64ToBytes(input: string): Uint8Array {
  const out = new Uint8Array(base64DecodedSize(input));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    const v = c < 256 ? B64_LOOKUP[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Gmail's `raw` (base64url) → the message as a binary string. */
export function decodeGmailRaw(raw: string): string {
  return bytesToBinary(base64ToBytes(raw));
}

// ─── Charsets ────────────────────────────────────────────────────────────────

// High halves (0x80–0xFF) of the single-byte charsets that matter here.
// iso-8859-2: 0x80–0x9F are the C1 controls (identity), the table starts at 0xA0.
const ISO_8859_2_A0 =
  "\u00a0\u0104\u02d8\u0141\u00a4\u013d\u015a\u00a7\u00a8\u0160\u015e\u0164\u0179\u00ad\u017d\u017b" +
  "\u00b0\u0105\u02db\u0142\u00b4\u013e\u015b\u02c7\u00b8\u0161\u015f\u0165\u017a\u02dd\u017e\u017c" +
  "\u0154\u00c1\u00c2\u0102\u00c4\u0139\u0106\u00c7\u010c\u00c9\u0118\u00cb\u011a\u00cd\u00ce\u010e" +
  "\u0110\u0143\u0147\u00d3\u00d4\u0150\u00d6\u00d7\u0158\u016e\u00da\u0170\u00dc\u00dd\u0162\u00df" +
  "\u0155\u00e1\u00e2\u0103\u00e4\u013a\u0107\u00e7\u010d\u00e9\u0119\u00eb\u011b\u00ed\u00ee\u010f" +
  "\u0111\u0144\u0148\u00f3\u00f4\u0151\u00f6\u00f7\u0159\u016f\u00fa\u0171\u00fc\u00fd\u0163\u02d9";
const WINDOWS_1250_80 =
  "\u20ac\u0081\u201a\u0083\u201e\u2026\u2020\u2021\u0088\u2030\u0160\u2039\u015a\u0164\u017d\u0179" +
  "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u0098\u2122\u0161\u203a\u015b\u0165\u017e\u017a" +
  "\u00a0\u02c7\u02d8\u0141\u00a4\u0104\u00a6\u00a7\u00a8\u00a9\u015e\u00ab\u00ac\u00ad\u00ae\u017b" +
  "\u00b0\u00b1\u02db\u0142\u00b4\u00b5\u00b6\u00b7\u00b8\u0105\u015f\u00bb\u013d\u02dd\u013e\u017c" +
  ISO_8859_2_A0.slice(32); // 0xC0–0xFF are the same as iso-8859-2
const WINDOWS_1252_80 =
  "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f" +
  "\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";

function singleByte(bin: string, high: string, from: number): string {
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    const c = bin.charCodeAt(i) & 0xff;
    out += c >= from ? high[c - from] : String.fromCharCode(c);
  }
  return out;
}

function normalizeCharset(label: string | undefined): string {
  return (label ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\*.*$/, "") // RFC 2231 language suffix (utf-8*hu)
    .toLowerCase();
}

function isValidUtf8(bin: string): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(binaryToBytes(bin));
    return true;
  } catch {
    return false;
  }
}

/** A binary string in `charset` → text. Unknown charsets fall back to UTF-8. */
export function decodeCharset(bin: string, charset: string | undefined): string {
  const label = normalizeCharset(charset);
  if (!/[^\x00-\x7f]/.test(bin)) return bin;
  switch (label) {
    case "utf-8":
    case "utf8":
      return new TextDecoder("utf-8").decode(binaryToBytes(bin));
    case "iso-8859-1":
    case "iso8859-1":
    case "latin1":
    case "l1":
      return bin;
    case "windows-1252":
    case "cp1252":
    case "x-cp1252":
      return decode1252(bin);
    case "iso-8859-2":
    case "iso8859-2":
    case "iso_8859-2":
    case "latin2":
    case "l2":
      return singleByte(bin, ISO_8859_2_A0, 0xa0);
    case "windows-1250":
    case "cp1250":
    case "x-cp1250":
      return singleByte(bin, WINDOWS_1250_80, 0x80);
    case "":
    case "us-ascii":
    case "ascii":
      // Unlabelled 8-bit text: UTF-8 when it is valid, else the Central European legacy charset.
      return isValidUtf8(bin)
        ? new TextDecoder("utf-8").decode(binaryToBytes(bin))
        : singleByte(bin, WINDOWS_1250_80, 0x80);
    default:
      try {
        return new TextDecoder(label).decode(binaryToBytes(bin));
      } catch {
        return new TextDecoder("utf-8").decode(binaryToBytes(bin));
      }
  }
}

// windows-1252's 0xA0–0xFF are latin-1 (identity); only 0x80–0x9F are mapped.
// `singleByte` with a 32-char table would index past it for 0xA0+, so wrap it.
function decode1252(bin: string): string {
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    const c = bin.charCodeAt(i) & 0xff;
    out += c >= 0x80 && c < 0xa0 ? WINDOWS_1252_80[c - 0x80] : String.fromCharCode(c);
  }
  return out;
}

// ─── Transfer encodings ──────────────────────────────────────────────────────

/** Quoted-printable → binary string (soft breaks joined, trailing blanks dropped). */
export function decodeQuotedPrintable(bin: string): string {
  // Trailing blanks of each line are dropped with a linear scan (a regex with a
  // look-ahead is quadratic on a long run of spaces).
  const lines = bin.split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    let end = line.endsWith("\r") ? line.length - 1 : line.length;
    const cr = end < line.length;
    while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
    if (end < (cr ? line.length - 1 : line.length)) lines[i] = line.slice(0, end) + (cr ? "\r" : "");
  }
  return lines
    .join("\n")
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeTransfer(body: string, encoding: string | undefined): string {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "base64") return bytesToBinary(base64ToBytes(body));
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  return body;
}

// ─── Headers ─────────────────────────────────────────────────────────────────

type RawHeader = { name: string; value: string }; // value: binary, unfolded

function splitEntity(bin: string): { headers: RawHeader[]; body: string } {
  let headerEnd = -1;
  let bodyStart = 0;
  if (bin.startsWith("\r\n")) bodyStart = 2;
  else if (bin.startsWith("\n")) bodyStart = 1;
  else {
    const m = /\r?\n\r?\n/.exec(bin);
    if (m) {
      headerEnd = m.index;
      bodyStart = m.index + m[0].length;
    } else {
      headerEnd = bin.length;
      bodyStart = bin.length;
    }
  }
  const block = headerEnd < 0 ? "" : bin.slice(0, headerEnd);
  const headers: RawHeader[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && headers.length > 0) {
      const last = headers[headers.length - 1];
      if (last.value.length < MAX_HEADER_VALUE_CHARS) {
        last.value = `${last.value} ${line.trim()}`.slice(0, MAX_HEADER_VALUE_CHARS);
      }
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) continue; // an mbox "From " line, junk
    const name = line.slice(0, colon).trim();
    if (!/^[!-9;-~]+$/.test(name)) continue;
    if (headers.length >= MAX_HEADERS) continue;
    headers.push({ name, value: line.slice(colon + 1, colon + 1 + MAX_HEADER_VALUE_CHARS).trim() });
  }
  return { headers, body: bin.slice(bodyStart) };
}

function headerOf(headers: readonly RawHeader[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

const ENCODED_WORD_RE = /=\?([^?\s]+)\?([BbQq])\?([^?]*)\?=/g;

function decodeEncodedWordBytes(encoding: string, text: string): string {
  if (encoding.toUpperCase() === "B") return bytesToBinary(base64ToBytes(text));
  return text
    .replace(/_/g, " ")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** A plain (not encoded-word) header segment: raw 8-bit is UTF-8 when valid. */
function decodeRawSegment(bin: string): string {
  return decodeCharset(bin, "");
}

/**
 * RFC 2047: decode encoded-words (B / Q, any charset). Whitespace between
 * two encoded-words is dropped; adjacent words of one charset are joined as
 * bytes first, so a character split across words survives.
 */
export function decodeHeaderValue(raw: string): string {
  ENCODED_WORD_RE.lastIndex = 0;
  if (!raw.includes("=?")) return decodeRawSegment(raw).trim();
  let out = "";
  let last = 0;
  let pending: { charset: string; bytes: string } | null = null;
  const flush = () => {
    if (pending) out += decodeCharset(pending.bytes, pending.charset);
    pending = null;
  };
  for (const m of raw.matchAll(ENCODED_WORD_RE)) {
    const between = raw.slice(last, m.index);
    const charset = normalizeCharset(m[1]);
    const bytes = decodeEncodedWordBytes(m[2], m[3]);
    if (pending && /^[ \t\r\n]*$/.test(between)) {
      if (pending.charset === charset) pending.bytes += bytes;
      else {
        flush();
        pending = { charset, bytes };
      }
    } else {
      flush();
      out += decodeRawSegment(between);
      pending = { charset, bytes };
    }
    last = (m.index ?? 0) + m[0].length;
  }
  flush();
  out += decodeRawSegment(raw.slice(last));
  return out.trim();
}

type ParamValue = { value: string; charset?: string };

/**
 * `type/subtype; a=b; c="d"` → value + params, with RFC 2231 extended
 * (`name*=utf-8''%C3%A1`) and continued (`name*0*=…; name*1=…`) parameters.
 */
function parseStructured(raw: string | undefined): { value: string; params: Record<string, string> } {
  if (!raw) return { value: "", params: {} };
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && inQuotes && i + 1 < raw.length) {
      current += raw[++i];
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
      continue;
    }
    if (ch === ";" && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  const value = parts.shift()!.trim().toLowerCase();
  const simple: Record<string, ParamValue> = {};
  const continued: Record<string, Array<{ index: number; text: string; extended: boolean }>> = {};
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) val = val.slice(1, -1);
    const cont = /^([^*]+)\*(\d+)(\*?)$/.exec(key);
    if (cont) {
      (continued[cont[1]] ??= []).push({ index: Number(cont[2]), text: val, extended: cont[3] === "*" });
      continue;
    }
    if (key.endsWith("*")) {
      simple[key.slice(0, -1)] = extendedValue(val);
      continue;
    }
    if (!(key in simple)) simple[key] = { value: val };
  }
  const params: Record<string, string> = {};
  for (const [key, pieces] of Object.entries(continued)) {
    pieces.sort((a, b) => a.index - b.index);
    let charset: string | undefined;
    let bytes = "";
    for (const piece of pieces) {
      if (piece.extended) {
        let text = piece.text;
        if (piece.index === 0) {
          const m = /^([^']*)'[^']*'(.*)$/.exec(text);
          if (m) {
            charset = m[1] || undefined;
            text = m[2];
          }
        }
        bytes += percentDecode(text);
      } else {
        bytes += piece.text;
      }
    }
    params[key] = charset ? decodeCharset(bytes, charset) : decodeHeaderValue(bytes);
  }
  for (const [key, p] of Object.entries(simple)) {
    if (key in params) continue;
    params[key] = p.charset !== undefined ? decodeCharset(p.value, p.charset) : decodeHeaderValue(p.value);
  }
  return { value, params };
}

function percentDecode(text: string): string {
  return text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function extendedValue(val: string): ParamValue {
  const m = /^([^']*)'[^']*'(.*)$/.exec(val);
  if (!m) return { value: percentDecode(val), charset: "utf-8" };
  return { value: percentDecode(m[2]), charset: m[1] || "utf-8" };
}

const MESSAGE_ID_RE = /<[^<>\s]+>/g;

function firstMessageId(value: string | undefined): string | null {
  if (!value) return null;
  MESSAGE_ID_RE.lastIndex = 0;
  const m = value.match(MESSAGE_ID_RE);
  if (m && m.length > 0) return m[0];
  const bare = value.trim();
  return /^[^<>\s]+@[^<>\s]+$/.test(bare) ? `<${bare}>` : null;
}

function allMessageIds(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value.match(MESSAGE_ID_RE) ?? [];
  return [...new Set(ids)].slice(-MAX_REFERENCES);
}

/** An RFC 2822 date ("Mon, 19 Oct 2026 10:00:00 +0200 (CEST)") → epoch ms, or null. */
export function parseMailDate(value: string | undefined): number | null {
  if (!value) return null;
  const clean = value.slice(0, 200).replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  let ms = Date.parse(clean);
  if (Number.isNaN(ms)) ms = Date.parse(clean.replace(/^[A-Za-z]{3},?\s*/, ""));
  if (Number.isNaN(ms)) {
    // "19 Oct 2026 10:00:00 +0200" without seconds or with a bare offset name.
    const m = /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4})?/.exec(clean);
    if (!m) return null;
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mon = months.indexOf(m[2].toLowerCase());
    if (mon < 0) return null;
    const offset = m[7] ? (m[7][0] === "-" ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3))) : 0;
    ms = Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) - offset * 60_000;
  }
  return Number.isFinite(ms) ? ms : null;
}

// ─── HTML → text ─────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
  copy: "©", reg: "®", trade: "™", euro: "€", bull: "•", middot: "·", deg: "°", times: "×", shy: "",
  zwnj: "", zwj: "",
  aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó",
  ouml: "ö", Ouml: "Ö", uacute: "ú", Uacute: "Ú", uuml: "ü", Uuml: "Ü", auml: "ä", Auml: "Ä", szlig: "ß",
  odblac: "ő", Odblac: "Ő", udblac: "ű", Udblac: "Ű",
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      return code === 0xa0 ? " " : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[ref] ?? whole;
  });
}

const SKIPPED_ELEMENTS = new Set(["head", "script", "style", "title"]);
const PARAGRAPH_ELEMENTS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "table", "pre"]);
const LINE_ELEMENTS = new Set(["div", "tr", "li", "section", "article", "header", "footer"]);
const LINE = "\u0001";
const PARAGRAPH = "\u0002";
const BREAK = "\u0003";

/** The tag name of `<…>` text (`/p`, `br/`, `div class=…` → p, br, div). */
function tagName(tag: string): { name: string; closing: boolean } {
  let i = 0;
  while (i < tag.length && (tag[i] === " " || tag[i] === "\t" || tag[i] === "\n" || tag[i] === "\r")) i++;
  const closing = tag[i] === "/";
  if (closing) i++;
  let j = i;
  while (j < tag.length && /[A-Za-z0-9]/.test(tag[j])) j++;
  return { name: tag.slice(i, j).toLowerCase(), closing };
}

/**
 * Readable text from an email's HTML: structure → line breaks, tags dropped,
 * entities decoded. ONE linear pass over the (capped) input — `indexOf`
 * scans only, no backtracking regex: hostile HTML (`<!--` × 100 000, a
 * `<` with no `>`, a run of spaces) costs O(n).
 */
export function htmlToText(html: string): string {
  const src = (html.length > HTML_TO_TEXT_INPUT_CAP ? html.slice(0, HTML_TO_TEXT_INPUT_CAP) : html).replace(
    /[\u0001-\u0003]/g,
    "",
  );
  const lower = src.toLowerCase();
  const out: string[] = [];
  let pos = 0;
  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    if (lt < 0) {
      out.push(src.slice(pos));
      break;
    }
    out.push(src.slice(pos, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end < 0) break; // an unterminated comment hides the rest
      pos = end + 3;
      continue;
    }
    const gt = src.indexOf(">", lt + 1);
    if (gt < 0) {
      out.push(src.slice(lt)); // a stray "<": text
      break;
    }
    const { name, closing } = tagName(src.slice(lt + 1, Math.min(gt, lt + 64)));
    pos = gt + 1;
    if (!closing && SKIPPED_ELEMENTS.has(name)) {
      const close = lower.indexOf(`</${name}`, pos);
      if (close < 0) break;
      const closeEnd = src.indexOf(">", close);
      pos = closeEnd < 0 ? src.length : closeEnd + 1;
      continue;
    }
    if (name === "br") out.push(BREAK);
    else if (name === "li" && !closing) out.push(`${LINE}- `);
    else if (PARAGRAPH_ELEMENTS.has(name)) out.push(PARAGRAPH);
    else if (LINE_ELEMENTS.has(name)) out.push(LINE);
    else if ((name === "td" || name === "th") && closing) out.push(" ");
  }
  // Source whitespace collapses to one space (markers and <br> breaks survive).
  const text = decodeHtmlEntities(out.join("").replace(/[ \t\r\n\f\v\u00a0]+/g, " "));
  // A run of markers / breaks / spaces → its breaks (≤ 2), a paragraph when a marker says so.
  const isSep = (c: string) => c === LINE || c === PARAGRAPH || c === BREAK || c === " ";
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (!isSep(text[i])) {
      let j = i;
      while (j < text.length && !isSep(text[j])) j++;
      result += text.slice(i, j);
      i = j;
      continue;
    }
    let j = i;
    let paragraph = false;
    let line = false;
    let breaks = 0;
    while (j < text.length && isSep(text[j])) {
      if (text[j] === PARAGRAPH) paragraph = true;
      else if (text[j] === LINE) line = true;
      else if (text[j] === BREAK) breaks++;
      j++;
    }
    result += paragraph ? "\n\n" : breaks > 0 ? "\n".repeat(Math.min(breaks, 2)) : line ? "\n" : " ";
    i = j;
  }
  return result
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── The walk ────────────────────────────────────────────────────────────────

type Collect = {
  texts: string[];
  htmls: string[];
  attachments: ParsedAttachment[];
  skipped: string[];
  truncated: boolean;
  maxAttachmentBytes: number;
};

const CALENDAR_TYPES = new Set(["text/calendar", "application/ics", "text/x-vcalendar", "application/x-ics"]);

function extensionFor(mime: string): string {
  const sub = mime.split("/")[1] ?? "bin";
  const known: Record<string, string> = {
    jpeg: "jpg", "svg+xml": "svg", plain: "txt", "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx", msword: "doc", "octet-stream": "bin",
  };
  return known[sub] ?? (sub.replace(/[^a-z0-9]+/gi, "").slice(0, 10) || "bin");
}

function cleanFileName(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/]/g, "_").trim().slice(0, 200);
}

function walk(bin: string, c: Collect, depth: number, defaultType: string): void {
  const { headers, body } = splitEntity(bin);
  const ct = parseStructured(headerOf(headers, "content-type") ?? defaultType);
  const mime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(ct.value) ? ct.value : "text/plain";
  const [type, subtype] = mime.split("/");
  const disposition = parseStructured(headerOf(headers, "content-disposition"));
  const encoding = headerOf(headers, "content-transfer-encoding");

  if (type === "multipart") {
    const boundary = ct.params.boundary;
    const parts = boundary && depth < MIME_MAX_DEPTH ? splitMultipart(body, boundary) : null;
    if (parts && parts.length > 0) {
      const childDefault = subtype === "digest" ? "message/rfc822" : "text/plain";
      for (const part of parts) walk(part, c, depth + 1, childDefault);
      return;
    }
    // A multipart with no usable boundary: read whatever text there is.
    if (body.trim()) c.texts.push(decodeCharset(body, ct.params.charset));
    return;
  }

  const fileName = disposition.params.filename || ct.params.name || "";
  const isAttachmentDisposition = disposition.value === "attachment";

  if (mime === "message/rfc822" && depth < MIME_MAX_DEPTH) {
    const inner = decodeTransfer(body, encoding);
    c.texts.push(forwardBlock(inner, c, depth + 1));
    return;
  }

  if (CALENDAR_TYPES.has(mime) || /\.(ics|vcs)$/i.test(fileName)) {
    c.skipped.push("calendar");
    return;
  }

  if (type === "text" && (subtype === "plain" || subtype === "html") && !isAttachmentDisposition && !fileName) {
    const text = decodeCharset(decodeTransfer(body, encoding), ct.params.charset);
    if (subtype === "plain") c.texts.push(text);
    else c.htmls.push(text);
    return;
  }

  // An attachment (or an inline image / file).
  const contentId = (headerOf(headers, "content-id") ?? "").replace(/^\s*<|>\s*$/g, "").trim() || null;
  const enc = (encoding ?? "").trim().toLowerCase();
  const size =
    enc === "base64"
      ? base64DecodedSize(body)
      : enc === "quoted-printable"
        ? decodeQuotedPrintable(body).length
        : body.length;
  const inline = disposition.value === "inline" || (contentId !== null && !isAttachmentDisposition);
  if (type === "image" && contentId && inline && size < INLINE_LOGO_MAX_BYTES) {
    c.skipped.push("inline_logo");
    return;
  }
  if (c.attachments.length >= MAX_ATTACHMENTS) {
    c.truncated = true;
    return;
  }
  const name = cleanFileName(fileName) || `attachment-${c.attachments.length + 1}.${extensionFor(mime)}`;
  const contentBytes =
    size > c.maxAttachmentBytes
      ? null
      : enc === "base64"
        ? base64ToBytes(body)
        : binaryToBytes(decodeTransfer(body, encoding));
  c.attachments.push({ name, mime, size: contentBytes ? contentBytes.length : size, contentBytes, contentId, inline });
}

/** The parts of a multipart body (preamble / epilogue dropped; an unterminated last part kept). */
function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  let pos = 0;
  let start = -1;
  for (;;) {
    const idx = body.indexOf(delimiter, pos);
    if (idx < 0) break;
    const after = idx + delimiter.length;
    const atLineStart = idx === 0 || body[idx - 1] === "\n";
    const next = body.slice(after, after + 2);
    const closing = next === "--";
    const boundaryEnds = closing || after >= body.length || /^[ \t\r\n]/.test(next);
    if (!atLineStart || !boundaryEnds) {
      pos = after;
      continue;
    }
    if (start >= 0) {
      let end = idx;
      if (body[end - 1] === "\n") end--;
      if (body[end - 1] === "\r") end--;
      parts.push(body.slice(start, Math.max(start, end)));
    }
    if (closing) return parts;
    const eol = body.indexOf("\n", after);
    start = eol < 0 ? body.length : eol + 1;
    pos = start;
  }
  if (start >= 0 && start < body.length) parts.push(body.slice(start));
  return parts;
}

/** A `message/rfc822` part as text: the forward block Gmail would show (attachments collected). */
function forwardBlock(inner: string, c: Collect, depth: number): string {
  const { headers } = splitEntity(inner);
  const sub: Collect = { ...c, texts: [], htmls: [] };
  walk(inner, sub, depth, "text/plain");
  c.truncated = c.truncated || sub.truncated;
  const text = sub.texts.length > 0 ? sub.texts.join("\n") : sub.htmls.length > 0 ? htmlToText(sub.htmls.join("\n")) : "";
  const line = (label: string, name: string) => {
    const value = headerOf(headers, name);
    return value ? `${label}: ${decodeHeaderValue(value)}\n` : "";
  };
  return (
    "---------- Forwarded message ---------\n" +
    line("From", "from") +
    line("Date", "date") +
    line("Subject", "subject") +
    line("To", "to") +
    line("Cc", "cc") +
    `\n${text}`
  );
}

/** Leading blank lines and trailing whitespace off, without a backtracking regex. */
function trimBody(text: string): string {
  let start = 0;
  while (start < text.length && text.charCodeAt(start) === 10) start++;
  return text.slice(start).trimEnd();
}

/**
 * M1: addresses are parsed from the RAW header — the structure (`<…>`,
 * commas, quotes) is never taken from decoded text, so an encoded-word
 * display name like `=?utf-8?B?…reka@pragmatico.hu <…?=` cannot become the
 * address. Only the display name is decoded afterwards.
 */
function rawAddresses(raw: string | undefined, max: number): { list: EmailAddress[]; overflow: number } {
  if (!raw) return { list: [], overflow: 0 };
  const parsed = parseAddressList(raw);
  const list = parsed.slice(0, max).map((a) => {
    const email = decodeCharset(a.email, "").toLowerCase();
    const name = a.name ? decodeHeaderValue(a.name).replace(/\s+/g, " ").trim() : "";
    return name && name.toLowerCase() !== email ? { name, email } : { email };
  });
  return { list, overflow: Math.max(0, parsed.length - max) };
}

function cap(text: string, max: number): { text: string; cut: boolean } {
  return text.length > max ? { text: text.slice(0, max), cut: true } : { text, cut: false };
}

/**
 * Parse one RFC 822 message (a binary string — `decodeGmailRaw` — or bytes).
 * Never throws.
 */
export function parseRawEmail(raw: string | Uint8Array, options: ParseOptions = {}): ParsedEmail {
  const bin = typeof raw === "string" ? raw : bytesToBinary(raw);
  const maxText = options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const maxHtml = options.maxHtmlChars ?? DEFAULT_MAX_HTML_CHARS;
  const { headers: rawHeaders } = splitEntity(bin);
  const collect: Collect = {
    texts: [],
    htmls: [],
    attachments: [],
    skipped: [],
    truncated: false,
    maxAttachmentBytes: options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES,
  };
  try {
    walk(bin, collect, 0, "text/plain");
  } catch {
    // Defensive: a pathological input never breaks ingest — keep what was read.
  }

  const headers: ParsedHeader[] = rawHeaders.map((h) => ({ name: h.name, value: decodeHeaderValue(h.value) }));
  const get = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value;
  const rawGet = (name: string) => headerOf(rawHeaders, name);

  const to = rawAddresses(rawGet("to"), MAX_ADDRESSES);
  const cc = rawAddresses(rawGet("cc"), MAX_ADDRESSES);
  const htmlJoined = collect.htmls.length > 0 ? collect.htmls.join("\n") : null;
  const plain = collect.texts.join("\n").replace(/\r\n?/g, "\n");
  const textFromHtml = !plain.trim() && htmlJoined !== null;
  const text = cap(textFromHtml ? htmlToText(htmlJoined!) : trimBody(plain), maxText);
  const html = htmlJoined === null ? null : cap(htmlJoined, maxHtml);

  return {
    headers,
    from: rawAddresses(rawGet("from"), 1).list[0] ?? null,
    to: to.list,
    cc: cc.list,
    toOverflow: to.overflow,
    ccOverflow: cc.overflow,
    subject: (get("subject") ?? "").replace(/\s+/g, " ").trim(),
    date: parseMailDate(rawGet("date")),
    messageId: firstMessageId(rawGet("message-id")),
    inReplyTo: firstMessageId(rawGet("in-reply-to")),
    references: allMessageIds(rawGet("references")),
    text: text.text,
    textFromHtml,
    html: html?.text ?? null,
    attachments: collect.attachments,
    truncated: collect.truncated || text.cut || Boolean(html?.cut),
    skipped: collect.skipped,
  };
}
