// @vitest-environment edge-runtime
//
// convex-test loads convex/**/*.ts via Vite's import.meta.glob, which
// requires an edge-runtime VM. Per-file override keeps React tests on jsdom.
//
// Entry-level billing category (docs/entry-billing-category-spec.md §8).
// These pin the member-default resolution chain, the sticky-category rule,
// re-resolution on explicit change / billable toggle, and the authorization
// on setDefaultWorkCategory. Every writer stores exactly the category it
// passed to resolveRateSnapshot — one resolution, two uses.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { statusRow, taskRow } from "./helpers/taskFixtures";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_cat";
const OTHER_ORG = "org_other";
const START_MS = Date.UTC(2026, 6, 15, 9); // 2026-07-15 09:00 UTC

/** Clerk JWT identity for a seeded externalId. */
function identity(
  externalId: string,
  role: "admin" | "member",
  orgId: string = ORG_ID,
) {
  return {
    subject: externalId,
    tokenIdentifier: `test|${externalId}`,
    org_id: orgId,
    org_role: role === "admin" ? "org:admin" : "org:member",
  } as never;
}

type World = {
  admin: Id<"users">;
  statusId: Id<"statuses">;
  design: Id<"workCategories">;
  dev: Id<"workCategories">;
  pm: Id<"workCategories">;
  clientId: Id<"clients">;
};

/**
 * Base org graph: admin, EUR/UTC settings, three categories with billable
 * rates (Design 120, Development 100, PM 80), and a EUR client. Per-test
 * users/projects/tasks/entries are added on top with the helpers below.
 */
async function baseSetup(t: ReturnType<typeof convexTest>): Promise<World> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "Admin",
      externalId: "admin_ext",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID,
      clerkUserId: "admin_ext",
      userId: admin,
      role: "admin",
      joinedAt: now,
    });
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID,
      defaultCurrency: "EUR",
      timezone: "UTC",
      roundingMinutes: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: admin,
    });
    await ctx.db.insert("userRates", {
      orgId: ORG_ID,
      userId: admin,
      currency: "EUR",
      costRate: 60,
      createdAt: now,
      updatedAt: now,
    });
    const statusId = await ctx.db.insert("statuses", statusRow({
      orgId: ORG_ID,
      name: "Todo",
      category: "backlog",
      color: "#000",
      createdAt: now,
      updatedAt: now,
      createdBy: admin,
    }));
    const cat = async (name: string) =>
      ctx.db.insert("workCategories", {
        orgId: ORG_ID,
        name,
        color: "#111",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: admin,
      });
    const design = await cat("Design");
    const dev = await cat("Development");
    const pm = await cat("PM");
    const catRate = async (workCategoryId: Id<"workCategories">, rate: number) =>
      ctx.db.insert("categoryRates", {
        orgId: ORG_ID,
        workCategoryId,
        currency: "EUR",
        defaultBillRate: rate,
        createdAt: now,
        updatedAt: now,
      });
    await catRate(design, 120);
    await catRate(dev, 100);
    await catRate(pm, 80);
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Acme",
      currency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: admin,
    });
    return { admin, statusId, design, dev, pm, clientId };
  });
}

async function addUser(
  t: ReturnType<typeof convexTest>,
  w: World,
  opts: {
    externalId: string;
    name: string;
    role?: "admin" | "member";
    defaultCat?: Id<"workCategories">;
    withCostRate?: boolean;
  },
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: opts.name,
      externalId: opts.externalId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID,
      clerkUserId: opts.externalId,
      userId,
      role: opts.role ?? "member",
      joinedAt: now,
      ...(opts.defaultCat ? { defaultWorkCategoryId: opts.defaultCat } : {}),
    });
    if (opts.withCostRate !== false) {
      await ctx.db.insert("userRates", {
        orgId: ORG_ID,
        userId,
        currency: "EUR",
        costRate: 50,
        createdAt: now,
        updatedAt: now,
      });
    }
    return userId;
  });
}

