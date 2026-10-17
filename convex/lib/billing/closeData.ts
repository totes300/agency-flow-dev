/**
 * Loads a project's billing state into the shapes the pure modules take
 * (`scope.ts`, `pricing.ts`). The only place that maps Convex docs to the
 * close model — every close-model query and mutation goes through here.
 */

import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import { getProjectEntries } from "../projectEntries";
import { toMinor } from "./money";
import type { PricedEntry, PricingProject } from "./pricing";
import type { ScopeEntry, ScopeProject } from "./scope";

type Reader = { db: GenericDatabaseReader<DataModel> };

/** A time entry as both the scope rule and the pricing function see it. */
export type BillingEntry = ScopeEntry &
  PricedEntry & {
    _id: Id<"timeEntries">;
    doc: Doc<"timeEntries">;
  };

export type ClosableProject = Doc<"projects"> & { billingType: "retainer" | "t_and_m" };

export function isClosableProject(project: Doc<"projects">): project is ClosableProject {
  return project.billingType === "retainer" || project.billingType === "t_and_m";
}

/**
 * Locked = settled by a live close. `closeId` is cleared when a close is
 * released, so its presence alone means live. The legacy `invoiceId` /
 * `settledAt` locks still count until the contract phase removes them.
 */
export function isEntryLocked(e: Doc<"timeEntries">): boolean {
  return e.closeId !== undefined || e.invoiceId !== undefined || e.settledAt !== undefined;
}

export function toBillingEntry(e: Doc<"timeEntries">, currency: string): BillingEntry {
  return {
    _id: e._id,
    doc: e,
    date: e.date,
    isBillable: e.isBillable,
    skippedThrough: e.skippedThrough,
    locked: isEntryLocked(e),
    minutes: e.durationMinutes,
    taskId: e.taskId,
    categoryId: e.snapshotCategoryId ?? null,
    billableRateMinor: toMinor(e.billableRate, currency),
  };
}

export function toScopeProject(project: ClosableProject): ScopeProject {
  return {
    billingType: project.billingType,
    startDate: project.startDate,
    rolloverEnabled: project.rolloverEnabled,
    cycleLength: project.cycleLength,
  };
}

export function toPricingProject(project: ClosableProject, currency: string): PricingProject {
  return {
    ...toScopeProject(project),
    includedMinutesPerMonth: project.includedMinutesPerMonth,
    overageRateMinor: toMinor(project.overageRate ?? 0, currency),
  };
}

/** Live (draft or final) closes of a project, oldest first. */
export async function getLiveCloses(
  ctx: Reader,
  orgId: string,
  projectId: Id<"projects">,
): Promise<Doc<"billingCloses">[]> {
  const closes = await ctx.db
    .query("billingCloses")
    .withIndex("by_orgId_projectId_periodStart", (q) =>
      q.eq("orgId", orgId).eq("projectId", projectId),
    )
    .collect();
  return closes.filter((c) => c.status !== "released");
}

export type CloseContext = {
  project: ClosableProject;
  client: Doc<"clients">;
  currency: string;
  entries: BillingEntry[];
  liveCloses: Doc<"billingCloses">[];
  livePeriods: { start: string; end: string }[];
};

/**
 * Everything the scope rule and pricing need for one project. Verifies the
 * project and its client belong to `orgId` (tenant boundary).
 */
export async function loadCloseContext(
  ctx: Reader,
  orgId: string,
  projectId: Id<"projects">,
): Promise<CloseContext> {
  const project = await ctx.db.get(projectId);
  if (!project || project.orgId !== orgId) throw new ConvexError("Project not found.");
  if (!isClosableProject(project)) {
    throw new ConvexError("Only retainer and Time & Materials projects are closed by period.");
  }
  const client = await ctx.db.get(project.clientId);
  if (!client || client.orgId !== orgId) throw new ConvexError("Client not found for project.");
  const currency = client.currency;
  const docs = await getProjectEntries(ctx, orgId, projectId);
  const liveCloses = await getLiveCloses(ctx, orgId, projectId);
  return {
    project,
    client,
    currency,
    entries: docs.map((d) => toBillingEntry(d, currency)),
    liveCloses,
    livePeriods: liveCloses.map((c) => ({ start: c.periodStart, end: c.periodEnd })),
  };
}
