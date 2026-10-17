// @vitest-environment edge-runtime

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import {
  buildTaskRows,
  groupWorksheetRowsByTaskId,
} from "../worksheetsHelpers";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_worksheet_lifecycle";

type SeedResult = {
  project: Doc<"projects">;
  januaryEntry: Doc<"timeEntries">;
  juneEntry: Doc<"timeEntries">;
};

async function seed(
  t: ReturnType<typeof convexTest>,
): Promise<SeedResult> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Test User",
      externalId: "worksheet_lifecycle_user",
      createdAt: now,
      updatedAt: now,
    });
    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID,
      name: "Done",
      type: "done",
      color: "green",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Lifecycle Client",
      currency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId,
      name: "Lifecycle Project",
      code: "LIFE-001",
      billingType: "t_and_m",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const taskId = await ctx.db.insert("tasks", {
      orgId: ORG_ID,
      title: "Lifecycle task",
      statusId,
      statusType: "done",
      projectId,
      assigneeIds: [userId],
      billable: true,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    // Two work categories: a task's in-scope entries can now carry different
    // snapshot categories (entry-level billing category feature), so the
    // worksheet row's categoryName must list every snapshot it covers.
    const designCat = await ctx.db.insert("workCategories", {
      orgId: ORG_ID,
      name: "Design",
      color: "#111",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const devCat = await ctx.db.insert("workCategories", {
      orgId: ORG_ID,
      name: "Development",
      color: "#222",
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });

    async function insertEntry(input: {
      date: string;
      startedAt: number;
      durationMinutes: number;
      note: string;
      snapshotCategoryId?: Id<"workCategories">;
    }): Promise<Id<"timeEntries">> {
      return await ctx.db.insert("timeEntries", {
        orgId: ORG_ID,
        projectId,
        taskId,
        userId,
        date: input.date,
        startedAt: input.startedAt,
        durationMinutes: input.durationMinutes,
        note: input.note,
        isBillable: true,
        method: "manual",
        costRate: 50,
        billableRate: 100,
        rateCurrency: "EUR",
        ...(input.snapshotCategoryId
          ? { snapshotCategoryId: input.snapshotCategoryId }
          : {}),
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
    }

    const januaryId = await insertEntry({
      date: "2026-01-15",
      startedAt: Date.UTC(2026, 0, 15, 9),
      durationMinutes: 90,
      note: "Completed discovery and approved the implementation plan",
      snapshotCategoryId: designCat,
    });
    const juneId = await insertEntry({
      date: "2026-06-20",
      startedAt: Date.UTC(2026, 5, 20, 9),
      durationMinutes: 120,
      note: "Shipped the final implementation to production",
      snapshotCategoryId: devCat,
    });

    return {
      project: (await ctx.db.get(projectId))!,
      januaryEntry: (await ctx.db.get(januaryId))!,
      juneEntry: (await ctx.db.get(juneId))!,
    };
  });
}

describe("worksheet lifecycle evidence", () => {
  it("keeps financial totals scoped while including all task entry notes", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const [row] = await t.run(async (ctx) =>
      buildTaskRows(ctx, seeded.project, [seeded.juneEntry], ORG_ID),
    );

    expect(row.entryCount).toBe(1);
    expect(row.firstWorked).toBe("2026-06-20");
    expect(row.lastWorked).toBe("2026-06-20");
    expect(row.billableMinutes).toBe(120);
    expect(row.totalMinutes).toBe(120);
    expect(row.aiInput.entryNotes.map((entry) => entry.note)).toEqual([
      "Completed discovery and approved the implementation plan",
      "Shipped the final implementation to production",
    ]);
  });

  it("builds identical lifecycle evidence for repeated cycle-month rows", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const [januaryRows, juneRows] = await t.run(async (ctx) =>
      Promise.all([
        buildTaskRows(ctx, seeded.project, [seeded.januaryEntry], ORG_ID),
        buildTaskRows(ctx, seeded.project, [seeded.juneEntry], ORG_ID),
      ]),
    );

    expect(januaryRows[0].aiInput).toEqual(juneRows[0].aiInput);
    expect(januaryRows[0].totalMinutes).toBe(90);
    expect(juneRows[0].totalMinutes).toBe(120);

    const summaryGroups = groupWorksheetRowsByTaskId([
      januaryRows[0],
      juneRows[0],
    ]);
    expect(summaryGroups).toHaveLength(1);
    expect(summaryGroups[0].occurrenceCount).toBe(2);
  });

  it("lists every snapshot category when a task's in-scope entries span two", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    // Both entries belong to one task but carry different snapshot categories
    // (January = Design, June = Development). The worksheet row must label the
    // task with both, in date order — the same attribution rule Monthly Report
    // uses, so subtotals bucket identically.
    const [row] = await t.run(async (ctx) =>
      buildTaskRows(
        ctx,
        seeded.project,
        [seeded.januaryEntry, seeded.juneEntry],
        ORG_ID,
      ),
    );

    expect(row.categoryName).toBe("Design, Development");
    expect(row.entryCount).toBe(2);
  });
});
