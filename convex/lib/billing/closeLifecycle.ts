/**
 * Close lifecycle — commit and release (docs/prd-billing-refactor.md §8).
 *
 * `commitClose` is the ONLY way a retainer or T&M period gets settled and the
 * only way such an invoice comes into being. In one transaction it re-derives
 * the committable period, the scope and the price from current data (client
 * state is never trusted), writes the close, its immutable snapshot and the
 * entry locks, and — when there is money to bill — the draft invoice.
 *
 * `releaseClose` is its single inverse (draft deleted, invoice voided, period
 * reopened): the close row stays for audit, the entries become open again and
 * re-resolve through the scope rule; their skip stamps survive.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { ActivityVia } from "../../tasks/model";
import { getOrgSettings } from "../orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "../timer";
import {
  loadCloseContext,
  getLiveCloses,
  toPricingProject,
  toScopeProject,
  type BillingEntry,
  type ClosableProject,
} from "./closeData";
import { appendBillingEvent } from "./events";
import { monthLabel, periodSubjectLabel } from "./labels";
import { fromMinor, round2 } from "./money";
import { monthBucket, type Period } from "./periods";
import { priceScope, type PriceResult } from "./pricing";
import { committablePeriod, scopeOf, type ScopeMember } from "./scope";

/** Who acts. `via` is set only for writes through an external agent (MCP, D15). */
export type Actor = { orgId: string; userId: Id<"users">; via?: ActivityVia };

export type CommitResult = {
  closeId: Id<"billingCloses">;
  /** Present when the close bills money (over-budget retainer, T&M). */
  invoiceId: Id<"invoices"> | null;
  /** Entries the close settled (billable and non-billable). */
  entryCount: number;
};

/** One line of the draft invoice a close creates, exactly as it will be inserted. */
export type DraftInvoiceLine = {
  lineType: "time" | "overage";
  description: string;
  quantityMinutes: number;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  groupKey?: string;
  workCategoryId?: Id<"workCategories">;
};

/** The draft invoice a close creates, exactly as it will be inserted. */
export type DraftInvoicePlan = {
  prefix: string;
  subject: string;
  issueDate: string;
  dueDate: string;
  messageToClient?: string;
  lines: DraftInvoiceLine[];
};

/**
 * Everything `commitClose` writes, computed without writing: the committable
 * period, its scope (the entries the close settles and locks), the frozen
 * price and — when it bills money — the draft invoice. The app's commit and
 * the MCP preview (docs/prd-mcp.md §9) both come from here, so a preview is
 * the commit's own plan.
 */
export type ClosePlan = {
  project: ClosableProject;
  currency: string;
  period: Period;
  members: ScopeMember<BillingEntry>[];
  roundingMinutes: number;
  overageRateMinor: number;
  price: PriceResult;
  invoice: DraftInvoicePlan | null;
};

/**
 * Plans the close of the project's committable period. Throws the same
 * errors the commit always has; reads only.
 */
export async function planClose(
  ctx: QueryCtx,
  orgId: string,
  args: { projectId: Id<"projects">; periodStart: string },
): Promise<ClosePlan> {
  const c = await loadCloseContext(ctx, orgId, args.projectId);
  const orgSettings = await getOrgSettings(ctx, orgId);
  const todayStr = getDateInTimezone(Date.now(), orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK);

  // Oldest-first (N5) and uniqueness (N3): the requested period must be the
  // committable one, which by definition has no live close.
  const scopeProject = toScopeProject(c.project);
  const { period } = committablePeriod({
    project: scopeProject,
    entries: c.entries,
    liveCloses: c.livePeriods,
    todayStr,
  });
  if (!period) throw new ConvexError("Nothing to close for this project yet.");
  if (period.start !== args.periodStart) {
    throw new ConvexError(
      `${periodSubjectLabel(period.start, period.end)} must be closed first.`,
    );
  }

  const members = scopeOf({
    project: scopeProject,
    entries: c.entries,
    liveCloses: c.livePeriods,
    period,
  });
  // Retainer math is always raw; T&M line rounding is frozen into the close.
  const roundingMinutes = c.project.billingType === "retainer" ? 1 : orgSettings?.roundingMinutes ?? 1;
  const pricingProject = toPricingProject(c.project, c.currency);
  const price = priceScope({
    project: pricingProject,
    period,
    members,
    roundingMinutes,
    todayStr,
  });
  if (price.issues.includes("missing-overage-rate")) {
    throw new ConvexError("This period is over budget but the project has no overage rate. Set one first.");
  }

  const invoice =
    price.amountMinor > 0
      ? await planDraftInvoice(ctx, orgSettings, c.project, c.currency, period, price)
      : null;
  return {
    project: c.project,
    currency: c.currency,
    period,
    members,
    roundingMinutes,
    overageRateMinor: pricingProject.overageRateMinor ?? 0,
    price,
    invoice,
  };
}

