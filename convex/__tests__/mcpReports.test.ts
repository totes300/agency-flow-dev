// @vitest-environment edge-runtime
//
// MCP slice 5 (docs/prd-mcp.md §8, §13, §14 row 5): the `report` kinds
// through convex/mcp/report.ts with OAuth identities.
//   exit       every kind's numbers equal the app's screen / internal query on
//              the same fixture (the "numbers match the app" exit, as a test)
//   roles      members: time_by_member (own time) and missing_time (own tasks),
//              no money; every other kind refuses them
//   money      partitioned by currency, never summed across
//   caps       an over-cap scan refuses with "narrow"; nothing is clipped
//   D25        missing_time correctness; client_monthly raw material incl. the
//              closing comment
//   I3 / I4    foreign refs are not found; a session token cannot call report

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { collectTimesheetDataForAuth } from "../timesheets";
import { flattenMonthlyBreakdown, flattenProjectOverview } from "../../lib/reports/views";
import { taskRow } from "./helpers/taskFixtures";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp5";
const OTHER = "org_mcp5_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;
type Caller = "admin" | "alice" | "bob" | "other";

const SUBJECT: Record<Caller, [string, string, "admin" | "member"]> = {
  admin: ["clerk_admin", ORG, "admin"],
  alice: ["clerk_alice", ORG, "member"],
  bob: ["clerk_bob", ORG, "member"],
  other: ["clerk_other", OTHER, "admin"],
};

/** A Clerk OAuth access token as Convex sees it: client_id + org_id, no role. */
const as = (t: T, caller: Caller) =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: "client_claude", org_id: SUBJECT[caller][1] });

