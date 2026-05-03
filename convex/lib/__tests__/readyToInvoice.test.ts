import { describe, it, expect } from "vitest";
import {
  buildFixedReadyRow,
  buildRetainerCycleReadyRows,
  buildRetainerMonthlyReadyRows,
  buildTmReadyRows,
  computeLastInvoicedAt,
  enumerateRetainerCycleState,
  isInvoiceable,
  selectBatchEligibleRows,
  sortReadyRows,
  type ClientInput,
  type InvoiceInput,
  type ProjectInput,
  type ReadyRow,
} from "../readyToInvoice";
import type { DataModel, Id } from "../../_generated/dataModel";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;

const TODAY = "2026-05-15";

function makeClient(over: Partial<ClientInput> = {}): ClientInput {
  return {
    _id: id<"clients">("client_a"),
    name: "Acme Co",
    currency: "USD",
    ...over,
  };
}

function makeProject(over: Partial<ProjectInput>): ProjectInput {
  return {
    _id: id<"projects">("project_a"),
    name: "Project A",
    billingType: "retainer",
    clientId: id<"clients">("client_a"),
    ...over,
  };
}

function inv(over: Partial<InvoiceInput>): InvoiceInput {
  return {
    _id: id<"invoices">("inv_1"),
    status: "invoiced",
    total: 0,
    issueDate: "2026-04-01",
    ...over,
  };
}

// ─── computeLastInvoicedAt ─────────────────────────────────────────────────────

describe("computeLastInvoicedAt", () => {
  it("returns null when only drafts/voids exist", () => {
    expect(
      computeLastInvoicedAt([
        inv({ status: "draft", issueDate: "2026-04-01" }),
        inv({ status: "void", issueDate: "2026-03-01" }),
      ]),
    ).toBeNull();
  });

  it("returns the latest finalized issueDate as ms", () => {
    const result = computeLastInvoicedAt([
      inv({ status: "invoiced", issueDate: "2026-02-15" }),
      inv({ status: "paid", issueDate: "2026-04-01" }),
      inv({ status: "draft", issueDate: "2026-05-01" }), // ignored
    ]);
    // Anchored at noon UTC so re-projection through any IANA tz lands on the
    // same calendar day. See computeLastInvoicedAt docstring.
    expect(result).toBe(Date.parse("2026-04-01T12:00:00Z"));
  });
});

// ─── enumerateRetainerCycleState ──────────────────────────────────────────────

