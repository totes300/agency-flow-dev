import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { billingTypeValidator, tmRateModeValidator, currencyValidator, retainerStatusValidator } from "./lib/validators";
import { generateNextProjectCode, ensureUniqueProjectCode } from "./lib/helpers";
import { CURRENCIES } from "./lib/constants";

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
    const clientMap = new Map(clients.map((c) => [c._id.toString(), c.name]));

    return projects.map((p) => ({
      ...p,
      clientName: clientMap.get(p.clientId.toString()) ?? "Unknown",
    }));
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
    currency: currencyValidator,
    code: v.optional(v.string()),
    // T&M fields
    tmRateMode: v.optional(tmRateModeValidator),
    hourlyRate: v.optional(v.number()),
    tmCategoryRates: v.optional(v.array(v.object({
      workCategoryId: v.id("workCategories"),
      rate: v.number(),
    }))),
    // Retainer fields
    includedHoursPerMonth: v.optional(v.number()),
    overageRate: v.optional(v.number()),
    startDate: v.optional(v.string()),
    cycleLength: v.optional(v.number()),
    rolloverEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);

    const name = args.name.trim();
    if (!name) throw new Error("Project name is required");
    validateStringLength(name, 100, "Project name");

    // Validate client exists and belongs to org
    const client = await ctx.db.get(args.clientId);
    if (!client || client.orgId !== orgId) throw new Error("Client not found");

    // Validate currency
    if (!CURRENCIES.includes(args.currency as typeof CURRENCIES[number])) {
      throw new Error("Invalid currency");
    }

    // T&M validation
    if (args.billingType === "t_and_m") {
      if (!args.tmRateMode) throw new Error("Rate mode is required for T&M projects");
      if (args.tmRateMode === "flat" && (args.hourlyRate === undefined || args.hourlyRate < 0)) {
        throw new Error("Hourly rate is required for flat-rate T&M projects");
      }
      if (args.tmRateMode === "per_category") {
        if (!args.tmCategoryRates || args.tmCategoryRates.length === 0) {
          throw new Error("At least one category rate is required for per-category T&M projects");
        }
        for (const cr of args.tmCategoryRates) {
          if (cr.rate < 0) throw new Error("Category rate cannot be negative");
        }
      }
    }

    // Retainer validation
    if (args.billingType === "retainer") {
      if (!args.includedHoursPerMonth || args.includedHoursPerMonth <= 0) {
        throw new Error("Monthly hours is required for retainer projects");
      }
      if (args.overageRate === undefined || args.overageRate < 0) {
        throw new Error("Overage rate is required for retainer projects");
      }
      if (!args.startDate || !DATE_REGEX.test(args.startDate)) {
        throw new Error("Start date is required (YYYY-MM-DD)");
      }
      const [y, m, d] = args.startDate.split("-").map(Number);
      const testDate = new Date(y, m - 1, d);
      if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
        throw new Error("Invalid date");
      }
      const cycleLen = args.cycleLength ?? 3;
      if (cycleLen < 1 || cycleLen > 12 || !Number.isInteger(cycleLen)) {
        throw new Error("Cycle length must be 1-12 months");
      }
    }

    // Generate or validate code with retry on conflict
    let code = args.code?.trim() || await generateNextProjectCode(ctx, orgId);
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        await ensureUniqueProjectCode(ctx, orgId, code);
        break;
      } catch {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(`Could not find a unique project code after ${maxAttempts} attempts`);
        }
        code = await generateNextProjectCode(ctx, orgId);
      }
    }

    const now = Date.now();
    return await ctx.db.insert("projects", {
      orgId,
      clientId: args.clientId,
      name,
      code,
      billingType: args.billingType,
      currency: args.currency,
      // T&M fields
      ...(args.billingType === "t_and_m" ? {
        tmRateMode: args.tmRateMode,
        hourlyRate: args.tmRateMode === "flat" ? args.hourlyRate : undefined,
        tmCategoryRates: args.tmRateMode === "per_category" ? args.tmCategoryRates : undefined,
      } : {}),
      // Retainer fields
      ...(args.billingType === "retainer" ? {
        retainerStatus: "active" as const,
        includedHoursPerMonth: args.includedHoursPerMonth,
        overageRate: args.overageRate,
        startDate: args.startDate,
        rolloverEnabled: args.rolloverEnabled ?? true,
        cycleLength: args.cycleLength ?? 3,
      } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    currency: v.optional(currencyValidator),
    defaultAssignees: v.optional(v.array(v.object({
      workCategoryId: v.id("workCategories"),
      userId: v.id("users"),
    }))),
    hourlyRate: v.optional(v.number()),
    tmCategoryRates: v.optional(v.array(v.object({
      workCategoryId: v.id("workCategories"),
      rate: v.number(),
    }))),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new Error("Project not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Project name is required");
      validateStringLength(name, 100, "Project name");
      updates.name = name;
    }

    if (args.code !== undefined) {
      const code = args.code.trim();
      if (!code) throw new Error("Project code is required");
      await ensureUniqueProjectCode(ctx, orgId, code, args.id.toString());
      updates.code = code;
    }

    if (args.currency !== undefined) {
      // TODO: Currency lock — block if invoiced/paid reports exist. Always allows for now.
      updates.currency = args.currency;
    }

    if (args.defaultAssignees !== undefined) {
      updates.defaultAssignees = args.defaultAssignees;
    }

    // T&M rate updates
    if (args.hourlyRate !== undefined) {
      if (project.billingType !== "t_and_m" || project.tmRateMode !== "flat") {
        throw new Error("Hourly rate can only be set on flat-rate T&M projects");
      }
      if (args.hourlyRate < 0) throw new Error("Hourly rate cannot be negative");
      updates.hourlyRate = args.hourlyRate;
    }

    if (args.tmCategoryRates !== undefined) {
      if (project.billingType !== "t_and_m" || project.tmRateMode !== "per_category") {
        throw new Error("Category rates can only be set on per-category T&M projects");
      }
      if (args.tmCategoryRates.length === 0) {
        throw new Error("Per-category T&M projects must include at least one category rate");
      }
      for (const cr of args.tmCategoryRates) {
        if (cr.rate < 0) throw new Error("Category rate cannot be negative");
      }
      updates.tmCategoryRates = args.tmCategoryRates;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const archive = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new Error("Project not found");

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });

    // TODO Phase 5: cascade archive to tasks
    // TODO Phase 7: stop running timers
  },
});

