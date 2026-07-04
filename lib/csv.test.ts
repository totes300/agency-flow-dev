import { describe, expect, it } from "vitest"
import { escapeCsvField, joinCsvRow, CSV_BOM } from "./csv"

describe("escapeCsvField", () => {
  it("returns empty string for empty / null / undefined", () => {
    expect(escapeCsvField("")).toBe("")
    expect(escapeCsvField(null)).toBe("")
    expect(escapeCsvField(undefined)).toBe("")
  })

  it("passes through safe strings without quoting", () => {
    expect(escapeCsvField("Homepage hero redesign")).toBe(
      "Homepage hero redesign",
    )
  })

  it("stringifies numbers as-is", () => {
    expect(escapeCsvField(0)).toBe("0")
    expect(escapeCsvField(42)).toBe("42")
  })

  it("wraps fields containing a comma in quotes", () => {
    expect(escapeCsvField("Designed hero, refreshed CTA")).toBe(
      '"Designed hero, refreshed CTA"',
    )
  })

  it("escapes internal double quotes by doubling them", () => {
    expect(escapeCsvField('She said "hi"')).toBe('"She said ""hi"""')
  })

  it("wraps strings containing newlines", () => {
    expect(escapeCsvField("line one\nline two")).toBe('"line one\nline two"')
  })

  it("guards against formula injection on =", () => {
    expect(escapeCsvField("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)")
  })

  it("guards against formula injection on +", () => {
    expect(escapeCsvField("+1234567890")).toBe("'+1234567890")
  })

  it("guards against formula injection on -", () => {
    // The minus sign on the first character is the offender — quoted because
    // the resulting `'-…` still triggers the comma check? No, this field has
    // no commas, so it stays unquoted but prefixed.
    expect(escapeCsvField("-1234")).toBe("'-1234")
  })

  it("guards against formula injection on @", () => {
    expect(escapeCsvField("@SUM")).toBe("'@SUM")
  })

  it("guards against formula injection on tab / CR", () => {
    expect(escapeCsvField("\tleading-tab")).toBe("'\tleading-tab")
    // Carriage return at the start triggers the prefix AND the wrap.
    expect(escapeCsvField("\rdanger")).toBe('"\'\rdanger"')
  })

  it("preserves formula guard inside a quoted field with commas", () => {
    expect(escapeCsvField("=A1+A2, also dangerous")).toBe(
      '"\'=A1+A2, also dangerous"',
    )
  })
})

describe("joinCsvRow", () => {
  it("joins escaped fields with commas", () => {
    expect(joinCsvRow(["a", "b", "c"])).toBe("a,b,c")
  })

  it("escapes per-field", () => {
    expect(joinCsvRow(["plain", "with, comma", "=danger"])).toBe(
      'plain,"with, comma",\'=danger',
    )
  })

  it("emits empty cells for null / undefined", () => {
    expect(joinCsvRow(["a", null, undefined, ""])).toBe("a,,,")
  })
})

describe("CSV_BOM", () => {
  it("is the UTF-8 BOM byte order mark", () => {
    // U+FEFF — Excel-on-Windows decodes this as "yes, this file is UTF-8."
    expect(CSV_BOM).toBe("﻿")
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff)
  })
})