describe("enumerateRetainerCycleState", () => {
  it("monthly mode (rollover OFF) returns closed months without cycles", () => {
    // Project starts 2026-01-01, today is 2026-04-15.
    // Closed months: Jan, Feb, Mar (April is in progress).
    // Each month independent: endBalance = included - worked.
    const result = enumerateRetainerCycleState({
      startDate: "2026-01-01",
      todayStr: "2026-04-15",
      includedMinutes: 2400, // 40h
      cycleLength: 3,
      rolloverEnabled: false,
      billableByMonth: new Map([
        ["2026-01", 1800], // 30h worked → +600 balance
        ["2026-02", 2400], // 40h → 0
        ["2026-03", 2700], // 45h → -300 (over)
      ]),
    });
    expect(result.cycles).toEqual([]);
    expect(result.closedMonths).toEqual([
      { year: 2026, month: 1, endBalance: 600 },
      { year: 2026, month: 2, endBalance: 0 },
      { year: 2026, month: 3, endBalance: -300 },
    ]);
  });

  it("rollover mode chains balances and emits one cycle per closing month", () => {
    // 3-month cycles, project starts 2026-01-01, today 2026-04-15.
    // Cycle 1 (Jan-Mar) closes; April starts a new cycle.
    // Cycle balance = (3 × 40h) - sum(worked) = 7200 - (1800+2400+2700) = 300.
    const result = enumerateRetainerCycleState({
      startDate: "2026-01-01",
      todayStr: "2026-04-15",
      includedMinutes: 2400,
      cycleLength: 3,
      rolloverEnabled: true,
      billableByMonth: new Map([
        ["2026-01", 1800],
        ["2026-02", 2400],
        ["2026-03", 2700],
      ]),
    });
    expect(result.cycles).toEqual([
      {
        closingYear: 2026,
        closingMonth: 3,
        cycleBalance: 300, // 3×2400 - 6900
        isCycleClosed: true,
      },
    ]);
    // Closed months still emitted with chained endBalance:
    //   Jan:  start 0 + 2400 - 1800 = 600
    //   Feb:  start 600 + 2400 - 2400 = 600
    //   Mar:  start 600 + 2400 - 2700 = 300
    expect(result.closedMonths).toEqual([
      { year: 2026, month: 1, endBalance: 600 },
      { year: 2026, month: 2, endBalance: 600 },
      { year: 2026, month: 3, endBalance: 300 },
    ]);
  });

  it("emits an in-progress cycle bucket with isCycleClosed=false", () => {
    // Today is mid-March (cycle's closing month). The closing month's mEnd
    // (Mar 31) is NOT < today (Mar 15), so isClosed=false. The cycle gets
    // emitted at the position-2 hop with that flag.
    const result = enumerateRetainerCycleState({
      startDate: "2026-01-01",
      todayStr: "2026-03-15",
      includedMinutes: 2400,
      cycleLength: 3,
      rolloverEnabled: true,
      billableByMonth: new Map([["2026-01", 1200], ["2026-02", 1200]]),
    });
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].isCycleClosed).toBe(false);
    expect(result.cycles[0].closingMonth).toBe(3);
    // March hasn't ended → not in closedMonths.
    expect(result.closedMonths.map((m) => m.month)).toEqual([1, 2]);
  });

  it("does not emit a cycle bucket while still mid-cycle (before closing month)", () => {
    // Today is Feb 15 (position 1 of 3); we never reach position 2 → no cycle.
    const result = enumerateRetainerCycleState({
      startDate: "2026-01-01",
      todayStr: "2026-02-15",
      includedMinutes: 2400,
      cycleLength: 3,
      rolloverEnabled: true,
      billableByMonth: new Map(),
    });
    expect(result.cycles).toEqual([]);
    expect(result.closedMonths.map((m) => m.month)).toEqual([1]); // only Jan closed
  });

  it("restarts the rollover chain at the start of each new cycle", () => {
    // Two complete 3-month cycles. Cycle 2's first month should NOT inherit
    // cycle 1's leftover balance (matches `getRetainerData` semantics).
    const result = enumerateRetainerCycleState({
      startDate: "2026-01-01",
      todayStr: "2026-07-15",
      includedMinutes: 2400,
      cycleLength: 3,
      rolloverEnabled: true,
      billableByMonth: new Map([
        ["2026-01", 0],
        ["2026-02", 0],
        ["2026-03", 0], // cycle 1: 7200 unused
        ["2026-04", 1200],
        ["2026-05", 1200],
        ["2026-06", 1200], // cycle 2: 3600 worked, 3600 unused
      ]),
    });
    // April's startBalance must be 0 (cycle restart), not 7200.
    const april = result.closedMonths.find((m) => m.month === 4)!;
    expect(april.endBalance).toBe(2400 - 1200); // start 0 + 2400 - 1200
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[0].cycleBalance).toBe(7200);
    expect(result.cycles[1].cycleBalance).toBe(3600);
  });

  it("handles year rollover within a cycle", () => {
    // Cycle spans Nov 2025 → Jan 2026 (cycleLength 3). Closing month is Jan.
    const result = enumerateRetainerCycleState({
      startDate: "2025-11-01",
      todayStr: "2026-04-15",
      includedMinutes: 2400,
      cycleLength: 3,
      rolloverEnabled: true,
      billableByMonth: new Map(),
    });
    // First cycle closes January 2026.
    expect(result.cycles[0]).toEqual({
      closingYear: 2026,
      closingMonth: 1,
      cycleBalance: 7200, // all unused
      isCycleClosed: true,
    });
    // Second cycle: Feb-Apr 2026; April hasn't ended yet → still emitted with
    // isCycleClosed=false.
    expect(result.cycles).toHaveLength(2);
    expect(result.cycles[1].isCycleClosed).toBe(false);
    expect(result.cycles[1].closingMonth).toBe(4);
  });

  it("returns an empty result when the project starts in the current month", () => {
    const result = enumerateRetainerCycleState({
      startDate: "2026-04-01",
      todayStr: "2026-04-15",
      includedMinutes: 2400,
      cycleLength: 3,
      rolloverEnabled: true,
      billableByMonth: new Map([["2026-04", 600]]),
    });
    expect(result.closedMonths).toEqual([]);
    // The first cycle hasn't reached its closing month yet (we're at position 0).
    expect(result.cycles).toEqual([]);
  });
});

