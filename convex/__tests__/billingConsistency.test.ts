// @vitest-environment edge-runtime
//
// convex-test loads convex/**/*.ts via Vite's import.meta.glob, which needs the
// edge-runtime VM (see invoiceTransitions.test.ts for the full note).

/**
 * Billing consistency suite — docs/prd-billing-refactor.md §11, slice 0.
 *
 * Invariant N11: for identical data, every surface that shows money for a
 * period must agree: the Close queue row, the Close workspace, the generated
 * draft, the finalized invoice and the client report. Each engine has its own
 * unit tests; this suite is the only place that checks them AGAINST EACH
 * OTHER, through the public API, the way the UI calls them.
 *
 * The second half pins the verified defects B1–B7 from the PRD. B1 and B2 were
 * fixed in slice 0; B3–B7 by the close-model rebuild (slice 3). Every surface
 * here is the close-model API the UI calls since the cutover.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { scopeOf, type ScopeEntry, type ScopeProject } from "../lib/billing/scope";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_billing";
const ADMIN = {
  subject: "user_admin",
  tokenIdentifier: "test|user_admin",
  org_id: ORG_ID,
  org_role: "org:admin",
} as never;

type T = ReturnType<typeof convexTest>;

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** Pin "today" — every period rule depends on it. Only `Date` is faked. */
function setToday(ymd: string) {
  vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

type Org = { userId: Id<"users">; statusId: Id<"statuses">; clientId: Id<"clients"> };

async function seedOrg(t: T, opts: { roundingMinutes?: number } = {}): Promise<Org> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Admin",
      externalId: "user_admin",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID,
      clerkUserId: "user_admin",
      userId,
      role: "admin",
      joinedAt: now,
    });
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID,
      defaultCurrency: "EUR",
      timezone: "UTC",
      roundingMinutes: opts.roundingMinutes ?? 1,
      brandName: "Test Agency",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID,
      name: "Todo",
      type: "backlog",
      color: "#000",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Acme",
      currency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    return { userId, statusId, clientId };
  });
}

async function seedRetainer(
  t: T,
  org: Org,
  opts: { startDate: string; includedMinutesPerMonth: number; overageRate: number },
): Promise<Id<"projects">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId: org.clientId,
      name: "Retainer Co",
      code: "PRJ-R",
      billingType: "retainer",
      retainerStatus: "active",
      startDate: opts.startDate,
      includedMinutesPerMonth: opts.includedMinutesPerMonth,
      overageRate: opts.overageRate,
      monthlyFee: 500,
      rolloverEnabled: false,
      cycleLength: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: org.userId,
    });
  });
}

async function seedTm(t: T, org: Org): Promise<Id<"projects">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId: org.clientId,
      name: "Hourly Co",
      code: "PRJ-T",
      billingType: "t_and_m",
      createdAt: now,
      updatedAt: now,
      createdBy: org.userId,
    });
  });
}

async function seedTask(
  t: T,
  org: Org,
  projectId: Id<"projects">,
  title: string,
): Promise<Id<"tasks">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("tasks", {
      orgId: ORG_ID,
      title,
      statusId: org.statusId,
      statusType: "backlog",
      projectId,
      assigneeIds: [org.userId],
      billable: true,
      createdAt: now,
      updatedAt: now,
      createdBy: org.userId,
    });
  });
}

/** Inserts an OPEN entry directly (as `timeEntries.create` would, minus guards). */
async function seedEntry(
  t: T,
  org: Org,
  e: { taskId: Id<"tasks">; date: string; minutes: number; rate?: number; billable?: boolean },
): Promise<Id<"timeEntries">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const task = await ctx.db.get(e.taskId);
    if (!task?.projectId) throw new Error("Fixture task has no project");
    return ctx.db.insert("timeEntries", {
      orgId: ORG_ID,
      projectId: task.projectId,
      taskId: e.taskId,
      userId: org.userId,
      date: e.date,
      startedAt: Date.parse(`${e.date}T09:00:00Z`),
      durationMinutes: e.minutes,
      isBillable: e.billable ?? true,
      method: "manual",
      costRate: 0,
      billableRate: e.rate ?? 0,
      rateCurrency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: org.userId,
    });
  });
}

// ─── Surface readers (exactly what the UI calls) ────────────────────────────

async function queueRow(t: T, projectId: Id<"projects">, monthKey: string) {
  const queue = await t.withIdentity(ADMIN).query(api.billingViews.getCloseQueue, {});
  return queue.months
    .flatMap((m) => m.rows)
    .find((r) => r.projectId === projectId && r.periodToken === monthKey);
}

async function workspace(t: T, projectId: Id<"projects">, monthKey: string) {
  return t
    .withIdentity(ADMIN)
    .query(api.billingViews.getCloseWorkspace, { projectId, period: monthKey });
}

/** The invoice as the editor sees it (display amounts derived from minor units). */
async function invoiceDoc(t: T, invoiceId: Id<"invoices">) {
  const detail = await t
    .withIdentity(ADMIN)
    .query(api.invoices.getInvoice, { identifier: invoiceId });
  return detail?.invoice ?? null;
}

