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

import { extractText } from "unpdf";
import mammoth from "mammoth";
import { imageSize } from "image-size";
import {
  DOCX_MAX_UNCOMPRESSED_BYTES,
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

async function readPdf(bytes: Uint8Array): Promise<ExtractionOutcome> {
  // pdf.js may transfer (detach) the buffer it is given — hand it a copy.
  // Given raw data, unpdf opens the document and destroys it afterwards.
  const { totalPages, text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  const capped = capText(normalizeText(text));
  return { kind: "done", text: capped.text, truncated: capped.truncated, pageCount: totalPages };
}

async function readDocx(bytes: Uint8Array): Promise<ExtractionOutcome> {
  // Zip-bomb guard: the central directory states the unpacked size up front.
  const unpacked = zipUncompressedSize(bytes);
  if (unpacked !== null && unpacked > DOCX_MAX_UNCOMPRESSED_BYTES) {
    return { kind: "unsupported", reason: DOCX_TOO_LARGE };
  }
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