async function addProject(
  t: ReturnType<typeof convexTest>,
  w: World,
  opts: { billingType?: "t_and_m" | "fixed" | "retainer" | "non_billable" } = {},
): Promise<Id<"projects">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const billingType = opts.billingType ?? "t_and_m";
    return await ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId: w.clientId,
      name: "Project",
      code: `PRJ-${Math.floor(now % 100000)}`,
      billingType,
      createdAt: now,
      updatedAt: now,
      createdBy: w.admin,
      ...(billingType === "fixed" ? { fixedPrice: 10000 } : {}),
      ...(billingType === "retainer" ? { monthlyFee: 5000 } : {}),
    });
  });
}

async function addTask(
  t: ReturnType<typeof convexTest>,
  w: World,
  opts: {
    projectId: Id<"projects">;
    categoryId?: Id<"workCategories">;
    assignees?: Id<"users">[];
    billable?: boolean;
  },
): Promise<Id<"tasks">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const taskId = await ctx.db.insert("tasks", taskRow({
      orgId: ORG_ID,
      title: "Task",
      statusId: w.statusId,
      statusCategory: "backlog",
      projectId: opts.projectId,
      assigneeIds: opts.assignees ?? [],
      billable: opts.billable ?? true,
      ...(opts.categoryId ? { workCategoryId: opts.categoryId } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: w.admin,
    }));
    // Assignee edges are the access source of truth (tasks/access.ts, D1).
    for (const userId of opts.assignees ?? []) {
      await ctx.db.insert("taskAssignees", { orgId: ORG_ID, taskId, userId, assignedAt: now, assignedBy: w.admin });
    }
    return taskId;
  });
}

const getEntry = (t: ReturnType<typeof convexTest>, id: Id<"timeEntries">) =>
  t.run(async (ctx) => ctx.db.get(id));

// ─── 1. member default beats task category ──────────────────────────────────

describe("create — resolution chain", () => {
  it("member default beats task category", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });

    const entryId = await t
      .withIdentity(identity("designer_ext", "member"))
      .mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
      });

    const entry = await getEntry(t, entryId as Id<"timeEntries">);
    expect(entry?.snapshotCategoryId).toBe(w.design);
    expect(entry?.billableRate).toBe(120); // Design's rate, not Development's
  });

  // ─── 2. no member default falls back to task category ─────────────────────

  it("no member default falls back to task category", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const user = await addUser(t, w, {
      externalId: "nodefault_ext",
      name: "No Default",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [user],
    });

    const entryId = await t
      .withIdentity(identity("nodefault_ext", "member"))
      .mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
      });

    const entry = await getEntry(t, entryId as Id<"timeEntries">);
    expect(entry?.snapshotCategoryId).toBe(w.dev);
    expect(entry?.billableRate).toBe(100);
  });

  // ─── 3. explicit workCategoryId beats both ────────────────────────────────

  it("explicit workCategoryId beats member default and task category", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });

    const entryId = await t
      .withIdentity(identity("designer_ext", "member"))
      .mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
        workCategoryId: w.pm, // explicit PM overrides both
      });

    const entry = await getEntry(t, entryId as Id<"timeEntries">);
    expect(entry?.snapshotCategoryId).toBe(w.pm);
    expect(entry?.billableRate).toBe(80);
  });

  // ─── 4. admin-on-behalf uses the OWNER's default ──────────────────────────

  it("admin-on-behalf uses the OWNER's default, not the admin's", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    // Admin's own default is PM; owner (designer) default is Design.
    await t.run(async (ctx) => {
      const m = await ctx.db
        .query("orgMembers")
        .withIndex("by_userId", (q) => q.eq("userId", w.admin))
        .first();
      await ctx.db.patch(m!._id, { defaultWorkCategoryId: w.pm });
    });
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });

    const entryId = await t
      .withIdentity(identity("admin_ext", "admin"))
      .mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
        userId: designer, // logging on behalf of the designer
      });

    const entry = await getEntry(t, entryId as Id<"timeEntries">);
    expect(entry?.userId).toBe(designer);
    expect(entry?.snapshotCategoryId).toBe(w.design); // owner's default, not PM
    expect(entry?.billableRate).toBe(120);
  });

  // ─── 14. uncategorized task + owner default works ─────────────────────────

  it("uncategorized task + owner default resolves to the default", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      // no categoryId → uncategorized task
      assignees: [designer],
    });

    const entryId = await t
      .withIdentity(identity("designer_ext", "member"))
      .mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
      });

    const entry = await getEntry(t, entryId as Id<"timeEntries">);
    expect(entry?.snapshotCategoryId).toBe(w.design);
    expect(entry?.billableRate).toBe(120);
  });

  // ─── 15a. uncategorized + no default + billable → resolver error, no write ─

  it("uncategorized task + no default + billable throws before any write", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const user = await addUser(t, w, {
      externalId: "nodefault_ext",
      name: "No Default",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      assignees: [user],
    });

    await expect(
      t
        .withIdentity(identity("nodefault_ext", "member"))
        .mutation(api.timeEntries.create, {
          taskId,
          durationMinutes: 60,
          startedAt: START_MS,
        }),
    ).rejects.toThrow(/Choose a work category before logging billable time/);

    // Nothing was written.
    const count = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
        .collect();
      return rows.length;
    });
    expect(count).toBe(0);
  });

  // ─── 11. retainer entry records category, billableRate stays 0 ────────────

  it("retainer entry records the category but keeps billableRate 0", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w, { billingType: "retainer" });
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });

    const entryId = await t
      .withIdentity(identity("designer_ext", "member"))
      .mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
      });

    const entry = await getEntry(t, entryId as Id<"timeEntries">);
    expect(entry?.snapshotCategoryId).toBe(w.design); // recorded for grouping
    expect(entry?.billableRate).toBe(0); // retainer semantics unchanged
  });
});

