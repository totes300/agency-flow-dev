import { v, ConvexError } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/**
 * Seeds the eight scenarios from
 * `docs/invoicing-refactor-issues/03-cutover-wipe-reseed-verification.md`
 * so the post-refactor `/invoices` Ready feed, Monthly Report renderer, and
 * Monthly Breakdown card can be smoke-tested end-to-end.
 *
 * Run from the repo root (after `migrations/wipeInvoicingForRefactor`):
 *
 *   npx convex run migrations/seedInvoicingScenarios '{}'
 *
 * Idempotent: every client this script creates uses a `SEED:` name prefix
 * and every project a `SEED-` code prefix. Re-running first deletes those
 * records + their tasks + time entries before reseeding, so you can iterate
 * fixtures without growing junk rows.
 *
 * Naming convention — each client + project is named after the scenario it
 * demonstrates so you can identify the test case at a glance in the UI:
 *
 *   SEED-1  client "SEED: Monthly retainer (no rollover)"
 *           project "8h/mo · Apr overage · May in-progress"
 *   SEED-2  client "SEED: 3-month rollover (cycle had overage)"
 *           project "Feb–Apr closed, 30h of 24h budget → cycle Ready row"
 *   SEED-3  client "SEED: 3-month rollover (cycle within budget)"
 *           project "Feb–Apr closed, 18h of 24h budget → no Ready row"
 *   SEED-4  client "SEED: T&M (hourly billing)"
 *           project "Apr: 9h billable + 2h non-billable"
 *   SEED-5  client "SEED: Fixed price project"
 *           project "$5,000 sold · 12h of 40h estimate logged"
 *
 * Sanctioned by memory `project_mvp_dummy_data.md` (dummy data only).
 */

const CLIENT_NAME_PREFIX = "SEED:";
const PROJECT_CODE_PREFIX = "SEED-";
const CURRENCY = "USD";

// Pin the seeder's "today" so the produced fixtures behave the same way
// regardless of when this is invoked. Bump to keep aligned with your real
// "current" month if you re-run later.
//
// Set to 2026-05-06 so the May spreadDays loops in scenarios 1, 2, 3
// (which generate days 1, 3, 5) all survive the `if (d > TODAY) continue`
// filter — the seeded May fixtures match their scenario comments.
const TODAY = "2026-05-06";