/** An app session token (the UI surface). */
const inApp = (t: T, caller: Caller) =>
  t.withIdentity({
    subject: SUBJECT[caller][0],
    tokenIdentifier: `test|${SUBJECT[caller][0]}`,
    org_id: SUBJECT[caller][1],
    org_role: SUBJECT[caller][2] === "admin" ? "org:admin" : "org:member",
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const at = (iso: string) => Date.parse(iso);
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/**
 * One agency: a T&M project (ARLO, EUR), a retainer (RETA, EUR, March closed
 * over budget), a USD client (BOLT, T&M) and a fixed-fee project (FIXD, USD);
 * time in March–July, invoices in two currencies, and tasks covering every
 * missing_time case. Another org holds a foreign client, project and task.
 */
async function setup(t: T) {
  const ids = await t.run(async (ctx) => {
    const now = at("2026-03-01T08:00:00Z");
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    const statuses: Record<string, Id<"statuses">> = {};
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, brandName: orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        const id = await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
        if (orgId === ORG) statuses[s.name] = id;
      }
    }
    const design = await ctx.db.insert("workCategories", { orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin });
    const dev = await ctx.db.insert("workCategories", { orgId: ORG, name: "Development", color: "green", sortOrder: 1, createdAt: now, updatedAt: now, createdBy: admin });

    const client = (orgId: string, name: string, currency: string, prefix: string, createdBy: Id<"users">) =>
      ctx.db.insert("clients", { orgId, name, currency, prefix, createdAt: now, updatedAt: now, createdBy });
    const arlow = await client(ORG, "Arlow", "EUR", "ARL", admin);
    const bolt = await client(ORG, "Bolt", "USD", "BLT", admin);
    const foreignClient = await client(OTHER, "Foreign", "EUR", "FOR", other);
    const project = (orgId: string, clientId: Id<"clients">, name: string, code: string, extra: Record<string, unknown>, createdBy: Id<"users">) =>
      ctx.db.insert("projects", { orgId, clientId, name, code, createdAt: now, updatedAt: now, createdBy, ...extra } as never);
    const arlo = await project(ORG, arlow, "Arlow site", "ARLO", { billingType: "t_and_m" }, admin);
    const reta = await project(ORG, arlow, "Arlow care", "RETA", {
      billingType: "retainer", includedMinutesPerMonth: 600, overageRate: 90, monthlyFee: 1000, startDate: "2026-03-01",
    }, admin);
    const boltProject = await project(ORG, bolt, "Bolt ads", "BOLT", { billingType: "t_and_m" }, admin);
    const fixd = await project(ORG, bolt, "Bolt spec", "FIXD", { billingType: "fixed", fixedPrice: 5000 }, admin);
    const foreignProject = await project(OTHER, foreignClient, "Foreign site", "FORN", { billingType: "t_and_m" }, other);

    const task = async (
      identifier: string,
      title: string,
      status: string,
      assignees: Id<"users">[],
      extra: Record<string, unknown> = {},
    ) => {
      const s = DEFAULT_STATUS_SEED.find((x) => x.name === status)!;
      const id = await ctx.db.insert("tasks", taskRow({
        orgId: ORG, title, identifier, statusId: statuses[status], statusCategory: s.category, createdBy: admin,
        assigneeIds: assignees, createdAt: now, updatedAt: now, lastActivityAt: now, ...extra,
      } as never));
      for (const userId of assignees) {
        await ctx.db.insert("taskAssignees", { orgId: ORG, taskId: id, userId, assignedAt: now, assignedBy: admin });
      }
      return id;
    };
    const a1 = await task("ARLO-1", "Hero design", "In progress", [alice], { projectId: arlo, clientId: arlow });
    const a2 = await task("ARLO-2", "Landing build", "Done", [bob], { projectId: arlo, clientId: arlow, completedAt: at("2026-06-20T10:00:00Z") });
    const r1 = await task("RETA-1", "Support", "In progress", [alice], { projectId: reta, clientId: arlow });
    const b1 = await task("BOLT-1", "Ads", "In progress", [bob], { projectId: boltProject, clientId: bolt });
    const f1 = await task("FIXD-1", "Spec", "In progress", [admin], { projectId: fixd, clientId: bolt });
    // missing_time cases (June 2026)
    const june = (day: string) => at(`2026-06-${day}T10:00:00Z`);
    const m = {
      doneNoTime: await task("ARLO-10", "Done no time", "Done", [alice], { projectId: arlo, clientId: arlow, completedAt: june("15") }),
      doneWithTime: await task("ARLO-11", "Done with time", "Done", [alice], { projectId: arlo, clientId: arlow, completedAt: june("16") }),
      doneInMay: await task("ARLO-12", "Done in May", "Done", [alice], { projectId: arlo, clientId: arlow, completedAt: at("2026-05-30T10:00:00Z") }),
      reviewJune: await task("ARLO-13", "In client review", "Client review", [bob], { projectId: arlo, clientId: arlow }),
      reviewMay: await task("ARLO-14", "Review since May", "Admin review", [bob], { projectId: arlo, clientId: arlow }),
      canceled: await task("ARLO-15", "Canceled", "Canceled", [alice], { projectId: arlo, clientId: arlow, completedAt: june("10") }),
      subtask: await task("ARLO-16", "Checklist item", "Done", [alice], { projectId: arlo, clientId: arlow, completedAt: june("12"), parentTaskId: a1 }),
      archived: await task("ARLO-17", "Archived done", "Done", [alice], { projectId: arlo, clientId: arlow, completedAt: june("12"), archivedAt: june("13") }),
      lead: await task("KONV-1", "Lead without project", "Done", [alice], { completedAt: june("12") }),
      boltDone: await task("BOLT-10", "Bolt done", "Done", [bob], { projectId: boltProject, clientId: bolt, completedAt: june("05") }),
      reviewCreatedJune: await task("ARLO-18", "Review created in June", "Admin review", [alice], { projectId: arlo, clientId: arlow, createdAt: june("03") }),
      inProgress: await task("ARLO-19", "Still in progress", "In progress", [alice], { projectId: arlo, clientId: arlow }),
    };
    const statusChange = (taskId: Id<"tasks">, to: string, createdAt: number) =>
      ctx.db.insert("activityLog", {
        orgId: ORG, taskId, userId: admin, type: "status_changed", createdAt,
        metadata: { from: "In progress", to, toId: statuses[to], toCategory: "started" },
      });
    await statusChange(m.reviewJune, "Client review", june("25"));
    await statusChange(m.reviewMay, "Admin review", at("2026-05-10T10:00:00Z"));

    const entry = async (
      projectId: Id<"projects">,
      taskId: Id<"tasks">,
      userId: Id<"users">,
      date: string,
      durationMinutes: number,
      o: { billable?: boolean; rate?: number; cost?: number; currency?: string; note?: string; category?: Id<"workCategories">; orgId?: string } = {},
    ) =>
      ctx.db.insert("timeEntries", {
        orgId: o.orgId ?? ORG, projectId, taskId, userId, date, startedAt: at(`${date}T09:00:00Z`), durationMinutes,
        isBillable: o.billable ?? true, method: "manual", costRate: o.cost ?? 40, billableRate: o.rate ?? 0,
        rateCurrency: o.currency ?? "EUR", note: o.note, snapshotCategoryId: o.category,
        createdAt: now, updatedAt: now, createdBy: userId,
      });
    await entry(arlo, a1, alice, "2026-06-02", 90, { rate: 120, note: "Hero sketches", category: design });
    await entry(arlo, a1, alice, "2026-06-10", 60, { billable: false, note: "Internal sync", category: design });
    await entry(arlo, a1, admin, "2026-06-11", 45, { rate: 100, note: "  Review pass  ", category: dev });
    await entry(arlo, a2, bob, "2026-06-05", 120, { rate: 100, note: "Build", category: dev });
    await entry(arlo, a2, bob, "2026-07-02", 30, { rate: 100, category: dev });
    await entry(arlo, m.doneWithTime, alice, "2026-06-14", 15, { rate: 120, category: design });
    await entry(reta, r1, alice, "2026-03-04", 400, { category: design });
    await entry(reta, r1, alice, "2026-03-18", 255, { category: design });
    await entry(reta, r1, alice, "2026-04-10", 300, { category: dev });
    await entry(reta, r1, alice, "2026-06-08", 200, { note: "June support", category: dev });
    await entry(boltProject, b1, bob, "2026-06-03", 60, { rate: 80, currency: "USD", category: dev });
    await entry(boltProject, b1, bob, "2026-06-20", 30, { rate: 80, currency: "USD", billable: false, category: dev });
    await entry(fixd, f1, admin, "2026-06-07", 60, { currency: "USD", category: design });
    const foreignTask = await ctx.db.insert("tasks", taskRow({
      orgId: OTHER, title: "Foreign task", identifier: "FORN-1", statusId: (await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", OTHER)).first())!._id,
      createdBy: other, projectId: foreignProject,
    }));
    await entry(foreignProject, foreignTask, other, "2026-06-04", 999, { rate: 100, orgId: OTHER });

    await ctx.db.insert("comments", { taskId: a1, orgId: ORG, userId: alice, content: doc("First look"), createdAt: june("02"), updatedAt: june("02") });
    await ctx.db.insert("comments", { taskId: a1, orgId: ORG, userId: admin, content: doc("Shipped to client, waiting for feedback"), createdAt: june("28"), updatedAt: june("28") });

    const invoice = (projectId: Id<"projects">, clientId: Id<"clients">, status: "draft" | "invoiced" | "paid" | "void", currency: string, totalMinor: number, extra: Record<string, unknown>) =>
      ctx.db.insert("invoices", {
        orgId: ORG, projectId, clientId, prefix: "INV-", status, currency, subtotalMinor: totalMinor, totalMinor,
        issueDate: "2026-06-30", createdAt: now, updatedAt: now, createdBy: admin, ...extra,
      } as never);
    await invoice(arlo, arlow, "paid", "EUR", 50_000, { number: 1, paidAt: at("2026-07-02T10:00:00Z"), dueDate: "2026-07-15" });
    await invoice(boltProject, bolt, "invoiced", "USD", 30_000, { number: 2, dueDate: "2026-07-01" });
    await invoice(boltProject, bolt, "draft", "USD", 10_000, {});
    await invoice(arlo, arlow, "void", "EUR", 99_900, { number: 3 });

    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    return {
      admin, alice, bob, arlow, bolt, foreignClient, arlo, reta, boltProject, fixd, foreignProject,
      a1, design, dev, m, adminAuth,
    };
  });
  // March on the retainer is over budget: close it the app's way (draft invoice).
  await inApp(t, "admin").mutation(api.billingCloses.commitClose, { projectId: ids.reta, periodStart: "2026-03-01" });
  return ids;
}

const report = {
  timesheet: (t: T, c: Caller, a: { client: string; from: string; to: string; project?: string }) => as(t, c).query(api.mcp.report.timesheet, a),
  timeByMember: (t: T, c: Caller, a: { from: string; to: string; member?: string }) => as(t, c).query(api.mcp.report.timeByMember, a),
  clientMonthly: (t: T, c: Caller, a: { client: string; fromMonth: string; toMonth: string }) => as(t, c).query(api.mcp.report.clientMonthly, a),
  missingTime: (t: T, c: Caller, a: { from: string; to: string; client?: string; project?: string; member?: string }) =>
    as(t, c).query(api.mcp.report.missingTime, a),
};

const JUNE = { from: "2026-06-01", to: "2026-06-30" };

/** `row` without `key` (MCP adds a field, or the app returns one MCP leaves out). */
const without = (row: object, key: string) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== key));

