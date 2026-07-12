import { describe, expect, it } from "vitest";
import {
  flattenInvoiceDetail,
  flattenInvoiceMetrics,
  flattenInvoiceRows,
  flattenMonthlyBreakdown,
  flattenProjectOverview,
  flattenReadyRows,
  flattenRetainerCycle,
  flattenRetainerStatement,
  formatInvoiceRef,
  formatMonthKey,
  taskDescriptionToPlainText,
  type InvoiceDetailLike,
  type MonthlyBreakdownMonthLike,
  type ProjectOverviewLike,
  type RetainerCycleLike,
  type RetainerStatementLike,
} from "./reportViews";

describe("formatters", () => {
  it("formats invoice refs and falls back to 'draft' when unnumbered", () => {
    expect(formatInvoiceRef("INV-", 35)).toBe("INV-035");
    expect(formatInvoiceRef("INV-", 1234)).toBe("INV-1234");
    expect(formatInvoiceRef("INV-", null)).toBe("draft");
    expect(formatInvoiceRef("INV-", undefined)).toBe("draft");
  });

  it("formats month keys", () => {
    expect(formatMonthKey(2026, 6)).toBe("2026-06");
    expect(formatMonthKey(2026, 12)).toBe("2026-12");
  });
});

describe("taskDescriptionToPlainText", () => {
  it("extracts plain text from a Tiptap JSON string", () => {
    const doc = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Ship the header fix" }],
        },
      ],
    });
    expect(taskDescriptionToPlainText(doc)).toBe("Ship the header fix");
  });

  it("passes plain strings through and nulls empties", () => {
    expect(taskDescriptionToPlainText("just text")).toBe("just text");
    expect(taskDescriptionToPlainText("")).toBeNull();
    expect(taskDescriptionToPlainText(undefined)).toBeNull();
  });

  it("truncates long text with an ellipsis", () => {
    const out = taskDescriptionToPlainText("x".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out!.endsWith("…")).toBe(true);
  });
});

describe("flattenProjectOverview", () => {
  const overview = (): ProjectOverviewLike => ({
    totalMinutes: 300,
    totalBillableMinutes: 240,
    totalNonBillableMinutes: 60,
    lastLoggedDate: "2026-06-10",
    thisMonthBillableMinutes: 120,
    last3BillableMonths: [{ month: "2026-06", minutes: 120 }],
    minutesByCategory: { cat1: 200, uncategorized: 100 },
    billableMinutesByCategory: { cat1: 200 },
    totalActualCost: 123.456,
    openMinutes: 60,
    openAmount: 100.005,
    draftMinutes: 0,
    draftAmount: 0,
    invoicedMinutes: 180,
    invoicedAmount: 300,
    settledMinutes: 0,
    settledAmount: 0,
    invoiceCount: 2,
    fixedLineItemsAmount: 0,
  });

  it("names categories, sorts by minutes and rounds money to 2dp", () => {
    const flat = flattenProjectOverview(
      overview(),
      new Map([["cat1", "Development"]]),
    );
    expect(flat.categories).toEqual([
      { categoryName: "Development", minutes: 200, billableMinutes: 200 },
      { categoryName: "No category", minutes: 100, billableMinutes: 0 },
    ]);
    expect(flat.laborCost).toBe(123.46);
    expect(flat.billing.openAmount).toBe(100.01);
    expect(flat.billableMinutes).toBe(240);
  });
});

describe("flattenMonthlyBreakdown", () => {
  const month = (): MonthlyBreakdownMonthLike => ({
    month: "2026-06",
    monthLabel: "June 2026",
    totalMinutes: 150,
    totalAmount: 166.666,
    entryCount: 3,
    taskCount: 2,
    categoryCount: 2,
    billableCategoryGroups: [
      { categoryName: "Dev", totalMinutes: 100, totalAmount: 166.666 },
    ],
    nonBillableCategoryGroups: [
      { categoryName: "PM", totalMinutes: 50, totalAmount: 0 },
    ],
  });

  it("derives the billable split from the query's own category subtotals", () => {
    const [row] = flattenMonthlyBreakdown([month()], false);
    expect(row).toMatchObject({
      month: "2026-06",
      billableMinutes: 100,
      nonBillableMinutes: 50,
      billableAmount: 166.67,
    });
    expect(row.categories).toBeUndefined();
  });

  it("includes category rows only on request", () => {
    const [row] = flattenMonthlyBreakdown([month()], true);
    expect(row.categories).toEqual([
      { categoryName: "Dev", billable: true, minutes: 100, amount: 166.67 },
      { categoryName: "PM", billable: false, minutes: 50, amount: 0 },
    ]);
  });
});

describe("flattenRetainerCycle", () => {
  const cycle = (): RetainerCycleLike => ({
    cycleNumber: 3,
    cycleStart: "2026-04-01",
    cycleEnd: "2026-06-30",
    cycleLength: 3,
    isCycleClosed: false,
    isCurrentCycle: true,
    months: [
      {
        year: 2026,
        month: 4,
        label: "April 2026",
        workedMinutes: 700,
        startBalance: 0,
        available: 600,
        endBalance: -100,
        totalNonBillableMinutes: 30,
        periodEnded: true,
        isClosed: false,
        balanceStatus: "deficit",
        entryCount: 12,
        taskCount: 4,
        invoice: { number: 12, prefix: "INV-", status: "paid" },
      },
    ],
    cycleBudget: 1800,
    cycleWorked: 700,
    cycleBalance: 1100,
    utilization: 38.888,
    overageMinutes: 0,
    overageDue: 0,
    monthlyFee: 2000,
    includedMinutesPerMonth: 600,
    rolloverEnabled: true,
    overageRate: 150,
    totalNonBillableMinutes: 30,
    currency: "EUR",
  });

  it("flattens cycle totals and month rows with formatted invoice refs", () => {
    const flat = flattenRetainerCycle(cycle());
    expect(flat).toMatchObject({
      cycleNumber: 3,
      cycleBudgetMinutes: 1800,
      utilizationPercent: 38.89,
      currency: "EUR",
    });
    expect(flat.months[0]).toMatchObject({
      month: "2026-04",
      workedMinutes: 700,
      endBalanceMinutes: -100,
      balanceStatus: "deficit",
      invoice: { number: "INV-012", status: "paid" },
    });
  });
});

