// @vitest-environment edge-runtime

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import type { Doc, Id } from "../_generated/dataModel";
import { resolveScopeEntries } from "../worksheetsHelpers";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_settled_period_scope";

/**
 * The `settledPeriod` worksheet scope selects by SETTLEMENT STAMP, never by
 * entry date — that's what makes the post-close worksheet agree with the
 * Monthly Report: carried-in work (earlier date, stamped into this period)
 * belongs, work skipped out of the period (in-month date, stamped later or
 * not settled) doesn't.
 */
describe("resolveScopeEntries — settledPeriod", () => {
  async function seed(t: ReturnType<typeof convexTest>): Promise<{
    projectId: Id<"projects">;
    inPeriod: Id<"timeEntries">;
    carriedIn: Id<"timeEntries">;
    skippedOut: Id<"timeEntries">;
    unsettled: Id<"timeEntries">;
  }> {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        name: "Test User",
        externalId: "settled_scope_user",
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
        name: "Stamp Client",
        currency: "EUR",
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
      const projectId = await ctx.db.insert("projects", {
        orgId: ORG_ID,
        clientId,
        name: "Stamp Project",
        code: "STMP-001",
        billingType: "retainer",
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
      const taskId = await ctx.db.insert("tasks", {
        orgId: ORG_ID,
        title: "Stamped task",
        statusId,
        statusType: "done",
        projectId,
        assigneeIds: [userId],
        billable: true,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });

      async function insertEntry(input: {
        date: string;
        settledPeriodStart?: string;
        settledPeriodEnd?: string;
      }): Promise<Id<"timeEntries">> {
        return await ctx.db.insert("timeEntries", {
          orgId: ORG_ID,
          taskId,
          userId,
          date: input.date,
          startedAt: now,
          durationMinutes: 60,
          note: "work",
          isBillable: true,
          method: "manual",
          costRate: 50,
          billableRate: 100,
          rateCurrency: "EUR",
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
          ...(input.settledPeriodStart
            ? {
                settledAt: now,
                settledReason: "retainer_included" as const,
                settledPeriodStart: input.settledPeriodStart,
                settledPeriodEnd: input.settledPeriodEnd,
              }
            : {}),
        });
      }

      // Stamped into June, dated June — the ordinary case.
      const inPeriod = await insertEntry({
        date: "2026-06-10",
        settledPeriodStart: "2026-06-01",
        settledPeriodEnd: "2026-06-30",
      });
      // Dated MAY but stamped into June (carried in) — must be selected.
      const carriedIn = await insertEntry({
        date: "2026-05-28",
        settledPeriodStart: "2026-06-01",
        settledPeriodEnd: "2026-06-30",
      });
      // Dated June but stamped into JULY (skipped out) — must be excluded.
      const skippedOut = await insertEntry({
        date: "2026-06-20",
        settledPeriodStart: "2026-07-01",
        settledPeriodEnd: "2026-07-31",
      });
      // Dated June, never settled — must be excluded.
      const unsettled = await insertEntry({ date: "2026-06-05" });

      return { projectId, inPeriod, carriedIn, skippedOut, unsettled };
    });
  }

  it("selects by stamp: carried-in included, skipped-out and unsettled excluded", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const entries = await t.run(async (ctx) => {
      const { entries } = await resolveScopeEntries(
        ctx,
        {
          kind: "settledPeriod",
          projectId: seeded.projectId,
          periodStart: "2026-06-01",
        },
        ORG_ID,
      );
      return entries.map((e: Doc<"timeEntries">) => e._id);
    });

    expect(entries).toHaveLength(2);
    expect(entries).toContain(seeded.inPeriod);
    expect(entries).toContain(seeded.carriedIn);
    expect(entries).not.toContain(seeded.skippedOut);
    expect(entries).not.toContain(seeded.unsettled);
  });

  it("returns nothing for an open (unstamped) period", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seed(t);

    const entries = await t.run(async (ctx) => {
      const { entries } = await resolveScopeEntries(
        ctx,
        {
          kind: "settledPeriod",
          projectId: seeded.projectId,
          periodStart: "2026-08-01",
        },
        ORG_ID,
      );
      return entries;
    });

    expect(entries).toHaveLength(0);
  });
});
