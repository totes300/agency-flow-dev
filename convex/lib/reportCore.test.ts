import { describe, expect, it } from "vitest";
import {
  aggregateClientMonths,
  aggregateClientTasks,
  aggregateOrgFinance,
  aggregateTimeByMember,
  classifyRetainerMonth,
  isValidMonthKey,
  lastDayOfMonth,
  monthKeysBetween,
  type ReportEntryInput,
  type TaskProjectRef,
} from "./reportCore";

const projectRef = (over: Partial<TaskProjectRef> = {}): TaskProjectRef => ({
  projectId: "p1",
  projectName: "Website",
  clientId: "c1",
  clientName: "Pragmatico",
  currency: "EUR",
  ...over,
});

const entry = (over: Partial<ReportEntryInput> = {}): ReportEntryInput => ({
  userId: "u1",
  taskId: "t1",
  date: "2026-06-10",
  durationMinutes: 60,
  isBillable: true,
  costRate: 40,
  billableRate: 100,
  rateCurrency: "EUR",
  ...over,
});

// ─── month helpers ───────────────────────────────────────────────────────────

describe("month helpers", () => {
  it("validates month keys", () => {
    expect(isValidMonthKey("2026-06")).toBe(true);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-6")).toBe(false);
    expect(isValidMonthKey("June 2026")).toBe(false);
  });

  it("computes the last day of a month (incl. leap years)", () => {
    expect(lastDayOfMonth("2026-06")).toBe("2026-06-30");
    expect(lastDayOfMonth("2026-02")).toBe("2026-02-28");
    expect(lastDayOfMonth("2028-02")).toBe("2028-02-29");
  });

  it("enumerates inclusive month ranges across year boundaries", () => {
    expect(monthKeysBetween("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(monthKeysBetween("2026-06", "2026-06")).toEqual(["2026-06"]);
  });

  it("rejects malformed or reversed ranges", () => {
    expect(() => monthKeysBetween("2026-6", "2026-07")).toThrow(/YYYY-MM/);
    expect(() => monthKeysBetween("2026-07", "2026-06")).toThrow(/before/);
  });
});

// ─── aggregateTimeByMember ───────────────────────────────────────────────────

describe("aggregateTimeByMember", () => {
  it("groups minutes by member and project, sorted by minutes desc", () => {
    const rollups = aggregateTimeByMember({
      entries: [
        entry({ userId: "u1", taskId: "t1", durationMinutes: 90 }),
        entry({ userId: "u1", taskId: "t2", durationMinutes: 30, isBillable: false }),
        entry({ userId: "u2", taskId: "t1", durationMinutes: 240 }),
      ],
      targetUserIds: ["u1", "u2"],
      userNameById: new Map([
        ["u1", "Anna"],
        ["u2", "Ben"],
      ]),
      projectByTaskId: new Map([
        ["t1", projectRef()],
        ["t2", projectRef({ projectId: "p2", projectName: "App", clientName: "Arlow" })],
      ]),
    });

    expect(rollups.map((r) => r.userName)).toEqual(["Ben", "Anna"]);
    const anna = rollups[1];
    expect(anna).toMatchObject({
      minutes: 120,
      billableMinutes: 90,
      nonBillableMinutes: 30,
      entryCount: 2,
    });
    expect(anna.byProject).toEqual([
      {
        projectId: "p1",
        projectName: "Website",
        clientName: "Pragmatico",
        minutes: 90,
        billableMinutes: 90,
      },
      {
        projectId: "p2",
        projectName: "App",
        clientName: "Arlow",
        minutes: 30,
        billableMinutes: 0,
      },
    ]);
  });

  it("zero-fills requested members without entries and skips unrequested users", () => {
    const rollups = aggregateTimeByMember({
      entries: [entry({ userId: "intruder" })],
      targetUserIds: ["u1"],
      userNameById: new Map([["u1", "Anna"]]),
      projectByTaskId: new Map(),
    });
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({ userId: "u1", minutes: 0, entryCount: 0 });
  });

  it("buckets project-less tasks under 'No project'", () => {
    const rollups = aggregateTimeByMember({
      entries: [entry({ taskId: "orphan" })],
      targetUserIds: ["u1"],
      userNameById: new Map([["u1", "Anna"]]),
      projectByTaskId: new Map([["orphan", null]]),
    });
    expect(rollups[0].byProject).toEqual([
      {
        projectId: null,
        projectName: "No project",
        clientName: null,
        minutes: 60,
        billableMinutes: 60,
      },
    ]);
  });
});

// ─── aggregateClientMonths ───────────────────────────────────────────────────

describe("aggregateClientMonths", () => {
  it("buckets by month with zero-filled idle months and per-project splits", () => {
    const result = aggregateClientMonths({
      entries: [
        entry({ date: "2026-01-15", durationMinutes: 60, billableRate: 100 }),
        entry({ date: "2026-01-20", durationMinutes: 30, isBillable: false }),
        entry({
          date: "2026-03-02",
          taskId: "t2",
          durationMinutes: 90,
          billableRate: 80,
        }),
      ],
      fromMonth: "2026-01",
      toMonth: "2026-03",
      projectByTaskId: new Map([
        ["t1", projectRef()],
        ["t2", projectRef({ projectId: "p2", projectName: "App" })],
      ]),
    });

    expect(result.months.map((m) => m.month)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
    expect(result.months[0]).toMatchObject({
      minutes: 90,
      billableMinutes: 60,
      nonBillableMinutes: 30,
      billableAmount: 100,
      entryCount: 2,
    });
    expect(result.months[1]).toMatchObject({ minutes: 0, entryCount: 0 });
    expect(result.months[2].billableAmount).toBe(120); // 1.5h × 80
    expect(result.months[2].byProject).toEqual([
      { projectId: "p2", projectName: "App", minutes: 90 },
    ]);
    expect(result.totals).toEqual({
      minutes: 180,
      billableMinutes: 150,
      nonBillableMinutes: 30,
      billableAmount: 220,
      entryCount: 3,
    });
  });
});

// ─── classifyRetainerMonth ───────────────────────────────────────────────────

describe("aggregateClientTasks", () => {
  it("rolls minutes up per task and keeps the notes oldest first, raw", () => {
    const projectByTaskId = new Map([["t1", projectRef()], ["t2", projectRef({ projectId: "p2", projectName: "Ads" })]]);
    const rows = aggregateClientTasks({
      projectByTaskId,
      entries: [
        { ...entry({ taskId: "t1", date: "2026-06-12", durationMinutes: 47 }), note: "  Second pass  ", startedAt: 2 },
        { ...entry({ taskId: "t1", date: "2026-06-10", durationMinutes: 13, isBillable: false }), note: "First", startedAt: 1 },
        { ...entry({ taskId: "t1", date: "2026-06-12", durationMinutes: 5 }), note: "", startedAt: 1 },
        { ...entry({ taskId: "t2", date: "2026-06-11", durationMinutes: 90 }) },
      ],
    });
    expect(rows.map((r) => [r.taskId, r.minutes, r.billableMinutes, r.nonBillableMinutes, r.entryCount])).toEqual([
      ["t2", 90, 90, 0, 1],
      ["t1", 65, 52, 13, 3],
    ]);
    expect(rows[1].notes).toEqual([
      { date: "2026-06-10", minutes: 13, billable: false, note: "First" },
      { date: "2026-06-12", minutes: 47, billable: true, note: "Second pass" },
    ]);
    expect(rows[0]).toMatchObject({ projectId: "p2", projectName: "Ads", notes: [] });
  });
});

describe("classifyRetainerMonth", () => {
  it("classifies each balance state", () => {
    expect(
      classifyRetainerMonth({ workedMinutes: 0, endBalanceMinutes: 600, periodEnded: true }),
    ).toBe("no_activity");
    expect(
      classifyRetainerMonth({ workedMinutes: 700, endBalanceMinutes: -100, periodEnded: false }),
    ).toBe("overage");
    expect(
      classifyRetainerMonth({ workedMinutes: 600, endBalanceMinutes: 0, periodEnded: true }),
    ).toBe("used_up");
    expect(
      classifyRetainerMonth({ workedMinutes: 400, endBalanceMinutes: 200, periodEnded: true }),
    ).toBe("underspent");
    expect(
      classifyRetainerMonth({ workedMinutes: 400, endBalanceMinutes: 200, periodEnded: false }),
    ).toBe("on_track");
  });
});

// ─── aggregateOrgFinance ─────────────────────────────────────────────────────

describe("aggregateOrgFinance", () => {
  it("rolls up time, per-currency money and per-project rows", () => {
    const result = aggregateOrgFinance({
      entries: [
        entry({ durationMinutes: 120, costRate: 40, billableRate: 100 }), // 2h
        entry({
          taskId: "t2",
          durationMinutes: 60,
          isBillable: false,
          costRate: 50,
          billableRate: 0,
          rateCurrency: "USD",
        }),
      ],
      invoices: [
        { status: "paid", total: 1000, currency: "EUR" },
        { status: "invoiced", total: 500, currency: "EUR" },
        { status: "draft", total: 200, currency: "USD" },
        { status: "void", total: 999, currency: "EUR" },
      ],
      projectByTaskId: new Map([
        ["t1", projectRef()],
        ["t2", projectRef({ projectId: "p2", projectName: "App", currency: "USD" })],
      ]),
    });

    expect(result.time).toEqual({
      totalMinutes: 180,
      billableMinutes: 120,
      nonBillableMinutes: 60,
      entryCount: 2,
    });
    expect(result.laborCostByCurrency).toEqual([
      { currency: "EUR", amount: 80 },
      { currency: "USD", amount: 50 },
    ]);
    expect(result.billableValueByCurrency).toEqual([
      { currency: "EUR", amount: 200 },
      { currency: "USD", amount: 0 },
    ]);
    expect(result.invoicing).toEqual([
      {
        currency: "EUR",
        invoicedTotal: 1500,
        paidTotal: 1000,
        draftTotal: 0,
        invoiceCount: 2,
        paidCount: 1,
        draftCount: 0,
      },
      {
        currency: "USD",
        invoicedTotal: 0,
        paidTotal: 0,
        draftTotal: 200,
        invoiceCount: 0,
        paidCount: 0,
        draftCount: 1,
      },
    ]);
    expect(result.projects.map((p) => p.projectId)).toEqual(["p1", "p2"]);
    expect(result.projects[0]).toMatchObject({
      minutes: 120,
      billableMinutes: 120,
      laborCost: 80,
      billableValue: 200,
      currency: "EUR",
    });
  });
});
