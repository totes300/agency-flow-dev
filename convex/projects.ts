import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, mutation, type QueryCtx } from "./_generated/server";
import {
  getAuthContext,
  requireAdmin,
  validateStringLength,
  type AuthContext,
} from "./lib/auth";
import { billingTypeValidator, retainerStatusValidator } from "./lib/validators";
import { generateNextProjectCode, ensureUniqueProjectCode, normalizeProjectCode } from "./lib/helpers";
import { rewriteProjectIdentifiers } from "./tasks/write";
import { validateAssignees } from "./lib/task_helpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { getOrgSettings, getProjectCurrency } from "./lib/orgHelpers";
import { fixedBilledMinor } from "./lib/billing/invoiceLifecycle";
import { fromMinor, toMinor } from "./lib/billing/money";
import { loadCloseContext } from "./lib/billing/closeData";
import { getCyclePeriods } from "./lib/billing/periods";
import { monthBalances, type MonthBalance } from "./lib/billing/periodView";
import { loadReportMonths } from "./lib/billing/reportMonths";
import { autoSaveTimersForTasks } from "./lib/timerEntry";
import type {
  ResolvedProjectListItem,
  ResolvedProjectDetail,
} from "./lib/types";
import {
  computeTmSummary,
  computeFixedSummary,
  computeRetainerSummary,
  resolveDateRange,
  type EntryInput,
  type InvoiceInput,
  type LineItemInput,
  type DateRange,
  type DateRangePreset,
  type RetainerCycleContext,
  type ProjectSummary,
} from "./lib/projectSummary";
import { getProjectEntries } from "./lib/projectEntries";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── Queries ────────────────────────────────────────────────────────────────────

/** Args of `projects.list` (shared with the agent actor path). */
export type ListProjectsArgs = {
  includeArchived?: boolean;
  clientId?: Id<"clients">;
  billingType?: Doc<"projects">["billingType"];
};

/**
 * Shared core of `list` — also run by the agent actor path
 * (`convex/agentActorTools.ts`) with a DB-derived AuthContext, so both entry
 * points execute the same code and checks.
 */
export async function listProjectsForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: ListProjectsArgs,
): Promise<ResolvedProjectListItem[]> {
  const { orgId } = auth;

  const [allProjects, clients] = await Promise.all([
    ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
  ]);
  let projects = allProjects;

  if (!args.includeArchived) {
    projects = projects.filter((p) => !p.archivedAt);
  }
  if (args.clientId) {
    projects = projects.filter((p) => p.clientId === args.clientId);
  }
  if (args.billingType) {
    projects = projects.filter((p) => p.billingType === args.billingType);
  }
  const clientMap = new Map(clients.map((c) => [c._id.toString(), {
    name: c.name,
    prefix: c.prefix,
    usePrefix: c.usePrefix,
    currency: c.currency,
  }]));

  return projects.map((p) => {
    const client = clientMap.get(p.clientId.toString());
    return {
      ...p,
      clientName: client?.name ?? "Unknown",
      clientPrefix: client?.prefix ?? "",
      clientUsePrefix: client?.usePrefix,
      // Resolved currency — single source of truth is client.currency.
      // See D1 invariant in convex/schema.ts above `timeEntries`.
      currency: client?.currency ?? "USD",
    };
  });
}

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    clientId: v.optional(v.id("clients")),
    billingType: v.optional(billingTypeValidator),
  },
  // Explicit return annotation: forces every field of ResolvedProjectListItem
  // to be assembled below. Any new project-fetching query that forgets to
  // resolve `currency` from the client will fail type-checking instead of
  // silently shipping `undefined` to 14+ downstream consumers.
  handler: async (ctx, args): Promise<ResolvedProjectListItem[]> => {
    return await listProjectsForAuth(ctx, await getAuthContext(ctx), args);
  },
});

export const get = query({
  args: { id: v.id("projects") },
  // See `list` for the rationale behind the explicit return annotation.
  handler: async (ctx, args): Promise<ResolvedProjectDetail | null> => {
    const { orgId } = await getAuthContext(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) return null;

    const client = await ctx.db.get(project.clientId);
    return {
      ...project,
      clientName: client?.name ?? "Unknown",
      // Resolved currency — single source of truth is client.currency.
      currency: client?.currency ?? "USD",
    };
  },
});

