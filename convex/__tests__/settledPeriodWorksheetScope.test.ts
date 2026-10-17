// @vitest-environment edge-runtime

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { resolveScopeEntries } from "../worksheetsHelpers";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_settled_period_scope";
const ADMIN = {
  subject: "settled_scope_user",
  tokenIdentifier: "test|settled_scope_user",
  org_id: ORG_ID,
  org_role: "org:admin",
} as never;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

/**
 * The closed-month (`settledPeriod`) worksheet scope reads the close's frozen
 * snapshot by report month, never entry dates — so the post-close worksheet
 * agrees with the Monthly Report: carried-in work (earlier date, settled into
 * this month) belongs; work skipped out of the month, or logged after the
 * close, doesn't (docs/prd-billing-refactor.md N8).
 */
describe("resolveScopeEntries — settledPeriod", () => {
  it("selects the close snapshot: carried-in included, skipped-out and late excluded", async () => {
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        name: "Test User",
        externalId: "settled_scope_user",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("orgMembers", {
        orgId: ORG_ID,
        clerkUserId: "settled_scope_user",
        userId,
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
        createdBy: userId,
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
        startDate: "2026-05-01",
        includedMinutesPerMonth: 6000,
        overageRate: 100,
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
      return { userId, projectId, taskId };
    });

    const insertEntry = (date: string): Promise<Id<"timeEntries">> =>
      t.run(async (ctx) => {
        const now = Date.now();
        return ctx.db.insert("timeEntries", {
          orgId: ORG_ID,
          projectId: ids.projectId,
          taskId: ids.taskId,
          userId: ids.userId,
          date,
          startedAt: now,
          durationMinutes: 60,
          note: "work",
          isBillable: true,
          method: "manual",
          costRate: 50,
          billableRate: 0,
          rateCurrency: "EUR",
          createdAt: now,
          updatedAt: now,
          createdBy: ids.userId,
        });
      });
    const admin = t.withIdentity(ADMIN);
    const commit = (periodStart: string) =>
      admin.mutation(api.billingCloses.commitClose, { projectId: ids.projectId, periodStart });

    // Dated May, skipped into June — carried in.
    const carriedIn = await insertEntry("2026-05-28");
    await admin.mutation(api.billingCloses.skipEntries, { entryIds: [carriedIn] });
    await commit("2026-05-01");
    // Dated June — the ordinary case.
    const inPeriod = await insertEntry("2026-06-10");
    // Dated June but skipped out to July.
    const skippedOut = await insertEntry("2026-06-20");
    await admin.mutation(api.billingCloses.skipEntries, { entryIds: [skippedOut] });
    await commit("2026-06-01");
    // Dated June, logged after the June close — open, belongs to July.
    const late = await insertEntry("2026-06-05");

    const result = await t.run(async (ctx) =>
      resolveScopeEntries(
        ctx,
        { kind: "settledPeriod", projectId: ids.projectId, periodStart: "2026-06-01" },
        ORG_ID,
      ),
    );
    const selected = new Set(result.entries.map((e) => e._id));
    expect(selected).toEqual(new Set([inPeriod, carriedIn]));
    expect(selected.has(skippedOut)).toBe(false);
    expect(selected.has(late)).toBe(false);
  });
});