// ─── 5. timer stop uses the owner's default ─────────────────────────────────

describe("timer stop — category resolution", () => {
  it("uses the owner's default category and its rate", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });

    const id = identity("designer_ext", "member");
    await t.withIdentity(id).mutation(api.timer.start, { taskId });
    const result = await t
      .withIdentity(id)
      .mutation(api.timer.stop, { overrideMinutes: 30 });

    expect((result as { entryId: Id<"timeEntries"> | null }).entryId).not.toBeNull();
    const entry = await getEntry(
      t,
      (result as { entryId: Id<"timeEntries"> }).entryId,
    );
    expect(entry?.snapshotCategoryId).toBe(w.design);
    expect(entry?.billableRate).toBe(120);
  });

  // ─── 15b. uncategorized + no default + billable timer stop keeps timer ────

  it("uncategorized task + no default keeps the timer alive on stop error", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const user = await addUser(t, w, {
      externalId: "nodefault_ext",
      name: "No Default",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, { projectId, assignees: [user] });

    // Bypass start (its pre-check would also reject) — plant a running timer
    // directly, then assert stop throws and the timer state is intact.
    await t.run(async (ctx) => {
      await ctx.db.patch(user, {
        timerTaskId: taskId,
        timerStartedAt: Date.now() - 60_000,
        timerAccumulatedMs: 0,
        timerStatus: "running" as const,
      });
    });

    await expect(
      t
        .withIdentity(identity("nodefault_ext", "member"))
        .mutation(api.timer.stop, {}),
    ).rejects.toThrow(/Choose a work category before logging billable time/);

    const stillRunning = await t.run(async (ctx) => {
      const u = await ctx.db.get(user);
      return u?.timerTaskId;
    });
    expect(stillRunning).toBe(taskId);
  });
});

// ─── 6-8, 10. update semantics ──────────────────────────────────────────────

