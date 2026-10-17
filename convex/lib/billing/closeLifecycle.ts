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
import type { MutationCtx } from "../../_generated/server";
import { getOrgSettings } from "../orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "../timer";
import { loadCloseContext, toPricingProject, toScopeProject, type BillingEntry } from "./closeData";
import { appendBillingEvent } from "./events";
import { monthLabel, periodSubjectLabel } from "./labels";
import { fromMinor, round2 } from "./money";
import { monthBucket } from "./periods";
import { priceScope, type PriceResult } from "./pricing";
import { committablePeriod, scopeOf, type ScopeMember } from "./scope";

type Actor = { orgId: string; userId: Id<"users"> };

export type CommitResult = {
  closeId: Id<"billingCloses">;
  /** Present when the close bills money (over-budget retainer, T&M). */
  invoiceId: Id<"invoices"> | null;
};

export async function commitClose(
  ctx: MutationCtx,
  actor: Actor,
  args: { projectId: Id<"projects">; periodStart: string },
): Promise<CommitResult> {
  const { orgId, userId } = actor;
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

  const now = Date.now();
  const billsMoney = price.amountMinor > 0;
  const closeId = await ctx.db.insert("billingCloses", {
    orgId,
    projectId: c.project._id,
    kind: c.project.billingType,
    periodStart: period.start,
    periodEnd: period.end,
    status: billsMoney ? "draft" : "final",
    currency: c.currency,
    roundingMinutes,
    includedMinutes: price.includedMinutes,
    overageRateMinor: pricingProject.overageRateMinor ?? 0,
    usageMinutes: price.usageMinutes,
    overageMinutes: price.overageMinutes,
    amountMinor: price.amountMinor,
    committedAt: now,
    committedBy: userId,
    ...(billsMoney ? {} : { finalizedAt: now }),
  });

  await writeSnapshot(ctx, orgId, closeId, period, members);

  let invoiceId: Id<"invoices"> | null = null;
  if (billsMoney) {
    invoiceId = await insertDraftInvoice(ctx, actor, c.project, c.currency, closeId, period, price);
    await ctx.db.patch(closeId, { invoiceId });
  }

  await appendBillingEvent(ctx, {
    orgId,
    projectId: c.project._id,
    type: "close_committed",
    actorId: userId,
    closeId,
    ...(invoiceId ? { invoiceId } : {}),
    data: { periodStart: period.start, amountMinor: price.amountMinor, entries: members.length },
  });
  return { closeId, invoiceId };
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

async function insertDraftInvoice(
  ctx: MutationCtx,
  actor: Actor,
  project: Doc<"projects">,
  currency: string,
  closeId: Id<"billingCloses">,
  period: { start: string; end: string },
  price: PriceResult,
): Promise<Id<"invoices">> {
  const { orgId, userId } = actor;
  const orgSettings = await getOrgSettings(ctx, orgId);
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;
  const issueDate = getDateInTimezone(Date.now(), timezone);
  const due = new Date(`${issueDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + (orgSettings?.defaultPaymentTermsDays ?? 30));
  const now = Date.now();
  const totalMinor = price.amountMinor;
  const isRetainer = project.billingType === "retainer";

  const invoiceId = await ctx.db.insert("invoices", {
    orgId,
    projectId: project._id,
    clientId: project.clientId,
    prefix: orgSettings?.invoicePrefix ?? "INV-",
    subject: isRetainer
      ? `${periodSubjectLabel(period.start, period.end)} overage`
      : monthLabel(period.start),
    status: "draft",
    currency,
    subtotal: fromMinor(totalMinor, currency),
    total: fromMinor(totalMinor, currency),
    subtotalMinor: totalMinor,
    totalMinor,
    issueDate,
    dueDate: due.toISOString().slice(0, 10),
    periodStart: period.start,
    periodEnd: period.end,
    ...(orgSettings?.invoiceMessageTemplate ? { messageToClient: orgSettings.invoiceMessageTemplate } : {}),
    closeId,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  });

  const taskTitles = new Map<string, string>();
  for (const line of price.lines) {
    if (taskTitles.has(line.taskId)) continue;
    const task = await ctx.db.get(line.taskId as Id<"tasks">);
    taskTitles.set(line.taskId, task?.title ?? "Unknown task");
  }

  let sortOrder = 0;
  for (const line of price.lines) {
    await ctx.db.insert("invoiceLineItems", {
      orgId,
      invoiceId,
      sortOrder: sortOrder++,
      lineType: "time",
      description: taskTitles.get(line.taskId) ?? "Unknown task",
      quantityMinutes: line.minutes,
      quantity: round2(line.billedMinutes / 60),
      unitPrice: fromMinor(line.rateMinor, currency),
      unitPriceMinor: line.rateMinor,
      amount: fromMinor(line.amountMinor, currency),
      amountMinor: line.amountMinor,
      groupKey: line.groupKey,
      ...(line.categoryId ? { workCategoryId: line.categoryId as Id<"workCategories"> } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }
  if (price.overage) {
    const rate = fromMinor(price.overage.rateMinor, currency);
    const hours = round2(price.overage.minutes / 60);
    await ctx.db.insert("invoiceLineItems", {
      orgId,
      invoiceId,
      sortOrder: sortOrder++,
      lineType: "overage",
      description: `Overage (${hours}h × ${rate}/h)`,
      quantityMinutes: price.overage.minutes,
      quantity: hours,
      unitPrice: rate,
      unitPriceMinor: price.overage.rateMinor,
      amount: fromMinor(price.overage.amountMinor, currency),
      amountMinor: price.overage.amountMinor,
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
    closeId: close._id,
    ...(close.invoiceId ? { invoiceId: close.invoiceId } : {}),
    data: { reason },
  });
}