/** Writes a planned close: the close, its snapshot and locks, the draft invoice, one event. */
export async function applyClosePlan(
  ctx: MutationCtx,
  actor: Actor,
  plan: ClosePlan,
): Promise<CommitResult> {
  const { orgId, userId } = actor;
  const { project, period, price } = plan;
  const now = Date.now();
  const billsMoney = plan.invoice !== null;
  const closeId = await ctx.db.insert("billingCloses", {
    orgId,
    projectId: project._id,
    kind: project.billingType,
    periodStart: period.start,
    periodEnd: period.end,
    status: billsMoney ? "draft" : "final",
    currency: plan.currency,
    roundingMinutes: plan.roundingMinutes,
    includedMinutes: price.includedMinutes,
    overageRateMinor: plan.overageRateMinor,
    usageMinutes: price.usageMinutes,
    overageMinutes: price.overageMinutes,
    amountMinor: price.amountMinor,
    committedAt: now,
    committedBy: userId,
    ...(billsMoney ? {} : { finalizedAt: now }),
  });

  await writeSnapshot(ctx, orgId, closeId, period, plan.members);

  let invoiceId: Id<"invoices"> | null = null;
  if (plan.invoice) {
    invoiceId = await insertDraftInvoice(ctx, actor, project, plan.currency, closeId, price, plan.invoice);
    await ctx.db.patch(closeId, { invoiceId });
  }

  await appendBillingEvent(ctx, {
    orgId,
    projectId: project._id,
    type: "close_committed",
    actorId: userId,
    via: actor.via,
    closeId,
    ...(invoiceId ? { invoiceId } : {}),
    data: { periodStart: period.start, amountMinor: price.amountMinor, entries: plan.members.length },
  });
  return { closeId, invoiceId, entryCount: plan.members.length };
}

/**
 * Settles the committable period (see the module comment). The one commit
 * path: the app's mutation and the MCP commit both run plan + apply.
 */
export async function commitClose(
  ctx: MutationCtx,
  actor: Actor,
  args: { projectId: Id<"projects">; periodStart: string },
): Promise<CommitResult> {
  return applyClosePlan(ctx, actor, await planClose(ctx, actor.orgId, args));
}

/** The immutable membership snapshot (N2) plus the entry locks (N1). */
async function writeSnapshot(
  ctx: MutationCtx,
  orgId: string,
  closeId: Id<"billingCloses">,
  period: { start: string; end: string },
  members: ScopeMember<BillingEntry>[],
): Promise<void> {
  const now = Date.now();
  for (const { entry, carried } of members) {
    await ctx.db.insert("billingCloseEntries", {
      orgId,
      closeId,
      entryId: entry._id,
      taskId: entry.doc.taskId,
      ...(entry.doc.snapshotCategoryId ? { categoryId: entry.doc.snapshotCategoryId } : {}),
      date: entry.date,
      monthKey: monthBucket(entry.date, period),
      minutes: entry.minutes,
      isBillable: entry.isBillable,
      billableRateMinor: entry.billableRateMinor,
      ...(carried ? { carried } : {}),
    });
    await ctx.db.patch(entry._id, { closeId, updatedAt: now });
  }
}