async function finalize(t: T, invoiceId: Id<"invoices">) {
  await t
    .withIdentity(ADMIN)
    .mutation(api.invoices.changeInvoiceStatus, { id: invoiceId, newStatus: "invoiced" });
}

async function report(t: T, projectId: Id<"projects">, year: number, month: number) {
  return t
    .withIdentity(ADMIN)
    .query(api.billingReports.getMonthlyReport, { projectId, year, month });
}

/** The one way a period becomes a draft / close (the Close workspace's commit). */
async function commit(t: T, projectId: Id<"projects">, periodStart: string) {
  return t.withIdentity(ADMIN).mutation(api.billingCloses.commitClose, { projectId, periodStart });
}

// ─── N11: one number per period, on every surface ──────────────────────────

describe("billing consistency (N11) — queue = workspace = draft = invoice = report", () => {
  it("monthly retainer over budget", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedRetainer(t, org, {
      startDate: "2026-03-01",
      includedMinutesPerMonth: 600, // 10h
      overageRate: 90,
    });
    const task = await seedTask(t, org, projectId, "Support");
    await seedEntry(t, org, { taskId: task, date: "2026-03-04", minutes: 400 });
    await seedEntry(t, org, { taskId: task, date: "2026-03-18", minutes: 255 });
    await seedEntry(t, org, { taskId: task, date: "2026-03-20", minutes: 120, billable: false });
    // 655 billable − 600 included = 55 min over × 90/h = 82.50

    const row = await queueRow(t, projectId, "2026-03");
    const ws = await workspace(t, projectId, "2026-03");
    expect(row?.amount).toBe(82.5);
    expect(ws?.amount).toBe(82.5);
    expect(ws?.usageMinutes).toBe(655);

    const { invoiceId } = await commit(t, projectId, "2026-03-01");
    expect((await invoiceDoc(t, invoiceId!))?.total).toBe(82.5);

    await finalize(t, invoiceId!);
    expect((await invoiceDoc(t, invoiceId!))?.total).toBe(82.5);

    const stmt = await report(t, projectId, 2026, 3);
    expect(stmt?.billing.overageAmount).toBe(82.5);
    expect(stmt?.balance.usedMinutes).toBe(655);
  });

  it("monthly retainer within budget — Close & report", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedRetainer(t, org, {
      startDate: "2026-03-01",
      includedMinutesPerMonth: 600,
      overageRate: 90,
    });
    const task = await seedTask(t, org, projectId, "Support");
    await seedEntry(t, org, { taskId: task, date: "2026-03-04", minutes: 300 });

    const row = await queueRow(t, projectId, "2026-03");
    const ws = await workspace(t, projectId, "2026-03");
    expect(row?.isCloseRow).toBe(true);
    expect(row?.amount).toBe(0);
    expect(ws?.withinBudget).toBe(true);
    expect(ws?.usageMinutes).toBe(300);

    expect((await commit(t, projectId, "2026-03-01")).invoiceId).toBeNull();

    expect(await queueRow(t, projectId, "2026-03")).toBeUndefined();
    const stmt = await report(t, projectId, 2026, 3);
    expect(stmt?.billing.overageAmount).toBe(0);
    expect(stmt?.balance.usedMinutes).toBe(300);
  });

  it("T&M month with line rounding", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t, { roundingMinutes: 15 });
    const projectId = await seedTm(t, org);
    const design = await seedTask(t, org, projectId, "Design");
    const build = await seedTask(t, org, projectId, "Build");
    await seedEntry(t, org, { taskId: design, date: "2026-03-03", minutes: 20, rate: 100 });
    await seedEntry(t, org, { taskId: build, date: "2026-03-09", minutes: 50, rate: 90 });
    // Design 20 → 30 min × 100 = 50.00; Build 50 → 60 min × 90 = 90.00

    const row = await queueRow(t, projectId, "2026-03");
    const ws = await workspace(t, projectId, "2026-03");
    expect(row?.amount).toBe(140);
    expect(ws?.amount).toBe(140);

    const { invoiceId } = await commit(t, projectId, "2026-03-01");
    expect((await invoiceDoc(t, invoiceId!))?.total).toBe(140);

    await finalize(t, invoiceId!);
    expect((await invoiceDoc(t, invoiceId!))?.total).toBe(140);
  });
});

// ─── B1–B7 regressions (docs/prd-billing-refactor.md §1.1) ─────────────────

describe("B1 — retainer overage priced from minutes on every surface", () => {
  it("7 min over at 100/h is 11.67 in the queue, the workspace and the draft", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedRetainer(t, org, {
      startDate: "2026-03-01",
      includedMinutesPerMonth: 60,
      overageRate: 100,
    });
    const task = await seedTask(t, org, projectId, "Support");
    await seedEntry(t, org, { taskId: task, date: "2026-03-10", minutes: 67 });

    expect((await queueRow(t, projectId, "2026-03"))?.amount).toBe(11.67);
    expect((await workspace(t, projectId, "2026-03"))?.amount).toBe(11.67);

    const { invoiceId } = await commit(t, projectId, "2026-03-01");
    expect((await invoiceDoc(t, invoiceId!))?.total).toBe(11.67); // was 12.00
  });
});

