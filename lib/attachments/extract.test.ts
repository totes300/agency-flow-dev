// @vitest-environment node
//
// A6 extractors against tiny real fixtures (convex/__tests__/fixtures/):
// a 2-page PDF (unpdf), a DOCX (mammoth), a 1200×628 PNG (image-size) and a
// CRLF text file. Runs in the node environment — the same runtime as the
// "use node" action that calls these.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFileContent } from "./extract";
import {
  DOCX_MAX_UNCOMPRESSED_BYTES,
  TEXT_BYTES_MAX,
  describeExtractionError,
  zipUncompressedSize,
} from "./contents";
import { DOCX_DAMAGED, DOCX_TOO_LARGE, IMAGE_UNREADABLE } from "./extract";

/** A copy of a ZIP whose first central-directory entry claims `size` uncompressed bytes. */
function withClaimedUncompressedSize(zip: Uint8Array, size: number): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer);
  for (let i = 0; i + 4 <= copy.length; i++) {
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, size + 1, true);
      expect(zipUncompressedSize(copy)).toBeGreaterThan(size);
      return copy;
    }
  }
  throw new Error("no central directory entry");
}

const fixture = (name: string) =>
  new Uint8Array(readFileSync(path.join(__dirname, "../../convex/__tests__/fixtures", name)));

describe("extractFileContent", () => {
  it("PDF → text + page count", async () => {
    const out = await extractFileContent(fixture("brief.pdf"), "pdf");
    expect(out).toMatchObject({ kind: "done", pageCount: 2, truncated: false });
    if (out.kind !== "done") throw new Error("unreachable");
    expect(out.text).toContain("Hello brief page one");
    expect(out.text).toContain("Second page text");
  });

  it("DOCX → raw text", async () => {
    const out = await extractFileContent(fixture("brief.docx"), "docx");
    expect(out).toMatchObject({ kind: "done", truncated: false });
    if (out.kind !== "done") throw new Error("unreachable");
    expect(out.text).toBe("Kész, ha: 4 banner sizes\n\n1200x628 hero");
  });

  it("image → width × height, no text", async () => {
    expect(await extractFileContent(fixture("banner.png"), "image")).toEqual({ kind: "done", width: 1200, height: 628 });
  });

  it("SVG → size from its attributes", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="250"></svg>');
    expect(await extractFileContent(svg, "image")).toEqual({ kind: "done", width: 300, height: 250 });
  });

  it("text → UTF-8 decoded and normalized", async () => {
    expect(await extractFileContent(fixture("notes.txt"), "text")).toEqual({
      kind: "done",
      text: "Client notes\nDeadline: Friday",
      truncated: false,
    });
  });

  it("caps long text and flags it", async () => {
    const long = new TextEncoder().encode("a".repeat(60_000));
    const out = await extractFileContent(long, "text");
    expect(out).toMatchObject({ kind: "done", truncated: true });
    if (out.kind !== "done") throw new Error("unreachable");
    expect(out.text).toHaveLength(50_000);
  });

  it("a corrupted PDF throws an error that reads as permanent, not a crash", async () => {
    const junk = new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf");
    const err = await extractFileContent(junk, "pdf").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(describeExtractionError(err)).toEqual({ reason: "PDF is damaged or not a valid PDF", permanent: true });
  });

  it("a corrupt DOCX is a permanent failure, not a retry", async () => {
    expect(await extractFileContent(new TextEncoder().encode("not a zip"), "docx")).toEqual({
      kind: "error", reason: DOCX_DAMAGED, permanent: true,
    });
  });

  it("a DOCX that unpacks to an absurd size is not handed to mammoth", async () => {
    const bomb = withClaimedUncompressedSize(fixture("brief.docx"), DOCX_MAX_UNCOMPRESSED_BYTES);
    expect(await extractFileContent(bomb, "docx")).toEqual({ kind: "unsupported", reason: DOCX_TOO_LARGE });
  });

  it("unrecognized or misnamed image bytes are a permanent failure", async () => {
    const expected = { kind: "error", reason: IMAGE_UNREADABLE, permanent: true };
    expect(await extractFileContent(new Uint8Array([1, 2, 3, 4]), "image")).toEqual(expected);
    expect(await extractFileContent(fixture("brief.pdf"), "image")).toEqual(expected);
  });

  it("decodes at most TEXT_BYTES_MAX bytes of a text file and flags the cut", async () => {
    // Whitespace collapses under normalization, so the char cap alone would
    // not trip — the byte slice must still mark the text as truncated.
    const big = new TextEncoder().encode("a\n\n\n".repeat(TEXT_BYTES_MAX));
    const out = await extractFileContent(big, "text");
    expect(out).toMatchObject({ kind: "done", truncated: true });
    if (out.kind !== "done") throw new Error("unreachable");
    expect(out.text!.length).toBeLessThanOrEqual(TEXT_BYTES_MAX);
  });
});