export default internalMutation({
  args: {
    // Optional. If omitted and the deployment has exactly one org in
    // `orgSettings`, that org is used. Pass explicitly when multiple orgs
    // exist (the mutation throws with the candidate list).
    orgId: v.optional(v.string()),
    // Optional override — defaults to the first admin orgMember.
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // ── Resolve orgId (auto-detect if only one) ─────────────────────────
    let orgId: string;
    if (args.orgId) {
      orgId = args.orgId;
    } else {
      const allOrgs = await ctx.db.query("orgSettings").collect();
      const uniqueOrgIds = Array.from(new Set(allOrgs.map((s) => s.orgId)));
      if (uniqueOrgIds.length === 0) {
        throw new ConvexError(
          "No org found in orgSettings. Sign into the app once so an org is created.",
        );
      }
      if (uniqueOrgIds.length > 1) {
        throw new ConvexError(
          `Multiple orgs in this deployment — pass {"orgId":"..."} explicitly. Candidates: ${uniqueOrgIds.join(", ")}`,
        );
      }
      orgId = uniqueOrgIds[0];
    }

    // ── Resolve the createdBy user ──────────────────────────────────────
    let userId: Id<"users"> | null = args.userId ?? null;
    if (!userId) {
      const member = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .filter((q) => q.eq(q.field("role"), "admin"))
        .first();
      userId = member?.userId ?? null;
    }
    if (!userId) {
      throw new ConvexError(
        `No admin orgMember found for orgId=${orgId}. Pass {"userId":"..."} explicitly or sign in once so the membership is synced.`,
      );
    }

    // ── Find / create work categories ───────────────────────────────────
    const wantedCategories = [
      { name: "Development", color: "blue" },
      { name: "Design", color: "purple" },
      { name: "PM", color: "amber" },
    ];
    const existingCategories = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const categoryByName = new Map<string, Id<"workCategories">>();
    for (const cat of existingCategories) categoryByName.set(cat.name, cat._id);
    for (let i = 0; i < wantedCategories.length; i++) {
      const wc = wantedCategories[i];
      if (categoryByName.has(wc.name)) continue;
      const id = await ctx.db.insert("workCategories", {
        orgId,
        name: wc.name,
        color: wc.color,
        sortOrder: i,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: userId,
      });
      categoryByName.set(wc.name, id);
    }
    const devCategoryId = categoryByName.get("Development")!;
    const designCategoryId = categoryByName.get("Design")!;

    // ── Find a status to put the tasks under ────────────────────────────
    const status = await ctx.db
      .query("statuses")
      .withIndex("by_orgId_type", (q) =>
        q.eq("orgId", orgId).eq("type", "in_progress"),
      )
      .first();
    if (!status) {
      throw new ConvexError(
        `Org ${orgId} has no statuses seeded. Run onboarding first so the default status set is created.`,
      );
    }

    // ── Idempotent cleanup ──────────────────────────────────────────────
    // Wipe every project whose code starts with `SEED-` (and its tasks +
    // entries + estimates), then every client whose name starts with
    // `SEED:` (or matches the legacy "Seed Co." name from the first
    // seeder pass). Categories are kept — they're shared, useful, and
    // adding/removing them on every run would churn references in any
    // hand-created data.
    const allProjects = await ctx.db
      .query("projects")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    let removedProjects = 0;
    let removedTasks = 0;
    let removedEntries = 0;
    let removedEstimates = 0;
    for (const p of allProjects) {
      if (!p.code.startsWith(PROJECT_CODE_PREFIX)) continue;
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_projectId", (q) =>
          q.eq("orgId", orgId).eq("projectId", p._id),
        )
        .collect();
      for (const t of tasks) {
        const entries = await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", t._id))
          .collect();
        for (const e of entries) {
          await ctx.db.delete(e._id);
          removedEntries++;
        }
        await ctx.db.delete(t._id);
        removedTasks++;
      }
      const estimates = await ctx.db
        .query("projectCategoryEstimates")
        .withIndex("by_projectId", (q) => q.eq("projectId", p._id))
        .collect();
      for (const est of estimates) {
        await ctx.db.delete(est._id);
        removedEstimates++;
      }
      await ctx.db.delete(p._id);
      removedProjects++;
    }
    const allClients = await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    let removedClients = 0;
    for (const c of allClients) {
      if (
        c.name.startsWith(CLIENT_NAME_PREFIX) ||
        c.name === "Seed Co." // legacy from the first seeder pass
      ) {
        // Drop client contacts too so reseeding doesn't leak
        const contacts = await ctx.db
          .query("clientContacts")
          .withIndex("by_clientId", (q) => q.eq("clientId", c._id))
          .collect();
        for (const ct of contacts) await ctx.db.delete(ct._id);
        await ctx.db.delete(c._id);
        removedClients++;
      }
    }

    // ── Helpers ─────────────────────────────────────────────────────────
    const now = Date.now();

    async function createClient(name: string): Promise<Id<"clients">> {
      return await ctx.db.insert("clients", {
        orgId,
        name,
        currency: CURRENCY,
        billingName: name,
        billingEmail: "ap@example.com",
        billingCountry: "US",
        billingCity: "Brooklyn",
        billingZip: "11201",
        billingStreet: "100 Test Street",
        createdAt: now,
        updatedAt: now,
        createdBy: userId!,
      });
    }

    async function createProject(opts: {
      code: string;
      name: string;
      clientId: Id<"clients">;
      billingType: "retainer" | "t_and_m" | "fixed";
      startDate?: string;
      includedMinutesPerMonth?: number;
      monthlyFee?: number;
      overageRate?: number;
      rolloverEnabled?: boolean;
      cycleLength?: number;
      fixedPrice?: number;
    }): Promise<Id<"projects">> {
      return await ctx.db.insert("projects", {
        orgId,
        clientId: opts.clientId,
        name: opts.name,
        code: opts.code,
        billingType: opts.billingType,
        retainerStatus: opts.billingType === "retainer" ? "active" : undefined,
        includedMinutesPerMonth: opts.includedMinutesPerMonth,
        startDate: opts.startDate,
        rolloverEnabled: opts.rolloverEnabled,
        cycleLength: opts.cycleLength,
        monthlyFee: opts.monthlyFee,
        fixedPrice: opts.fixedPrice,
        overageRate: opts.overageRate,
        teamMembers: [userId!],
        createdAt: now,
        updatedAt: now,
        createdBy: userId!,
      });
    }

    async function createTask(opts: {
      projectId: Id<"projects">;
      title: string;
      categoryId: Id<"workCategories">;
      billable: boolean;
    }): Promise<Id<"tasks">> {
      return await ctx.db.insert("tasks", {
        orgId,
        title: opts.title,
        statusId: status!._id,
        statusType: "in_progress",
        projectId: opts.projectId,
        assigneeIds: [userId!],
        workCategoryId: opts.categoryId,
        billable: opts.billable,
        createdAt: now,
        updatedAt: now,
        createdBy: userId!,
      });
    }

    /**
     * `billableRate` follows `convex/lib/orgHelpers.ts:resolveRateSnapshot`:
     *   - retainer projects → 0 (revenue is cycle-level, not per-entry)
     *   - t&m / fixed → the project's effective billable rate
     */
    async function createEntry(opts: {
      taskId: Id<"tasks">;
      categoryId: Id<"workCategories">;
      date: string;
      durationMinutes: number;
      isBillable: boolean;
      billableRate: number;
      hourOfDay?: number;
    }) {
      const hour = opts.hourOfDay ?? 10;
      const startedAt = Date.parse(
        `${opts.date}T${String(hour).padStart(2, "0")}:00:00Z`,
      );
      await ctx.db.insert("timeEntries", {
        orgId,
        taskId: opts.taskId,
        userId: userId!,
        date: opts.date,
        startedAt,
        durationMinutes: opts.durationMinutes,
        isBillable: opts.isBillable,
        method: "manual",
        costRate: 0,
        billableRate: opts.billableRate,
        rateCurrency: CURRENCY,
        snapshotCategoryId: opts.categoryId,
        createdAt: now,
        updatedAt: now,
        createdBy: userId!,
      });
    }

    function spreadDays(year: number, month: number, count: number, startDay = 3) {
      const days: string[] = [];
      for (let i = 0; i < count; i++) {
        const day = startDay + i * 2;
        const lastDay = new Date(year, month, 0).getDate();
        if (day > lastDay) break;
        days.push(
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        );
      }
      return days;
    }

    // ──────────────────────────────────────────────────────────────────
    // Scenario 1 — Monthly retainer, no rollover
    //
    //   8 h/month included @ $100/h overage. Started 2026-03-01.
    //   Mar: 5h logged → within budget closed (no Ready row, report renders)
    //   Apr: 12h logged → 4h overage closed (Ready row, "Generate" button)
    //   May: 3h logged so far → in-progress (badge on report)
    // ──────────────────────────────────────────────────────────────────
    const c1 = await createClient(`${CLIENT_NAME_PREFIX} Monthly retainer (no rollover)`);
    const p1 = await createProject({
      code: "SEED-1",
      name: "8h/mo · Apr overage · May in-progress",
      clientId: c1,
      billingType: "retainer",
      startDate: "2026-03-01",
      includedMinutesPerMonth: 480,
      monthlyFee: 800,
      overageRate: 100,
      rolloverEnabled: false,
      cycleLength: 1,
    });
    const p1TaskDev = await createTask({
      projectId: p1,
      title: "Bugfixes",
      categoryId: devCategoryId,
      billable: true,
    });
    const p1TaskDesign = await createTask({
      projectId: p1,
      title: "UI tweaks",
      categoryId: designCategoryId,
      billable: true,
    });
    for (const d of spreadDays(2026, 3, 5)) {
      await createEntry({
        taskId: p1TaskDev,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: true,
        billableRate: 0,
      });
    }
    for (const d of spreadDays(2026, 4, 8)) {
      await createEntry({
        taskId: p1TaskDev,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: true,
        billableRate: 0,
      });
    }
    for (const d of spreadDays(2026, 4, 4, 5)) {
      await createEntry({
        taskId: p1TaskDesign,
        categoryId: designCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: true,
        billableRate: 0,
      });
    }
    for (const d of spreadDays(2026, 5, 3, 1)) {
      if (d > TODAY) continue;
      await createEntry({
        taskId: p1TaskDev,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: true,
        billableRate: 0,
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Scenario 2 — Rollover retainer, prior cycle CLOSED with OVERAGE
    //
    //   3-month cycle, 8 h/month → 24h cycle budget. Started 2026-02-01.
    //   Cycle 0 (Feb/Mar/Apr): 30h logged → 6h cycle overage → single Ready
    //                          row covering 2026-02-01 → 2026-04-30.
    //   Cycle 1 (May+): 2h logged so far in May → mid-cycle in-progress.
    // ──────────────────────────────────────────────────────────────────
    const c2 = await createClient(
      `${CLIENT_NAME_PREFIX} 3-month rollover (cycle had overage)`,
    );
    const p2 = await createProject({
      code: "SEED-2",
      name: "Feb–Apr closed, 30h of 24h budget → cycle Ready row",
      clientId: c2,
      billingType: "retainer",
      startDate: "2026-02-01",
      includedMinutesPerMonth: 480,
      monthlyFee: 1200,
      overageRate: 120,
      rolloverEnabled: true,
      cycleLength: 3,
    });
    const p2Task = await createTask({
      projectId: p2,
      title: "Cycle work",
      categoryId: devCategoryId,
      billable: true,
    });
    for (const month of [2, 3, 4]) {
      for (const d of spreadDays(2026, month, 10)) {
        await createEntry({
          taskId: p2Task,
          categoryId: devCategoryId,
          date: d,
          durationMinutes: 60,
          isBillable: true,
          billableRate: 0,
        });
      }
    }
    for (const d of spreadDays(2026, 5, 2, 1)) {
      if (d > TODAY) continue;
      await createEntry({
        taskId: p2Task,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: true,
        billableRate: 0,
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Scenario 3 — Rollover retainer, prior cycle CLOSED within budget
    //
    //   Same shape as Scenario 2, but only 18h logged across the cycle
    //   (within 24h budget) → no Ready row. Monthly Report renders for
    //   any of Feb/Mar/Apr. May = mid-cycle so cycle-to-date renders too.
    // ──────────────────────────────────────────────────────────────────
    const c3 = await createClient(
      `${CLIENT_NAME_PREFIX} 3-month rollover (cycle within budget)`,
    );
    const p3 = await createProject({
      code: "SEED-3",
      name: "Feb–Apr closed, 18h of 24h budget → no Ready row",
      clientId: c3,
      billingType: "retainer",
      startDate: "2026-02-01",
      includedMinutesPerMonth: 480,
      monthlyFee: 1200,
      overageRate: 120,
      rolloverEnabled: true,
      cycleLength: 3,
    });
    const p3Task = await createTask({
      projectId: p3,
      title: "Cycle work",
      categoryId: devCategoryId,
      billable: true,
    });
    for (const month of [2, 3, 4]) {
      for (const d of spreadDays(2026, month, 6)) {
        await createEntry({
          taskId: p3Task,
          categoryId: devCategoryId,
          date: d,
          durationMinutes: 60,
          isBillable: true,
          billableRate: 0,
        });
      }
    }
    for (const d of spreadDays(2026, 5, 1, 1)) {
      if (d > TODAY) continue;
      await createEntry({
        taskId: p3Task,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: true,
        billableRate: 0,
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Scenario 4 — T&M (hourly billing)
    //
    //   $150/h on Development. April: 9h billable + 2h non-billable.
    //   Ready row reflects the billable amount; non-billable is excluded.
    // ──────────────────────────────────────────────────────────────────
    const c4 = await createClient(`${CLIENT_NAME_PREFIX} T&M (hourly billing)`);
    const p4 = await createProject({
      code: "SEED-4",
      name: "Apr: 9h billable + 2h non-billable",
      clientId: c4,
      billingType: "t_and_m",
    });
    const p4TaskBill = await createTask({
      projectId: p4,
      title: "Hourly engagement",
      categoryId: devCategoryId,
      billable: true,
    });
    const p4TaskNonBill = await createTask({
      projectId: p4,
      title: "Internal QA (non-billable)",
      categoryId: devCategoryId,
      billable: false,
    });
    for (const d of spreadDays(2026, 4, 6)) {
      await createEntry({
        taskId: p4TaskBill,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 90,
        isBillable: true,
        billableRate: 150,
      });
    }
    for (const d of spreadDays(2026, 4, 2, 5)) {
      await createEntry({
        taskId: p4TaskNonBill,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 60,
        isBillable: false,
        billableRate: 0,
      });
    }

    // ──────────────────────────────────────────────────────────────────
    // Scenario 5 — Fixed price project
    //
    //   $5,000 sold price, 40h estimate on Development.
    //   12h logged so far → Ready row reflects remaining balance.
    // ──────────────────────────────────────────────────────────────────
    const c5 = await createClient(`${CLIENT_NAME_PREFIX} Fixed price project`);
    const p5 = await createProject({
      code: "SEED-5",
      name: "$5,000 sold · 12h of 40h estimate logged",
      clientId: c5,
      billingType: "fixed",
      fixedPrice: 5000,
    });
    await ctx.db.insert("projectCategoryEstimates", {
      orgId,
      projectId: p5,
      workCategoryId: devCategoryId,
      estimatedMinutes: 40 * 60,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const p5Task = await createTask({
      projectId: p5,
      title: "Build the thing",
      categoryId: devCategoryId,
      billable: true,
    });
    for (const d of spreadDays(2026, 4, 8)) {
      await createEntry({
        taskId: p5Task,
        categoryId: devCategoryId,
        date: d,
        durationMinutes: 90,
        isBillable: true,
        billableRate: 125,
      });
    }

    return {
      removed: {
        clients: removedClients,
        projects: removedProjects,
        tasks: removedTasks,
        timeEntries: removedEntries,
        projectCategoryEstimates: removedEstimates,
      },
      created: {
        clients: [
          { code: "SEED-1", clientId: c1, projectId: p1 },
          { code: "SEED-2", clientId: c2, projectId: p2 },
          { code: "SEED-3", clientId: c3, projectId: p3 },
          { code: "SEED-4", clientId: c4, projectId: p4 },
          { code: "SEED-5", clientId: c5, projectId: p5 },
        ],
      },
      hint: "Open /clients to see the five scenario clients, or /invoices for the Ready feed.",
    };
  },
});