describe("numbers match the app (§14 row 5 exit)", () => {
  it("timesheet = the worksheet collector per project, totals included", async () => {
    const t = createT();
    const s = await setup(t);
    const mcp = await report.timesheet(t, "admin", { client: "client:ARL", ...JUNE });
    const rows = [];
    for (const projectId of [s.arlo, s.reta]) {
      const ws = await inApp(t, "admin").query(internal.worksheetsHelpers.collectWorksheetData, {
        scope: { kind: "period", projectId, periodStart: JUNE.from, periodEnd: JUNE.to },
      });
      rows.push(...ws.rows);
    }
    const shape = (r: { title: string; minutes?: number; totalMinutes?: number; billableMinutes: number; nonBillableMinutes: number; firstWorked: string; lastWorked: string; entryCount: number }) => [
      r.title, r.minutes ?? r.totalMinutes, r.billableMinutes, r.nonBillableMinutes, r.firstWorked, r.lastWorked, r.entryCount,
    ];
    const sortByTitle = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    expect(mcp.rows.map(shape).sort(sortByTitle)).toEqual(rows.map(shape).sort(sortByTitle));
    expect(mcp.totals.minutes).toBe(rows.reduce((n, r) => n + r.totalMinutes, 0));
    expect(mcp.totals.minutes).toBe(90 + 60 + 45 + 120 + 15 + 200);
    // The internal timesheet collector (the pivot's input) agrees too.
    const collected = await inApp(t, "admin").query(internal.timesheets.collectTimesheetData, {
      clientId: s.arlow, periodStart: JUNE.from, periodEnd: JUNE.to,
    });
    expect(collected.rows.reduce((n, r) => n + r.totalMinutes, 0)).toBe(mcp.totals.minutes);
    // The pivot's columns: a task worked in two categories is its own column, as in the worksheet.
    expect(mcp.categories).toEqual([
      { name: "Design", minutes: 15 },
      { name: "Development", minutes: 320 },
      { name: "Design, Development", minutes: 195 },
    ]);
    expect(mcp.rows.find((r) => r.title === "Hero design")).toMatchObject({ identifier: "ARLO-1", project: "ARLO", category: "Design, Development" });
  });

  it("time_by_member = the internal query and the Workday grid", async () => {
    const t = createT();
    await setup(t);
    const mcp = await report.timeByMember(t, "admin", JUNE);
    const app = await inApp(t, "admin").query(internal.reports.timeByMember, { fromDate: JUNE.from, toDate: JUNE.to, allMembers: true });
    expect(mcp.scope).toBe("team");
    expect(mcp.totals).toEqual(app.totals);
    expect(mcp.members.map((m) => [m.name, m.minutes, m.billableMinutes, m.nonBillableMinutes, m.entryCount])).toEqual(
      app.members.map((m) => [m.userName, m.minutes, m.billableMinutes, m.nonBillableMinutes, m.entryCount]),
    );
    const week = { startDate: "2026-06-01", endDate: "2026-06-07" };
    const grid = await inApp(t, "admin").query(api.workday.weekGrid, week);
    const weekly = await report.timeByMember(t, "admin", { from: week.startDate, to: week.endDate });
    for (const row of grid.users) {
      expect(weekly.members.find((m) => m.name === row.user.name)?.minutes).toBe(row.totalMinutes);
    }
    expect(weekly.members.find((m) => m.name === "Alice")?.email).toBe("clerk_alice@x.test");
  });

  it("client_monthly = the internal query; per-task minutes add up to it", async () => {
    const t = createT();
    const s = await setup(t);
    const mcp = await report.clientMonthly(t, "admin", { client: "client:ARL", fromMonth: "2026-03", toMonth: "2026-06" });
    const app = await inApp(t, "admin").query(internal.reports.clientMonthlySummary, { clientId: s.arlow, fromMonth: "2026-03", toMonth: "2026-06" });
    expect(mcp.totals).toEqual(app.totals);
    expect(mcp.months).toEqual(app.months.map((m) => without(m, "byProject")));
    expect(mcp.tasks.reduce((n, task) => n + task.minutes, 0)).toBe(app.totals.minutes);
  });

  it("project_overview and project_monthly = the project page's queries", async () => {
    const t = createT();
    const s = await setup(t);
    const names = new Map<string, string>([[s.design, "Design"], [s.dev, "Development"]]);
    for (const [code, projectId] of [["ARLO", s.arlo], ["RETA", s.reta], ["FIXD", s.fixd]] as const) {
      const overview = await as(t, "admin").query(api.mcp.report.projectOverview, { project: code });
      const app = await inApp(t, "admin").query(api.timeEntries.projectOverview, { projectId });
      expect(overview.summary).toEqual(flattenProjectOverview(app!, names));
      const monthly = await as(t, "admin").query(api.mcp.report.projectMonthly, { project: code });
      const appMonths = await inApp(t, "admin").query(api.timeEntries.projectMonthlyBreakdown, { projectId });
      expect(monthly.months).toEqual(flattenMonthlyBreakdown(appMonths, true));
    }
    const arlo = await as(t, "admin").query(api.mcp.report.projectOverview, { project: "ARLO" });
    expect(arlo).toMatchObject({ currency: "EUR", project: { code: "ARLO", billingType: "t_and_m" } });
    expect(arlo.summary.totalMinutes).toBe(90 + 60 + 45 + 120 + 30 + 15);
  });

  it("retainer_statement = the statement page; retainer_health = the internal sweep", async () => {
    const t = createT();
    const s = await setup(t);
    const mcp = await as(t, "admin").query(api.mcp.report.retainerStatement, { project: "RETA", month: "2026-03" });
    const app = (await inApp(t, "admin").query(api.billingReports.getMonthlyReport, { projectId: s.reta, year: 2026, month: 3 }))!;
    expect(mcp.statement).toMatchObject({
      usedMinutes: app.balance.usedMinutes,
      includedMinutes: app.balance.includedMinutes,
      endBalanceMinutes: app.balance.endBalanceMinutes,
      overageMinutes: app.balance.overageMinutes,
      overageAmount: app.billing.overageAmount,
      currency: "EUR",
    });
    expect(mcp.statement.usedMinutes).toBe(655);
    expect(mcp.statement.overageAmount).toBeGreaterThan(0);
    expect(mcp.usage.total).toEqual(app.retainerUsage.total);
    expect(mcp.statement.linkedInvoice?.status).toBe("draft");

    for (const month of [3, 6]) {
      const health = await as(t, "admin").query(api.mcp.report.retainerHealth, { month: `2026-0${month}` });
      const sweep = await inApp(t, "admin").query(internal.reports.retainerHealthForMonth, { year: 2026, month });
      expect(health.rows.map((r) => without(r, "projectCode"))).toEqual(sweep.rows);
      expect(health.summary).toEqual(sweep.summary);
      expect(health.rows[0].projectCode).toBe("RETA");
    }
  });

  it("close_queue = the internal close queue; invoice_metrics = the internal invoice metrics", async () => {
    const t = createT();
    await setup(t);
    const mcp = await as(t, "admin").query(api.mcp.report.closeQueue, {});
    const app = await inApp(t, "admin").query(internal.billingViews.getCloseQueue, {});
    expect(mcp.actionableCount).toBe(app.actionableCount);
    expect(mcp.months.map((m) => [m.monthKey, m.openCount, m.closedCount, m.totalCount])).toEqual(
      app.months.map((m) => [m.monthKey, m.openCount, m.closedCount, m.totalCount]),
    );
    const rows = (data: { months: Array<{ rows: Array<{ projectName: string; periodToken: string; amount: number; currency: string; loggedMinutes: number; isCloseRow: boolean }> }> }) =>
      data.months.flatMap((m) => m.rows.map((r) => [r.projectName, r.periodToken, r.amount, r.currency, r.loggedMinutes, r.isCloseRow]));
    expect(rows(mcp)).toEqual(rows(app));
    expect(mcp.months.map((m) => Object.fromEntries(m.totalsByCurrency.map((x) => [x.currency, x.amount])))).toEqual(
      app.months.map((m) => m.totalsByCurrency),
    );

    const metrics = await as(t, "admin").query(api.mcp.report.invoiceMetrics, {});
    const appMetrics = await inApp(t, "admin").query(internal.invoices.getInvoiceMetrics, {});
    for (const bucket of ["draft", "unpaid", "pastDue", "paidThisMonth", "outstanding"] as const) {
      const row = metrics.buckets.find((b) => b.bucket === bucket)!;
      expect(row.count).toBe(appMetrics[bucket].count);
      expect(Object.fromEntries(row.totals.map((x) => [x.currency, x.total]))).toEqual(appMetrics[bucket].currencySums);
    }
  });

  it("org_finance = the internal snapshot, exactly", async () => {
    const t = createT();
    await setup(t);
    const mcp = await as(t, "admin").query(api.mcp.report.orgFinance, JUNE);
    const app = await inApp(t, "admin").query(internal.reports.orgFinanceSnapshot, { fromDate: JUNE.from, toDate: JUNE.to });
    expect(mcp).toEqual(app);
  });
});

