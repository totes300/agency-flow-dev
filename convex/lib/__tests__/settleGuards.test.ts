import { describe, it, expect } from "vitest";
import {
  pickClosedCoveringPeriod,
  pickCoveringFinalizedInvoice,
  type InvoicePeriodLike,
  type PeriodLike,
} from "../settleGuards";

/**
 * Phase 8 Slice 3 — `assertEntryDateOpen` predicate tests.
 *
 * The async DB-backed wrapper (`assertEntryDateOpen`) is exercised by the
 * three write-path integration paths it's wired into; here we lock down
 * the pure date-coverage rule it depends on.
 *
 * Coverage rule (parent PRD § Mutations):
 *   a closed retainer period covers date D iff
 *     periodStart ≤ D ≤ periodEnd  AND  closedAt is set.
 *
 * Inclusive boundaries are deliberate: a period for March ends on
 * `"2026-03-31"` and an entry whose date is `"2026-03-31"` is unambiguously
 * inside that period. Same on `periodStart`.
 */

function p(periodStart: string, periodEnd: string, closedAt: number | undefined): PeriodLike {
  return { periodStart, periodEnd, closedAt };
}

describe("pickClosedCoveringPeriod — basic coverage", () => {
  it("returns null when no periods exist", () => {
    expect(pickClosedCoveringPeriod([], "2026-03-15")).toBeNull();
  });

  it("returns the period when the date falls strictly inside it AND it's closed", () => {
    const closed = p("2026-03-01", "2026-03-31", 1_000);
    expect(pickClosedCoveringPeriod([closed], "2026-03-15")).toBe(closed);
  });

  it("returns null when the only covering period is OPEN (closedAt undefined)", () => {
    const open = p("2026-03-01", "2026-03-31", undefined);
    expect(pickClosedCoveringPeriod([open], "2026-03-15")).toBeNull();
  });

  it("returns null when the date falls OUTSIDE every closed period", () => {
    const closed = p("2026-03-01", "2026-03-31", 1_000);
    // before
    expect(pickClosedCoveringPeriod([closed], "2026-02-28")).toBeNull();
    // after
    expect(pickClosedCoveringPeriod([closed], "2026-04-01")).toBeNull();
  });
});

describe("pickClosedCoveringPeriod — inclusive boundaries", () => {
  const closed = p("2026-03-01", "2026-03-31", 1_000);

  it("treats periodStart as inside the period", () => {
    expect(pickClosedCoveringPeriod([closed], "2026-03-01")).toBe(closed);
  });

  it("treats periodEnd as inside the period", () => {
    expect(pickClosedCoveringPeriod([closed], "2026-03-31")).toBe(closed);
  });

  it("treats the day before periodStart as outside", () => {
    expect(pickClosedCoveringPeriod([closed], "2026-02-28")).toBeNull();
  });

  it("treats the day after periodEnd as outside", () => {
    expect(pickClosedCoveringPeriod([closed], "2026-04-01")).toBeNull();
  });
});

describe("pickClosedCoveringPeriod — mixed open/closed lists", () => {
  it("only the closed period covering the date wins", () => {
    const openCovers = p("2026-03-01", "2026-03-31", undefined);
    const closedDoesNotCover = p("2026-02-01", "2026-02-28", 1_000);
    const closedCovers = p("2026-03-01", "2026-03-31", 2_000);
    const all: PeriodLike[] = [openCovers, closedDoesNotCover, closedCovers];

    // Open March period must NOT short-circuit the search — same date is
    // covered by both the open March and the closed March, but only the
    // closed one is what `assertEntryDateOpen` should reject on.
    expect(pickClosedCoveringPeriod(all, "2026-03-15")).toBe(closedCovers);
  });

  it("returns the first matching closed period when multiple exist", () => {
    // Defensive: in real data there is at most one row per
    // (projectId, periodStart), but the predicate's contract is "first
    // match wins" so iteration order is stable.
    const first = p("2026-03-01", "2026-03-31", 1_000);
    const second = p("2026-03-01", "2026-03-31", 2_000);
    expect(pickClosedCoveringPeriod([first, second], "2026-03-15")).toBe(first);
  });
});

// ─── pickCoveringFinalizedInvoice ───────────────────────────────────────────

describe("pickCoveringFinalizedInvoice", () => {
  const inv = (
    status: InvoicePeriodLike["status"],
    periodStart?: string,
    periodEnd?: string,
    number?: number | null,
  ): InvoicePeriodLike => ({ status, periodStart, periodEnd, prefix: "INV-", number })

  it("matches an invoiced invoice covering the date", () => {
    const covering = inv("invoiced", "2026-01-01", "2026-03-31", 42)
    expect(pickCoveringFinalizedInvoice([covering], "2026-03-30")).toBe(covering)
  })

  it("matches a paid invoice covering the date", () => {
    const covering = inv("paid", "2026-03-01", "2026-03-31", 42)
    expect(pickCoveringFinalizedInvoice([covering], "2026-03-15")).toBe(covering)
  })

  it("never matches drafts (stale-draft refresh owns that case)", () => {
    expect(
      pickCoveringFinalizedInvoice([inv("draft", "2026-03-01", "2026-03-31")], "2026-03-15"),
    ).toBeNull()
  })

  it("never matches voided invoices (period is re-billable)", () => {
    expect(
      pickCoveringFinalizedInvoice([inv("void", "2026-03-01", "2026-03-31", 42)], "2026-03-15"),
    ).toBeNull()
  })

  it("ignores invoices without a stored period", () => {
    expect(
      pickCoveringFinalizedInvoice([inv("invoiced", undefined, undefined, 42)], "2026-03-15"),
    ).toBeNull()
  })

  it("treats period boundaries as inclusive", () => {
    const covering = inv("invoiced", "2026-01-01", "2026-03-31", 42)
    expect(pickCoveringFinalizedInvoice([covering], "2026-01-01")).toBe(covering)
    expect(pickCoveringFinalizedInvoice([covering], "2026-03-31")).toBe(covering)
    expect(pickCoveringFinalizedInvoice([covering], "2025-12-31")).toBeNull()
    expect(pickCoveringFinalizedInvoice([covering], "2026-04-01")).toBeNull()
  })

  it("skips a non-covering finalized invoice but finds the covering one", () => {
    const feb = inv("invoiced", "2026-02-01", "2026-02-28", 41)
    const march = inv("invoiced", "2026-03-01", "2026-03-31", 42)
    expect(pickCoveringFinalizedInvoice([feb, march], "2026-03-15")).toBe(march)
  })
})
