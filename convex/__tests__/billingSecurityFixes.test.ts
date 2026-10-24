// @vitest-environment edge-runtime

/**
 * Security and data fixes of the project/billing redesign
 * (docs/prd-project-billing-redesign.md §6.3–§6.8, slice 3) — one named test
 * per audit item: A13, A14 (+ workedIn), A5, A7, A15.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { statusRow, taskRow } from "./helpers/taskFixtures";
import {
  ORG_ID,
  addEntry,
  addProject,
  asAdmin,
  asMember,
  billingWorld,
  commit,
  setInvoiceStatus,
  type BillingProject,
  type BillingWorld,
} from "./helpers/billingWorld";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const setToday = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));

const newWorld = (opts?: { roundingMinutes?: number }) => billingWorld(convexTest(schema, modules), opts);
const retainer = { includedMinutesPerMonth: 600, overageRate: 90 };

/** A task on `p` with a status of `category`, assigned (edge + field) to `assignee`. */
async function addTask(
  w: BillingWorld,
  p: BillingProject,
  opts: { title: string; category?: "backlog" | "started" | "completed"; assignee?: Id<"users">; archived?: boolean },
): Promise<Id<"tasks">> {
  return w.t.run(async (ctx) => {
    const now = Date.now();
    const category = opts.category ?? "backlog";
    const statusId = await ctx.db.insert("statuses", statusRow({
      orgId: ORG_ID, name: category, category, color: "#000", createdAt: now, updatedAt: now, createdBy: w.userId,
    }));
    const assignee = opts.assignee;
    const taskId = await ctx.db.insert("tasks", taskRow({
      orgId: ORG_ID, title: opts.title, statusId, statusCategory: category, projectId: p.projectId,
      assigneeIds: assignee ? [assignee] : [], createdAt: now, updatedAt: now, createdBy: w.userId,
      ...(opts.archived ? { archivedAt: now } : {}),
    }));
    if (assignee) {
      await ctx.db.insert("taskAssignees", { orgId: ORG_ID, taskId, userId: assignee, assignedAt: now, assignedBy: w.userId });
    }
    return taskId;
  });
}

async function addTaskEntry(w: BillingWorld, p: BillingProject, taskId: Id<"tasks">, date: string, minutes: number) {
  return addEntry(w, { ...p, taskId }, date, minutes);
}

describe("A13 — projectOverview and projectMonthlyBreakdown are admin-only", () => {
  it("members are refused; admins read", async () => {
    setToday("2026-04-10");
    const w = await newWorld();
    const p = await addProject(w, { billingType: "t_and_m", startDate: undefined });
    await expect(asMember(w).query(api.timeEntries.projectOverview, { projectId: p.projectId })).rejects.toThrow(
      "Admin access required",
    );
    await expect(asMember(w).query(api.timeEntries.projectMonthlyBreakdown, { projectId: p.projectId })).rejects.toThrow(
      "Admin access required",
    );
    expect(await asAdmin(w).query(api.timeEntries.projectOverview, { projectId: p.projectId })).not.toBeNull();
    expect(await asAdmin(w).query(api.timeEntries.projectMonthlyBreakdown, { projectId: p.projectId })).toEqual([]);
  });
});

describe("A14 — the project task surface is that project's tasks for every role", () => {
  it("a member's assignee plan never leaks another project's tasks", async () => {
    setToday("2026-04-10");
    const w = await newWorld();
    const p = await addProject(w, retainer);
    const q = await addProject(w, retainer);
    const mine = await addTask(w, p, { title: "Mine here", assignee: w.memberId });
    await addTask(w, q, { title: "Mine elsewhere", assignee: w.memberId });
    const rows = (
      await asMember(w).query(api.tasks.queries.listView, { surface: "project", projectId: p.projectId, viewKey: "all" })
    ).rows;
    expect(rows.map((r) => r._id)).toEqual([mine]);
  });
});