describe("money per currency", () => {
  it("never adds EUR and USD", async () => {
    const t = createT();
    await setup(t);
    const finance = await as(t, "admin").query(api.mcp.report.orgFinance, JUNE);
    expect(finance.billableValueByCurrency).toEqual([
      { currency: "EUR", amount: 180 + 75 + 200 + 30 },
      { currency: "USD", amount: 80 },
    ]);
    expect(finance.invoicing.map((r) => [r.currency, r.invoicedTotal, r.draftTotal])).toEqual([
      ["EUR", 500, 0],
      ["USD", 300, 100],
    ]);
    const metrics = await as(t, "admin").query(api.mcp.report.invoiceMetrics, {});
    expect(metrics.buckets.find((b) => b.bucket === "outstanding")?.totals).toEqual([{ currency: "USD", total: 300 }]);
    expect(metrics.buckets.find((b) => b.bucket === "draft")?.totals).toEqual([
      { currency: "EUR", total: expect.any(Number) },
      { currency: "USD", total: 100 },
    ]);
  });
});

describe("member scope and money stripping (as in the app)", () => {
  it("time_by_member: a member gets exactly their own time, no money", async () => {
    const t = createT();
    await setup(t);
    const own = await report.timeByMember(t, "alice", JUNE);
    const app = await inApp(t, "alice").query(internal.reports.timeByMember, { fromDate: JUNE.from, toDate: JUNE.to, allMembers: true });
    expect(own.scope).toBe("self");
    expect(own.members.map((m) => [m.name, m.minutes])).toEqual([["Alice", 90 + 60 + 15 + 200]]);
    expect(own.totals).toEqual(app.totals);
    expect(await report.timeByMember(t, "alice", { ...JUNE, member: "me" })).toEqual(own);
    await expect(report.timeByMember(t, "alice", { ...JUNE, member: "clerk_bob@x.test" })).rejects.toThrow(/only report their own time/);
    expect(JSON.stringify(own)).not.toMatch(/amount|rate|cost|value/i);
  });

  it("every admin kind refuses a member and names what they can run", async () => {
    const t = createT();
    await setup(t);
    const calls = [
      () => report.timesheet(t, "alice", { client: "client:ARL", ...JUNE }),
      () => report.clientMonthly(t, "alice", { client: "client:ARL", fromMonth: "2026-06", toMonth: "2026-06" }),
      () => as(t, "alice").query(api.mcp.report.projectOverview, { project: "ARLO" }),
      () => as(t, "alice").query(api.mcp.report.projectMonthly, { project: "ARLO" }),
      () => as(t, "alice").query(api.mcp.report.retainerStatement, { project: "RETA", month: "2026-03" }),
      () => as(t, "alice").query(api.mcp.report.retainerHealth, { month: "2026-06" }),
      () => as(t, "alice").query(api.mcp.report.closeQueue, {}),
      () => as(t, "alice").query(api.mcp.report.invoiceMetrics, {}),
      () => as(t, "alice").query(api.mcp.report.orgFinance, JUNE),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(/admin-only, as in the app\. Members can run time_by_member .* and missing_time/);
    }
  });

  it("missing_time: a member sees only tasks assigned to them", async () => {
    const t = createT();
    await setup(t);
    const own = await report.missingTime(t, "alice", JUNE);
    expect(own.scope).toBe("self");
    expect(own.rows.map((r) => r.identifier)).toEqual(["ARLO-18", "ARLO-10"]);
    await expect(report.missingTime(t, "alice", { ...JUNE, member: "clerk_bob@x.test" })).rejects.toThrow(/only their own tasks/);
    expect(JSON.stringify(own)).not.toMatch(/amount|rate|cost/i);
  });
});

