/**
 * Tests for `buildCompletionToast` — the pure stats→toast-content
 * function. Locks the matrix of outcome variants so future changes
 * to copy or thresholds can't silently regress.
 */

import { describe, expect, it } from "vitest"
import { buildCompletionToast } from "./worksheet-toast"

const FILE = "acme-q1-worksheet.csv"

describe("buildCompletionToast — success", () => {
  it("celebrates a clean run with the summary count", () => {
    const t = buildCompletionToast(
      { total: 5, aiSucceeded: 5, aiSkipped: 0, aiFailed: 0 },
      FILE,
    )
    expect(t.variant).toBe("success")
    expect(t.title).toContain("5 summaries")
    expect(t.description).toBe(FILE)
  })

  it("uses singular noun when exactly one summary generated", () => {
    const t = buildCompletionToast(
      { total: 1, aiSucceeded: 1, aiSkipped: 0, aiFailed: 0 },
      FILE,
    )
    expect(t.title).toContain("1 summary")
  })

  it("calls out empty-content tasks in the description without surfacing as a failure", () => {
    const t = buildCompletionToast(
      { total: 5, aiSucceeded: 3, aiSkipped: 2, aiFailed: 0 },
      FILE,
    )
    expect(t.variant).toBe("success")
    expect(t.description).toContain("2 tasks had no content")
    expect(t.description).toContain(FILE)
  })

  it("handles the all-empty-content case as a quiet success", () => {
    const t = buildCompletionToast(
      { total: 3, aiSucceeded: 0, aiSkipped: 3, aiFailed: 0 },
      FILE,
    )
    expect(t.variant).toBe("success")
    expect(t.title).toContain("3 tasks")
    expect(t.description).toContain("No task descriptions")
  })
})

describe("buildCompletionToast — warning (partial)", () => {
  it("flags partial failures with the exact count", () => {
    const t = buildCompletionToast(
      { total: 10, aiSucceeded: 8, aiSkipped: 0, aiFailed: 2 },
      FILE,
    )
    expect(t.variant).toBe("warning")
    expect(t.title).toBe("8 of 10 summaries generated")
    expect(t.description).toContain("2 failed rows")
    expect(t.description).toContain("[summary unavailable]")
    expect(t.duration).toBeGreaterThanOrEqual(8_000)
  })

  it("singular wording on exactly one failure", () => {
    const t = buildCompletionToast(
      { total: 5, aiSucceeded: 4, aiSkipped: 0, aiFailed: 1 },
      FILE,
    )
    expect(t.variant).toBe("warning")
    expect(t.description).toContain("1 failed row is")
  })

  it("ignores aiSkipped when computing the success ratio", () => {
    // Skipped rows aren't a failure — they're tasks with no content.
    // The "of N" should count attempted (succeeded + failed), NOT total.
    const t = buildCompletionToast(
      { total: 10, aiSucceeded: 6, aiSkipped: 3, aiFailed: 1 },
      FILE,
    )
    expect(t.variant).toBe("warning")
    expect(t.title).toBe("6 of 7 summaries generated")
  })
})

describe("buildCompletionToast — error (total AI failure)", () => {
  it("escalates to error when every attempted call failed", () => {
    const t = buildCompletionToast(
      { total: 5, aiSucceeded: 0, aiSkipped: 0, aiFailed: 5 },
      FILE,
    )
    expect(t.variant).toBe("error")
    expect(t.title).toContain("every AI summary failed")
    expect(t.description).toContain("Settings → Integrations")
    expect(t.duration).toBeGreaterThanOrEqual(10_000)
  })

  it("still error-toasts when some were skipped but every attempt failed", () => {
    // 2 skipped (empty content, didn't count as attempts) + 3 failed.
    // 3 of 3 attempts failed → still terminal.
    const t = buildCompletionToast(
      { total: 5, aiSucceeded: 0, aiSkipped: 2, aiFailed: 3 },
      FILE,
    )
    expect(t.variant).toBe("error")
  })

  it("does NOT escalate to error when zero attempts were made (all skipped)", () => {
    // No AI calls attempted at all → not a failure, just a quiet success.
    const t = buildCompletionToast(
      { total: 3, aiSucceeded: 0, aiSkipped: 3, aiFailed: 0 },
      FILE,
    )
    expect(t.variant).toBe("success")
  })
})
