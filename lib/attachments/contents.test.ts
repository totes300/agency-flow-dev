import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  EXTRACT_ATTEMPT_TIMEOUT_MS,
  EXTRACT_MAX_ATTEMPTS,
  EXTRACT_MAX_BYTES,
  EXTRACT_RETRY_BASE_MS,
  EXTRACT_TEXT_MAX,
  FILE_MISSING,
  TOO_LARGE,
  UNSUPPORTED_TYPE,
  capText,
  contentMessage,
  decideStatus,
  describeExtractionError,
  initialDecision,
  isStuck,
  normalizeText,
  routeFormat,
  zipUncompressedSize,
} from "./contents";

describe("routeFormat", () => {
  it("routes by mime type", () => {
    expect(routeFormat("application/pdf", "x")).toBe("pdf");
    expect(routeFormat("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x")).toBe("docx");
    for (const mime of ["text/plain", "text/markdown", "text/csv", "text/plain; charset=utf-8", "TEXT/CSV", "application/csv"]) {
      expect(routeFormat(mime, "x"), mime).toBe("text");
    }
    for (const mime of ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/svg+xml"]) {
      expect(routeFormat(mime, "x"), mime).toBe("image");
    }
  });

  it("falls back to the extension when the mime type is generic or unknown", () => {
    expect(routeFormat("application/octet-stream", "brief.PDF")).toBe("pdf");
    expect(routeFormat("", "brief.docx")).toBe("docx");
    expect(routeFormat("application/vnd.ms-excel", "export.csv")).toBe("text");
    expect(routeFormat("application/octet-stream", "README.md")).toBe("text");
    expect(routeFormat("application/octet-stream", "shot.jpeg")).toBe("image");
  });

  it("a readable mime type wins over a misleading extension", () => {
    expect(routeFormat("image/png", "banner.pdf")).toBe("image");
  });

  it("everything else is unsupported", () => {
    expect(routeFormat("application/zip", "assets.zip")).toBe("unsupported");
    expect(routeFormat("application/msword", "old.doc")).toBe("unsupported");
    expect(routeFormat("image/tiff", "scan.tif")).toBe("unsupported");
    expect(routeFormat("application/octet-stream", "noext")).toBe("unsupported");
    expect(routeFormat("application/octet-stream", "trailingdot.")).toBe("unsupported");
  });
});

describe("initialDecision", () => {
  it("queues readable files", () => {
    expect(initialDecision({ mimeType: "application/pdf", name: "a.pdf", size: 10 })).toEqual({ status: "pending" });
    expect(initialDecision({ mimeType: "application/pdf", name: "a.pdf", size: EXTRACT_MAX_BYTES })).toEqual({ status: "pending" });
  });

  it("unsupported types and files over 25 MB are unsupported at once; a missing blob fails", () => {
    expect(initialDecision({ mimeType: "application/zip", name: "a.zip", size: 10 })).toEqual({ status: "unsupported", error: UNSUPPORTED_TYPE });
    expect(initialDecision({ mimeType: "application/pdf", name: "a.pdf", size: EXTRACT_MAX_BYTES + 1 })).toEqual({ status: "unsupported", error: TOO_LARGE });
    expect(TOO_LARGE).toMatch(/too large/);
    expect(initialDecision({ mimeType: "application/pdf", name: "a.pdf", size: null })).toEqual({ status: "failed", error: FILE_MISSING });
  });
});

describe("capText / normalizeText", () => {
  it("keeps short text and caps long text with a flag", () => {
    expect(capText("hello")).toEqual({ text: "hello", truncated: false });
    const capped = capText("x".repeat(EXTRACT_TEXT_MAX + 5));
    expect(capped.truncated).toBe(true);
    expect(capped.text).toHaveLength(EXTRACT_TEXT_MAX);
    expect(capText("x".repeat(EXTRACT_TEXT_MAX))).toEqual({ text: "x".repeat(EXTRACT_TEXT_MAX), truncated: false });
  });

  it("never splits a surrogate pair at the cut", () => {
    const out = capText("ab😀cd", 3);
    expect(out).toEqual({ text: "ab", truncated: true });
  });

  it("normalizes BOM, NULs, CRLF, trailing spaces and blank runs", () => {
    expect(normalizeText("\uFEFFa\u0000b  \r\n\r\n\r\n\r\nc\r")).toBe("ab\n\nc");
  });
});

