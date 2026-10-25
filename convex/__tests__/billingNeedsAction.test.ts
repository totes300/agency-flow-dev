// @vitest-environment edge-runtime

/**
 * The org read model (docs/prd-project-billing-redesign.md §5.5, §6.2, slice
 * 2): needs-action rows across projects, hub tiles and the sidebar badge
 * counts — all from one pass, and equal to the sum of the project models.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import {
  addEntry,
  addProject,
  asAdmin,
  asMember,
  billingWorld,
  commit,
  setInvoiceStatus,
} from "./helpers/billingWorld";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const setToday = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));

const retainer = { includedMinutesPerMonth: 600, overageRate: 90 };
const newWorld = () => billingWorld(convexTest(schema, modules));

/**
 * Today 2026-06-10. Projects:
 *   A retainer from April: Apr over (ready to invoice), May within (blocked ready to close)
 *   B retainer from May, no rate, over → needs rate
 *   C T&M: March invoiced and past due (finalized), May billable → ready to invoice
 *   D fixed: a draft invoice
 *   E archived retainer with waiting months → excluded
 */
async function scenario() {
  setToday("2026-04-10");
  const w = await newWorld();
  const c = await addProject(w, { billingType: "t_and_m", startDate: undefined });
  await addEntry(w, c, "2026-03-03", 60, { rate: 100 });
  const { invoiceId: cInv } = await commit(w, c, "2026-03-01");
  await setInvoiceStatus(w, cInv!, "invoiced");

  setToday("2026-06-10");
  const a = await addProject(w, { ...retainer, startDate: "2026-04-01" });
  await addEntry(w, a, "2026-04-04", 700);
  await addEntry(w, a, "2026-05-04", 100);
  const b = await addProject(w, { includedMinutesPerMonth: 60, startDate: "2026-05-01" });
  await addEntry(w, b, "2026-05-04", 90);
  await addEntry(w, c, "2026-05-03", 30, { rate: 100 });
  const d = await addProject(w, { billingType: "fixed", fixedPrice: 1000, startDate: undefined });
  await asAdmin(w).mutation(api.billingInvoices.createFixedInvoice, { projectId: d.projectId, amount: 400 });
  const e = await addProject(w, { ...retainer, startDate: "2026-01-01", archivedAt: Date.now() });
  await addEntry(w, e, "2026-02-04", 900);
  return { w, a, b, c, d, e };
}

describe("getNeedsAction", () => {
  it("one row per needs-action period, grouped in month-end order, archived excluded", async () => {
    const { w, a, b, c, d } = await scenario();
    const data = await asAdmin(w).query(api.billingViews.getNeedsAction, {});
    expect(data.rows.map((r) => [r.group, r.projectId, r.period?.key ?? null])).toEqual([
      ["needs_rate", b.projectId, "2026-05"],
      ["ready_to_invoice", a.projectId, "2026-04"],
      ["ready_to_invoice", c.projectId, "2026-05"],
      ["ready_to_close", a.projectId, "2026-05"],
      ["draft", d.projectId, null],
      ["past_due", c.projectId, "2026-03"],
    ]);
    const blocked = data.rows[3];
    expect(blocked.action).toMatchObject({ kind: "review_close", blocked: { reason: "Close April 2026 first" } });
    expect(data.rows[4]).toMatchObject({ action: { kind: "open_draft" }, undo: [{ kind: "delete_draft" }], amountMinor: 40000 });
    expect(data.rows[5]).toMatchObject({ action: { kind: "mark_paid" }, clientName: "Acme" });
  });

  it("counts: past due is listed but not counted as needs action", async () => {
    const { w } = await scenario();
    const data = await asAdmin(w).query(api.billingViews.getNeedsAction, {});
    // needs_rate 1 + ready_to_invoice 2 + ready_to_close 1 + fixed draft 1
    expect(data.needsActionCount).toBe(5);
    expect(data.pastDueCount).toBe(1);
    expect(await asAdmin(w).query(api.billingViews.getNavSignals, {})).toEqual({ needsActionCount: 5, pastDueCount: 1 });
  });

  it("org counts equal the sum of the project models (one definition)", async () => {
    const { w, a, b, c, d } = await scenario();
    let sum = 0;
    let pastDue = 0;
    for (const p of [a, b, c, d]) {
      const m = await asAdmin(w).query(api.billingViews.getProjectBillingPeriods, { projectId: p.projectId });
      sum += m!.needsActionCount;
      pastDue += m!.pastDueCount;
    }
    expect(await asAdmin(w).query(api.billingViews.getNavSignals, {})).toEqual({ needsActionCount: sum, pastDueCount: pastDue });
  });

  it("tiles: unbilled, outstanding, paid this month, months to close", async () => {
    const { w } = await scenario();
    const { tiles } = await asAdmin(w).query(api.billingViews.getNeedsAction, {});
    // Ready: A April 100 min × 90 = 15000; C May 30 min × 100 = 5000. Draft: D 40000.
    expect(tiles.unbilled).toEqual({ minorByCurrency: { EUR: 60000 }, readyCount: 2, draftCount: 1 });
    expect(tiles.outstanding).toEqual({ minorByCurrency: { EUR: 10000 }, pastDueCount: 1, invoicedCount: 0 });
    expect(tiles.paidThisMonth).toEqual({ minorByCurrency: {}, count: 0 });
    expect(tiles.monthsToClose).toEqual({ count: 1, waitingCount: 1 });
  });

  it("paid this month counts invoices paid in the current org month", async () => {
    const { w } = await scenario();
    const inv = await w.t.run(async (ctx) => (await ctx.db.query("invoices").collect()).find((i) => i.status === "invoiced"));
    await setInvoiceStatus(w, inv!._id, "paid");
    const { tiles, pastDueCount } = await asAdmin(w).query(api.billingViews.getNeedsAction, {});
    expect(tiles.paidThisMonth).toEqual({ minorByCurrency: { EUR: 10000 }, count: 1 });
    expect(pastDueCount).toBe(0);
  });

  it("past-due-only org: the badge falls back to the past-due count", async () => {
    setToday("2026-04-10");
    const w = await newWorld();
    const c = await addProject(w, { billingType: "t_and_m", startDate: undefined });
    await addEntry(w, c, "2026-03-03", 60, { rate: 100 });
    const { invoiceId } = await commit(w, c, "2026-03-01");
    await setInvoiceStatus(w, invoiceId!, "invoiced");
    setToday("2026-06-10");
    expect(await asAdmin(w).query(api.billingViews.getNavSignals, {})).toEqual({ needsActionCount: 0, pastDueCount: 1 });
  });

  it("refuses members", async () => {
    setToday("2026-04-10");
    const w = await newWorld();
    await expect(asMember(w).query(api.billingViews.getNeedsAction, {})).rejects.toThrow("Admin access required");
    await expect(asMember(w).query(api.billingViews.getNavSignals, {})).rejects.toThrow("Admin access required");
  });
});