export const nextCode = query({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await getAuthContext(ctx);
    return await generateNextProjectCode(ctx, orgId);
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    billingType: billingTypeValidator,
    code: v.optional(v.string()),
    // Fixed fields
    fixedPrice: v.optional(v.number()),
    // Fixed-only optional scope estimate. When provided, seeds
    // projectCategoryEstimates with these values instead of zeros.
    categoryEstimates: v.optional(
      v.array(
        v.object({
          workCategoryId: v.id("workCategories"),
          estimatedMinutes: v.number(),
        }),
      ),
    ),
    // Retainer fields
    includedMinutesPerMonth: v.optional(v.number()),
    monthlyFee: v.optional(v.number()),
    startDate: v.optional(v.string()),
    cycleLength: v.optional(v.number()),
    rolloverEnabled: v.optional(v.boolean()),
    overageRate: v.optional(v.number()),
    // Team members
    teamMembers: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const name = args.name.trim();
    if (!name) throw new ConvexError("Project name is required");
    validateStringLength(name, 100, "Project name");

    // Validate client exists and belongs to org — currency is derived from client
    // at read time, not stored on the project (see D1 invariant in schema.ts).
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");

    // Validate team members belong to org
    if (args.teamMembers && args.teamMembers.length > 0) {
      await validateAssignees(ctx, orgId, args.teamMembers);
    }

    // Fixed validation
    if (args.billingType === "fixed") {
      if (args.fixedPrice === undefined || args.fixedPrice <= 0) {
        throw new ConvexError("Fixed fee is required and must be greater than zero");
      }
      // Per-row guard: the per-category upsert mutation rejects negatives
      // (projectCategoryEstimates.ts:46). The create path must match that
      // invariant — a bad client shouldn't be able to seed negative estimates.
      if (args.categoryEstimates) {
        for (const est of args.categoryEstimates) {
          if (est.estimatedMinutes < 0) {
            throw new ConvexError("Estimated minutes cannot be negative");
          }
        }
      }
    }

    // Retainer validation
    if (args.billingType === "retainer") {
      if (!args.includedMinutesPerMonth || args.includedMinutesPerMonth <= 0) {
        throw new ConvexError("Monthly hours is required for retainer projects");
      }
      if (!args.startDate || !DATE_REGEX.test(args.startDate)) {
        throw new ConvexError("Start date is required (YYYY-MM-DD)");
      }
      const [y, m, d] = args.startDate.split("-").map(Number);
      const testDate = new Date(y, m - 1, d);
      if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
        throw new ConvexError("Invalid date");
      }
      const cycleLen = args.cycleLength ?? 1;
      if (cycleLen < 1 || cycleLen > 12 || !Number.isInteger(cycleLen)) {
        throw new ConvexError("Cycle length must be 1-12 months");
      }
      if (args.monthlyFee !== undefined && args.monthlyFee < 0) {
        throw new ConvexError("Monthly fee cannot be negative");
      }
      if (args.overageRate === undefined || args.overageRate <= 0) {
        throw new ConvexError("Overage rate is required for retainer projects and must be greater than zero");
      }
    }

    // The code is the task identifier key (D2): validate a user-entered one,
    // else suggest one from the client prefix / client or project name.
    const userCode = args.code?.trim();
    let code: string;
    if (userCode) {
      code = normalizeProjectCode(userCode);
      await ensureUniqueProjectCode(ctx, orgId, code);
    } else {
      code = await generateNextProjectCode(ctx, orgId, {
        clientPrefix: client.prefix,
        clientName: client.name,
        projectName: name,
      });
    }

    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      orgId,
      clientId: args.clientId,
      name,
      code,
      billingType: args.billingType,
      // Currency is derived from client.currency — not stored on project.
      // Fixed fields
      ...(args.billingType === "fixed" ? {
        fixedPrice: args.fixedPrice,
      } : {}),
      // Retainer fields
      ...(args.billingType === "retainer" ? {
        retainerStatus: "active" as const,
        includedMinutesPerMonth: args.includedMinutesPerMonth,
        monthlyFee: args.monthlyFee,
        overageRate: args.overageRate,
        startDate: args.startDate,
        rolloverEnabled: (args.cycleLength ?? 1) >= 2 ? (args.rolloverEnabled ?? true) : false,
        cycleLength: args.cycleLength ?? 1,
      } : {}),
      // Team members
      ...(args.teamMembers && args.teamMembers.length > 0 ? { teamMembers: args.teamMembers } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    // Seed category estimate rows for Fixed projects.
    // If args.categoryEstimates was provided (via the creation modal's scope
    // step), use those values; otherwise default every active category to 0
    // minutes so the Budget tab has a row to edit.
    if (args.billingType === "fixed") {
      const categories = await ctx.db
        .query("workCategories")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      const activeCategories = categories.filter((c) => !c.archivedAt);
      const providedMap = new Map(
        (args.categoryEstimates ?? []).map((e) => [
          e.workCategoryId.toString(),
          e.estimatedMinutes,
        ]),
      );
      for (const cat of activeCategories) {
        const minutes = providedMap.get(cat._id.toString()) ?? 0;
        await ctx.db.insert("projectCategoryEstimates", {
          orgId,
          projectId,
          workCategoryId: cat._id,
          estimatedMinutes: minutes,
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
        });
      }
    }

    // No auto-seeding of projectRateOverrides — the resolution chain
    // falls back to categoryRates when no project override exists.
    // Overrides are only created when a user explicitly sets a different rate.

    return projectId;
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    fixedPrice: v.optional(v.number()),
    defaultAssignees: v.optional(v.array(v.object({
      workCategoryId: v.id("workCategories"),
      userId: v.id("users"),
    }))),
    teamMembers: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError("Project name is required");
      validateStringLength(name, 100, "Project name");
      updates.name = name;
    }

    let codeRename: string | undefined;
    // Re-sending the unchanged code (even a legacy "PRJ-042") is a no-op.
    if (args.code !== undefined && args.code.trim() !== project.code) {
      const code = normalizeProjectCode(args.code);
      if (code !== project.code) {
        await ensureUniqueProjectCode(ctx, orgId, code, args.id.toString());
        updates.code = code;
        codeRename = code;
      }
    }

    if (args.teamMembers !== undefined) {
      if (args.teamMembers.length > 0) {
        await validateAssignees(ctx, orgId, args.teamMembers);
      }
      updates.teamMembers = args.teamMembers;
    }

    if (args.defaultAssignees !== undefined) {
      const effectiveTeam = (updates.teamMembers ?? project.teamMembers) as string[] | undefined;
      const teamSet = new Set((effectiveTeam ?? []).map((id) => String(id)));
      for (const da of args.defaultAssignees) {
        if (!teamSet.has(da.userId.toString())) {
          throw new ConvexError("Default assignee must be a project team member");
        }
      }
      updates.defaultAssignees = args.defaultAssignees;
    }

    if (args.fixedPrice !== undefined) {
      if (project.billingType !== "fixed") {
        throw new ConvexError("Fixed fee can only be set on fixed projects");
      }
      if (args.fixedPrice <= 0) {
        throw new ConvexError("Fixed fee must be greater than zero");
      }
      // Never below what's already been invoiced — the next generate would
      // otherwise emit a negative fixed line / negative-total invoice.
      const currency = await getProjectCurrency(ctx, project);
      const billedMinor = await fixedBilledMinor(ctx, orgId, args.id);
      if (toMinor(args.fixedPrice, currency) < billedMinor) {
        throw new ConvexError(
          `Fixed fee cannot be lower than the amount already invoiced (${fromMinor(billedMinor, currency)}). Void the affected invoices first.`,
        );
      }
      updates.fixedPrice = args.fixedPrice;
    }

    await ctx.db.patch(args.id, updates);
    // §11.1: a code rename rewrites every identifier in the project; the old
    // ones become aliases (write path, T5).
    if (codeRename) await rewriteProjectIdentifiers(ctx, userId, project, codeRename);
  },
});