describe("§6.3 — workedIn: a period's work on the project surface", () => {
  it("tasks with time in the range (archived and closed too) — no open tasks for a past range", async () => {
    setToday("2026-05-10");
    const w = await newWorld();
    const p = await addProject(w, retainer);
    const worked = await addTask(w, p, { title: "Worked", category: "started" });
    const done = await addTask(w, p, { title: "Done", category: "completed" });
    const archived = await addTask(w, p, { title: "Archived", archived: true });
    await addTask(w, p, { title: "Open, no time" });
    const later = await addTask(w, p, { title: "Worked in May" });
    await addTaskEntry(w, p, worked, "2026-04-02", 30);
    await addTaskEntry(w, p, worked, "2026-04-20", 15);
    await addTaskEntry(w, p, done, "2026-04-03", 60);
    await addTaskEntry(w, p, archived, "2026-04-04", 10);
    await addTaskEntry(w, p, later, "2026-05-02", 10);

    const april = await asAdmin(w).query(api.tasks.queries.listView, {
      surface: "project",
      projectId: p.projectId,
      viewKey: "all",
      workedIn: { from: "2026-04-01", to: "2026-04-30" },
      closedLimit: 0,
    });
    expect(new Set(april.rows.map((r) => r._id))).toEqual(new Set([worked, done, archived]));
    expect(april.workedMinutes).toEqual({ [worked]: 45, [done]: 60, [archived]: 10 });
  });

  it("the current period also lists the project's open tasks without time", async () => {
    setToday("2026-05-10");
    const w = await newWorld();
    const p = await addProject(w, retainer);
    const open = await addTask(w, p, { title: "Open, no time" });
    const worked = await addTask(w, p, { title: "Worked in May" });
    await addTask(w, p, { title: "Done, no time", category: "completed" });
    await addTaskEntry(w, p, worked, "2026-05-02", 10);
    const may = await asAdmin(w).query(api.tasks.queries.listView, {
      surface: "project",
      projectId: p.projectId,
      viewKey: "all",
      workedIn: { from: "2026-05-01", to: "2026-05-31" },
    });
    // The fixture's own "Support" task is open without time too.
    expect(new Set(may.rows.map((r) => r._id))).toEqual(new Set([open, worked, p.taskId]));
  });

  it("is refused outside the project surface", async () => {
    setToday("2026-05-10");
    const w = await newWorld();
    await expect(
      asAdmin(w).query(api.tasks.queries.listView, {
        surface: "tasks",
        viewKey: "all",
        workedIn: { from: "2026-05-01", to: "2026-05-31" },
      }),
    ).rejects.toThrow("only allowed on the project surface");
  });
});

describe("A5 — fixed fee: one draft at a time", () => {
  it("a second Create invoice while a draft exists is refused with DRAFT_EXISTS", async () => {
    setToday("2026-04-10");
    const w = await newWorld();
    const p = await addProject(w, { billingType: "fixed", fixedPrice: 1000, startDate: undefined });
    const { invoiceId } = await asAdmin(w).mutation(api.billingInvoices.createFixedInvoice, { projectId: p.projectId, amount: 300 });
    const second = asAdmin(w).mutation(api.billingInvoices.createFixedInvoice, { projectId: p.projectId });
    await expect(second).rejects.toMatchObject({ data: { code: "DRAFT_EXISTS", invoiceId } });
    // Once finalized, the next installment can be drafted.
    await setInvoiceStatus(w, invoiceId, "invoiced");
    const next = await asAdmin(w).mutation(api.billingInvoices.createFixedInvoice, { projectId: p.projectId });
    expect(next.invoiceId).not.toBe(invoiceId);
  });
});

describe("A7 — retainer cycle settings lock while a period is closed", () => {
  it("start date, cycle length and rollover are refused with a live close; fee, hours and rate are not", async () => {
    setToday("2026-04-10");
    const w = await newWorld();
    const p = await addProject(w, retainer);
    await commit(w, p, "2026-03-01");
    const update = (args: Record<string, unknown>) =>
      asAdmin(w).mutation(api.projects.updateRetainer, { id: p.projectId, confirmed: true, ...args });
    const locked = "Reopen or void the closed periods before changing the billing cycle.";
    await expect(update({ startDate: "2026-02-01" })).rejects.toThrow(locked);
    await expect(update({ cycleLength: 3, rolloverEnabled: true })).rejects.toThrow(locked);
    await update({ monthlyFee: 900, includedMinutesPerMonth: 700, overageRate: 100 });
    // Unchanged values pass (forms send every field).
    await update({ startDate: "2026-03-01", cycleLength: 1, rolloverEnabled: false });
    // After reopening, the grid can move again.
    await asAdmin(w).mutation(api.billingCloses.reopenClose, { projectId: p.projectId, periodStart: "2026-03-01" });
    await update({ startDate: "2026-02-01" });
  });
});

describe("A15 — one definition of billed", () => {
  it("projectOverview billed = draft + final closes = the T&M summary's billed", async () => {
    setToday("2026-05-10");
    const w = await newWorld();
    const p = await addProject(w, { billingType: "t_and_m", startDate: undefined });
    await addEntry(w, p, "2026-03-03", 60, { rate: 100 });
    await addEntry(w, p, "2026-04-03", 30, { rate: 100 });
    await addEntry(w, p, "2026-05-03", 45, { rate: 100 });
    const { invoiceId } = await commit(w, p, "2026-03-01");
    await setInvoiceStatus(w, invoiceId!, "invoiced");
    await commit(w, p, "2026-04-01"); // stays a draft

    const overview = await asAdmin(w).query(api.timeEntries.projectOverview, { projectId: p.projectId });
    expect(overview).toMatchObject({ billedMinutes: 90, billedAmount: 150, openMinutes: 45 });
    // The finance card's per-period billed adds up to the same total (P9).
    const billed = { minutes: 0, amount: 0, unbilledMinutes: 0 };
    for (const period of ["2026-03", "2026-04", "2026-05"]) {
      const summary = await asAdmin(w).query(api.projects.getSummary, { projectId: p.projectId, period });
      if (summary?.billingType !== "t_and_m") throw new Error("expected a T&M summary");
      billed.minutes += summary.billingStatus!.billedMinutes;
      billed.amount += summary.billingStatus!.billedAmount;
      billed.unbilledMinutes += summary.billingStatus!.unbilledMinutes;
    }
    expect(billed).toEqual({ minutes: 90, amount: 150, unbilledMinutes: 45 });
  });
});