export const restore = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new Error("Project not found");

    await ctx.db.patch(args.id, { archivedAt: undefined, updatedAt: Date.now() });
    // Restore does NOT cascade — tasks stay archived
  },
});

export const updateRetainer = mutation({
  args: {
    id: v.id("projects"),
    includedHoursPerMonth: v.optional(v.number()),
    overageRate: v.optional(v.number()),
    startDate: v.optional(v.string()),
    cycleLength: v.optional(v.number()),
    rolloverEnabled: v.optional(v.boolean()),
    retainerStatus: v.optional(retainerStatusValidator),
    confirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new Error("Project not found");
    if (project.billingType !== "retainer") throw new Error("Not a retainer project");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    // Check if any config-changing fields are being modified (require confirmation)
    const needsConfirmation =
      (args.includedHoursPerMonth !== undefined && args.includedHoursPerMonth !== project.includedHoursPerMonth) ||
      (args.overageRate !== undefined && args.overageRate !== project.overageRate) ||
      (args.cycleLength !== undefined && args.cycleLength !== project.cycleLength) ||
      (args.rolloverEnabled !== undefined && args.rolloverEnabled !== project.rolloverEnabled) ||
      (args.startDate !== undefined && args.startDate !== project.startDate);

    if (needsConfirmation && !args.confirmed) {
      throw new ConvexError("CONFIRMATION_REQUIRED");
    }

    if (args.includedHoursPerMonth !== undefined) {
      if (args.includedHoursPerMonth <= 0) throw new Error("Monthly hours must be greater than 0");
      updates.includedHoursPerMonth = args.includedHoursPerMonth;
    }

    if (args.overageRate !== undefined) {
      if (args.overageRate < 0) throw new Error("Overage rate cannot be negative");
      updates.overageRate = args.overageRate;
    }

    if (args.startDate !== undefined) {
      if (!DATE_REGEX.test(args.startDate)) throw new Error("Invalid date format");
      const [y, m, d] = args.startDate.split("-").map(Number);
      const testDate = new Date(y, m - 1, d);
      if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
        throw new Error("Invalid date");
      }
      updates.startDate = args.startDate;
    }

    if (args.cycleLength !== undefined) {
      if (args.cycleLength < 1 || args.cycleLength > 12 || !Number.isInteger(args.cycleLength)) {
        throw new Error("Cycle length must be 1-12 months");
      }
      updates.cycleLength = args.cycleLength;
    }

    if (args.rolloverEnabled !== undefined) {
      updates.rolloverEnabled = args.rolloverEnabled;
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
      includedHoursPerMonth = 0,
      overageRate = 0,
      startDate,
      rolloverEnabled = true,
      cycleLength = 3,
    } = project;

    if (!startDate) return null;
    const timezone = orgSettings?.timezone ?? "America/New_York";

    // Compute today in org timezone
    const nowUtc = new Date();
    const orgNow = new Date(nowUtc.toLocaleString("en-US", { timeZone: timezone }));
    const todayStr = `${orgNow.getFullYear()}-${String(orgNow.getMonth() + 1).padStart(2, "0")}-${String(orgNow.getDate()).padStart(2, "0")}`;

    // Compute cycle boundaries
    const startParts = startDate.split("-").map(Number);
    const startYear = startParts[0];
    const startMonth = startParts[1] - 1; // 0-indexed

    // Calculate which cycle index contains today
    const todayDate = new Date(orgNow.getFullYear(), orgNow.getMonth(), 1);
    const startDateObj = new Date(startYear, startMonth, 1);
    const monthsDiff = (todayDate.getFullYear() - startDateObj.getFullYear()) * 12 +
      (todayDate.getMonth() - startDateObj.getMonth());
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

    // TODO Phase 7: Query real time entries. For now, return 0 minutes per month.
    // When time entries exist, group by month using org timezone:
    // const tasks = await ctx.db.query("tasks").withIndex("by_projectId", q => q.eq("projectId", args.id)).collect()
    // const taskIds = new Set(tasks.map(t => t._id.toString()))
    // const entries = ... filter by taskIds, billable, not archived ...
    // const minutesByMonth = groupByMonth(entries, orgTimezone)

    // Compute balances (sequential — each month depends on the previous)
    type MonthData = typeof months[number] & {
      workedMinutes: number;
      startBalance: number;
      available: number;
      endBalance: number;
      isMonthClosed: boolean;
      balanceStatus: "due" | "deficit" | "rollover" | "unused" | "on_track";
      cyclePosition: number;
      entries: Array<{ taskName: string; categoryName: string; minutes: number }>;
      entryCount: number;
      taskCount: number;
    };
    const monthlyData: MonthData[] = [];

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const workedMinutes = 0; // Phase 7: real data
      const isMonthClosed = m.endDate < todayStr;

      let startBalance: number;
      if (rolloverEnabled) {
        startBalance = i === 0 ? 0 : monthlyData[i - 1].endBalance;
      } else {
        startBalance = 0;
      }

      const available = startBalance + includedHoursPerMonth;
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

      monthlyData.push({
        ...m,
        workedMinutes,
        startBalance,
        available,
        endBalance,
        isMonthClosed,
        balanceStatus,
        cyclePosition: i + 1,
        entries: [], // Phase 7
        entryCount: 0,
        taskCount: 0,
      });
    }

    // Cycle totals
    const cycleBudget = includedHoursPerMonth * cycleLength;
    const cycleWorked = monthlyData.reduce((sum, m) => sum + m.workedMinutes, 0);
    const cycleBalance = cycleBudget - cycleWorked;
    const utilization = cycleBudget > 0 ? (cycleWorked / cycleBudget) * 100 : 0;

    // Overage calculation
    let overageMinutes = 0;
    if (rolloverEnabled) {
      // Only at cycle end
      if (isCycleClosed && cycleBalance < 0) {
        overageMinutes = Math.abs(cycleBalance);
      }
    } else {
      // Per closed month
      for (const m of monthlyData) {
        if (m.isMonthClosed && m.endBalance < 0) {
          overageMinutes += Math.abs(m.endBalance);
        }
      }
    }
    const overageDue = (overageMinutes / 60) * overageRate;

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
      overageRate,
      includedHoursPerMonth,
      rolloverEnabled,
      currency: project.currency,
    };
  },
});

export const remove = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.id);
    if (!project || project.orgId !== orgId) throw new Error("Project not found");

    // TODO Phase 7: block if time entries exist
    // Guard: if time entries exist → throw "Cannot delete project with time entries — archive instead"

    // Cascade delete: fetch estimates and periods in parallel
    const [estimates, periods] = await Promise.all([
      ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
      ctx.db.query("retainerPeriods").withIndex("by_projectId", (q) => q.eq("projectId", args.id)).collect(),
    ]);
    for (const est of estimates) {
      await ctx.db.delete(est._id);
    }
    for (const period of periods) {
      await ctx.db.delete(period._id);
    }

    await ctx.db.delete(args.id);
  },
});
