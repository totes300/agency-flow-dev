/**
 * The library-backed extractors for attachment contents (docs/prd-mcp.md
 * §10; ported from c3972ab). Node-only
 * (`mammoth` needs `Buffer`), so it is imported ONLY by the `"use node"`
 * action `convex/attachmentExtraction.ts` and by its vitest suite — never by
 * a Convex query/mutation module or client code.
 *
 * Deterministic parse failures (a corrupt DOCX, bytes that are not the image
 * they claim to be) come back as PERMANENT error outcomes — retrying cannot
 * help. Anything else a library throws propagates; the action turns it into
 * a readable reason (`describeExtractionError`, which also recognizes pdf.js'
 * encrypted / damaged PDF exceptions as permanent) and the status decision.
 */

import { getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { imageSize } from "image-size";
import { Inflate } from "fflate";
import {
  DOCX_DOCUMENT_XML_MAX_BYTES,
  DOCX_MAX_UNCOMPRESSED_BYTES,
  EXTRACT_TEXT_MAX,
  TEXT_BYTES_MAX,
  capText,
  normalizeText,
  zipUncompressedSize,
  type ExtractFormat,
  type ExtractionOutcome,
} from "./contents";

type Extractable = Exclude<ExtractFormat, "unsupported">;

export const DOCX_DAMAGED = "DOCX is damaged or not a valid Word file";
export const DOCX_TOO_LARGE = "Document is too large to read once unpacked";
export const IMAGE_UNREADABLE = "Not a readable image (damaged, or the file type doesn't match its name)";

/**
 * PDF text, page by page (as unpdf's `extractText` joins it), stopping once
 * the text kept would pass `maxChars` — a huge PDF is never read to the end
 * for text that is then thrown away. The page count is always the whole
 * document's.
 */
export async function readPdf(bytes: Uint8Array, maxChars = EXTRACT_TEXT_MAX): Promise<ExtractionOutcome> {
  // pdf.js may transfer (detach) the buffer it is given — hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const pages: string[] = [];
    let raw = 0;
    let stoppedEarly = false;
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
      page.cleanup();
      pages.push(text);
      raw += text.length;
      // Normalizing only shrinks text, so check it once the raw text could be over.
      if (raw >= maxChars && n < pdf.numPages && normalizeText(mergePages(pages)).length >= maxChars) {
        stoppedEarly = true;
        break;
      }
    }
    const capped = capText(normalizeText(mergePages(pages)), maxChars);
    return { kind: "done", text: capped.text, truncated: capped.truncated || stoppedEarly, pageCount: pdf.numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** Pages joined like unpdf's `mergePages`: whitespace collapsed, line breaks kept, at most one blank line. */
function mergePages(pages: readonly string[]): string {
  return pages.join("\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n");
}

/** Compressed input fed to the inflater per step: one step can unpack at most ~4 MB (DEFLATE tops out near 1:1032). */
const INFLATE_STEP = 4 * 1024;

/**
 * Unpacks every entry of a ZIP (a DOCX) for real — not trusting the sizes
 * its headers claim — counting the output and stopping as soon as the whole
 * archive passes DOCX_MAX_UNCOMPRESSED_BYTES or word/document.xml passes
 * DOCX_DOCUMENT_XML_MAX_BYTES. The output is discarded; this only proves
 * what mammoth would unpack. "damaged" when the archive cannot be walked.
 */
export function checkZipUnpackedSize(bytes: Uint8Array): "ok" | "too_large" | "damaged" {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "damaged";
  const entries = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) return "damaged";
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) return "damaged";
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + compressed > bytes.length) return "damaged";
    const entryCap = name === "word/document.xml" ? DOCX_DOCUMENT_XML_MAX_BYTES : Number.POSITIVE_INFINITY;
    let size = 0;
    if (method === 0) {
      size = compressed;
    } else if (method === 8) {
      const inflater = new Inflate((chunk) => {
        size += chunk.length;
      });
      try {
        for (let at = 0; at < compressed; at += INFLATE_STEP) {
          const end = Math.min(compressed, at + INFLATE_STEP);
          inflater.push(bytes.subarray(start + at, start + end), end === compressed);
          if (size > entryCap || total + size > DOCX_MAX_UNCOMPRESSED_BYTES) return "too_large";
        }
      } catch {
        return "damaged";
      }
    } else {
      return "damaged";
    }
    total += size;
    if (size > entryCap || total > DOCX_MAX_UNCOMPRESSED_BYTES) return "too_large";
  }
  return "ok";
}

async function readDocx(bytes: Uint8Array): Promise<ExtractionOutcome> {
  // Zip-bomb guards: the sizes the central directory claims (cheap), then
  // the real unpacked sizes with a cap, before mammoth unpacks anything.
  const unpacked = zipUncompressedSize(bytes);
  if (unpacked !== null && unpacked > DOCX_MAX_UNCOMPRESSED_BYTES) {
    return { kind: "unsupported", reason: DOCX_TOO_LARGE };
  }
  const real = checkZipUnpackedSize(bytes);
  if (real === "too_large") return { kind: "unsupported", reason: DOCX_TOO_LARGE };
  if (real === "damaged") return { kind: "error", reason: DOCX_DAMAGED, permanent: true };
  let value: string;
  try {
    ({ value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) }));
  } catch {
    return { kind: "error", reason: DOCX_DAMAGED, permanent: true };
  }
  const capped = capText(normalizeText(value));
  return { kind: "done", text: capped.text, truncated: capped.truncated };
}

function readText(bytes: Uint8Array): ExtractionOutcome {
  // Decode only what the cap can keep (a cut multi-byte char at the end
  // decodes to U+FFFD and is past the cap or harmless).
  const sliced = bytes.length > TEXT_BYTES_MAX;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(sliced ? bytes.subarray(0, TEXT_BYTES_MAX) : bytes);
  const capped = capText(normalizeText(decoded));
  return { kind: "done", text: capped.text, truncated: capped.truncated || sliced };
}

function readImage(bytes: Uint8Array): ExtractionOutcome {
  let size: { width?: number; height?: number };
  try {
    size = imageSize(bytes);
  } catch {
    return { kind: "error", reason: IMAGE_UNREADABLE, permanent: true };
  }
  if (!size.width || !size.height) {
    return { kind: "error", reason: IMAGE_UNREADABLE, permanent: true };
  }
  return { kind: "done", width: size.width, height: size.height };
}

/** Read one file's bytes with the extractor its format routes to. */
export async function extractFileContent(
  bytes: Uint8Array,
  format: Extractable,
): Promise<ExtractionOutcome> {
  switch (format) {
    case "pdf":
      return await readPdf(bytes);
    case "docx":
      return await readDocx(bytes);
    case "text":
      return readText(bytes);
    case "image":
      return readImage(bytes);
  }
}
