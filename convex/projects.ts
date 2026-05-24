import { v, ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { billingTypeValidator, retainerStatusValidator } from "./lib/validators";
import { generateNextProjectCode, ensureUniqueProjectCode } from "./lib/helpers";
import { validateAssignees } from "./lib/task_helpers";
import { getDateInTimezone, ORG_TIMEZONE_FALLBACK } from "./lib/timer";
import { getOrgSettings, getProjectCurrency } from "./lib/orgHelpers";
import {
  getInvoiceAnchorMonthKey,
  invoiceCoversMonth,
} from "./lib/invoiceAnchor";
import { getCyclePeriods } from "./lib/retainerCycle";
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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── Queries ────────────────────────────────────────────────────────────────────

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
    const { orgId } = await getAuthContext(ctx);

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

    // Validate or generate project code
    const userCode = args.code?.trim();
    let code: string;

    if (userCode) {
      await ensureUniqueProjectCode(ctx, orgId, userCode);
      code = userCode;
    } else {
      code = await generateNextProjectCode(ctx, orgId);
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          await ensureUniqueProjectCode(ctx, orgId, code);
          break;
        } catch {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new ConvexError(`Could not generate a unique project code after ${maxAttempts} attempts`);
          }
          code = await generateNextProjectCode(ctx, orgId);
        }
      }
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
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError("Project name is required");
      validateStringLength(name, 100, "Project name");
      updates.name = name;
    }

    if (args.code !== undefined) {
      const code = args.code.trim();
      if (!code) throw new ConvexError("Project code is required");
      await ensureUniqueProjectCode(ctx, orgId, code, args.id.toString());
      updates.code = code;
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
      updates.fixedPrice = args.fixedPrice;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const archive = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    // Stop running timers on this project's tasks
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", args.id))
      .collect();
    const projectTaskIds = new Set(projectTasks.map((t) => t._id.toString()));

    const orgMembers = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    for (const member of orgMembers) {
      if (!member.userId) continue;
      const user = await ctx.db.get(member.userId);
      if (user?.timerTaskId && projectTaskIds.has(user.timerTaskId.toString())) {
        await ctx.db.patch(member.userId, {
          timerTaskId: undefined,
          timerStartedAt: undefined,
          timerAccumulatedMs: undefined,
          timerStatus: undefined,
        });
      }
    }

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });
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
      rolloverEnabled = true,
      cycleLength = 3,
    } = project;

    // Get currency from client
    const client = await ctx.db.get(project.clientId);
    const currency = client?.currency ?? "USD";

    if (!startDate) return null;
    const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;

    // Compute today in org timezone (same helper used by timer & time entries)
    const todayStr = getDateInTimezone(Date.now(), timezone);

    // Resolve cycle boundaries via shared helper. See convex/lib/retainerCycle.ts
    // for the rules — this is the only place we ask "what months belong to
    // this cycle?", and the close mutations (Phase 8 Slice 3/4) consume the
    // same helper so the read path and write path can never disagree on
    // whether a date falls inside a given period.
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

    // Fetch all time entries for those tasks
    const allEntries = (
      await Promise.all(
        tasks.map(async (task) => {
          const entries = await ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .collect();
          return entries.map((e) => ({
            ...e,
            taskTitle: task.title,
            workCategoryId: e.snapshotCategoryId,
          }));
        }),
      )
    ).flat();

    // Split billable and non-billable
    const billableEntries = allEntries.filter((e) => e.isBillable);
    const nonBillableEntries = allEntries.filter((e) => !e.isBillable);

    // Group billable entries by month
    const billableByMonth: Record<string, typeof billableEntries> = {};
    for (const e of billableEntries) {
      const monthKey = e.date.slice(0, 7);
      (billableByMonth[monthKey] ??= []).push(e);
    }

    // Group non-billable entries by month
    const nonBillableByMonth: Record<string, typeof nonBillableEntries> = {};
    for (const e of nonBillableEntries) {
      const monthKey = e.date.slice(0, 7);
      (nonBillableByMonth[monthKey] ??= []).push(e);
    }

    // Fetch work categories for enrichment
    const categories = await ctx.db
      .query("workCategories")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const catMap = new Map(categories.map((c) => [c._id.toString(), c]));

    // Fetch retainer invoices for this project and attach each to its
    // **anchor** month (the YYYY-MM of `periodEnd`). For monthly retainers
    // (rollover OFF) the anchor is the single billed month. For rollover
    // cycle invoices (multi-month period after Issue #01) the anchor is the
    // cycle-end month — that's the row that carries the cycle's primary
    // action ("Generate" before billing, invoice link after). Centralised in
    // `convex/lib/invoiceAnchor.ts` so the Ready feed and Monthly Report
    // queries agree on the same convention.
    const projectInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.id))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const invoiceByMonthKey = new Map<string, Doc<"invoices">>();
    for (const inv of projectInvoices) {
      // Voided invoices free their period for re-billing (PRD § D5). The
      // audit trail still lives on `/invoices` Voided tab — the project
      // row should treat the period as unbilled so Generate can re-fire.
      if (inv.status === "void") continue;
      const key = getInvoiceAnchorMonthKey(inv);
      if (!key) continue;
      invoiceByMonthKey.set(key, inv);
    }

    // Phase 8 — admin-settled period rows. `isClosed`/`closedAt` on each
    // displayed month reflects an explicit admin "Close period" action; it
    // is independent of `periodEnded` (calendar). The close mutations
    // (Slice 3/4) populate these via `retainerPeriods.closedAt`.
    const retainerPeriodRows = await ctx.db
      .query("retainerPeriods")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.id))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const periodRowByStart = new Map<string, Doc<"retainerPeriods">>();
    for (const row of retainerPeriodRows) {
      periodRowByStart.set(row.periodStart, row);
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
      number: number;
      prefix: string;
      status: Doc<"invoices">["status"];
    };
    type MonthData = typeof months[number] & {
      workedMinutes: number;
      startBalance: number;
      available: number;
      endBalance: number;
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

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const monthKey = `${m.year}-${String(m.month).padStart(2, "0")}`;
      const monthBillable = billableByMonth[monthKey] ?? [];
      const monthNonBillable = nonBillableByMonth[monthKey] ?? [];
      const workedMinutes = monthBillable.reduce((s, e) => s + e.durationMinutes, 0);
      const totalNonBillableMinutes = monthNonBillable.reduce((s, e) => s + e.durationMinutes, 0);
      // Phase 8 — `periodEnded` is calendar-only (was `isMonthClosed`); the
      // new `isClosed`/`closedAt` carry the admin-settlement state read from
      // `retainerPeriods`. `balanceStatus` continues to key on `periodEnded`
      // — financial due-ness is a calendar question, not an admin one.
      const periodEnded = m.endDate < todayStr;
      const periodRow = periodRowByStart.get(m.startDate);
      const closedAt = periodRow?.closedAt;
      const isClosed = closedAt !== undefined;

      let startBalance: number;
      if (rolloverEnabled) {
        startBalance = i === 0 ? 0 : monthlyData[i - 1].endBalance;
      } else {
        startBalance = 0;
      }

      const available = startBalance + includedMinutesPerMonth;
      const endBalance = available - workedMinutes;

      // Badge status
      let balanceStatus: MonthData["balanceStatus"];
      if (endBalance < 0) {
        if (rolloverEnabled) {
          balanceStatus = (i === cycleLength - 1 && isCycleClosed) ? "due" : "deficit";
        } else {
          balanceStatus = periodEnded ? "due" : "deficit";
        }
      } else if (endBalance > 0) {
        if (rolloverEnabled) {
          balanceStatus = (i === cycleLength - 1 && isCycleClosed) ? "unused" : "rollover";
        } else {
          balanceStatus = periodEnded ? "unused" : "on_track";
        }
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
        workedMinutes,
        startBalance,
        available,
        endBalance,
        totalNonBillableMinutes,
        periodEnded,
        isClosed,
        closedAt,
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

    // Cycle totals
    const cycleBudget = includedMinutesPerMonth * cycleLength;
    const cycleWorked = monthlyData.reduce((sum, m) => sum + m.workedMinutes, 0);
    const cycleBalance = cycleBudget - cycleWorked;
    const utilization = cycleBudget > 0 ? (cycleWorked / cycleBudget) * 100 : 0;

    // Overage calculation
    const projectOverageRate = project.overageRate ?? 0;
    let overageMinutes = 0;
    let overageDue = 0;
    if (rolloverEnabled) {
      // Rollover: overage only at end of closed cycle
      if (isCycleClosed && cycleBalance < 0) {
        overageMinutes = Math.abs(cycleBalance);
        overageDue = (overageMinutes / 60) * projectOverageRate;
      }
    } else {
      // Non-rollover: each month settles independently. Calendar-driven —
      // `periodEnded` (not `isClosed`) gates due-ness, so an unbilled
      // overage month still shows due even before an admin clicks Close.
      for (const m of monthlyData) {
        if (m.periodEnded && m.endBalance < 0) {
          const monthOverage = Math.abs(m.endBalance);
          overageMinutes += monthOverage;
          overageDue += (monthOverage / 60) * projectOverageRate;
        }
      }
    }

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
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) =>
        q.eq("orgId", orgId).eq("projectId", args.projectId),
      )
      .collect();
    const rawEntries = (
      await Promise.all(
        tasks.map((task) =>
          ctx.db
            .query("timeEntries")
            .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
            .filter((q) => q.eq(q.field("orgId"), orgId))
            .collect(),
        ),
      )
    ).flat();
    const entries: EntryInput[] = rawEntries.map((e) => ({
      durationMinutes: e.durationMinutes,
      isBillable: e.isBillable,
      invoiceId: e.invoiceId ? e.invoiceId.toString() : null,
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
          amount: li.amount,
          invoiceStatus: inv.status,
        }));

      const invoiceInputs: InvoiceInput[] = invoices.map((inv) => ({
        status: inv.status,
        total: inv.total,
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
      includedMinutesPerMonth = 0,
      monthlyFee = 0,
      overageRate = 0,
      startDate,
      rolloverEnabled = true,
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

    // Entries within cycle range
    const cycleEntries = entries.filter(
      (e) => e.date >= cycleContext.start && e.date <= cycleContext.end,
    );

    // Badge semantics after the invoicing refactor: "Uninvoiced" means
    // "there is an invoiceable overage period not covered by a live invoice",
    // not merely "a closed calendar month has no invoice". Within-budget
    // retainer periods produce Monthly Reports, so marking them Uninvoiced
    // makes the owner think a billable action is missing when none exists.
    const retainerInvoices = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("orgId"), orgId))
      .collect();
    const liveInvoices = retainerInvoices.filter((inv) => inv.status !== "void");

    const monthBillableMinutes = new Map<string, number>();
    for (const entry of cycleEntries) {
      if (!entry.isBillable) continue;
      const key = entry.date.slice(0, 7);
      monthBillableMinutes.set(
        key,
        (monthBillableMinutes.get(key) ?? 0) + entry.durationMinutes,
      );
    }

    let hasUninvoicedClosedMonth = false;
    if (rolloverEnabled) {
      const cycleBillableMinutes = Array.from(monthBillableMinutes.values()).reduce(
        (sum, minutes) => sum + minutes,
        0,
      );
      const cycleBudgetMinutes = includedMinutesPerMonth * cycleLength;
      if (cycleContext.isCycleClosed && cycleBillableMinutes > cycleBudgetMinutes) {
        const [y, m] = cycleContext.end.slice(0, 7).split("-").map(Number);
        const covered = liveInvoices.some((inv) => invoiceCoversMonth(inv, y, m));
        hasUninvoicedClosedMonth = !covered;
      }
    } else {
      for (const monthKey of cycleContext.monthKeys) {
        // Calendar-only check (was `isMonthClosed`; renamed in Phase 8 so
        // the codebase has one name per concept — admin settlement lives on
        // `retainerPeriods.closedAt`, not on a calendar comparison).
        const periodEnded = lastDayOfMonth(monthKey) < todayStr;
        if (!periodEnded) continue;
        const billableMinutes = monthBillableMinutes.get(monthKey) ?? 0;
        if (billableMinutes <= includedMinutesPerMonth) continue;
        const [y, m] = monthKey.split("-").map(Number);
        const covered = liveInvoices.some((inv) => invoiceCoversMonth(inv, y, m));
        if (covered) continue;
        hasUninvoicedClosedMonth = true;
        break;
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
    const subtitle = `${rangeLabel} · ${length}-month ${rolloverEnabled ? "rollover" : "monthly"}${isCycleClosed ? " (closed)" : ""}`;

    return computeRetainerSummary({
      entries: cycleEntries,
      monthlyFee,
      overageRate,
      includedMinutesPerMonth,
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
 * Thin adapter over `getCyclePeriods` (Phase 8 — Slice 2) that preserves the
 * pre-existing return shape `{ start, end, length, number, offset, ...,
 * monthKeys }` consumed by `getSummary`. The boundary math itself lives in
 * `convex/lib/retainerCycle.ts` so the read and write paths cannot drift.
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

function lastDayOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return `${monthKey}-${String(lastDay).padStart(2, "0")}`;
}

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found");

    // Block if any task has time entries
    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_projectId", (q) => q.eq("orgId", orgId).eq("projectId", args.id))
      .collect();
    for (const task of projectTasks) {
      const hasEntries = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
        .first();
      if (hasEntries) {
        throw new ConvexError("Cannot delete a project with time entries — archive it instead");
      }
    }

    // Cascade delete: fetch estimates, periods, and rate overrides in parallel
    const [estimates, periods, rateOverrides] = await Promise.all([
      ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
      ctx.db.query("retainerPeriods").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
      ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
    ]);
    for (const est of estimates) {
      await ctx.db.delete(est._id);
    }
    for (const period of periods) {
      await ctx.db.delete(period._id);
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