export const archive = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    // Running timers on this project's tasks: auto-save the measured time as
    // entries instead of wiping it (identical rescue to tasks.archive — the
    // 2026-07-05 hardening). Returned so the caller's toast can report whose
    // time was saved / left running.
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", args.id))
      .collect();
    const projectTaskIds = new Set(projectTasks.map((t) => t._id.toString()));

    const timerRescue = await autoSaveTimersForTasks(ctx, {
      orgId,
      actorUserId: userId,
      taskIds: projectTaskIds,
      noteLabel: "Auto-saved when the project was archived",
    });

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });

    return { autoSavedTimers: timerRescue.saved, timerSaveFailures: timerRescue.failed };
  },
});

export const restore = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    await ctx.db.patch(args.id, { archivedAt: undefined, updatedAt: Date.now() });
    // Restore does NOT cascade — tasks stay archived
  },
});

export const updateRetainer = mutation({
  args: {
    id: v.id("projects"),
    includedMinutesPerMonth: v.optional(v.number()),
    monthlyFee: v.optional(v.number()),
    startDate: v.optional(v.string()),
    cycleLength: v.optional(v.number()),
    rolloverEnabled: v.optional(v.boolean()),
    overageRate: v.optional(v.number()),
    retainerStatus: v.optional(retainerStatusValidator),
    confirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");
    if (project.billingType !== "retainer") throw new ConvexError("Not a retainer project");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    // Check if any config-changing fields are being modified (require confirmation)
    const needsConfirmation =
      (args.includedMinutesPerMonth !== undefined && args.includedMinutesPerMonth !== project.includedMinutesPerMonth) ||
      (args.monthlyFee !== undefined && args.monthlyFee !== project.monthlyFee) ||
      (args.cycleLength !== undefined && args.cycleLength !== project.cycleLength) ||
      (args.rolloverEnabled !== undefined && args.rolloverEnabled !== project.rolloverEnabled) ||
      (args.startDate !== undefined && args.startDate !== project.startDate) ||
      (args.overageRate !== undefined && args.overageRate !== project.overageRate);

    if (needsConfirmation && !args.confirmed) {
      throw new ConvexError("CONFIRMATION_REQUIRED");
    }

    if (args.includedMinutesPerMonth !== undefined) {
      if (args.includedMinutesPerMonth <= 0) throw new ConvexError("Monthly hours must be greater than 0");
      updates.includedMinutesPerMonth = args.includedMinutesPerMonth;
    }

    if (args.monthlyFee !== undefined) {
      if (args.monthlyFee < 0) throw new ConvexError("Monthly fee cannot be negative");
      updates.monthlyFee = args.monthlyFee;
    }

    if (args.startDate !== undefined) {
      if (!DATE_REGEX.test(args.startDate)) throw new ConvexError("Invalid date format");
      const [y, m, d] = args.startDate.split("-").map(Number);
      const testDate = new Date(y, m - 1, d);
      if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
        throw new ConvexError("Invalid date");
      }
      updates.startDate = args.startDate;
    }

    if (args.cycleLength !== undefined) {
      if (args.cycleLength < 1 || args.cycleLength > 12 || !Number.isInteger(args.cycleLength)) {
        throw new ConvexError("Cycle length must be 1-12 months");
      }
      updates.cycleLength = args.cycleLength;
    }

    if (args.rolloverEnabled !== undefined) {
      updates.rolloverEnabled = args.rolloverEnabled;
    }

    // Same rule `create` enforces: rollover is only meaningful across a
    // multi-month cycle. Without this, a settings edit could produce a
    // "1-month rollover" hybrid — monthly billing forced through the
    // cycle-close flow, with degenerate "Apr–Apr cycle" labels everywhere.
    {
      const effectiveCycleLength =
        (updates.cycleLength as number | undefined) ?? project.cycleLength ?? 1;
      if (effectiveCycleLength < 2) {
        updates.rolloverEnabled = false;
      }
    }

    if (args.overageRate !== undefined) {
      if (args.overageRate <= 0) throw new ConvexError("Overage rate must be greater than 0");
      updates.overageRate = args.overageRate;
    }

    if (args.retainerStatus !== undefined) {
      updates.retainerStatus = args.retainerStatus;
    }

    await ctx.db.patch(args.id, updates);
  },
});

