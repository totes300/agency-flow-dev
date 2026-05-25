import { describe, it, expect } from "vitest";
import {
  decideRetainerRowAction,
  decideRetainerRowCloseAction,
  isCycleEnd,
  type RetainerRowCloseContext,
  type RetainerRowContext,
  type RetainerRowMonthInput,
} from "./retainer-row-action";

const monthlyCtx: RetainerRowContext = {
  isRollover: false,
  cycleLength: 1,
  cycleHasOverage: false,
  overageRate: 100,
};

const rolloverCtx: RetainerRowContext = {
  isRollover: true,
  cycleLength: 3,
  cycleHasOverage: true,
  overageRate: 100,
};

const month = (
  partial: Partial<RetainerRowMonthInput> = {},
): RetainerRowMonthInput => ({
  periodEnded: true,
  cyclePosition: 1,
  endBalance: 0,
  invoice: null,
  ...partial,
});

describe("decideRetainerRowAction — invoice link", () => {
  it("renders the invoice link when a non-void invoice is attached", () => {
    expect(
      decideRetainerRowAction(
        month({ invoice: { status: "invoiced" } }),
        monthlyCtx,
      ),
    ).toBe("invoice-link");
  });

  it("ignores void invoices (period is freed for re-billing)", () => {
    // Even if the upstream loop forgot to filter, the helper does.
    expect(
      decideRetainerRowAction(
        month({ invoice: { status: "void" }, endBalance: -120 }),
        monthlyCtx,
      ),
    ).toBe("generate");
  });

  it("draft invoices also win the link slot — the user resumes via the link", () => {
    expect(
      decideRetainerRowAction(
        month({ invoice: { status: "draft" } }),
        monthlyCtx,
      ),
    ).toBe("invoice-link");
  });
});

describe("decideRetainerRowAction — monthly retainer (rollover OFF)", () => {
  it("over-budget closed month → generate", () => {
    expect(
      decideRetainerRowAction(month({ endBalance: -180 }), monthlyCtx),
    ).toBe("generate");
  });

  it("within-budget closed month → report", () => {
    expect(
      decideRetainerRowAction(month({ endBalance: 60 }), monthlyCtx),
    ).toBe("report");
  });

  it("in-progress month → report (never generate, even if currently over)", () => {
    expect(
      decideRetainerRowAction(
        month({ periodEnded: false, endBalance: -180 }),
        monthlyCtx,
      ),
    ).toBe("report");
  });

  it("zero overage rate → report (no row should produce a $0 invoice)", () => {
    expect(
      decideRetainerRowAction(month({ endBalance: -180 }), {
        ...monthlyCtx,
        overageRate: 0,
      }),
    ).toBe("report");
  });
});

describe("decideRetainerRowAction — rollover retainer", () => {
  it("cycle-end row with cycle overage → generate", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 3, periodEnded: true }),
        rolloverCtx,
      ),
    ).toBe("generate");
  });

  it("mid-cycle row never generates — even if over budget that month", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 2, periodEnded: true, endBalance: -300 }),
        rolloverCtx,
      ),
    ).toBe("report");
  });

  it("cycle-end row when cycle is within budget → report", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 3, periodEnded: true }),
        { ...rolloverCtx, cycleHasOverage: false },
      ),
    ).toBe("report");
  });

  it("cycle-end row in an unclosed cycle → report (mid-cycle visit)", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 3, periodEnded: false }),
        rolloverCtx,
      ),
    ).toBe("report");
  });
});

describe("isCycleEnd", () => {
  it("returns true at the closing position", () => {
    expect(isCycleEnd({ cyclePosition: 3 }, 3)).toBe(true);
  });
  it("returns false elsewhere", () => {
    expect(isCycleEnd({ cyclePosition: 1 }, 3)).toBe(false);
    expect(isCycleEnd({ cyclePosition: 2 }, 3)).toBe(false);
  });
});

// ─── Slice 4 — close-action dispatch ────────────────────────────────────────

const closeCtxBase: Omit<RetainerRowCloseContext, "isRollover" | "cycleLength"> = {
  cycleHasOverage: false,
  overageRate: 100,
  isCycleClosed: true,
  allCycleMonthsEnded: true,
  isMonthAlreadyClosed: false,
  isAdmin: true,
};

const monthlyCloseCtx: RetainerRowCloseContext = {
  ...closeCtxBase,
  isRollover: false,
  cycleLength: 1,
};

const rolloverCloseCtx: RetainerRowCloseContext = {
  ...closeCtxBase,
  isRollover: true,
  cycleLength: 3,
};