// ─── Retainer monthly (rollover OFF) ──────────────────────────────────────────

describe("buildRetainerMonthlyReadyRows", () => {
  // Contract after the invoicing refactor (`docs/invoicing-refactor.md`):
  //   - within-budget months never appear; they render as Monthly Reports.
  //   - over-budget months emit one row whose `amount = overageHours × rate`.
  //   - the previous `invoiceTotal = monthlyFee + overage` field is gone.
  it("emits NO row for a within-budget closed month", () => {
    const rows = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: false, overageRate: 100 }),
      client: makeClient(),
      invoices: [],
      monthBalances: [{ year: 2026, month: 3, endBalance: 120 }],
    });
    expect(rows).toEqual([]);
  });

  it("emits an over-budget row with computed overage charge", () => {
    const rows = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: false, overageRate: 100 }),
      client: makeClient(),
      invoices: [],
      monthBalances: [{ year: 2026, month: 3, endBalance: -120 }], // 2h over
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].badgeKind).toBe("over-budget");
    expect(rows[0].overageHours).toBe(2);
    expect(rows[0].amount).toBe(200); // 2h × $100
  });

  it("skips months that already have a non-void invoice", () => {
    const rows = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: false, overageRate: 100 }),
      client: makeClient(),
      invoices: [
        inv({
          status: "invoiced",
          periodStart: "2026-04-01",
          periodEnd: "2026-04-30",
        }),
      ],
      monthBalances: [
        { year: 2026, month: 3, endBalance: -60 }, // over → row
        { year: 2026, month: 4, endBalance: -120 }, // over but already invoiced
      ],
    });
    expect(rows.map((r) => r.period?.month)).toEqual([3]);
  });

  it("treats voided invoices as non-blocking (the month is re-invoiceable)", () => {
    const rows = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: false, overageRate: 100 }),
      client: makeClient(),
      invoices: [
        inv({
          status: "void",
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
        }),
      ],
      monthBalances: [{ year: 2026, month: 3, endBalance: -60 }], // over
    });
    expect(rows).toHaveLength(1);
  });

  it("emits no row when over-budget but overageRate is 0 (pathological config)", () => {
    const rows = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: false, overageRate: 0 }),
      client: makeClient(),
      invoices: [],
      monthBalances: [{ year: 2026, month: 3, endBalance: -60 }],
    });
    // No row: amount would be 0 → never bill.
    expect(rows).toEqual([]);
  });

  it("returns nothing when rolloverEnabled is true (cycle handles it)", () => {
    const rows = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100 }),
      client: makeClient(),
      invoices: [],
      monthBalances: [{ year: 2026, month: 3, endBalance: 0 }],
    });
    expect(rows).toEqual([]);
  });
});

// ─── Retainer cycle (rollover ON) ─────────────────────────────────────────────