/** The draft invoice a priced period produces: header from org settings, one line per time group plus overage. */
async function planDraftInvoice(
  ctx: QueryCtx,
  orgSettings: Doc<"orgSettings"> | null,
  project: Doc<"projects">,
  currency: string,
  period: Period,
  price: PriceResult,
): Promise<DraftInvoicePlan> {
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
  const issueDate = getDateInTimezone(Date.now(), timezone);
  const due = new Date(`${issueDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + (orgSettings?.defaultPaymentTermsDays ?? 30));
  const isRetainer = project.billingType === "retainer";

  const taskTitles = new Map<string, string>();
  for (const line of price.lines) {
    if (taskTitles.has(line.taskId)) continue;
    const task = await ctx.db.get(line.taskId as Id<"tasks">);
    taskTitles.set(line.taskId, task?.title ?? "Unknown task");
  }

  const lines: DraftInvoiceLine[] = price.lines.map((line) => ({
    lineType: "time",
    description: taskTitles.get(line.taskId) ?? "Unknown task",
    quantityMinutes: line.minutes,
    quantity: round2(line.billedMinutes / 60),
    unitPriceMinor: line.rateMinor,
    amountMinor: line.amountMinor,
    groupKey: line.groupKey,
    ...(line.categoryId ? { workCategoryId: line.categoryId as Id<"workCategories"> } : {}),
  }));
  if (price.overage) {
    const rate = fromMinor(price.overage.rateMinor, currency);
    const hours = round2(price.overage.minutes / 60);
    lines.push({
      lineType: "overage",
      description: `Overage (${hours}h × ${rate}/h)`,
      quantityMinutes: price.overage.minutes,
      quantity: hours,
      unitPriceMinor: price.overage.rateMinor,
      amountMinor: price.overage.amountMinor,
    });
  }

  return {
    prefix: orgSettings?.invoicePrefix ?? "INV-",
    subject: isRetainer
      ? `${periodSubjectLabel(period.start, period.end)} overage`
      : monthLabel(period.start),
    issueDate,
    dueDate: due.toISOString().slice(0, 10),
    ...(orgSettings?.invoiceMessageTemplate ? { messageToClient: orgSettings.invoiceMessageTemplate } : {}),
    lines,
  };
}

async function insertDraftInvoice(
  ctx: MutationCtx,
  actor: Actor,
  project: Doc<"projects">,
  currency: string,
  closeId: Id<"billingCloses">,
  price: PriceResult,
  draft: DraftInvoicePlan,
): Promise<Id<"invoices">> {
  const { orgId, userId } = actor;
  const now = Date.now();
  const totalMinor = price.amountMinor;

  const invoiceId = await ctx.db.insert("invoices", {
    orgId,
    projectId: project._id,
    clientId: project.clientId,
    prefix: draft.prefix,
    subject: draft.subject,
    status: "draft",
    currency,
    subtotalMinor: totalMinor,
    totalMinor,
    issueDate: draft.issueDate,
    dueDate: draft.dueDate,
    ...(draft.messageToClient ? { messageToClient: draft.messageToClient } : {}),
    closeId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  });

  let sortOrder = 0;
  for (const line of draft.lines) {
    await ctx.db.insert("invoiceLineItems", {
      orgId,
      invoiceId,
      sortOrder: sortOrder++,
      ...line,
      createdAt: now,
      updatedAt: now,
    });
  }
  return invoiceId;
}

/**
 * Undo a close: mark it released (kept for audit) and reopen its entries.
 * Callers handle the invoice side (delete / void) and their own event.
 */
export async function releaseClose(
  ctx: MutationCtx,
  actor: Actor,
  close: Doc<"billingCloses">,
  reason: NonNullable<Doc<"billingCloses">["releasedReason"]>,
): Promise<void> {
  if (close.status === "released") return;
  const now = Date.now();
  const snapshot = await ctx.db
    .query("billingCloseEntries")
    .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
    .collect();
  for (const row of snapshot) {
    const entry = await ctx.db.get(row.entryId);
    // Only clear a lock this close owns — never another close's.
    if (entry && entry.orgId === actor.orgId && entry.closeId === close._id) {
      await ctx.db.patch(entry._id, { closeId: undefined, updatedAt: now });
    }
  }
  await ctx.db.patch(close._id, { status: "released", releasedAt: now, releasedReason: reason });
  await appendBillingEvent(ctx, {
    orgId: actor.orgId,
    projectId: close.projectId,
    type: "close_released",
    actorId: actor.userId,
    via: actor.via,
    closeId: close._id,
    ...(close.invoiceId ? { invoiceId: close.invoiceId } : {}),
    data: { reason },
  });
}

/** What reopening a within-budget close does, computed without writing. */
export type ReopenPlan = {
  close: Doc<"billingCloses">;
  /** Entries the close settled — they become editable again. */
  reopenedCount: number;
  /** Their minutes (billable and non-billable), from the close's snapshot. */
  reopenedMinutes: number;
};

/**
 * Plans reopening the period containing `periodStart` when its close billed
 * nothing (within-budget retainer). Throws the app's errors; reads only.
 */
export async function planReopen(
  ctx: QueryCtx,
  orgId: string,
  args: { projectId: Id<"projects">; periodStart: string },
): Promise<ReopenPlan> {
  const close = (await getLiveCloses(ctx, orgId, args.projectId)).find(
    (c) => c.periodStart <= args.periodStart && c.periodEnd >= args.periodStart,
  );
  if (!close || close.status !== "final") throw new ConvexError("This period is not closed.");
  if (close.invoiceId) {
    throw new ConvexError("This period is billed on an invoice. Void that invoice to reopen it.");
  }
  // Oldest-first in reverse: reopening an earlier period under a later live
  // close would make the later one cover work that now belongs before it.
  const later = await ctx.db
    .query("billingCloses")
    .withIndex("by_orgId_projectId_periodStart", (q) =>
      q.eq("orgId", orgId).eq("projectId", close.projectId).gt("periodStart", close.periodStart),
    )
    .collect();
  if (later.some((c) => c.status !== "released")) {
    throw new ConvexError("Reopen the later closed periods first.");
  }
  const snapshot = await ctx.db
    .query("billingCloseEntries")
    .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
    .collect();
  return {
    close,
    reopenedCount: snapshot.length,
    reopenedMinutes: snapshot.reduce((sum, row) => sum + row.minutes, 0),
  };
}

/** Reopens a planned close (`releaseClose` with reason "reopened"). */
export async function applyReopen(
  ctx: MutationCtx,
  actor: Actor,
  plan: ReopenPlan,
): Promise<{ reopenedCount: number }> {
  await releaseClose(ctx, actor, plan.close, "reopened");
  return { reopenedCount: plan.reopenedCount };
}