describe("decideRetainerRowCloseAction — guards", () => {
  it("returns null for members (close is admin-only)", () => {
    expect(
      decideRetainerRowCloseAction(month({ endBalance: 60 }), {
        ...monthlyCloseCtx,
        isAdmin: false,
      }),
    ).toBeNull();
  });

  it("returns null when the row is already admin-closed", () => {
    // Cycle close bulk-marks every month; the per-row button must
    // disappear immediately so the admin can't double-close.
    expect(
      decideRetainerRowCloseAction(month({ endBalance: 60 }), {
        ...monthlyCloseCtx,
        isMonthAlreadyClosed: true,
      }),
    ).toBeNull();
  });

  it("returns null for in-progress rows (period hasn't ended yet)", () => {
    expect(
      decideRetainerRowCloseAction(
        month({ periodEnded: false, endBalance: 60 }),
        monthlyCloseCtx,
      ),
    ).toBeNull();
  });

  it("returns null when a non-void invoice already covers the row (billing wins)", () => {
    expect(
      decideRetainerRowCloseAction(
        month({ invoice: { status: "invoiced" } }),
        monthlyCloseCtx,
      ),
    ).toBeNull();
  });
});

describe("decideRetainerRowCloseAction — monthly (non-rollover)", () => {
  it("returns close-month on an ended within-budget row", () => {
    expect(
      decideRetainerRowCloseAction(month({ endBalance: 60 }), monthlyCloseCtx),
    ).toBe("close-month");
  });

  it("returns null on an ended over-budget row (Generate wins instead)", () => {
    expect(
      decideRetainerRowCloseAction(
        month({ endBalance: -60 }),
        monthlyCloseCtx,
      ),
    ).toBeNull();
  });

  it("returns close-month on an ended over-budget row when overageRate=0 (no billing path)", () => {
    // overageRate=0 means there's nothing to bill; close-month becomes
    // the right action so the admin can lock the report without first
    // creating a $0 invoice.
    expect(
      decideRetainerRowCloseAction(
        month({ endBalance: -60 }),
        { ...monthlyCloseCtx, overageRate: 0 },
      ),
    ).toBe("close-month");
  });
});

describe("decideRetainerRowCloseAction — rollover monthly (non-cycle-end rows)", () => {
  it("returns close-month for a mid-cycle ended row", () => {
    // Rollover monthly close is allowed mid-cycle (Slice 3) so admins
    // can lock prior months without waiting for the cycle to finish.
    expect(
      decideRetainerRowCloseAction(
        month({ cyclePosition: 1, endBalance: 60 }),
        { ...rolloverCloseCtx, isCycleClosed: false, allCycleMonthsEnded: false },
      ),
    ).toBe("close-month");
  });

  it("returns close-month even when cycleHasOverage is true on a non-cycle-end row", () => {
    // Cycle-level overage gates the CYCLE button only — it doesn't block
    // an admin from monthly-closing an earlier month inside the cycle.
    expect(
      decideRetainerRowCloseAction(
        month({ cyclePosition: 1, endBalance: 60 }),
        { ...rolloverCloseCtx, cycleHasOverage: true, isCycleClosed: false, allCycleMonthsEnded: false },
      ),
    ).toBe("close-month");
  });
});

describe("decideRetainerRowCloseAction — rollover cycle-end row", () => {
  const cycleEndMonth = month({ cyclePosition: 3, endBalance: 60 });

  it("returns close-cycle when all gates pass (cycle ended, all months ended, within budget)", () => {
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, rolloverCloseCtx),
    ).toBe("close-cycle");
  });

  it("falls back to close-month when the cycle hasn't ended yet", () => {
    // A cycle-end row that's calendar-ended but lives inside an
    // in-progress cycle (one of its later months hasn't ended) should
    // still allow monthly close — `getRetainerData` only ever exposes
    // months from the targeted cycle so this path is the safety net
    // when an admin opens a previous cycle with the navigator.
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, {
        ...rolloverCloseCtx,
        isCycleClosed: false,
      }),
    ).toBe("close-month");
  });

  it("falls back to close-month when a sibling month is still in progress", () => {
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, {
        ...rolloverCloseCtx,
        allCycleMonthsEnded: false,
      }),
    ).toBe("close-month");
  });

  it("returns null when the cycle has overage (Generate must run first)", () => {
    // The billing axis is still surfacing Generate on the cycle-end row
    // for the unbilled overage; close-cycle is meaningless until that
    // bill exists.
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, {
        ...rolloverCloseCtx,
        cycleHasOverage: true,
      }),
    ).toBeNull();
  });
});
