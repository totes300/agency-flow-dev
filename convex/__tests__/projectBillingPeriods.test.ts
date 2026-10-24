// @vitest-environment edge-runtime

/**
 * The project billing read model (docs/prd-project-billing-redesign.md §6.1,
 * slice 1): per billing type, the §11 edge cases it owns, and N11 — a period
 * row agrees with the Close workspace, the queue, the monthly report and the
 * invoice, before and after commit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  addEntry,
  addProject,
  asAdmin,
  asMember,
  billingWorld as makeWorld,
  commit,
  setInvoiceStatus,
  type BillingProject,
  type BillingWorld,
} from "./helpers/billingWorld";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const billingWorld = (_modules: typeof modules, opts?: Parameters<typeof makeWorld>[1]) =>
  makeWorld(convexTest(schema, modules), opts);

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const setToday = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));

const retainer = { includedMinutesPerMonth: 600, overageRate: 90 };

const model = (w: BillingWorld, p: BillingProject) =>
  asAdmin(w).query(api.billingViews.getProjectBillingPeriods, { projectId: p.projectId });
const row = async (w: BillingWorld, p: BillingProject, key: string) =>
  (await model(w, p))?.periods.find((r) => r.key === key);
const states = async (w: BillingWorld, p: BillingProject) =>
  (await model(w, p))?.periods.map((r) => [r.key, r.state]);

describe("monthly retainer", () => {
  it("lists every period from the start to the current one, newest first, with states", async () => {
    setToday("2026-06-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-03-04", 700); // over by 100 → ready to invoice
    await addEntry(w, p, "2026-04-04", 300); // within → ready to close
    await addEntry(w, p, "2026-06-02", 30);
    const m = await model(w, p);
    expect(m?.currentKey).toBe("2026-06");
    expect(m?.periods.map((r) => [r.key, r.label, r.state, r.isCommittable, r.blockedBy?.key ?? null])).toEqual([
      ["2026-06", "June 2026", "in_progress", false, null],
      ["2026-05", "May 2026", "ready_to_close", false, "2026-03"],
      ["2026-04", "April 2026", "ready_to_close", false, "2026-03"],
      ["2026-03", "March 2026", "ready_to_invoice", true, null],
    ]);
    // §5.5: blocked periods count — they are work waiting.
    expect(m?.needsActionCount).toBe(3);
    expect(m?.totals.unbilledMinor).toBe(15000);
    const march = m!.periods[3];
    expect(march).toMatchObject({
      usageMinutes: 700,
      includedMinutes: 600,
      overageMinutes: 100,
      amountMinor: 15000,
      action: { kind: "review_invoice", emphasis: "primary" },
      documents: { monthlyReport: "preview", worksheet: "range" },
    });
    expect(m!.periods[2].action).toMatchObject({
      kind: "review_close",
      blocked: { reason: "Close March 2026 first", by: { key: "2026-03" } },
    });
  });

  it("drives a period through draft → invoiced → past due → paid → unpaid → void", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-03-04", 660);
    const { invoiceId } = await commit(w, p, "2026-03-01");
    expect(await row(w, p, "2026-03")).toMatchObject({
      state: "draft",
      action: { kind: "open_draft" },
      undo: [{ kind: "delete_draft" }],
      invoice: { id: invoiceId, number: null, status: "draft" },
      closeStatus: "draft",
    });
    expect((await model(w, p))?.needsActionCount).toBe(1);

    await setInvoiceStatus(w, invoiceId!, "invoiced");
    const invoiced = await row(w, p, "2026-03");
    expect(invoiced).toMatchObject({ state: "invoiced", action: { kind: "mark_paid" } });
    expect(invoiced?.invoice?.number).toMatch(/^INV-\d+/);
    expect(invoiced?.undo.map((u) => u.kind)).toEqual(["revert_to_draft", "void_invoice"]);
    expect(invoiced?.documents.monthlyReport).toBe("final");
    expect((await model(w, p))?.totals.outstandingMinor).toBe(9000);

    // Past due uses the org timezone's today against the due date.
    setToday("2026-06-10");
    expect((await row(w, p, "2026-03"))?.state).toBe("past_due");
    expect((await model(w, p))?.pastDueCount).toBe(1);

    await setInvoiceStatus(w, invoiceId!, "paid");
    expect(await row(w, p, "2026-03")).toMatchObject({ state: "paid", action: null, undo: [{ kind: "mark_unpaid" }] });
    await setInvoiceStatus(w, invoiceId!, "invoiced");
    // §11.2 — void → the period returns to ready, and needs action again.
    await setInvoiceStatus(w, invoiceId!, "void");
    expect(await row(w, p, "2026-03")).toMatchObject({ state: "ready_to_invoice", invoice: null, closeId: null });
    expect((await model(w, p))?.invoices.map((i) => i.status)).toEqual(["void"]);
  });

  it("§11.3 — a reverted (numbered) draft offers Void, not Delete", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-03-04", 660);
    const { invoiceId } = await commit(w, p, "2026-03-01");
    await setInvoiceStatus(w, invoiceId!, "invoiced");
    await setInvoiceStatus(w, invoiceId!, "draft");
    expect(await row(w, p, "2026-03")).toMatchObject({ state: "draft", undo: [{ kind: "void_invoice", confirm: true }] });
  });

  it("§11.4 — reopening behind a later live close is disabled with the reason", async () => {
    setToday("2026-05-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await commit(w, p, "2026-03-01");
    expect((await row(w, p, "2026-03"))?.undo).toEqual([{ kind: "reopen_period", label: "Reopen period", confirm: false }]);
    await commit(w, p, "2026-04-01");
    expect((await row(w, p, "2026-03"))?.undo[0]).toMatchObject({ disabledReason: "Reopen April 2026 first" });
    expect(await row(w, p, "2026-04")).toMatchObject({ state: "closed", action: null, closedAt: expect.any(Number) });
  });

  it("§11.5 — over budget with no overage rate → needs rate, Set rate, never a commit", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, { includedMinutesPerMonth: 60 });
    await addEntry(w, p, "2026-03-04", 90);
    expect(await row(w, p, "2026-03")).toMatchObject({
      state: "needs_rate",
      missingRate: true,
      action: { kind: "set_rate", label: "Set rate" },
    });
    await expect(commit(w, p, "2026-03-01")).rejects.toThrow("no overage rate");
  });

  it("§11.6 — an empty month is ready to close and blocks the next one", async () => {
    setToday("2026-05-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-04-04", 700);
    expect(await states(w, p)).toEqual([
      ["2026-05", "in_progress"],
      ["2026-04", "ready_to_invoice"],
      ["2026-03", "ready_to_close"],
    ]);
    expect((await row(w, p, "2026-04"))?.action).toMatchObject({ emphasis: "secondary", blocked: { by: { key: "2026-03" } } });
  });

  it("§11.11 — the current period shows its overage so far, no action", async () => {
    setToday("2026-03-20");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-03-04", 660);
    expect(await row(w, p, "2026-03")).toMatchObject({ state: "in_progress", amountMinor: 9000, action: null, undo: [] });
  });

  it("§11.1 — late time counts in the next open period; the closed one is frozen", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-03-04", 500);
    await addEntry(w, p, "2026-03-05", 30, { billable: false });
    await commit(w, p, "2026-03-01");
    await addEntry(w, p, "2026-03-28", 200); // logged late
    const march = await row(w, p, "2026-03");
    const april = await row(w, p, "2026-04");
    expect(march).toMatchObject({ state: "closed", usageMinutes: 500, billableMinutes: 500, nonBillableMinutes: 30 });
    expect(april).toMatchObject({ usageMinutes: 200, months: [{ key: "2026-04", workedMinutes: 200 }] });
    const report = await asAdmin(w).query(api.billingReports.getMonthlyReport, { projectId: p.projectId, year: 2026, month: 3 });
    expect(report?.balance.usedMinutes).toBe(500);
  });
});

describe("rollover retainer", () => {
  it("§11.8 — one row per cycle, months carry the trend, mid-cycle has no state of its own", async () => {
    setToday("2026-08-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, { ...retainer, startDate: "2026-04-01", rolloverEnabled: true, cycleLength: 3 });
    await addEntry(w, p, "2026-04-10", 500);
    await addEntry(w, p, "2026-05-10", 700);
    await addEntry(w, p, "2026-06-10", 700);
    await addEntry(w, p, "2026-07-10", 100);
    const m = await model(w, p);
    expect(m?.currentKey).toBe("2026-07");
    expect(m?.periods.map((r) => [r.key, r.label, r.state])).toEqual([
      ["2026-07", "Jul – Sep 2026", "in_progress"],
      ["2026-04", "Apr – Jun 2026", "ready_to_invoice"],
    ]);
    const q2 = m!.periods[1];
    expect(q2.includedMinutes).toBe(1800);
    expect(q2.amountMinor).toBe(15000);
    expect(q2.months.map((x) => [x.key, x.workedMinutes])).toEqual([
      ["2026-04", 500],
      ["2026-05", 700],
      ["2026-06", 700],
    ]);
  });
});

describe("T&M", () => {
  it("§11.7 — an ended month without billable work is not a row; the current month always is", async () => {
    setToday("2026-06-10");
    const w = await billingWorld(modules, { roundingMinutes: 15 });
    const p = await addProject(w, { billingType: "t_and_m", startDate: undefined });
    await addEntry(w, p, "2026-03-03", 20, { rate: 100 });
    await addEntry(w, p, "2026-04-03", 60, { billable: false });
    await addEntry(w, p, "2026-05-03", 50, { rate: 90 });
    const m = await model(w, p);
    expect(m?.periods.map((r) => [r.key, r.state, r.amountMinor, r.includedMinutes])).toEqual([
      ["2026-06", "in_progress", 0, null],
      ["2026-05", "ready_to_invoice", 9000, null],
      ["2026-03", "ready_to_invoice", 5000, null],
    ]);
    expect(m?.periods[1].blockedBy?.key).toBe("2026-03");
    expect(m?.periods.every((r) => r.documents.monthlyReport === null)).toBe(true);
  });
});

describe("T&M terms", () => {
  it("rate range = the project's effective category rates (override ?? org default)", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, { billingType: "t_and_m", startDate: undefined });
    expect((await model(w, p))?.terms.rateRangeMinor).toBeNull();
    await w.t.run(async (ctx) => {
      const now = Date.now();
      const cat = (name: string) =>
        ctx.db.insert("workCategories", { orgId: "org_billing", name, color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: w.userId });
      const design = await cat("Design");
      const dev = await cat("Dev");
      for (const [id, rate] of [[design, 80], [dev, 100]] as const) {
        await ctx.db.insert("categoryRates", { orgId: "org_billing", workCategoryId: id, currency: "EUR", defaultBillRate: rate, createdAt: now, updatedAt: now });
      }
      await ctx.db.insert("projectRateOverrides", { orgId: "org_billing", projectId: p.projectId, workCategoryId: dev, billableRate: 120, createdAt: now, updatedAt: now });
    });
    expect((await model(w, p))?.terms.rateRangeMinor).toEqual({ min: 8000, max: 12000 });
  });
});

describe("fixed fee and non-billable", () => {
  it("fixed: no periods; fixed billing with draft and remaining", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, { billingType: "fixed", fixedPrice: 12000, startDate: undefined });
    expect((await model(w, p))?.fixed).toMatchObject({ status: "not_invoiced", remainingMinor: 1200000, draft: null });
    const { invoiceId } = await asAdmin(w).mutation(api.billingInvoices.createFixedInvoice, {
      projectId: p.projectId,
      amount: 6000,
    });
    const m = await model(w, p);
    expect(m?.periods).toEqual([]);
    expect(m?.fixed).toMatchObject({ status: "draft", draftMinor: 600000, remainingMinor: 600000, draft: { id: invoiceId } });
    expect(m?.needsActionCount).toBe(1);
    await setInvoiceStatus(w, invoiceId, "invoiced");
    expect((await model(w, p))?.fixed).toMatchObject({ status: "partly_invoiced", invoicedMinor: 600000, draft: null });
  });

  it("non-billable: no periods, no fixed block", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, { billingType: "non_billable", startDate: undefined });
    expect(await model(w, p)).toMatchObject({ periods: [], fixed: null, needsActionCount: 0 });
  });
});

describe("§11.12 — timezone", () => {
  it("ended and past due follow the org timezone, not UTC", async () => {
    // 2026-04-01 02:00 in Tokyo is still March 31 in UTC.
    vi.setSystemTime(new Date("2026-03-31T17:00:00Z"));
    const w = await billingWorld(modules, { timezone: "Asia/Tokyo" });
    const p = await addProject(w, retainer);
    expect((await row(w, p, "2026-03"))?.state).toBe("ready_to_close");
    const utc = await billingWorld(modules, { timezone: "UTC" });
    const q = await addProject(utc, retainer);
    expect((await row(utc, q, "2026-03"))?.state).toBe("in_progress");
  });
});

describe("N11 — a period row agrees with every surface", () => {
  it("row = queue = workspace = report = invoice, open and after commit", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await addEntry(w, p, "2026-03-04", 400);
    await addEntry(w, p, "2026-03-18", 255);
    await addEntry(w, p, "2026-03-20", 120, { billable: false });

    const queue = (await asAdmin(w).query(internal.billingViews.getCloseQueue, {})).months
      .flatMap((m) => m.rows)
      .find((r) => r.projectId === p.projectId);
    const ws = await asAdmin(w).query(api.billingViews.getCloseWorkspace, { projectId: p.projectId, period: "2026-03" });
    const report = () =>
      asAdmin(w).query(api.billingReports.getMonthlyReport, { projectId: p.projectId, year: 2026, month: 3 });
    const open = await row(w, p, "2026-03");
    expect(open?.amountMinor).toBe(queue?.amountMinor);
    expect(open).toMatchObject({ usageMinutes: ws?.usageMinutes, overageMinutes: ws?.overageMinutes });
    expect(open?.amountMinor).toBe(8250);
    expect((await report())?.billing.overageAmount).toBe(82.5);

    const { invoiceId } = await commit(w, p, "2026-03-01");
    const closed = await row(w, p, "2026-03");
    const detail = await asAdmin(w).query(api.invoices.getInvoice, { identifier: invoiceId! });
    expect(closed).toMatchObject({ amountMinor: 8250, usageMinutes: 655, nonBillableMinutes: 120 });
    expect(closed?.invoice?.totalMinor).toBe(detail?.invoice.totalMinor);
    expect((await report())?.billing.overageAmount).toBe(82.5);
  });
});

describe("access", () => {
  it("refuses members and other orgs", async () => {
    setToday("2026-04-10");
    const w = await billingWorld(modules);
    const p = await addProject(w, retainer);
    await expect(
      asMember(w).query(api.billingViews.getProjectBillingPeriods, { projectId: p.projectId }),
    ).rejects.toThrow("Admin access required");
    const other = w.t.withIdentity({
      subject: "user_admin",
      tokenIdentifier: "test|user_admin",
      org_id: "org_other",
      org_role: "org:admin",
    } as never);
    await w.t.run(async (ctx) => {
      const user = await ctx.db.query("users").first();
      await ctx.db.insert("orgMembers", {
        orgId: "org_other", clerkUserId: "user_admin", userId: user!._id as Id<"users">, role: "admin", joinedAt: Date.now(),
      });
    });
    expect(await other.query(api.billingViews.getProjectBillingPeriods, { projectId: p.projectId })).toBeNull();
  });
});
