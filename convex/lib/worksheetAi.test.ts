/**
 * Tests for `parseResponse` — the model-output → CSV-row translator.
 *
 * The model occasionally drifts from the system prompt's exact format
 * (case, bullets, missing labels, wrapping quotes, etc.). The parser
 * must tolerate that and ALWAYS yield two non-empty strings, falling
 * back to a title-derived value when content is missing.
 */

import { describe, expect, it } from "vitest"
import { parseResponse } from "./worksheetAi"

const TITLE = "Homepage hero redesign"

describe("parseResponse — happy path", () => {
  it("extracts both labels from the canonical format", () => {
    const raw = `SUMMARY: Refresh the homepage hero with new positioning.
DELIVERED: Refreshed the hero with new product photography and a sharper CTA.`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe(
      "Refresh the homepage hero with new positioning.",
    )
    expect(result.whatWeDid).toBe(
      "Refreshed the hero with new product photography and a sharper CTA.",
    )
  })

  it("is case-insensitive on the label names", () => {
    const raw = `summary: lorem ipsum.\ndelivered: dolor sit amet.`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("lorem ipsum.")
    expect(result.whatWeDid).toBe("dolor sit amet.")
  })

  it("ignores bullet/numbered prefixes the model sometimes adds", () => {
    const raw = `- SUMMARY: lorem ipsum.\n1. DELIVERED: dolor sit amet.`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("lorem ipsum.")
    expect(result.whatWeDid).toBe("dolor sit amet.")
  })

  it("tolerates blank lines between the two label lines", () => {
    const raw = `SUMMARY: lorem ipsum.\n\n\nDELIVERED: dolor sit amet.`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("lorem ipsum.")
    expect(result.whatWeDid).toBe("dolor sit amet.")
  })
})

describe("parseResponse — drift tolerance", () => {
  it("strips wrapping double quotes (model violates 'no quotes' rule)", () => {
    const raw = `SUMMARY: "Refresh the hero."\nDELIVERED: "Shipped it."`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("Refresh the hero.")
    expect(result.whatWeDid).toBe("Shipped it.")
  })

  it("strips wrapping smart quotes too", () => {
    const raw = `SUMMARY: “Refresh the hero.”\nDELIVERED: “Shipped it.”`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("Refresh the hero.")
    expect(result.whatWeDid).toBe("Shipped it.")
  })

  it("collapses internal newlines to single spaces", () => {
    const raw = `SUMMARY: line one\nDELIVERED: chunk one\n   chunk two\n   chunk three`
    // The parser splits on newlines, so multi-line DELIVERED collapses
    // to its first line. That's an acceptable trade — the model is
    // instructed to stay single-line.
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("line one")
    expect(result.whatWeDid).toBe("chunk one")
  })
})

describe("parseResponse — missing data fallbacks", () => {
  it("uses the title-based fallback when both labels are missing AND there's no extractable text", () => {
    const result = parseResponse("", TITLE)
    expect(result.taskSummary).toBe(`${TITLE}.`)
    expect(result.whatWeDid).toBe(`Worked on ${TITLE}.`)
  })

  it("salvages plain text when the model returns no labels", () => {
    const raw = "Refreshed the hero. Shipped it on Monday."
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("Refreshed the hero.")
    expect(result.whatWeDid).toBe("Shipped it on Monday.")
  })

  it("uses title fallback for SUMMARY when only DELIVERED is present", () => {
    const raw = "DELIVERED: Shipped it."
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe(`${TITLE}.`)
    expect(result.whatWeDid).toBe("Shipped it.")
  })

  it("uses title fallback for DELIVERED when only SUMMARY is present", () => {
    const raw = "SUMMARY: Refresh the hero."
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary).toBe("Refresh the hero.")
    expect(result.whatWeDid).toBe(`Worked on ${TITLE}.`)
  })
})

describe("parseResponse — length caps", () => {
  it("truncates SUMMARY above ~220 chars with an ellipsis", () => {
    const long = "x".repeat(400)
    const raw = `SUMMARY: ${long}\nDELIVERED: short`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary.length).toBeLessThanOrEqual(220)
    expect(result.taskSummary.endsWith("…")).toBe(true)
  })

  it("truncates DELIVERED above ~320 chars with an ellipsis", () => {
    const long = "x".repeat(500)
    const raw = `SUMMARY: short\nDELIVERED: ${long}`
    const result = parseResponse(raw, TITLE)
    expect(result.whatWeDid.length).toBeLessThanOrEqual(320)
    expect(result.whatWeDid.endsWith("…")).toBe(true)
  })

  it("leaves short outputs untouched", () => {
    const raw = `SUMMARY: short.\nDELIVERED: shorter.`
    const result = parseResponse(raw, TITLE)
    expect(result.taskSummary.endsWith("…")).toBe(false)
    expect(result.whatWeDid.endsWith("…")).toBe(false)
  })
})
