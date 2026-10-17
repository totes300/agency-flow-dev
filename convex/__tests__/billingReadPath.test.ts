// @vitest-environment edge-runtime

/**
 * Close-model read path (docs/prd-billing-refactor.md slice 3b): the new
 * queue, workspace, monthly report and invoice detail must agree with each
 * other and with what `commitClose` bills (N11), before and after commit, and
 * a delivered report must never change (N8).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_read";
const ADMIN = {
  subject: "user_admin",
  tokenIdentifier: "test|user_admin",
  org_id: ORG_ID,
  org_role: "org:admin",
} as never;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const setToday = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));

const newTest = () => convexTest(schema, modules);
type World = { t: ReturnType<typeof newTest>; userId: Id<"users">; projectId: Id<"projects">; taskId: Id<"tasks"> };

async function world(project: Record<string, unknown>, roundingMinutes = 1): Promise<World> {
  const t = newTest();
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { name: "Admin", externalId: "user_admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG_ID, clerkUserId: "user_admin", userId, role: "admin", joinedAt: now });
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID,
      defaultCurrency: "EUR",
      timezone: "UTC",
      roundingMinutes,
      brandName: "Test Agency",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID, name: "Todo", type: "backlog", color: "#000", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: userId,
    });
    const clientId = await ctx.db.insert("clients", { orgId: ORG_ID, name: "Acme", currency: "EUR", createdAt: now, updatedAt: now, createdBy: userId });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId,
      name: "Project",
      code: "PRJ-1",
      billingType: "retainer",
      startDate: "2026-03-01",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      ...project,
    } as never);
    const taskId = await ctx.db.insert("tasks", {
      orgId: ORG_ID, title: "Support", statusId, statusType: "backlog", projectId, assigneeIds: [userId], billable: true,
      createdAt: now, updatedAt: now, createdBy: userId,
    });
    return { userId, projectId, taskId };
  });
  return { t, ...ids };
}

async function addEntry(w: World, date: string, minutes: number, over: { billable?: boolean; rate?: number } = {}) {
  return w.t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("timeEntries", {
      orgId: ORG_ID, projectId: w.projectId, taskId: w.taskId, userId: w.userId, date,
      startedAt: Date.parse(`${date}T09:00:00Z`), durationMinutes: minutes, isBillable: over.billable ?? true,
      method: "manual", costRate: 0, billableRate: over.rate ?? 0, rateCurrency: "EUR", createdAt: now, updatedAt: now, createdBy: w.userId,
    });
  });
}

const as = (w: World) => w.t.withIdentity(ADMIN);
const queueRow = async (w: World) =>
  (await as(w).query(api.billingViews.getCloseQueue, {})).months.flatMap((m) => m.rows).find((r) => r.projectId === w.projectId);
const workspace = (w: World, period: string) =>
  as(w).query(api.billingViews.getCloseWorkspace, { projectId: w.projectId, period });
const report = (w: World, year: number, month: number) =>
  as(w).query(api.billingReports.getMonthlyReport, { projectId: w.projectId, year, month });
const commit = (w: World, periodStart: string) =>
  as(w).mutation(api.billingCloses.commitClose, { projectId: w.projectId, periodStart });

const retainer = { includedMinutesPerMonth: 600, overageRate: 90 };

describe("N11 — one number per period, on every surface", () => {
  it("monthly retainer: queue = workspace = draft = invoice = report, before and after commit", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    await addEntry(w, "2026-03-04", 400);
    await addEntry(w, "2026-03-18", 255);
    await addEntry(w, "2026-03-20", 120, { billable: false });

    const row = await queueRow(w);
    expect(row).toMatchObject({ periodToken: "2026-03", amount: 82.5, isCloseRow: false, pendingPeriods: 0 });
    const ws = await workspace(w, "2026-03");
    expect(ws).toMatchObject({ amount: 82.5, usageMinutes: 655, committable: true, isClosed: false });
    expect(ws?.entries).toHaveLength(3);
    expect((await report(w, 2026, 3))?.billing.overageAmount).toBe(82.5);

    const { invoiceId } = await commit(w, "2026-03-01");
    const detail = await as(w).query(api.invoices.getInvoice, { identifier: invoiceId! });
    expect(detail?.invoice.total).toBe(82.5);
    expect(detail?.period).toEqual({ start: "2026-03-01", end: "2026-03-31", months: 1 });
    expect(detail?.retainerUsage?.total).toEqual({ availableMinutes: 600, usedMinutes: 655, balanceMinutes: -55, amountDue: 82.5 });

    // After commit: the period leaves the queue, the workspace reads the snapshot.
    expect(await queueRow(w)).toBeUndefined();
    const closed = await workspace(w, "2026-03");
    expect(closed).toMatchObject({ amount: 82.5, isClosed: true, committable: false });
    expect(closed?.coveringDraft?.id).toBe(invoiceId);
    expect(closed?.flags).toEqual([]);
    const stmt = await report(w, 2026, 3);
    expect(stmt).toMatchObject({ isFinal: false, billing: { overageAmount: 82.5 } });
    expect(stmt?.linkedInvoice?.id).toBe(invoiceId);

    await as(w).mutation(api.invoices.changeInvoiceStatus, { id: invoiceId!, newStatus: "invoiced" });
    expect((await report(w, 2026, 3))?.isFinal).toBe(true);
  });

  it("T&M: queue = workspace = draft with line rounding", async () => {
    setToday("2026-04-10");
    const w = await world({ billingType: "t_and_m", startDate: undefined }, 15);
    await addEntry(w, "2026-03-03", 20, { rate: 100 });
    await addEntry(w, "2026-03-09", 50, { rate: 90 });
    expect((await queueRow(w))?.amount).toBe(140);
    expect((await workspace(w, "2026-03"))?.amount).toBe(140);
    const { invoiceId } = await commit(w, "2026-03-01");
    expect((await as(w).query(api.invoices.getInvoice, { identifier: invoiceId! }))?.invoice.total).toBe(140);
  });

  it("cycle retainer: the report's amount due is the cycle close's price", async () => {
    setToday("2026-07-10");
    const w = await world({ ...retainer, startDate: "2026-04-01", rolloverEnabled: true, cycleLength: 3 });
    await addEntry(w, "2026-04-10", 500);
    await addEntry(w, "2026-05-10", 700);
    await addEntry(w, "2026-06-10", 700);
    const row = await queueRow(w);
    expect(row).toMatchObject({ periodToken: "2026-04", periodLabel: "Apr-Jun 2026", amount: 150 });
    expect((await workspace(w, "2026-05"))?.period).toMatchObject({ start: "2026-04-01", end: "2026-06-30" });
    await commit(w, "2026-04-01");
    const june = await report(w, 2026, 6);
    expect(june?.retainerUsage).toMatchObject({ kind: "cycle", closed: true });
    expect(june?.billing.overageAmount).toBe(150);
    expect(june?.cycleToDate).toMatchObject({ usedMinutes: 1900, includedMinutes: 1800, positionInCycle: 3 });
    // Mid-cycle months show no amount due.
    expect((await report(w, 2026, 5))?.billing.overageAmount).toBe(0);

    // The close's worksheet (D10): per-month sections from the snapshot, and
    // the cycle ledger lands on the close's own overage.
    const close = await w.t.run(async (ctx) => (await ctx.db.query("billingCloses").collect())[0]);
    const sheet = await as(w).query(internal.worksheetsHelpers.collectCloseWorksheetData, { closeId: close._id });
    expect(sheet.layout).toBe("cycle");
    if (sheet.layout === "cycle") {
      expect(sheet.data.sections.map((s) => [s.subtotalBillableMinutes, s.allocationMinutes])).toEqual([
        [500, 600],
        [700, 700],
        [700, 600],
      ]);
      expect(sheet.data.sections.map((s) => s.rolloverIntoNextMinutes)).toEqual([100, 0, null]);
      expect(sheet.data.sections[2].overageMinutes).toBe(close.overageMinutes);
      expect(sheet.data.cycleTotal).toEqual({ billableMinutes: 1900, allocationMinutes: 1800, netOverageMinutes: 100 });
    }
  });
});

describe("N8 — a closed month's report never changes; carried work counts once", () => {
  it("a skipped entry counts on the receiving month only (fixes B4)", async () => {
    setToday("2026-05-10");
    const w = await world({ includedMinutesPerMonth: 60, overageRate: 100 });
    const skipped = await addEntry(w, "2026-03-12", 30);
    await as(w).mutation(api.billingCloses.skipEntries, { entryIds: [skipped] });
    await commit(w, "2026-03-01");
    await addEntry(w, "2026-04-08", 45);
    await commit(w, "2026-04-01");

    const march = await report(w, 2026, 3);
    const april = await report(w, 2026, 4);
    expect(march?.balance.usedMinutes).toBe(0);
    expect(april?.balance.usedMinutes).toBe(75);
    expect(april?.billing.overageAmount).toBe(25);
    expect(april?.carriedGroups.map((g) => g.monthKey)).toEqual(["2026-03"]);
  });

  it("time logged later never changes a closed month", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    await addEntry(w, "2026-03-04", 300);
    await commit(w, "2026-03-01");
    const before = await report(w, 2026, 3);
    await addEntry(w, "2026-03-25", 500); // late: belongs to April
    expect(await report(w, 2026, 3)).toEqual(before);
    setToday("2026-05-10");
    const april = await report(w, 2026, 4);
    expect(april?.balance.usedMinutes).toBe(500);
    expect(april?.carriedGroups).toHaveLength(1);
  });
});

describe("queue", () => {
  it("one row per project with the periods waiting behind it", async () => {
    setToday("2026-06-10");
    const w = await world(retainer);
    await addEntry(w, "2026-04-04", 100);
    expect(await queueRow(w)).toMatchObject({ periodToken: "2026-03", isCloseRow: true, pendingPeriods: 2 });
    const signals = await as(w).query(api.billingViews.getNavSignals, {});
    expect(signals).toEqual({ toGenerateCount: 0, toCloseCount: 1, overdueCount: 0 });
  });

  it("an open period behind an unclosed one is flagged, not committable", async () => {
    setToday("2026-06-10");
    const w = await world(retainer);
    const ws = await workspace(w, "2026-04");
    expect(ws).toMatchObject({ committable: false, issues: ["not-earliest-open"] });
  });

  it("skipped entries render collapsed in the period they left", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 100);
    await as(w).mutation(api.billingCloses.skipEntries, { entryIds: [a] });
    const ws = await workspace(w, "2026-03");
    expect(ws?.entries.map((r) => [r._id, r.skipped, r.skippedToLabel])).toEqual([[a, true, "April 2026"]]);
    expect(ws?.usageMinutes).toBe(0);
  });
});

describe("entry status", () => {
  it("the Time tab shows close-locked entries as draft, then closed", async () => {
    setToday("2026-04-10");
    const w = await world({ billingType: "t_and_m", startDate: undefined });
    const a = await addEntry(w, "2026-03-03", 60, { rate: 100 });
    const { invoiceId } = await commit(w, "2026-03-01");
    const list = () => as(w).query(api.timeEntries.listProjectEntries, { projectId: w.projectId, billingStatus: "draft" });
    expect((await list()).entries.map((r) => [r._id, r.invoiceId])).toEqual([[a, invoiceId]]);
    await as(w).mutation(api.invoices.changeInvoiceStatus, { id: invoiceId!, newStatus: "invoiced" });
    expect((await list()).entries).toEqual([]);
    const closed = await as(w).query(api.timeEntries.listProjectEntries, { projectId: w.projectId, billingStatus: "closed" });
    expect(closed.entries.map((r) => r._id)).toEqual([a]);
  });
});
