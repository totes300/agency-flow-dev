import { describe, expect, it } from "vitest"
import { resolvePeriodPreset } from "./worksheet-period-presets"

const NY = "America/New_York"

// Fixed reference point used across tests so the assertions don't drift
// with the clock. May 25, 2026 — a Monday in Q2.
const REFERENCE_NOW = new Date("2026-05-25T15:00:00Z")

describe("resolvePeriodPreset", () => {
  it("resolves this-month against the org timezone", () => {
    const r = resolvePeriodPreset({
      key: "this-month",
      timezone: NY,
      now: REFERENCE_NOW,
    })
    expect(r).not.toBeNull()
    expect(r!.start).toBe("2026-05-01")
    expect(r!.end).toBe("2026-05-31")
    expect(r!.slug).toBe("2026-may")
    expect(r!.label).toBe("May 2026")
  })

  it("resolves last-month with year wrap (January → previous December)", () => {
    const r = resolvePeriodPreset({
      key: "last-month",
      timezone: NY,
      now: new Date("2026-01-15T15:00:00Z"),
    })
    expect(r!.start).toBe("2025-12-01")
    expect(r!.end).toBe("2025-12-31")
    expect(r!.slug).toBe("2025-dec")
  })

  it("resolves this-quarter for Q2", () => {
    const r = resolvePeriodPreset({
      key: "this-quarter",
      timezone: NY,
      now: REFERENCE_NOW,
    })
    expect(r!.start).toBe("2026-04-01")
    expect(r!.end).toBe("2026-06-30")
    expect(r!.slug).toBe("2026-q2")
  })

  it("resolves last-quarter with year wrap (Q1 → previous Q4)", () => {
    const r = resolvePeriodPreset({
      key: "last-quarter",
      timezone: NY,
      now: new Date("2026-02-10T15:00:00Z"),
    })
    expect(r!.start).toBe("2025-10-01")
    expect(r!.end).toBe("2025-12-31")
    expect(r!.slug).toBe("2025-q4")
  })

  it("resolves this-year", () => {
    const r = resolvePeriodPreset({
      key: "this-year",
      timezone: NY,
      now: REFERENCE_NOW,
    })
    expect(r!.start).toBe("2026-01-01")
    expect(r!.end).toBe("2026-12-31")
    expect(r!.slug).toBe("2026")
  })

  it("resolves last-year", () => {
    const r = resolvePeriodPreset({
      key: "last-year",
      timezone: NY,
      now: REFERENCE_NOW,
    })
    expect(r!.start).toBe("2025-01-01")
    expect(r!.end).toBe("2025-12-31")
    expect(r!.slug).toBe("2025")
  })

  it("resolves all-time with project start anchor when same year as today", () => {
    const r = resolvePeriodPreset({
      key: "all-time",
      timezone: NY,
      now: REFERENCE_NOW,
      projectStartDate: "2026-01-15",
    })
    expect(r!.start).toBe("2026-01-15")
    expect(r!.end).toBe("2026-05-25")
    expect(r!.slug).toBe("2026-all-time")
  })

  it("resolves all-time with multi-year span", () => {
    const r = resolvePeriodPreset({
      key: "all-time",
      timezone: NY,
      now: REFERENCE_NOW,
      projectStartDate: "2024-06-01",
    })
    expect(r!.start).toBe("2024-06-01")
    expect(r!.slug).toBe("2024-2026-all-time")
  })

  it("resolves custom range with start ≤ end", () => {
    const r = resolvePeriodPreset({
      key: "custom",
      timezone: NY,
      now: REFERENCE_NOW,
      customStart: "2026-01-15",
      customEnd: "2026-04-30",
    })
    expect(r).not.toBeNull()
    expect(r!.start).toBe("2026-01-15")
    expect(r!.end).toBe("2026-04-30")
    expect(r!.slug).toBe("2026-01-15-to-2026-04-30")
  })

  it("rejects custom range when end < start", () => {
    const r = resolvePeriodPreset({
      key: "custom",
      timezone: NY,
      now: REFERENCE_NOW,
      customStart: "2026-05-01",
      customEnd: "2026-04-30",
    })
    expect(r).toBeNull()
  })

  it("rejects custom range when one endpoint is missing", () => {
    expect(
      resolvePeriodPreset({
        key: "custom",
        timezone: NY,
        now: REFERENCE_NOW,
        customStart: "2026-01-01",
      }),
    ).toBeNull()
  })
})