describe("missing_time (D25)", () => {
  it("lists Done and entered-Review tasks of the period without time, nothing else", async () => {
    const t = createT();
    await setup(t);
    const all = await report.missingTime(t, "admin", JUNE);
    expect(all.reviewStatuses).toEqual(["Admin review", "Client review"]);
    expect(all.rows.map((r) => [r.identifier, r.kind, r.date, r.status, r.project])).toEqual([
      ["ARLO-18", "review", "2026-06-03", "Admin review", "ARLO"],
      ["BOLT-10", "done", "2026-06-05", "Done", "BOLT"],
      ["ARLO-10", "done", "2026-06-15", "Done", "ARLO"],
      ["ARLO-13", "review", "2026-06-25", "Client review", "ARLO"],
    ]);
    expect(all.rows.find((r) => r.identifier === "ARLO-13")).toMatchObject({ client: "Arlow", assignees: ["Bob"] });
    // Filters narrow the same set.
    expect((await report.missingTime(t, "admin", { ...JUNE, client: "client:BLT" })).rows.map((r) => r.identifier)).toEqual(["BOLT-10"]);
    expect((await report.missingTime(t, "admin", { ...JUNE, project: "ARLO", member: "clerk_bob@x.test" })).rows.map((r) => r.identifier)).toEqual(["ARLO-13"]);
    // May: the task completed then, and the review entered then.
    expect((await report.missingTime(t, "admin", { from: "2026-05-01", to: "2026-05-31" })).rows.map((r) => r.identifier)).toEqual([
      "ARLO-14",
      "ARLO-12",
    ]);
    await expect(report.missingTime(t, "admin", { ...JUNE, client: "client:ARL", project: "ARLO" })).rejects.toThrow(/either client or project/);
  });

  it("refuses rather than clips past its review-task cap", async () => {
    const t = createT();
    const s = await setup(t);
    await t.run(async (ctx) => {
      const review = (await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect()).find((x) => x.name === "Admin review")!;
      for (let i = 0; i < 500; i += 1) {
        await ctx.db.insert("tasks", taskRow({ orgId: ORG, title: `Bulk ${i}`, statusId: review._id, statusCategory: "started", createdBy: s.admin, projectId: s.arlo }));
      }
    });
    await expect(report.missingTime(t, "admin", JUNE)).rejects.toThrow(/More than 500 tasks are in a review status.*per member/);
    // One person's edges are read instead, so it still works per member.
    expect((await report.missingTime(t, "alice", JUNE)).rows).toHaveLength(2);
    expect((await report.missingTime(t, "admin", { ...JUNE, member: "clerk_alice@x.test" })).rows.map((r) => r.identifier)).toEqual([
      "ARLO-18",
      "ARLO-10",
    ]);
  });
});

