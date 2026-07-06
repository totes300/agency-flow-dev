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

  it("returns null on an ended over-budget row when overageRate=0 (server always rejects close)", () => {
    // The server's overage gate (`isOverageDueForScope`) blocks closing ANY
    // over-budget month regardless of whether an overage rate is set —
    // offering Close here was a dead-end loop (Close errored, Generate
    // unavailable). The config-issue inbox row routes the admin to set the
    // rate instead.
    expect(
      decideRetainerRowCloseAction(
        month({ endBalance: -60 }),
        { ...monthlyCloseCtx, overageRate: 0 },
      ),
    ).toBe(null);
  });
});

describe("decideRetainerRowCloseAction — rollover monthly (non-cycle-end rows)", () => {
  it("returns null for a mid-cycle ended row (rollover closes at cycle level only)", () => {
    // Slice 4 revision: mid-cycle monthly close on a rollover project would
    // settle entries as `retainer_included` and hide them from the cycle's
    // overage computation — `closePeriod` rejects it (Gate -1), so the UI
    // must never offer it.
    expect(
      decideRetainerRowCloseAction(
        month({ cyclePosition: 1, endBalance: 60 }),
        { ...rolloverCloseCtx, isCycleClosed: false, allCycleMonthsEnded: false },
      ),
    ).toBeNull();
  });

  it("returns null even when cycleHasOverage is true on a non-cycle-end row", () => {
    expect(
      decideRetainerRowCloseAction(
        month({ cyclePosition: 1, endBalance: 60 }),
        { ...rolloverCloseCtx, cycleHasOverage: true, isCycleClosed: false, allCycleMonthsEnded: false },
      ),
    ).toBeNull();
  });
});

describe("decideRetainerRowCloseAction — rollover cycle-end row", () => {
  const cycleEndMonth = month({ cyclePosition: 3, endBalance: 60 });

  it("returns close-cycle when all gates pass (cycle ended, all months ended, within budget)", () => {
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, rolloverCloseCtx),
    ).toBe("close-cycle");
  });

  it("returns null when the cycle hasn't ended yet (no monthly fallback)", () => {
    // Slice 4 revision: there is no monthly-close fallback on rollover
    // projects — the only close path is `closeRetainerCycle`, and it needs
    // the whole cycle to be calendar-ended first.
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, {
        ...rolloverCloseCtx,
        isCycleClosed: false,
      }),
    ).toBeNull();
  });

  it("returns null when a sibling month is still in progress", () => {
    expect(
      decideRetainerRowCloseAction(cycleEndMonth, {
        ...rolloverCloseCtx,
        allCycleMonthsEnded: false,
      }),
    ).toBeNull();
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