describe("buildRetainerCycleReadyRows", () => {
  // Contract after the invoicing refactor: only over-budget closed cycles
  // emit a row. Within-budget cycles render as Monthly Reports. The row's
  // period anchors to the cycle's CLOSING month — `cycleLengthMonths` lets
  // the UI render the full range ("Jan–Mar") without a second project fetch.
  it("emits NO row for a within-budget closed cycle", () => {
    const rows = buildRetainerCycleReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100, cycleLength: 3 }),
      client: makeClient(),
      invoices: [],
      cycles: [
        {
          closingYear: 2026,
          closingMonth: 3,
          cycleBalance: 300, // within budget
          isCycleClosed: true,
        },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("emits one row per closed over-budget cycle (cycle-end period anchor)", () => {
    const rows = buildRetainerCycleReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100, cycleLength: 3 }),
      client: makeClient(),
      invoices: [],
      cycles: [
        {
          closingYear: 2026,
          closingMonth: 3,
          cycleBalance: -180, // 3h over the entire cycle
          isCycleClosed: true,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("retainer-cycle");
    expect(rows[0].badgeKind).toBe("over-budget");
    expect(rows[0].overageHours).toBe(3);
    expect(rows[0].amount).toBe(300);
    expect(rows[0].period).toEqual({ year: 2026, month: 3 });
    // The row carries the cycle length so the UI can format "Jan–Mar".
    expect(rows[0].cycleLengthMonths).toBe(3);
  });

  it("excludes mid-cycle (isCycleClosed: false)", () => {
    const rows = buildRetainerCycleReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100 }),
      client: makeClient(),
      invoices: [],
      cycles: [
        {
          closingYear: 2026,
          closingMonth: 6,
          cycleBalance: -60,
          isCycleClosed: false,
        },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("skips the cycle when its closing month is already invoiced", () => {
    const rows = buildRetainerCycleReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100 }),
      client: makeClient(),
      invoices: [
        inv({
          status: "invoiced",
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
        }),
      ],
      cycles: [
        {
          closingYear: 2026,
          closingMonth: 3,
          cycleBalance: -120,
          isCycleClosed: true,
        },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("skips the cycle when a CYCLE-SPANNING invoice already covers it", () => {
    // Issue #01 introduced multi-month cycle invoices (periodStart=cycleStart,
    // periodEnd=cycleEnd). The Ready-feed dedup must key invoices by anchor
    // month (= periodEnd's YYYY-MM), not by periodStart, so a billed cycle
    // disappears from Ready instead of resurfacing as a duplicate.
    const rows = buildRetainerCycleReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100, cycleLength: 3 }),
      client: makeClient(),
      invoices: [
        inv({
          status: "invoiced",
          periodStart: "2026-01-01", // cycle start (Jan)
          periodEnd: "2026-03-31",   // cycle end (Mar) → anchor = "2026-03"
        }),
      ],
      cycles: [
        {
          closingYear: 2026,
          closingMonth: 3,
          cycleBalance: -180,
          isCycleClosed: true,
        },
      ],
    });
    expect(rows).toEqual([]);
  });

  it("a voided cycle invoice frees the period (cycle row reappears)", () => {
    // Per PRD § D5 — voiding releases the period for re-billing. Anchor-key
    // logic must agree: voided invoices are ignored regardless of period
    // shape.
    const rows = buildRetainerCycleReadyRows({
      project: makeProject({ rolloverEnabled: true, overageRate: 100, cycleLength: 3 }),
      client: makeClient(),
      invoices: [
        inv({
          status: "void",
          periodStart: "2026-01-01",
          periodEnd: "2026-03-31",
        }),
      ],
      cycles: [
        {
          closingYear: 2026,
          closingMonth: 3,
          cycleBalance: -180,
          isCycleClosed: true,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(300);
  });
});

// ─── Fixed ─────────────────────────────────────────────────────────────────────

describe("buildFixedReadyRow", () => {
  it("emits a row when remaining > 0 and no draft exists", () => {
    const row = buildFixedReadyRow({
      project: makeProject({ billingType: "fixed", fixedPrice: 5000 }),
      client: makeClient(),
      invoices: [
        inv({ status: "paid", total: 2000 }), // 2000 already finalized
      ],
      fixedBilledFinalized: 2000,
    });
    expect(row).not.toBeNull();
    expect(row?.kind).toBe("fixed");
    expect(row?.amount).toBe(3000);
    expect(row?.badgeKind).toBeNull();
    expect(row?.period).toBeUndefined();
  });

  it("returns null when a draft already exists (resume-existing path)", () => {
    const row = buildFixedReadyRow({
      project: makeProject({ billingType: "fixed", fixedPrice: 5000 }),
      client: makeClient(),
      invoices: [inv({ status: "draft", total: 0 })],
      fixedBilledFinalized: 0,
    });
    expect(row).toBeNull();
  });

  it("returns null when remaining <= 0", () => {
    const row = buildFixedReadyRow({
      project: makeProject({ billingType: "fixed", fixedPrice: 5000 }),
      client: makeClient(),
      invoices: [inv({ status: "paid", total: 5000 })],
      fixedBilledFinalized: 5000,
    });
    expect(row).toBeNull();
  });

  it("emits a row with the unbilled remainder when prior partial finalized exists", () => {
    const row = buildFixedReadyRow({
      project: makeProject({ billingType: "fixed", fixedPrice: 5000 }),
      client: makeClient(),
      invoices: [
        inv({ status: "paid", total: 1500 }),
        inv({ status: "invoiced", total: 1500 }),
      ],
      fixedBilledFinalized: 3000,
    });
    expect(row?.amount).toBe(2000);
  });

  it("returns null on archived projects", () => {
    const row = buildFixedReadyRow({
      project: makeProject({
        billingType: "fixed",
        fixedPrice: 5000,
        archivedAt: 1700000000000,
      }),
      client: makeClient(),
      invoices: [],
      fixedBilledFinalized: 0,
    });
    expect(row).toBeNull();
  });
});

// ─── T&M ───────────────────────────────────────────────────────────────────────

describe("buildTmReadyRows", () => {
  const tmProject = () =>
    makeProject({ billingType: "t_and_m", _id: id<"projects">("project_tm") });

  it("emits a row per closed prior month with uninvoiced billable hours", () => {
    const rows = buildTmReadyRows({
      project: tmProject(),
      client: makeClient(),
      invoices: [],
      entries: [
        {
          _id: id<"timeEntries">("e1"),
          date: "2026-03-10",
          durationMinutes: 60,
          isBillable: true,
          invoiceId: null,
          billableRate: 150,
        },
        {
          _id: id<"timeEntries">("e2"),
          date: "2026-03-12",
          durationMinutes: 30,
          isBillable: true,
          invoiceId: null,
          billableRate: 150,
        },
        {
          _id: id<"timeEntries">("e3"),
          date: "2026-04-01",
          durationMinutes: 60,
          isBillable: true,
          invoiceId: null,
          billableRate: 150,
        },
      ],
      todayStr: TODAY,
    });
    expect(rows).toHaveLength(2);
    const march = rows.find((r) => r.period?.month === 3);
    expect(march?.amount).toBe(225); // 1.5h × 150
    expect(march?.badgeKind).toBeNull();
    expect(march?.kind).toBe("tm");
  });

  it("excludes the current (mid-cycle) month", () => {
    const rows = buildTmReadyRows({
      project: tmProject(),
      client: makeClient(),
      invoices: [],
      entries: [
        {
          _id: id<"timeEntries">("e1"),
          date: TODAY,
          durationMinutes: 120,
          isBillable: true,
          invoiceId: null,
          billableRate: 150,
        },
      ],
      todayStr: TODAY,
    });
    expect(rows).toEqual([]);
  });

  it("excludes entries already attached to an invoice", () => {
    const rows = buildTmReadyRows({
      project: tmProject(),
      client: makeClient(),
      invoices: [],
      entries: [
        {
          _id: id<"timeEntries">("e1"),
          date: "2026-03-10",
          durationMinutes: 60,
          isBillable: true,
          invoiceId: id<"invoices">("inv_x"),
          billableRate: 150,
        },
      ],
      todayStr: TODAY,
    });
    expect(rows).toEqual([]);
  });

  it("excludes non-billable entries", () => {
    const rows = buildTmReadyRows({
      project: tmProject(),
      client: makeClient(),
      invoices: [],
      entries: [
        {
          _id: id<"timeEntries">("e1"),
          date: "2026-03-10",
          durationMinutes: 60,
          isBillable: false,
          invoiceId: null,
          billableRate: 150,
        },
      ],
      todayStr: TODAY,
    });
    expect(rows).toEqual([]);
  });
});

// ─── Sort + multi-currency ────────────────────────────────────────────────────

// ─── isInvoiceable ─────────────────────────────────────────────────────────────

describe("isInvoiceable", () => {
  // After the invoicing refactor (`docs/invoicing-refactor.md`) the canonical
  // rule is `row.amount > 0`. The previous `invoiceTotal = monthlyFee + overage`
  // composite is gone — the monthly retainer fee is a Stripe subscription, so
  // the only billable number is the overage in `amount`.
  function row(over: Partial<ReadyRow>): ReadyRow {
    return {
      kind: "retainer-monthly",
      projectId: id<"projects">("p1"),
      projectName: "P1",
      clientId: id<"clients">("c1"),
      clientName: "Client 1",
      sortKey: "2026-03/client 1",
      amount: 0,
      currency: "USD",
      badgeKind: "over-budget",
      lastInvoicedAt: null,
      period: { year: 2026, month: 3 },
      ...over,
    };
  }

  it("rejects rows with amount === 0 (zero-amount invoices never produced)", () => {
    expect(isInvoiceable(row({ amount: 0 }))).toBe(false);
  });

  it("accepts over-budget retainer with overage charge", () => {
    expect(isInvoiceable(row({ badgeKind: "over-budget", amount: 200 }))).toBe(true);
  });

  it("accepts fixed rows with a remaining balance", () => {
    expect(
      isInvoiceable(
        row({
          kind: "fixed",
          badgeKind: null,
          period: undefined,
          amount: 5000,
        }),
      ),
    ).toBe(true);
  });

  it("accepts T&M rows when entries have a billable rate", () => {
    expect(
      isInvoiceable(row({ kind: "tm", badgeKind: null, amount: 320 })),
    ).toBe(true);
  });
});

// ─── selectBatchEligibleRows ───────────────────────────────────────────────────

describe("selectBatchEligibleRows", () => {
  function row(over: Partial<ReadyRow>): ReadyRow {
    return {
      kind: "retainer-monthly",
      projectId: id<"projects">("p1"),
      projectName: "P1",
      clientId: id<"clients">("c1"),
      clientName: "Client 1",
      sortKey: "2026-03/client 1",
      amount: 0,
      currency: "USD",
      badgeKind: "over-budget",
      lastInvoicedAt: null,
      period: { year: 2026, month: 3 },
      ...over,
    };
  }

  it("is a thin wrapper around isInvoiceable (amount > 0)", () => {
    const billable = row({ amount: 200 });
    const zero = row({ amount: 0 });
    expect(selectBatchEligibleRows([billable, zero])).toEqual([billable]);
  });

  it("preserves input order for mixed rows", () => {
    const a = row({
      projectId: id<"projects">("a"),
      amount: 100,
      period: { year: 2026, month: 1 },
    });
    const b = row({
      projectId: id<"projects">("b"),
      amount: 0,
    });
    const c = row({
      projectId: id<"projects">("c"),
      amount: 200,
      period: { year: 2026, month: 2 },
    });
    expect(selectBatchEligibleRows([a, b, c]).map((r) => r.projectId)).toEqual([
      id<"projects">("a"),
      id<"projects">("c"),
    ]);
  });
});

describe("sortReadyRows", () => {
  it("orders rows oldest-first by sortKey across project types", () => {
    // Both retainer months are over-budget — within-budget months never reach
    // the Ready feed after the invoicing refactor.
    const monthly = buildRetainerMonthlyReadyRows({
      project: makeProject({
        _id: id<"projects">("p_ret"),
        rolloverEnabled: false,
        overageRate: 100,
      }),
      client: makeClient(),
      invoices: [],
      monthBalances: [
        { year: 2026, month: 4, endBalance: -120 },
        { year: 2026, month: 1, endBalance: -60 },
      ],
    });
    const fixed = buildFixedReadyRow({
      project: makeProject({
        _id: id<"projects">("p_fix"),
        billingType: "fixed",
        fixedPrice: 1000,
      }),
      client: makeClient({ name: "Zenith" }),
      invoices: [],
      fixedBilledFinalized: 0,
    });
    const sorted = sortReadyRows([...(fixed ? [fixed] : []), ...monthly]);
    // Expect retainer Jan, retainer Apr, fixed (Zenith — last alphabetically)
    expect(sorted.map((r) => `${r.kind}/${r.period?.month ?? "-"}`)).toEqual([
      "retainer-monthly/1",
      "retainer-monthly/4",
      "fixed/-",
    ]);
  });

  it("does not aggregate currencies across rows", () => {
    // Each row must be over-budget for the refactor's "no zero rows" rule —
    // both balances are negative so we get one row per project.
    const usdRow = buildRetainerMonthlyReadyRows({
      project: makeProject({ rolloverEnabled: false, overageRate: 100 }),
      client: makeClient({ currency: "USD" }),
      invoices: [],
      monthBalances: [{ year: 2026, month: 3, endBalance: -60 }],
    });
    const eurRow = buildRetainerMonthlyReadyRows({
      project: makeProject({
        _id: id<"projects">("p_eur"),
        rolloverEnabled: false,
        overageRate: 100,
      }),
      client: makeClient({ _id: id<"clients">("c_eur"), currency: "EUR" }),
      invoices: [],
      monthBalances: [{ year: 2026, month: 3, endBalance: -60 }],
    });
    const merged = [...usdRow, ...eurRow];
    expect(merged.map((r) => r.currency).sort()).toEqual(["EUR", "USD"]);
  });
});