describe("client_monthly raw material (D25)", () => {
  it("gives each task its status, link key, minutes, notes and closing comment", async () => {
    const t = createT();
    await setup(t);
    const data = await report.clientMonthly(t, "admin", { client: "client:ARL", fromMonth: "2026-06", toMonth: "2026-06" });
    expect(data.client).toMatchObject({ name: "Arlow", prefix: "ARL", currency: "EUR" });
    const hero = data.tasks.find((task) => task.identifier === "ARLO-1")!;
    expect(hero).toMatchObject({
      title: "Hero design",
      status: "In progress",
      statusCategory: "started",
      project: "ARLO",
      minutes: 195,
      billableMinutes: 135,
      nonBillableMinutes: 60,
      entryCount: 3,
      notes: [
        { date: "2026-06-02", minutes: 90, note: "Hero sketches" },
        { date: "2026-06-10", minutes: 60, note: "Internal sync" },
        { date: "2026-06-11", minutes: 45, note: "Review pass" },
      ],
      closingComment: { author: "Admin", text: "Shipped to client, waiting for feedback", truncated: false },
    });
    expect(data.tasks.find((task) => task.identifier === "ARLO-2")).toMatchObject({ status: "Done", minutes: 120, closingComment: null });
    expect(data.tasks.map((task) => task.identifier)).toEqual(["RETA-1", "ARLO-1", "ARLO-2", "ARLO-11"]);
  });
});

