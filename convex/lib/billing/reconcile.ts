/**
 * Reconciliation (docs/prd-billing-refactor.md slice 6): re-derive every
 * close's numbers from its frozen snapshot and compare them with what is
 * stored on the close, its invoice and its entries. A healthy org returns no
 * issues. Read-only; run from the tests and from `billingReconcile.run`.
 *
 * Checked per close:
 *   live      N2  snapshot members = entries carrying `closeId`
 *             N6  money is integer minor units; invoice total = Σ lines
 *             N7  re-pricing the snapshot reproduces the close's usage,
 *                 overage, amount and (retainer) included minutes
 *             N11 the invoice's time + overage lines equal the priced lines
 *                 and the close amount; manual lines are the only extra
 *                 the close ↔ invoice link and statuses agree
 *   released     no entry still carries its `closeId`
 */

import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import { frozenPricingProject, snapshotMembers } from "./closeData";
import { priceScope } from "./pricing";

type Reader = { db: GenericDatabaseReader<DataModel> };

export type ReconcileIssue = {
  closeId: Id<"billingCloses">;
  projectId: Id<"projects">;
  periodStart: string;
  /** Short machine-readable code, e.g. "amount", "snapshot-missing-lock". */
  code: string;
  detail: string;
};

/** Every close of the org, live and released, checked. */
export async function reconcileOrg(ctx: Reader, orgId: string): Promise<ReconcileIssue[]> {
  const issues: ReconcileIssue[] = [];
  for (const status of ["draft", "final", "released"] as const) {
    const closes = await ctx.db
      .query("billingCloses")
      .withIndex("by_orgId_status", (q) => q.eq("orgId", orgId).eq("status", status))
      .collect();
    for (const close of closes) issues.push(...(await reconcileClose(ctx, close)));
  }
  return issues;
}

export async function reconcileClose(
  ctx: Reader,
  close: Doc<"billingCloses">,
): Promise<ReconcileIssue[]> {
  const issues: ReconcileIssue[] = [];
  const issue = (code: string, detail: string) =>
    issues.push({ closeId: close._id, projectId: close.projectId, periodStart: close.periodStart, code, detail });

  const locked = await ctx.db
    .query("timeEntries")
    .withIndex("by_orgId_projectId_closeId", (q) =>
      q.eq("orgId", close.orgId).eq("projectId", close.projectId).eq("closeId", close._id),
    )
    .collect();

  if (close.status === "released") {
    if (locked.length > 0) issue("released-still-locked", `${locked.length} entries still carry this released close`);
    return issues;
  }

  // N2 — the snapshot and the locks name the same entries.
  const rows = await ctx.db
    .query("billingCloseEntries")
    .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
    .collect();
  const snapshotIds = new Set<string>(rows.map((r) => r.entryId));
  const lockedIds = new Set<string>(locked.map((e) => e._id));
  for (const id of snapshotIds) if (!lockedIds.has(id)) issue("snapshot-missing-lock", `entry ${id} is in the snapshot but not locked`);
  for (const id of lockedIds) if (!snapshotIds.has(id)) issue("lock-missing-snapshot", `entry ${id} is locked but not in the snapshot`);
  if (rows.length !== snapshotIds.size) issue("snapshot-duplicate", "an entry appears twice in the snapshot");

  // N6 — integer minor units on the close.
  for (const [field, value] of [
    ["amountMinor", close.amountMinor],
    ["overageRateMinor", close.overageRateMinor],
  ] as const) {
    if (!Number.isInteger(value)) issue("not-integer", `close.${field} = ${value}`);
  }

  // N7 — the snapshot re-prices to the stored close.
  const price = priceScope({
    project: frozenPricingProject(close),
    period: { start: close.periodStart, end: close.periodEnd },
    members: snapshotMembers(rows),
    roundingMinutes: close.roundingMinutes,
    // Only the ladder's pending flags depend on today; a committed period
    // has elapsed, so its end is a safe "today".
    todayStr: close.periodEnd,
  });
  const compare = (code: string, stored: number, priced: number) => {
    if (stored !== priced) issue(code, `stored ${stored}, snapshot prices to ${priced}`);
  };
  compare("usage", close.usageMinutes, price.usageMinutes);
  compare("overage", close.overageMinutes, price.overageMinutes);
  compare("amount", close.amountMinor, price.amountMinor);
  if (close.kind === "retainer") compare("included", close.includedMinutes, price.includedMinutes);

  // The close ↔ invoice link.
  if (close.amountMinor === 0) {
    if (close.invoiceId) issue("unexpected-invoice", "a zero-amount close has an invoice");
    if (close.status !== "final") issue("status", `a zero-amount close is ${close.status}, expected final`);
    return issues;
  }
  if (!close.invoiceId) {
    issue("missing-invoice", "a close that bills money has no invoice");
    return issues;
  }
  const invoice = await ctx.db.get(close.invoiceId);
  if (!invoice || invoice.orgId !== close.orgId) {
    issue("missing-invoice", `invoice ${close.invoiceId} not found`);
    return issues;
  }
  if (invoice.closeId !== close._id) issue("invoice-link", "the invoice does not point back to this close");
  const expectedInvoiceStatuses = close.status === "draft" ? ["draft"] : ["invoiced", "paid"];
  if (!expectedInvoiceStatuses.includes(invoice.status)) {
    issue("status", `close is ${close.status} but its invoice is ${invoice.status}`);
  }
  issues.push(...(await reconcileInvoiceLines(ctx, invoice, close, price.lines, price.overage?.amountMinor ?? 0)));
  return issues;
}