describe("update — sticky category, re-resolution, guards", () => {
  it("task move keeps snapshotCategoryId (sticky)", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      role: "admin", // admin so it can move across tasks freely
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    const taskDev = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });
    const taskPm = await addTask(t, w, {
      projectId,
      categoryId: w.pm,
      assignees: [designer],
    });

    const id = identity("designer_ext", "admin");
    const entryId = (await t.withIdentity(id).mutation(api.timeEntries.create, {
      taskId: taskDev,
      durationMinutes: 60,
      startedAt: START_MS,
    })) as Id<"timeEntries">;
    // Created under designer's default (Design), even though task is Dev.
    expect((await getEntry(t, entryId))?.snapshotCategoryId).toBe(w.design);

    await t
      .withIdentity(id)
      .mutation(api.timeEntries.update, { id: entryId, taskId: taskPm });

    const entry = await getEntry(t, entryId);
    expect(entry?.taskId).toBe(taskPm); // moved
    expect(entry?.snapshotCategoryId).toBe(w.design); // but category unchanged
    expect(entry?.billableRate).toBe(120); // rate unchanged
  });

  it("billable toggle re-resolves from the ENTRY's category, not the task's", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
      defaultCat: w.design,
    });
    const projectId = await addProject(t, w);
    // Task is Development; entry will carry Design (via default).
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });

    const id = identity("designer_ext", "member");
    const entryId = (await t.withIdentity(id).mutation(api.timeEntries.create, {
      taskId,
      durationMinutes: 60,
      startedAt: START_MS,
      isBillable: false, // start non-billable → billableRate 0
    })) as Id<"timeEntries">;
    expect((await getEntry(t, entryId))?.snapshotCategoryId).toBe(w.design);
    expect((await getEntry(t, entryId))?.billableRate).toBe(0);

    await t
      .withIdentity(id)
      .mutation(api.timeEntries.update, { id: entryId, isBillable: true });

    const entry = await getEntry(t, entryId);
    // Design's rate (120), NOT the task's Development rate (100).
    expect(entry?.billableRate).toBe(120);
    expect(entry?.snapshotCategoryId).toBe(w.design);
  });

  it("explicit category change re-resolves and respects project overrides", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });
    // Project override for Design = 200 (beats the 120 category default).
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projectRateOverrides", {
        orgId: ORG_ID,
        projectId,
        workCategoryId: w.design,
        billableRate: 200,
        createdAt: now,
        updatedAt: now,
      });
    });

    const id = identity("designer_ext", "member");
    const entryId = (await t.withIdentity(id).mutation(api.timeEntries.create, {
      taskId,
      durationMinutes: 60,
      startedAt: START_MS,
    })) as Id<"timeEntries">;
    expect((await getEntry(t, entryId))?.billableRate).toBe(100); // Dev default

    await t
      .withIdentity(id)
      .mutation(api.timeEntries.update, {
        id: entryId,
        workCategoryId: w.design,
      });

    const entry = await getEntry(t, entryId);
    expect(entry?.snapshotCategoryId).toBe(w.design);
    expect(entry?.billableRate).toBe(200); // project override, not 120
  });

  it("locked entry (closeId set) rejects a category change", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });
    const id = identity("designer_ext", "member");
    const entryId = (await t.withIdentity(id).mutation(api.timeEntries.create, {
      taskId,
      durationMinutes: 60,
      startedAt: START_MS,
    })) as Id<"timeEntries">;

    // Settle it in a final close → locked (N1).
    await t.run(async (ctx) => {
      const closeId = await ctx.db.insert("billingCloses", {
        orgId: ORG_ID,
        projectId,
        kind: "t_and_m",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "final",
        currency: "EUR",
        roundingMinutes: 1,
        includedMinutes: 0,
        overageRateMinor: 0,
        usageMinutes: 60,
        overageMinutes: 0,
        amountMinor: 0,
        committedAt: Date.now(),
        committedBy: w.admin,
      });
      await ctx.db.patch(entryId, { closeId });
    });

    await expect(
      t
        .withIdentity(id)
        .mutation(api.timeEntries.update, {
          id: entryId,
          workCategoryId: w.pm,
        }),
    ).rejects.toThrow(/Cannot edit a time entry/);
  });
});

// ─── 9. cross-org categoryId rejected ───────────────────────────────────────

describe("cross-org category rejection", () => {
  it("rejects a foreign categoryId on create, update, and setDefaultWorkCategory", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: w.dev,
      assignees: [designer],
    });
    // A category living in a different org.
    const foreignCat = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("workCategories", {
        orgId: OTHER_ORG,
        name: "Foreign",
        color: "#222",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: w.admin,
      });
    });

    const id = identity("designer_ext", "member");

    await expect(
      t.withIdentity(id).mutation(api.timeEntries.create, {
        taskId,
        durationMinutes: 60,
        startedAt: START_MS,
        workCategoryId: foreignCat,
      }),
    ).rejects.toThrow(/Category not found/);

    // A clean entry to try updating.
    const entryId = (await t.withIdentity(id).mutation(api.timeEntries.create, {
      taskId,
      durationMinutes: 60,
      startedAt: START_MS,
    })) as Id<"timeEntries">;

    await expect(
      t.withIdentity(id).mutation(api.timeEntries.update, {
        id: entryId,
        workCategoryId: foreignCat,
      }),
    ).rejects.toThrow(/Category not found/);

    await expect(
      t.withIdentity(id).mutation(api.orgMembers.setDefaultWorkCategory, {
        memberUserId: designer,
        workCategoryId: foreignCat,
      }),
    ).rejects.toThrow(/Category not found/);
  });
});