describe("caps, validation and tenancy", () => {
  it("timesheet refuses an over-cap scope before reading tasks, and over-long ranges", async () => {
    const t = createT();
    const s = await setup(t);
    await expect(
      t.run(async (ctx) =>
        await collectTimesheetDataForAuth(
          ctx,
          s.adminAuth,
          { clientId: s.arlow, periodStart: JUNE.from, periodEnd: JUNE.to },
          { aiInput: false, caps: { entries: 1000, tasks: 1, message: "Narrow the period" } },
        ),
      ),
    ).rejects.toThrow(/Narrow the period/);
    await expect(report.timesheet(t, "admin", { client: "client:ARL", from: "2025-01-01", to: "2026-06-30" })).rejects.toThrow(/at most 366 days/);
    await expect(report.timesheet(t, "admin", { client: "client:ARL", ...JUNE, project: "BOLT" })).rejects.toThrow(/BOLT is not a project of client:ARL/);
    await expect(as(t, "admin").query(api.mcp.report.retainerStatement, { project: "ARLO", month: "2026-06" })).rejects.toThrow(/not a retainer project/);
    await expect(as(t, "admin").query(api.mcp.report.retainerStatement, { project: "RETA", month: "2026-08" })).rejects.toThrow(/has not started yet/);
    await expect(report.clientMonthly(t, "admin", { client: "client:ARL", fromMonth: "2026-6", toMonth: "2026-06" })).rejects.toThrow(/YYYY-MM/);
  });

  it("another org's client, project and data are not found and never counted (I3)", async () => {
    const t = createT();
    const s = await setup(t);
    await expect(report.timesheet(t, "admin", { client: s.foreignClient, ...JUNE })).rejects.toThrow(/not found/);
    await expect(report.timesheet(t, "admin", { client: "client:FOR", ...JUNE })).rejects.toThrow(/not found/);
    await expect(as(t, "admin").query(api.mcp.report.projectOverview, { project: "FORN" })).rejects.toThrow(/not found/);
    await expect(as(t, "admin").query(api.mcp.report.projectOverview, { project: s.foreignProject })).rejects.toThrow(/not found/);
    const team = await report.timeByMember(t, "admin", JUNE);
    expect(team.members.map((m) => m.name).sort()).toEqual(["Admin", "Alice", "Bob"]);
    expect(team.totals.minutes).toBe(330 + 200 + 90 + 60); // ARLO + RETA + BOLT + FIXD; the foreign 999 is not counted
  });

  it("a session token cannot run reports (I4)", async () => {
    const t = createT();
    await setup(t);
    await expect(inApp(t, "admin").query(api.mcp.report.timeByMember, JUNE)).rejects.toThrow(/OAuth access token/);
  });
});