// ─── Retainer Data Query (balance computation) ─────────────────────────────────

export const getRetainerData = query({
  args: {
    id: v.id("projects"),
    cycleOffset: v.optional(v.number()), // 0 = current, -1 = previous, etc.
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const [project, orgSettings] = await Promise.all([
      ctx.db.get(args.id),
      ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).first(),
    ]);

    if (!project || project.orgId !== orgId) return null;
    if (project.billingType !== "retainer") return null;

    const {
      includedMinutesPerMonth = 0,
      monthlyFee = 0,
      startDate,
      // Defaults mirror `projects.create` (cycleLength 1 → monthly, no
      // rollover) so a doc missing these fields reads the same everywhere.
      rolloverEnabled = false,
      cycleLength = 1,
    } = project;

    // Get currency from client
    const client = await ctx.db.get(project.clientId);
    const currency = client?.currency ?? "USD";

    if (!startDate) return null;
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;

    // Compute today in org timezone (same helper used by timer & time entries)
    const todayStr = getDateInTimezone(Date.now(), timezone);

    // Resolve the navigated cycle's months (`lib/billing/periods`). Whether a
    // month is closed comes from the close model below, never from here.
    //
    // Local `startDate`/`endDate` keys on `months[]` are kept (instead of the
    // helper's `periodStart`/`periodEnd`) so the downstream `monthlyData`
    // shape stays byte-compatible with existing consumers.
    const cycle = getCyclePeriods({
      startDate,
      cycleLength,
      todayStr,
      cycleOffset: args.cycleOffset,
    });
    if (!cycle) return null;
    const targetCycleIndex = cycle.cycleIndex;
    const currentCycleIndex = cycle.currentCycleIndex;
    const months = cycle.periods.map((p) => ({
      year: p.year,
      month: p.month,
      label: p.label,
      startDate: p.periodStart,
      endDate: p.periodEnd,
    }));
    const cycleStartStr = cycle.cycleStart;
    const cycleEndStr = cycle.cycleEnd;
    const isCycleClosed = cycle.isCycleClosed;
    const isCurrentCycle = cycle.isCurrentCycle;

    // Fetch all tasks for the project (including archived — historical reporting)
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.id),
      )
      .collect();

    const taskById = new Map(tasks.map((t) => [t._id.toString(), t]));
    const allEntries = (await getProjectEntries(ctx, orgId, args.id)).flatMap((e) => {
      const task = taskById.get(e.taskId.toString());
      if (!task) return [];
      return [{ ...e, taskTitle: task.title, workCategoryId: e.snapshotCategoryId }];
    });

    // Split billable and non-billable
    const billableEntries = allEntries.filter((e) => e.isBillable);
    const nonBillableEntries = allEntries.filter((e) => !e.isBillable);

    // Group by REPORT month (billing refactor N8): the close's frozen bucket
    // for closed work, the effective-period bucket for open work — so a
    // skipped or late entry counts on the month its close bills it, exactly
    // like the monthly report.
    const closeContext = await loadCloseContext(ctx, orgId, args.id);
    const reportMonths = await loadReportMonths(ctx, closeContext);
    const reportMonthOf = (e: { _id: Id<"timeEntries">; date: string }) =>
      reportMonths.get(e._id) ?? e.date.slice(0, 7);

    const billableByMonth: Record<string, typeof billableEntries> = {};
    for (const e of billableEntries) {
      (billableByMonth[reportMonthOf(e)] ??= []).push(e);
    }
    const nonBillableByMonth: Record<string, typeof nonBillableEntries> = {};
    for (const e of nonBillableEntries) {
      (nonBillableByMonth[reportMonthOf(e)] ??= []).push(e);
    }

    // Fetch work categories for enrichment
    const categories = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const catMap = new Map(categories.map((c) => [c._id.toString(), c]));

    // Close state per month: the live close covering it (isClosed /
    // closedAt), and its invoice anchored on the close's last month — the
    // row that carries the period's action (a cycle bills on its last month).
    const closeOfMonth = (start: string, end: string) =>
      closeContext.liveCloses.find((c) => c.periodStart <= start && c.periodEnd >= end);
    const invoiceByMonthKey = new Map<string, Doc<"invoices">>();
    for (const close of closeContext.liveCloses) {
      if (!close.invoiceId) continue;
      const inv = await ctx.db.get(close.invoiceId);
      if (inv && inv.orgId === orgId && inv.status !== "void") {
        invoiceByMonthKey.set(close.periodEnd.slice(0, 7), inv);
      }
    }

    // Compute balances (sequential — each month depends on the previous)
    type CategoryGroupTask = {
      taskId: string;
      taskTitle: string;
      totalMinutes: number;
      firstDate: string;
      lastDate: string;
      entryCount: number;
    };
    type CategoryGroup = {
      workCategoryId: string | null;
      categoryName: string;
      categoryColor: string;
      totalMinutes: number;
      tasks: CategoryGroupTask[];
    };
    type MonthInvoice = {
      id: Doc<"invoices">["_id"];
      /** Undefined while the linked invoice is an unnumbered draft. */
      number: number | undefined;
      prefix: string;
      status: Doc<"invoices">["status"];
    };
    type MonthData = typeof months[number] & {
      workedMinutes: number;
      startBalance: number;
      available: number;
      endBalance: number;
      /** Overage of this row (negative end balance) and its price, from the ladder. */
      overageMinutes: number;
      overageAmount: number;
      totalNonBillableMinutes: number;
      // Calendar truth: the month's last day has already passed in the org's
      // timezone. Drives financial due-ness (overage, "due" balanceStatus)
      // and the overage-bill gate. Independent of admin action.
      periodEnded: boolean;
      // Admin-settlement truth: someone clicked "Close period" on this
      // month (or on the cycle containing it). Drives the lock guard on
      // entry edits and the row's primary action. Independent of calendar.
      isClosed: boolean;
      closedAt: number | undefined; // ms timestamp when admin clicked Close
      /** The live close covering the month (its worksheet export). */
      closeId: Doc<"billingCloses">["_id"] | null;
      balanceStatus: "due" | "deficit" | "rollover" | "unused" | "on_track";
      cyclePosition: number;
      billableCategoryGroups: CategoryGroup[];
      nonBillableCategoryGroups: CategoryGroup[];
      entryCount: number;
      taskCount: number;
      categoryCount: number;
      invoice: MonthInvoice | null;
    };
    const monthlyData: MonthData[] = [];
    const balances = await monthBalances(
      ctx,
      closeContext,
      months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`),
      { todayStr, roundingMinutes: 1 },
    );

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const monthKey = `${m.year}-${String(m.month).padStart(2, "0")}`;
      const monthBillable = billableByMonth[monthKey] ?? [];
      const monthNonBillable = nonBillableByMonth[monthKey] ?? [];
      const totalNonBillableMinutes = monthNonBillable.reduce((s, e) => s + e.durationMinutes, 0);
      // `periodEnded` is calendar-only; `isClosed`/`closedAt` carry the live
      // close's state. `balanceStatus` keys on the calendar too (the period
      // has ended) — financial due-ness is not an admin question.
      const periodEnded = m.endDate < todayStr;
      const close = closeOfMonth(m.startDate, m.endDate);
      const closedAt = close?.committedAt;
      const isClosed = close !== undefined;

      // The month's balance-ladder row (§8.3) from the period that settles it.
      const balance = balances.get(monthKey);
      const row = balance?.row;
      const startBalance = row?.startBalanceMinutes ?? 0;
      const available = row?.availableMinutes ?? 0;
      const endBalance = row?.balanceMinutes ?? 0;
      // The month settles its period's balance when it is the period's last
      // month and the period has ended (a cycle settles on its closing month).
      const settles =
        balance !== undefined && balance.row.isLast && balance.view.period.end < todayStr;
      const multiMonthPeriod = (balance?.view.price.monthlyBalances.length ?? 1) > 1;

      // Badge status
      let balanceStatus: MonthData["balanceStatus"];
      if (endBalance < 0) {
        balanceStatus = settles ? "due" : "deficit";
      } else if (endBalance > 0) {
        balanceStatus = settles ? "unused" : multiMonthPeriod ? "rollover" : "on_track";
      } else {
        balanceStatus = "on_track";
      }

      // Build category groups for this month
      const billableCategoryGroups = buildRetainerCategoryGroups(monthBillable, catMap);
      const nonBillableCategoryGroups = buildRetainerCategoryGroups(monthNonBillable, catMap);

      // Count unique tasks and categories
      const allMonthEntries = [...monthBillable, ...monthNonBillable];
      const uniqueTaskIds = new Set(allMonthEntries.map((e) => e.taskId.toString()));
      const uniqueCatIds = new Set(
        allMonthEntries.map((e) => e.workCategoryId?.toString() ?? "uncategorized"),
      );

      const monthInvoice = invoiceByMonthKey.get(monthKey);
      monthlyData.push({
        ...m,
        workedMinutes: row?.usedMinutes ?? 0,
        startBalance,
        available,
        endBalance,
        overageMinutes: row?.overageMinutes ?? 0,
        overageAmount: fromMinor(row?.overageAmountMinor ?? 0, currency),
        totalNonBillableMinutes,
        periodEnded,
        isClosed,
        closedAt,
        closeId: close?._id ?? null,
        balanceStatus,
        cyclePosition: i + 1,
        billableCategoryGroups,
        nonBillableCategoryGroups,
        entryCount: allMonthEntries.length,
        taskCount: uniqueTaskIds.size,
        categoryCount: uniqueCatIds.size,
        invoice: monthInvoice
          ? {
              id: monthInvoice._id,
              number: monthInvoice.number,
              prefix: monthInvoice.prefix,
              status: monthInvoice.status,
            }
          : null,
      });
    }

    // Cycle totals — read off the ladder. Each period in view contributes the
    // balance of its last month shown (one period for a rollover cycle, one
    // per month otherwise).
    const shownRows = [...balances.values()]; // month order
    const cycleBudget = shownRows.reduce((sum, b) => sum + b.row.includedMinutes, 0);
    const cycleWorked = shownRows.reduce((sum, b) => sum + b.row.usedMinutes, 0);
    const lastShownByPeriod = new Map<string, MonthBalance>();
    for (const b of shownRows) lastShownByPeriod.set(b.view.period.start, b);
    const cycleBalance = [...lastShownByPeriod.values()].reduce(
      (sum, b) => sum + b.row.balanceMinutes,
      0,
    );
    const utilization = cycleBudget > 0 ? (cycleWorked / cycleBudget) * 100 : 0;

    // Overage calculation. "Due" means STILL owed: an ended period with
    // overage whose closing month carries no non-void invoice. Each period's
    // overage is its close price (snapshot when closed, scope when open) —
    // the number the Close queue and the invoice show.
    const projectOverageRate = project.overageRate ?? 0;
    let overageMinutes = 0;
    let overageDueMinor = 0;
    for (const { view } of lastShownByPeriod.values()) {
      if (view.period.end >= todayStr) continue;
      if (invoiceByMonthKey.has(view.period.end.slice(0, 7))) continue;
      overageMinutes += view.price.overageMinutes;
      overageDueMinor += view.price.amountMinor;
    }
    const overageDue = fromMinor(overageDueMinor, currency);

    // totalNonBillableMinutes scoped to current cycle months only
    const totalNonBillableMinutes = monthlyData.reduce(
      (s, m) => s + m.totalNonBillableMinutes,
      0,
    );

    return {
      cycleIndex: targetCycleIndex,
      cycleNumber: targetCycleIndex + 1,
      cycleStart: cycleStartStr,
      cycleEnd: cycleEndStr,
      cycleLength,
      isCycleClosed,
      isCurrentCycle,
      hasPreviousCycle: targetCycleIndex > 0,
      hasNextCycle: targetCycleIndex < currentCycleIndex,
      months: monthlyData,
      cycleBudget,
      cycleWorked,
      cycleBalance,
      utilization,
      overageMinutes,
      overageDue,
      monthlyFee,
      includedMinutesPerMonth,
      rolloverEnabled,
      overageRate: projectOverageRate,
      totalNonBillableMinutes,
      currency,
    };
  },
});

// ─── Project Summary (unified overview card) ──────────────────────────────────
//
// Single thin dispatcher backing <ProjectSummaryCard>. Delegates business math
// to the pure calc layer in lib/projectSummary.ts so every formula can be unit-
// tested via fixtures without a Convex runtime.
//
// Return shape: discriminated union keyed on billingType. Member (non-admin)
// callers receive only `timeBreakdown` + minimal metadata; Billing Status,
// Profitability, and Overage are omitted per permissions rules (§5 of PRD).
//
// See docs/project-summary-prd.md for the canonical formulas.

const dateRangePresetValidator = v.union(
  v.literal("this_month"),
  v.literal("this_quarter"),
  v.literal("this_year"),
  v.literal("all"),
  v.literal("custom"),
);

export const getSummary = query({
  args: {
    projectId: v.id("projects"),
    dateRange: v.optional(
      v.object({
        preset: dateRangePresetValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
      }),
    ),
    cycleOffset: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<ProjectSummary | null> => {
    const { orgId, isAdmin } = await getAuthContext(ctx);

    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) return null;
    if (project.billingType === "non_billable") return null;

    const currency = await getProjectCurrency(ctx, project);

    // Fetch all tasks + their entries once. Every branch needs the entries;
    // Fixed + Retainer slice the same set differently.
    const rawEntries = await getProjectEntries(ctx, orgId, args.projectId);
    const entries: EntryInput[] = rawEntries.map((e) => ({
      durationMinutes: e.durationMinutes,
      isBillable: e.isBillable,
      closed: e.closeId !== undefined,
      costRate: e.costRate,
      billableRate: e.billableRate,
      date: e.date,
    }));

    if (project.billingType === "t_and_m") {
      const orgSettings = await getOrgSettings(ctx, orgId);
      const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
      const today = getDateInTimezone(Date.now(), timezone);

      const preset: DateRangePreset = args.dateRange?.preset ?? "all";
      const dateRange: DateRange = resolveDateRange(preset, today, {
        from: args.dateRange?.from,
        to: args.dateRange?.to,
      });

      return computeTmSummary({
        entries,
        dateRange,
        currency,
        subtitle: "Time & Materials Billing",
        isAdmin,
      });
    }

    if (project.billingType === "fixed") {
      const [invoices, estimates] = await Promise.all([
        ctx.db
          .query("invoices")
          .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
          .filter((q) => q.eq(q.field("orgId"), orgId))
          .collect(),
        ctx.db
          .query("projectCategoryEstimates")
          .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
          .collect(),
      ]);

      const lineItemsByInvoice = await Promise.all(
        invoices.map((inv) =>
          ctx.db
            .query("invoiceLineItems")
            .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect()
            .then((items) => items.map((li) => ({ li, inv }))),
        ),
      );
      const lineItems: LineItemInput[] = lineItemsByInvoice
        .flat()
        .map(({ li, inv }) => ({
          lineType: li.lineType,
          amount: fromMinor(li.amountMinor, inv.currency),
          invoiceStatus: inv.status,
        }));

      const invoiceInputs: InvoiceInput[] = invoices.map((inv) => ({
        status: inv.status,
        total: fromMinor(inv.totalMinor, inv.currency),
      }));

      const estimatedBudgetMinutes = estimates.length > 0
        ? estimates.reduce((sum, est) => sum + est.estimatedMinutes, 0)
        : null;

      return computeFixedSummary({
        entries,
        invoices: invoiceInputs,
        lineItems,
        fixedPrice: project.fixedPrice ?? null,
        estimatedBudgetMinutes,
        currency,
        subtitle: "Fixed Fee Billing",
        isAdmin,
      });
    }

    // Retainer
    const {
      monthlyFee = 0,
      startDate,
      rolloverEnabled = false,
      cycleLength = 1,
    } = project;

    if (!startDate) return null;

    const orgSettings = await getOrgSettings(ctx, orgId);
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
    const todayStr = getDateInTimezone(Date.now(), timezone);

    const cycleContext = resolveRetainerCycleContext({
      startDate,
      cycleLength,
      offset: args.cycleOffset ?? 0,
      todayStr,
    });
    if (!cycleContext) return null;

    // Report months (billing refactor N8): an entry counts on the month its
    // close bills it — skipped and late work on the receiving month.
    const closeContext = await loadCloseContext(ctx, orgId, args.projectId);
    const reportMonths = await loadReportMonths(ctx, closeContext);
    const inCycle = (key: string) =>
      key >= cycleContext.start.slice(0, 7) && key <= cycleContext.end.slice(0, 7);
    const cycleEntries = entries.filter((_, i) =>
      inCycle(reportMonths.get(rawEntries[i]._id) ?? rawEntries[i].date.slice(0, 7)),
    );

    // Budget and overage from the balance ladder (§8.3) of the periods that
    // settle the cycle's months. A pooled rollover cycle shows its overage
    // live; a single month's overage counts once the month has ended (an
    // in-progress month must not flip the card to "overage due", review M2).
    // "Uninvoiced" = an elapsed period with overage that no live close has
    // billed yet — exactly what the Close queue would put in front of the
    // owner. Within-budget periods produce reports, not invoices.
    const balances = await monthBalances(ctx, closeContext, cycleContext.monthKeys, {
      todayStr,
      roundingMinutes: 1,
    });
    const shownRows = [...balances.values()];
    const cycleBudgetMinutes = shownRows.reduce((sum, b) => sum + b.row.includedMinutes, 0);
    const periodViews = new Map(shownRows.map((b) => [b.view.period.start, b.view]));
    let hasUninvoicedClosedMonth = false;
    let overageMinutes = 0;
    let overageMinor = 0;
    for (const view of periodViews.values()) {
      const ended = view.period.end < todayStr;
      if (!view.liveClose && ended && view.price.overageMinutes > 0) {
        hasUninvoicedClosedMonth = true;
      }
      if (ended || view.price.monthlyBalances.length > 1) {
        overageMinutes += view.price.overageMinutes;
        overageMinor += view.price.amountMinor;
      }
    }

    const { start, end, length, number, offset, isCycleClosed, hasPreviousCycle, hasNextCycle } = cycleContext;
    const cycleForSummary: RetainerCycleContext = {
      number,
      offset,
      start,
      end,
      length,
      isCycleClosed,
      hasPreviousCycle,
      hasNextCycle,
      hasUninvoicedClosedMonth,
    };

    const startLabel = new Date(start + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const endLabel = new Date(end + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const rangeLabel = startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
    // Phase 8 lexicon: `ended` = calendar (the cycle's last day has passed);
    // `closed` is reserved for admin settlement (Close period / Close cycle).
    // Never overload `closed` for both — same rule as Slice 2 Revision Pass #1.
    const subtitle = `${rangeLabel} · ${length}-month ${rolloverEnabled ? "rollover" : "monthly"}${isCycleClosed ? " (ended)" : ""}`;

    return computeRetainerSummary({
      entries: cycleEntries,
      monthlyFee,
      cycleBudgetMinutes,
      overage: { minutes: overageMinutes, amount: fromMinor(overageMinor, currency) },
      cycle: cycleForSummary,
      currency,
      subtitle,
      isAdmin,
    });
  },
});

/**
 * Resolve retainer cycle boundaries for a given project + offset.
 *
 * Thin adapter over `getCyclePeriods` that preserves the
 * pre-existing return shape `{ start, end, length, number, offset, ...,
 * monthKeys }` consumed by `getSummary`. The boundary math itself lives in
 * `convex/lib/billing/periods.ts`.
 */
function resolveRetainerCycleContext(input: {
  startDate: string;
  cycleLength: number;
  offset: number;
  todayStr: string;
}): {
  start: string;
  end: string;
  length: number;
  number: number;
  offset: number;
  isCycleClosed: boolean;
  hasPreviousCycle: boolean;
  hasNextCycle: boolean;
  monthKeys: string[];
} | null {
  const cycle = getCyclePeriods({
    startDate: input.startDate,
    cycleLength: input.cycleLength,
    todayStr: input.todayStr,
    cycleOffset: input.offset,
  });
  if (!cycle) return null;
  const monthKeys = cycle.periods.map((p) => p.periodStart.slice(0, 7));

  return {
    start: cycle.cycleStart,
    end: cycle.cycleEnd,
    length: input.cycleLength,
    number: cycle.cycleIndex + 1,
    offset: input.offset,
    isCycleClosed: cycle.isCycleClosed,
    hasPreviousCycle: cycle.cycleIndex > 0,
    hasNextCycle: cycle.cycleIndex < cycle.currentCycleIndex,
    monthKeys,
  };
}

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    // Block if the project has any time entries
    const hasEntries = await ctx.db
      .query("timeEntries")
      .withIndex("by_orgId_projectId_closeId", (q) => q.eq("orgId", orgId).eq("projectId", args.id))
      .first();
    if (hasEntries) {
      throw new ConvexError("Cannot delete a project with time entries — archive it instead");
    }

    // Block on running timers too. Deleting the project would leave the
    // timer dangling — its stop would silently discard the measured hours
    // (and an auto-save is impossible: entry creation is exactly what the
    // entries-guard above forbids on delete).
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", args.id))
      .collect();
    const projectTaskIds = new Set(projectTasks.map((t) => t._id.toString()));
    const projectMembers = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const member of projectMembers) {
      if (!member.userId) continue;
      const memberUser = await ctx.db.get(member.userId);
      if (memberUser?.timerTaskId && projectTaskIds.has(memberUser.timerTaskId.toString())) {
        throw new ConvexError(
          `${memberUser.name} has a running timer on this project — it must be stopped or discarded first.`,
        );
      }
    }

    // Cascade delete: fetch estimates and rate overrides in parallel
    const [estimates, rateOverrides] = await Promise.all([
      ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
      ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
    ]);
    for (const est of estimates) {
      await ctx.db.delete(est._id);
    }
    for (const override of rateOverrides) {
      await ctx.db.delete(override._id);
    }

    await ctx.db.delete(args.id);
  },
});

// ─── Retainer Helpers ─────────────────────────────────────────────────────────

type EntryWithTask = {
  taskId: { toString(): string };
  taskTitle: string;
  workCategoryId?: { toString(): string } | null;
  durationMinutes: number;
  date: string;
};

type CategoryDoc = { name: string; color: string };

/** Build category groups with task breakdown for retainer month view. */
function buildRetainerCategoryGroups(
  entries: EntryWithTask[],
  catMap: Map<string, CategoryDoc>,
) {
  // Group by category
  const byCat: Record<string, { catId: string | null; entries: EntryWithTask[] }> = {};
  for (const e of entries) {
    const key = e.workCategoryId?.toString() ?? "uncategorized";
    if (!byCat[key]) byCat[key] = { catId: e.workCategoryId?.toString() ?? null, entries: [] };
    byCat[key].entries.push(e);
  }

  return Object.values(byCat)
    .map(({ catId, entries: catEntries }) => {
      const cat = catId ? catMap.get(catId) : null;
      const categoryName = cat?.name ?? "No category";
      const categoryColor = cat?.color ?? "gray";

      // Group by task
      const byTask: Record<string, EntryWithTask[]> = {};
      for (const e of catEntries) {
        const tid = e.taskId.toString();
        (byTask[tid] ??= []).push(e);
      }

      const tasks = Object.entries(byTask)
        .map(([taskId, taskEntries]) => {
          const totalMinutes = taskEntries.reduce((s, e) => s + e.durationMinutes, 0);
          const dates = taskEntries.map((e) => e.date).sort();
          return {
            taskId,
            taskTitle: taskEntries[0].taskTitle,
            totalMinutes,
            firstDate: dates[0],
            lastDate: dates[dates.length - 1],
            entryCount: taskEntries.length,
          };
        })
        .sort((a, b) => b.lastDate.localeCompare(a.lastDate));

      const totalMinutes = catEntries.reduce((s, e) => s + e.durationMinutes, 0);

      return {
        workCategoryId: catId,
        categoryName,
        categoryColor,
        totalMinutes,
        tasks,
      };
    })
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
}
