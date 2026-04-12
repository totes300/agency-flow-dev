import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { billingTypeValidator, retainerStatusValidator } from "./lib/validators";
import { generateNextProjectCode, ensureUniqueProjectCode } from "./lib/helpers";
import { validateAssignees } from "./lib/task_helpers";
import { getDateInTimezone } from "./lib/timer";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// ─── Queries ────────────────────────────────────────────────────────────────────

export const list = query({
  args: {
    includeArchived: v.optional(v.boolean()),
    clientId: v.optional(v.id("clients")),
    billingType: v.optional(billingTypeValidator),
  },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);

    const [projects_raw, clients] = await Promise.all([
      ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    ]);
    let projects = projects_raw;

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
    }]));

    return projects.map((p) => {
      const client = clientMap.get(p.clientId.toString());
      return {
        ...p,
        clientName: client?.name ?? "Unknown",
        clientPrefix: client?.prefix ?? "",
        clientUsePrefix: client?.usePrefix,
      };
    });
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await getAuthContext(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) return null;

    const client = await ctx.db.get(project.clientId);
    return {
      ...project,
      clientName: client?.name ?? "Unknown",
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

    // Validate client exists and belongs to org — currency derived from client
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found");
    const currency = client.currency;

    // Validate team members belong to org
    if (args.teamMembers && args.teamMembers.length > 0) {
      await validateAssignees(ctx, orgId, args.teamMembers);
    }

    // Fixed validation
    if (args.billingType === "fixed") {
      if (args.fixedPrice === undefined || args.fixedPrice <= 0) {
        throw new ConvexError("Fixed fee is required and must be greater than zero");
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
      currency, // Still writing to projects.currency during widen phase
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

    // Seed category estimate rows for Fixed projects (hours only, no rates)
    if (args.billingType === "fixed") {
      const categories = await ctx.db
        .query("workCategories")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
      const activeCategories = categories.filter((c) => !c.archivedAt);
      for (const cat of activeCategories) {
        await ctx.db.insert("projectCategoryEstimates", {
          orgId,
          projectId,
          workCategoryId: cat._id,
          estimatedMinutes: 0,
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
    const timezone = orgSettings?.timezone ?? "America/New_York";

    // Compute today in org timezone (same helper used by timer & time entries)
    const todayStr = getDateInTimezone(Date.now(), timezone);

    // Compute cycle boundaries
    const startParts = startDate.split("-").map(Number);
    const startYear = startParts[0];
    const startMonth = startParts[1] - 1; // 0-indexed

    // Calculate which cycle index contains today
    const todayParts = todayStr.split("-").map(Number);
    const todayYear = todayParts[0];
    const todayMonth = todayParts[1] - 1; // 0-indexed
    const monthsDiff = (todayYear - startYear) * 12 + (todayMonth - startMonth);
    const currentCycleIndex = Math.max(0, Math.floor(monthsDiff / cycleLength));

    const offset = args.cycleOffset ?? 0;
    const targetCycleIndex = currentCycleIndex + offset;
    if (targetCycleIndex < 0) return null;

    // Build month list for target cycle
    const cycleStartMonthOffset = targetCycleIndex * cycleLength;
    const months: Array<{
      year: number;
      month: number; // 0-indexed
      label: string;
      startDate: string;
      endDate: string;
    }> = [];

    for (let i = 0; i < cycleLength; i++) {
      const mOffset = cycleStartMonthOffset + i;
      const y = startYear + Math.floor((startMonth + mOffset) / 12);
      const m = (startMonth + mOffset) % 12;
      const lastDay = new Date(y, m + 1, 0).getDate();
      months.push({
        year: y,
        month: m,
        label: new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        startDate: `${y}-${String(m + 1).padStart(2, "0")}-01`,
        endDate: `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
      });
    }

    const cycleStartStr = months[0].startDate;
    const cycleEndStr = months[months.length - 1].endDate;
    const isCycleClosed = cycleEndStr < todayStr;
    const isCurrentCycle = targetCycleIndex === currentCycleIndex;

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
            workCategoryId: e.snapshotCategoryId ?? task.workCategoryId,
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
    type MonthData = typeof months[number] & {
      workedMinutes: number;
      startBalance: number;
      available: number;
      endBalance: number;
      totalNonBillableMinutes: number;
      isMonthClosed: boolean;
      balanceStatus: "due" | "deficit" | "rollover" | "unused" | "on_track";
      cyclePosition: number;
      billableCategoryGroups: CategoryGroup[];
      nonBillableCategoryGroups: CategoryGroup[];
      entryCount: number;
      taskCount: number;
      categoryCount: number;
    };
    const monthlyData: MonthData[] = [];

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const monthKey = `${m.year}-${String(m.month + 1).padStart(2, "0")}`;
      const monthBillable = billableByMonth[monthKey] ?? [];
      const monthNonBillable = nonBillableByMonth[monthKey] ?? [];
      const workedMinutes = monthBillable.reduce((s, e) => s + e.durationMinutes, 0);
      const totalNonBillableMinutes = monthNonBillable.reduce((s, e) => s + e.durationMinutes, 0);
      const isMonthClosed = m.endDate < todayStr;

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
          balanceStatus = isMonthClosed ? "due" : "deficit";
        }
      } else if (endBalance > 0) {
        if (rolloverEnabled) {
          balanceStatus = (i === cycleLength - 1 && isCycleClosed) ? "unused" : "rollover";
        } else {
          balanceStatus = isMonthClosed ? "unused" : "on_track";
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

      monthlyData.push({
        ...m,
        workedMinutes,
        startBalance,
        available,
        endBalance,
        totalNonBillableMinutes,
        isMonthClosed,
        balanceStatus,
        cyclePosition: i + 1,
        billableCategoryGroups,
        nonBillableCategoryGroups,
        entryCount: allMonthEntries.length,
        taskCount: uniqueTaskIds.size,
        categoryCount: uniqueCatIds.size,
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
      // Non-rollover: each month settles independently
      for (const m of monthlyData) {
        if (m.isMonthClosed && m.endBalance < 0) {
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
