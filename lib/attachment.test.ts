import { describe, expect, it } from "vitest"
import {
  validateFile,
  isImageType,
  formatFileSize,
  getFileExtension,
  MAX_FILE_SIZE,
  MAX_FILES_PER_TASK,
} from "./attachment"

// ─── validateFile ───────────────────────────────────────────────────────────────

describe("validateFile", () => {
  const validFile = { size: 1024, type: "application/pdf", name: "doc.pdf" }

  it("returns null for valid file", () => {
    expect(validateFile(validFile, 0)).toBeNull()
  })

  it("rejects when max files reached", () => {
    expect(validateFile(validFile, MAX_FILES_PER_TASK)).toBe(
      `Maximum ${MAX_FILES_PER_TASK} files per task`
    )
  })

  it("rejects file over 10MB", () => {
    const big = { size: MAX_FILE_SIZE + 1, type: "video/mp4", name: "video.mp4" }
    expect(validateFile(big, 0)).toBe('File "video.mp4" exceeds 10MB limit')
  })

  it("allows file exactly at 10MB", () => {
    const exact = { size: MAX_FILE_SIZE, type: "video/mp4", name: "video.mp4" }
    expect(validateFile(exact, 0)).toBeNull()
  })

  it("rejects empty file", () => {
    const empty = { size: 0, type: "text/plain", name: "empty.txt" }
    expect(validateFile(empty, 0)).toBe('File "empty.txt" is empty')
  })

  it("checks max count before size", () => {
    const big = { size: MAX_FILE_SIZE + 1, type: "video/mp4", name: "video.mp4" }
    expect(validateFile(big, MAX_FILES_PER_TASK)).toContain("Maximum")
  })
})

// ─── isImageType ────────────────────────────────────────────────────────────────

describe("isImageType", () => {
  it("returns true for JPEG", () => expect(isImageType("image/jpeg")).toBe(true))
  it("returns true for PNG", () => expect(isImageType("image/png")).toBe(true))
  it("returns true for GIF", () => expect(isImageType("image/gif")).toBe(true))
  it("returns true for WebP", () => expect(isImageType("image/webp")).toBe(true))
  it("returns true for SVG", () => expect(isImageType("image/svg+xml")).toBe(true))
  it("returns false for PDF", () => expect(isImageType("application/pdf")).toBe(false))
  it("returns false for video", () => expect(isImageType("video/mp4")).toBe(false))
  it("returns false for empty", () => expect(isImageType("")).toBe(false))
})

// ─── formatFileSize ─────────────────────────────────────────────────────────────

describe("formatFileSize", () => {
  it("formats 0 bytes", () => expect(formatFileSize(0)).toBe("0 B"))
  it("formats bytes", () => expect(formatFileSize(512)).toBe("512 B"))
  it("formats KB", () => expect(formatFileSize(1536)).toBe("1.5 KB"))
  it("formats MB", () => expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB"))
  it("formats fractional MB", () => expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB"))
  it("formats just over 1KB", () => expect(formatFileSize(1024)).toBe("1.0 KB"))
  it("formats just over 1MB", () => expect(formatFileSize(1024 * 1024)).toBe("1.0 MB"))
})

// ─── getFileExtension ───────────────────────────────────────────────────────────

describe("getFileExtension", () => {
  it("extracts pdf", () => expect(getFileExtension("report.pdf")).toBe("pdf"))
  it("extracts png", () => expect(getFileExtension("image.PNG")).toBe("png"))
  it("handles multiple dots", () => expect(getFileExtension("my.file.name.tsx")).toBe("tsx"))
  it("returns empty for no extension", () => expect(getFileExtension("README")).toBe(""))
  it("returns empty for trailing dot", () => expect(getFileExtension("file.")).toBe(""))
  it("handles hidden files", () => expect(getFileExtension(".gitignore")).toBe("gitignore"))
})
