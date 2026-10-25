/**
 * A one-org billing world for convex-test suites: an admin, a member, a
 * client, projects of any billing type with a task each, and entry inserts.
 * Mirrors the fixtures of `billingReadPath.test.ts`. The test file creates
 * the `convexTest` instance (this file is bundled by Convex, which cannot
 * load convex-test).
 */

import type { convexTest } from "convex-test";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { statusRow, taskRow } from "./taskFixtures";

export const ORG_ID = "org_billing";

export const ADMIN = {
  subject: "user_admin",
  tokenIdentifier: "test|user_admin",
  org_id: ORG_ID,
  org_role: "org:admin",
} as never;

export const MEMBER = {
  subject: "user_member",
  tokenIdentifier: "test|user_member",
  org_id: ORG_ID,
  org_role: "org:member",
} as never;

export type BillingWorld = {
  t: ReturnType<typeof convexTest>;
  userId: Id<"users">;
  memberId: Id<"users">;
  clientId: Id<"clients">;
  statusId: Id<"statuses">;
};

export type BillingProject = { projectId: Id<"projects">; taskId: Id<"tasks"> };

export async function billingWorld(
  t: ReturnType<typeof convexTest>,
  opts: { roundingMinutes?: number; timezone?: string } = {},
): Promise<BillingWorld> {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { name: "Admin", externalId: "user_admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG_ID, clerkUserId: "user_admin", userId, role: "admin", joinedAt: now });
    const memberId = await ctx.db.insert("users", { name: "Member", externalId: "user_member", createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG_ID, clerkUserId: "user_member", userId: memberId, role: "member", joinedAt: now });
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID,
      defaultCurrency: "EUR",
      timezone: opts.timezone ?? "UTC",
      roundingMinutes: opts.roundingMinutes ?? 1,
      brandName: "Test Agency",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const statusId = await ctx.db.insert("statuses", statusRow({
      orgId: ORG_ID, name: "Todo", category: "backlog", color: "#000", createdAt: now, updatedAt: now, createdBy: userId,
    }));
    const clientId = await ctx.db.insert("clients", { orgId: ORG_ID, name: "Acme", currency: "EUR", createdAt: now, updatedAt: now, createdBy: userId });
    return { userId, memberId, clientId, statusId };
  });
  return { t, ...ids };
}

let projectSeq = 0;

export async function addProject(w: BillingWorld, project: Record<string, unknown>): Promise<BillingProject> {
  projectSeq += 1;
  return w.t.run(async (ctx) => {
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId: w.clientId,
      name: `Project ${projectSeq}`,
      code: `PRJ${projectSeq}`,
      billingType: "retainer",
      startDate: "2026-03-01",
      createdAt: now,
      updatedAt: now,
      createdBy: w.userId,
      ...project,
    } as never);
    const taskId = await ctx.db.insert("tasks", taskRow({
      orgId: ORG_ID, title: "Support", statusId: w.statusId, statusCategory: "backlog", projectId, assigneeIds: [w.userId],
      billable: true, createdAt: now, updatedAt: now, createdBy: w.userId,
    }));
    return { projectId, taskId };
  });
}

export async function addEntry(
  w: BillingWorld,
  p: BillingProject,
  date: string,
  minutes: number,
  over: { billable?: boolean; rate?: number; cost?: number } = {},
): Promise<Id<"timeEntries">> {
  return w.t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("timeEntries", {
      orgId: ORG_ID, projectId: p.projectId, taskId: p.taskId, userId: w.userId, date,
      startedAt: Date.parse(`${date}T09:00:00Z`), durationMinutes: minutes, isBillable: over.billable ?? true,
      method: "manual", costRate: over.cost ?? 0, billableRate: over.rate ?? 0, rateCurrency: "EUR",
      createdAt: now, updatedAt: now, createdBy: w.userId,
    });
  });
}

export const asAdmin = (w: BillingWorld) => w.t.withIdentity(ADMIN);
export const asMember = (w: BillingWorld) => w.t.withIdentity(MEMBER);

export const commit = (w: BillingWorld, p: BillingProject, periodStart: string) =>
  asAdmin(w).mutation(api.billingCloses.commitClose, { projectId: p.projectId, periodStart });

export const setInvoiceStatus = (
  w: BillingWorld,
  id: Id<"invoices">,
  newStatus: "draft" | "invoiced" | "paid" | "void",
) => asAdmin(w).mutation(api.invoices.changeInvoiceStatus, { id, newStatus });