async function reconcileInvoiceLines(
  ctx: Reader,
  invoice: Doc<"invoices">,
  close: Doc<"billingCloses">,
  pricedLines: { groupKey: string; amountMinor: number }[],
  pricedOverageMinor: number,
): Promise<ReconcileIssue[]> {
  const issues: ReconcileIssue[] = [];
  const issue = (code: string, detail: string) =>
    issues.push({ closeId: close._id, projectId: close.projectId, periodStart: close.periodStart, code, detail });

  const lines = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
    .collect();
  for (const li of lines) {
    if (!Number.isInteger(li.amountMinor) || !Number.isInteger(li.unitPriceMinor)) {
      issue("not-integer", `line ${li._id} amount ${li.amountMinor} / unit ${li.unitPriceMinor}`);
    }
  }

  // N6 — the document total is the sum of its lines.
  const linesTotal = lines.reduce((sum, li) => sum + li.amountMinor, 0);
  if (invoice.totalMinor !== linesTotal) issue("invoice-total", `total ${invoice.totalMinor}, lines sum to ${linesTotal}`);
  if (invoice.subtotalMinor !== invoice.totalMinor) {
    issue("invoice-subtotal", `subtotal ${invoice.subtotalMinor} differs from total ${invoice.totalMinor}`);
  }

  // N11 — time lines match the priced groups; overage matches; together they
  // equal the close amount (manual lines are the only allowed extra).
  const stored = new Map<string, number>();
  for (const li of lines) {
    if (li.lineType !== "time") continue;
    const key = li.groupKey ?? `line:${li._id}`;
    stored.set(key, (stored.get(key) ?? 0) + li.amountMinor);
  }
  const priced = new Map(pricedLines.map((l) => [l.groupKey, l.amountMinor]));
  for (const [key, amount] of priced) {
    if (stored.get(key) !== amount) issue("time-line", `group ${key}: stored ${stored.get(key) ?? "none"}, priced ${amount}`);
  }
  for (const key of stored.keys()) {
    if (!priced.has(key)) issue("time-line", `group ${key} is on the invoice but not in the snapshot`);
  }
  const overageMinor = lines
    .filter((li) => li.lineType === "overage")
    .reduce((sum, li) => sum + li.amountMinor, 0);
  if (overageMinor !== pricedOverageMinor) issue("overage-line", `stored ${overageMinor}, priced ${pricedOverageMinor}`);
  const billedMinor = lines
    .filter((li) => li.lineType === "time" || li.lineType === "overage")
    .reduce((sum, li) => sum + li.amountMinor, 0);
  if (billedMinor !== close.amountMinor) {
    issue("invoice-amount", `time + overage lines ${billedMinor}, close amount ${close.amountMinor}`);
  }
  return issues;
}
