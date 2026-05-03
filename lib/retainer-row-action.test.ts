import { describe, it, expect } from "vitest";
import {
  decideRetainerRowAction,
  isCycleEnd,
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
  isMonthClosed: true,
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
        month({ isMonthClosed: false, endBalance: -180 }),
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
        month({ cyclePosition: 3, isMonthClosed: true }),
        rolloverCtx,
      ),
    ).toBe("generate");
  });

  it("mid-cycle row never generates — even if over budget that month", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 2, isMonthClosed: true, endBalance: -300 }),
        rolloverCtx,
      ),
    ).toBe("report");
  });

  it("cycle-end row when cycle is within budget → report", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 3, isMonthClosed: true }),
        { ...rolloverCtx, cycleHasOverage: false },
      ),
    ).toBe("report");
  });

  it("cycle-end row in an unclosed cycle → report (mid-cycle visit)", () => {
    expect(
      decideRetainerRowAction(
        month({ cyclePosition: 3, isMonthClosed: false }),
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