// ─── 12. missing categoryRate throws before write; timer survives ───────────

describe("missing category rate", () => {
  it("timer stop throws and leaves the timer intact (rollback)", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    // A category with NO categoryRate in EUR.
    const ops = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("workCategories", {
        orgId: ORG_ID,
        name: "Ops",
        color: "#333",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        createdBy: w.admin,
      });
    });
    const user = await addUser(t, w, {
      externalId: "ops_ext",
      name: "Ops User",
    });
    const projectId = await addProject(t, w);
    const taskId = await addTask(t, w, {
      projectId,
      categoryId: ops,
      assignees: [user],
    });

    // Plant a running timer directly (start would also reject on the rate).
    await t.run(async (ctx) => {
      await ctx.db.patch(user, {
        timerTaskId: taskId,
        timerStartedAt: Date.now() - 60_000,
        timerAccumulatedMs: 0,
        timerStatus: "running" as const,
      });
    });

    await expect(
      t.withIdentity(identity("ops_ext", "member")).mutation(api.timer.stop, {}),
    ).rejects.toThrow(/Set a billable rate for this category in EUR/);

    const [stillRunning, entryCount] = await t.run(async (ctx) => {
      const u = await ctx.db.get(user);
      const rows = await ctx.db
        .query("timeEntries")
        .withIndex("by_taskId", (q) => q.eq("taskId", taskId))
        .collect();
      return [u?.timerTaskId, rows.length];
    });
    expect(stillRunning).toBe(taskId);
    expect(entryCount).toBe(0); // nothing written
  });
});

// ─── 13. setDefaultWorkCategory authorization ───────────────────────────────

describe("setDefaultWorkCategory — authorization & clearing", () => {
  it("member sets self, cannot set others; admin sets anyone; clearing works", async () => {
    const t = convexTest(schema, modules);
    const w = await baseSetup(t);
    const designer = await addUser(t, w, {
      externalId: "designer_ext",
      name: "Designer",
    });
    const developer = await addUser(t, w, {
      externalId: "dev_ext",
      name: "Developer",
    });

    const readDefault = (userId: Id<"users">) =>
      t.run(async (ctx) => {
        const m = await ctx.db
          .query("orgMembers")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .first();
        // t.run serializes an `undefined` return to null — coalesce so the
        // "unset" assertions below can use toBeNull consistently.
        return m?.defaultWorkCategoryId ?? null;
      });

    // Member sets self → ok.
    await t
      .withIdentity(identity("designer_ext", "member"))
      .mutation(api.orgMembers.setDefaultWorkCategory, {
        memberUserId: designer,
        workCategoryId: w.design,
      });
    expect(await readDefault(designer)).toBe(w.design);

    // Member sets someone else → rejected.
    await expect(
      t
        .withIdentity(identity("designer_ext", "member"))
        .mutation(api.orgMembers.setDefaultWorkCategory, {
          memberUserId: developer,
          workCategoryId: w.dev,
        }),
    ).rejects.toThrow(/You can only set your own default category/);
    expect(await readDefault(developer)).toBeNull();

    // Admin sets anyone → ok.
    await t
      .withIdentity(identity("admin_ext", "admin"))
      .mutation(api.orgMembers.setDefaultWorkCategory, {
        memberUserId: developer,
        workCategoryId: w.dev,
      });
    expect(await readDefault(developer)).toBe(w.dev);

    // Clearing works (undefined removes the default).
    await t
      .withIdentity(identity("designer_ext", "member"))
      .mutation(api.orgMembers.setDefaultWorkCategory, {
        memberUserId: designer,
      });
    expect(await readDefault(designer)).toBeNull();
  });
});