describe("decideStatus", () => {
  it("done carries the extracted fields", () => {
    expect(decideStatus({ kind: "done", text: "t", truncated: false, pageCount: 2 }, 1)).toEqual({
      status: "done", text: "t", truncated: false, pageCount: 2, width: undefined, height: undefined,
    });
    expect(decideStatus({ kind: "done", width: 10, height: 20 }, 1)).toMatchObject({ status: "done", width: 10, height: 20 });
  });

  it("unsupported is final", () => {
    expect(decideStatus({ kind: "unsupported", reason: "nope" }, 1)).toEqual({ status: "unsupported", error: "nope" });
  });

  it("a transient error retries with backoff until the attempt cap, then fails", () => {
    const err = { kind: "error" as const, reason: "boom", permanent: false };
    expect(decideStatus(err, 1)).toEqual({ status: "pending", error: "boom", retryInMs: EXTRACT_RETRY_BASE_MS });
    expect(decideStatus(err, 2)).toEqual({ status: "pending", error: "boom", retryInMs: EXTRACT_RETRY_BASE_MS * 2 });
    expect(EXTRACT_MAX_ATTEMPTS).toBe(3);
    expect(decideStatus(err, 3)).toEqual({ status: "failed", error: "boom" });
  });

  it("a permanent error fails on the first attempt", () => {
    expect(decideStatus({ kind: "error", reason: "PDF is password-protected", permanent: true }, 1)).toEqual({
      status: "failed", error: "PDF is password-protected",
    });
  });
});

describe("describeExtractionError", () => {
  const named = (name: string, message: string) => Object.assign(new Error(message), { name });

  it("encrypted and damaged PDFs are permanent with a readable reason", () => {
    expect(describeExtractionError(named("PasswordException", "No password given"))).toEqual({
      reason: "PDF is password-protected", permanent: true,
    });
    expect(describeExtractionError(named("InvalidPDFException", "Invalid PDF structure."))).toEqual({
      reason: "PDF is damaged or not a valid PDF", permanent: true,
    });
    // pdf.js errors can cross realms as plain objects.
    expect(describeExtractionError({ name: "PasswordException", message: "x" }).permanent).toBe(true);
  });

  it("anything else is transient, short and single-line", () => {
    const out = describeExtractionError(new Error(`zip\n  broken ${"y".repeat(500)}`));
    expect(out.permanent).toBe(false);
    expect(out.reason.startsWith("Could not read the file: zip broken")).toBe(true);
    expect(out.reason.length).toBeLessThan(260);
    expect(describeExtractionError("weird").reason).toBe("Could not read the file: weird");
  });
});

describe("contentMessage", () => {
  it("every non-done state says the contents are unknown", () => {
    expect(contentMessage(null)).toMatch(/unknown/);
    expect(contentMessage({ status: "pending" })).toMatch(/still being read/);
    expect(contentMessage({ status: "unsupported", error: TOO_LARGE })).toMatch(/can't be read \(File is too large/);
    expect(contentMessage({ status: "failed", error: "PDF is password-protected" })).toMatch(/failed \(PDF is password-protected\).*unknown/);
  });

  it("done describes images, empty text and truncation", () => {
    expect(contentMessage({ status: "done", width: 1200, height: 628 })).toMatch(/1200×628/);
    expect(contentMessage({ status: "done", text: "" })).toMatch(/no text/);
    expect(contentMessage({ status: "done", text: "x", truncated: true })).toMatch(/first 50000/);
    expect(contentMessage({ status: "done", text: "x" })).toBe("Text extracted.");
  });
});

describe("isStuck", () => {
  it("only past the watchdog window plus slack", () => {
    const queued = 1_000_000;
    expect(isStuck(queued, queued + EXTRACT_ATTEMPT_TIMEOUT_MS)).toBe(false);
    expect(isStuck(queued, queued + EXTRACT_ATTEMPT_TIMEOUT_MS + 61_000)).toBe(true);
    // An attempt due in the future (backfill stagger, backoff) is never stuck.
    expect(isStuck(queued + 10_000, queued)).toBe(false);
  });
});

describe("zipUncompressedSize", () => {
  const docx = new Uint8Array(readFileSync(path.join(__dirname, "../../convex/__tests__/fixtures/brief.docx")));

  it("sums the central directory's uncompressed sizes", () => {
    const size = zipUncompressedSize(docx);
    // The fixture's three XML parts total ~950 bytes unpacked.
    expect(size).toBeGreaterThan(800);
    expect(size).toBeLessThan(2_000);
  });

  it("is null for non-ZIP bytes", () => {
    expect(zipUncompressedSize(new TextEncoder().encode("not a zip at all, just text"))).toBeNull();
    expect(zipUncompressedSize(new Uint8Array(0))).toBeNull();
  });

  it("reads a ZIP64 marker as unbounded", () => {
    const copy = new Uint8Array(docx);
    const view = new DataView(copy.buffer);
    for (let i = copy.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        view.setUint32(i + 16, 0xffffffff, true);
        break;
      }
    }
    expect(zipUncompressedSize(copy)).toBe(Number.POSITIVE_INFINITY);
  });
});