describe("flattenRetainerStatement", () => {
  const statement = (): RetainerStatementLike => ({
    inProgress: false,
    period: { year: 2026, month: 6, label: "June 2026" },
    balance: {
      startBalanceMinutes: 0,
      includedMinutes: 600,
      usedMinutes: 700,
      endBalanceMinutes: -100,
      overageMinutes: 100,
    },
    cycleToDate: null,
    billing: {
      monthlyFee: 2000,
      overageRate: 150,
      overageAmount: 250,
      currency: "EUR",
    },
    project: { name: "Retainer", rolloverEnabled: false, cycleLength: 1 },
    client: { name: "Pragmatico" },
    billableCategoryGroups: [{ categoryName: "Dev", totalMinutes: 700 }],
    nonBillableCategoryGroups: [{ categoryName: "PM", totalMinutes: 20 }],
    linkedInvoice: { number: 7, prefix: "INV-", status: "invoiced" },
  });

  it("flattens the statement into a single-level report row", () => {
    const flat = flattenRetainerStatement(statement());
    expect(flat).toMatchObject({
      projectName: "Retainer",
      clientName: "Pragmatico",
      month: "2026-06",
      usedMinutes: 700,
      endBalanceMinutes: -100,
      overageAmount: 250,
      linkedInvoice: { number: "INV-007", status: "invoiced" },
    });
    expect(flat.categories).toEqual([
      { categoryName: "Dev", billable: true, minutes: 700 },
      { categoryName: "PM", billable: false, minutes: 20 },
    ]);
  });
});

describe("invoice flatteners", () => {
  it("flattens metrics buckets into per-currency rows", () => {
    const rows = flattenInvoiceMetrics({
      draft: { count: 1, currencySums: { EUR: 200 } },
      unpaid: { count: 2, currencySums: { EUR: 1000.005, USD: 300 } },
      pastDue: { count: 0, currencySums: {} },
      paidThisMonth: { count: 1, currencySums: { EUR: 500 } },
    });
    expect(rows).toHaveLength(4);
    expect(rows[1]).toEqual({
      bucket: "unpaid",
      count: 2,
      totals: [
        { currency: "EUR", total: 1000.01 },
        { currency: "USD", total: 300 },
      ],
    });
  });

  it("flattens invoice list rows with formatted numbers", () => {
    const [row] = flattenInvoiceRows([
      {
        _id: "i1",
        number: 35,
        prefix: "INV-",
        subject: "June retainer",
        status: "invoiced",
        total: 1500,
        currency: "EUR",
        issueDate: "2026-07-01",
        dueDate: "2026-07-15",
        clientName: "Pragmatico",
        projectName: "Retainer",
        projectBillingType: "retainer",
      },
    ]);
    expect(row).toMatchObject({
      number: "INV-035",
      clientName: "Pragmatico",
      billingType: "retainer",
      dueDate: "2026-07-15",
    });
  });

  it("flattens ready rows with YYYY-MM periods", () => {
    const [row] = flattenReadyRows([
      {
        kind: "retainer-monthly",
        projectName: "Retainer",
        clientName: "Pragmatico",
        period: { year: 2026, month: 6 },
        amount: 250,
        currency: "EUR",
        overageHours: 1.67,
      },
    ]);
    expect(row).toEqual({
      kind: "retainer-monthly",
      projectName: "Retainer",
      clientName: "Pragmatico",
      period: "2026-06",
      amount: 250,
      currency: "EUR",
      overageHours: 1.67,
      cycleLengthMonths: null,
    });
  });

  it("flattens invoice detail into header + line rows", () => {
    const detail: InvoiceDetailLike = {
      invoice: {
        _id: "i1",
        number: 35,
        prefix: "INV-",
        subject: null,
        status: "invoiced",
        currency: "EUR",
        subtotal: 1500,
        total: 1750,
        issueDate: "2026-07-01",
        dueDate: null,
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
      },
      categoryGroups: [
        {
          categoryName: "Development",
          subtotalHours: 10,
          lineItems: [
            {
              description: "June development",
              lineType: "time",
              quantity: 10,
              unitPrice: 150,
              amount: 1500,
            },
          ],
        },
      ],
      retainerUsage: {
        kind: "month",
        closed: true,
        total: {
          availableMinutes: 600,
          usedMinutes: 700,
          balanceMinutes: -100,
          amountDue: 1750,
        },
      },
      project: { name: "Retainer", billingType: "retainer" },
      client: { name: "Pragmatico" },
      staleEntries: null,
    };
    const flat = flattenInvoiceDetail(detail);
    expect(flat).toMatchObject({
      number: "INV-035",
      clientName: "Pragmatico",
      total: 1750,
      periodStart: "2026-06-01",
    });
    expect(flat.lines).toEqual([
      {
        categoryName: "Development",
        description: "June development",
        lineType: "time",
        quantity: 10,
        unitPrice: 150,
        amount: 1500,
      },
    ]);
    expect(flat.retainerUsage).toMatchObject({ balanceMinutes: -100 });
  });
});