describe("B3 — time logged after the draft belongs to the next close", () => {
  it("a retainer draft finalizes even if its month got new time after creation", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedRetainer(t, org, {
      startDate: "2026-03-01",
      includedMinutesPerMonth: 60,
      overageRate: 100,
    });
    const task = await seedTask(t, org, projectId, "Support");
    await seedEntry(t, org, { taskId: task, date: "2026-03-10", minutes: 120 });
    const { invoiceId } = await commit(t, projectId, "2026-03-01");

    const late = await seedEntry(t, org, { taskId: task, date: "2026-03-20", minutes: 30 });

    await finalize(t, invoiceId!);
    const invoice = await invoiceDoc(t, invoiceId!);
    expect(invoice?.status).toBe("invoiced");
    expect(invoice?.total).toBe(100); // the draft's snapshot, unchanged
    const lateEntry = await t.run(async (ctx) => ctx.db.get(late));
    expect(lateEntry?.closeId).toBeUndefined(); // still open → next close
  });
});

describe("B4 — a closed month's report never changes", () => {
  it("a skipped entry on the next month's draft counts on that month, not on the closed origin month", async () => {
    setToday("2026-05-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedRetainer(t, org, {
      startDate: "2026-03-01",
      includedMinutesPerMonth: 60,
      overageRate: 100,
    });
    const task = await seedTask(t, org, projectId, "Support");
    const skipped = await seedEntry(t, org, { taskId: task, date: "2026-03-12", minutes: 30 });

    // Skip it out of March, close March (zero usage), bill April with it.
    await t.withIdentity(ADMIN).mutation(api.billingCloses.skipEntries, { entryIds: [skipped] });
    await commit(t, projectId, "2026-03-01");
    await seedEntry(t, org, { taskId: task, date: "2026-04-08", minutes: 45 });
    await commit(t, projectId, "2026-04-01");

    const march = await report(t, projectId, 2026, 3);
    const april = await report(t, projectId, 2026, 4);
    // Reports aggregate per task, so membership is asserted through minutes.
    expect(march?.balance.usedMinutes).toBe(0);
    expect(april?.balance.usedMinutes).toBe(75); // 45 + the carried 30
    expect(april?.billing.overageAmount).toBe(25); // what the April draft bills
  });
});

describe("B5 — draft amounts come from minutes, never from 2-decimal hours", () => {
  it("a 20-minute T&M line at 100/h is 33.33, and its amount cannot be hand-edited", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedTm(t, org);
    const task = await seedTask(t, org, projectId, "Build");
    await seedEntry(t, org, { taskId: task, date: "2026-03-09", minutes: 20, rate: 100 });
    const { invoiceId } = await commit(t, projectId, "2026-03-01");
    expect((await invoiceDoc(t, invoiceId!))?.total).toBe(33.33);

    const line = await t.run(async (ctx) =>
      ctx.db
        .query("invoiceLineItems")
        .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId!))
        .first(),
    );
    await expect(
      t.withIdentity(ADMIN).mutation(api.billingInvoices.updateManualLine, { lineId: line!._id, unitPrice: 90 }),
    ).rejects.toThrow(/Only manual lines/);
  });
});

describe("B6 — a numbered invoice is never deleted", () => {
  it("a finalized-then-reverted draft cannot be deleted (gapless series)", async () => {
    setToday("2026-04-10");
    const t = convexTest(schema, modules);
    const org = await seedOrg(t);
    const projectId = await seedTm(t, org);
    const task = await seedTask(t, org, projectId, "Build");
    await seedEntry(t, org, { taskId: task, date: "2026-03-09", minutes: 60, rate: 100 });
    const { invoiceId } = await commit(t, projectId, "2026-03-01");
    await finalize(t, invoiceId!);
    await t
      .withIdentity(ADMIN)
      .mutation(api.invoices.changeInvoiceStatus, { id: invoiceId!, newStatus: "draft" });
    expect((await invoiceDoc(t, invoiceId!))?.number).toBe(1);

    await expect(
      t.withIdentity(ADMIN).mutation(api.invoices.deleteInvoice, { id: invoiceId! }),
    ).rejects.toThrow(/gap in the series/);
  });
});

describe("B7 — an open entry never resolves into a closed period", () => {
  it("a May-dated open entry lands in June, not in the closed May", () => {
    // March re-opened while April and May stay closed.
    const project: ScopeProject = { billingType: "retainer", startDate: "2026-03-01" };
    const late: ScopeEntry = {
      _id: "e1" as Id<"timeEntries">,
      date: "2026-05-15",
      isBillable: true,
      locked: false,
    };
    const liveCloses = [
      { start: "2026-04-01", end: "2026-04-30" },
      { start: "2026-05-01", end: "2026-05-31" },
    ];
    const june = { start: "2026-06-01", end: "2026-06-30" };
    expect(scopeOf({ project, entries: [late], liveCloses, period: june })).toEqual([
      { entry: late, carried: "logged-late" },
    ]);
  });
});
