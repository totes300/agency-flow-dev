// @vitest-environment edge-runtime

/**
 * Close-model write path (docs/prd-billing-refactor.md §8, slice 3a), through
 * the public API: commit, release, skip, the invoice lifecycle, fixed-fee
 * invoices and draft editing — with the invariants each step must keep:
 * N1 lock, N2 snapshot, N3/N5 one close per period oldest-first, N7 frozen
 * money, N9 numbering, N10 one event per transition.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { NEVER_NUMBERED_VOID } from "../lib/billing/invoiceLifecycle";
import { reconcileOrg } from "../lib/billing/reconcile";
import { statusRow, taskRow } from "./helpers/taskFixtures";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_write";
const ADMIN = {
  subject: "user_admin",
  tokenIdentifier: "test|user_admin",
  org_id: ORG_ID,
  org_role: "org:admin",
} as never;

const newTest = () => convexTest(schema, modules);
type T = ReturnType<typeof newTest>;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const setToday = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));

// ─── Fixtures ──────────────────────────────────────────────────────────────

type World = {
  t: T;
  userId: Id<"users">;
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
};

async function world(
  project:
    | { billingType: "retainer"; includedMinutesPerMonth: number; overageRate: number }
    | { billingType: "t_and_m" }
    | { billingType: "fixed"; fixedPrice: number },
  roundingMinutes = 1,
): Promise<World> {
  const t = newTest();
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Admin",
      externalId: "user_admin",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID,
      clerkUserId: "user_admin",
      userId,
      role: "admin",
      joinedAt: now,
    });
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID,
      defaultCurrency: "EUR",
      timezone: "UTC",
      roundingMinutes,
      brandName: "Test Agency",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const statusId = await ctx.db.insert("statuses", statusRow({
      orgId: ORG_ID,
      name: "Todo",
      category: "backlog",
      color: "#000",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    }));
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Acme",
      currency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG_ID,
      clientId,
      name: "Project",
      code: "PRJ-1",
      startDate: "2026-03-01",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      ...project,
    });
    const taskId = await ctx.db.insert("tasks", taskRow({
      orgId: ORG_ID,
      title: "Support",
      statusId,
      statusCategory: "backlog",
      projectId,
      assigneeIds: [userId],
      billable: true,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    }));
    return { userId, projectId, taskId };
  });
  return { t, ...ids };
}

async function addEntry(
  w: World,
  date: string,
  minutes: number,
  over: { billable?: boolean; rate?: number } = {},
): Promise<Id<"timeEntries">> {
  return w.t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("timeEntries", {
      orgId: ORG_ID,
      projectId: w.projectId,
      taskId: w.taskId,
      userId: w.userId,
      date,
      startedAt: Date.parse(`${date}T09:00:00Z`),
      durationMinutes: minutes,
      isBillable: over.billable ?? true,
      method: "manual",
      costRate: 0,
      billableRate: over.rate ?? 0,
      rateCurrency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: w.userId,
    });
  });
}

const as = (w: World) => w.t.withIdentity(ADMIN);
const get = <Tbl extends "billingCloses" | "invoices" | "timeEntries">(w: World, id: Id<Tbl>) =>
  w.t.run(async (ctx) => ctx.db.get(id));
const snapshotOf = (w: World, closeId: Id<"billingCloses">) =>
  w.t.run(async (ctx) =>
    ctx.db
      .query("billingCloseEntries")
      .withIndex("by_closeId", (q) => q.eq("closeId", closeId))
      .collect(),
  );
const linesOf = (w: World, invoiceId: Id<"invoices">) =>
  w.t.run(async (ctx) =>
    ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
      .collect(),
  );
const events = (w: World) =>
  w.t.run(async (ctx) =>
    (await ctx.db.query("billingEvents").collect()).map((e) => e.type),
  );
const setStatus = (w: World, id: Id<"invoices">, newStatus: "draft" | "invoiced" | "paid" | "void") =>
  as(w).mutation(api.invoices.changeInvoiceStatus, { id, newStatus });

const retainer = { billingType: "retainer" as const, includedMinutesPerMonth: 600, overageRate: 90 };

// ─── Commit ────────────────────────────────────────────────────────────────

describe("commitClose", () => {
  it("over-budget retainer: draft close, frozen snapshot, locked entries, draft invoice", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 400);
    const b = await addEntry(w, "2026-03-18", 255);
    const internal = await addEntry(w, "2026-03-20", 120, { billable: false });

    const { closeId, invoiceId } = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });

    const close = await get(w, closeId);
    expect(close).toMatchObject({
      status: "draft",
      usageMinutes: 655,
      includedMinutes: 600,
      overageMinutes: 55,
      amountMinor: 8250,
      invoiceId,
    });
    // N2: the snapshot holds every in-scope entry, non-billable included.
    expect((await snapshotOf(w, closeId)).map((r) => r.entryId).sort()).toEqual([a, b, internal].sort());
    // N1: all locked by this close.
    for (const id of [a, b, internal]) expect((await get(w, id))?.closeId).toBe(closeId);

    const invoice = await get(w, invoiceId!);
    expect(invoice).toMatchObject({ status: "draft", totalMinor: 8250, subtotalMinor: 8250, closeId });
    const lines = await linesOf(w, invoiceId!);
    expect(lines.map((l) => [l.lineType, l.quantityMinutes, l.amountMinor])).toEqual([
      ["time", 655, 0],
      ["overage", 55, 8250],
    ]);
    expect(await events(w)).toEqual(["close_committed"]);
  });

  it("within-budget retainer: a final close and no invoice", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 300);
    const { closeId, invoiceId } = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    expect(invoiceId).toBeNull();
    expect(await get(w, closeId)).toMatchObject({ status: "final", amountMinor: 0 });
    expect((await get(w, a))?.closeId).toBe(closeId);
  });

  it("T&M: the draft total is the priced scope", async () => {
    setToday("2026-04-10");
    const w = await world({ billingType: "t_and_m" }, 15);
    await addEntry(w, "2026-03-03", 20, { rate: 100 });
    await addEntry(w, "2026-03-09", 50, { rate: 90 });
    const { invoiceId } = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    expect((await get(w, invoiceId!))?.totalMinor).toBe(5000 + 9000);
    expect((await linesOf(w, invoiceId!)).map((l) => l.groupKey)).toHaveLength(2);
  });

  it("oldest-first and one close per period (N3, N5)", async () => {
    setToday("2026-05-10");
    const w = await world(retainer);
    await addEntry(w, "2026-04-04", 300);
    await expect(
      as(w).mutation(api.billingCloses.commitClose, { projectId: w.projectId, periodStart: "2026-04-01" }),
    ).rejects.toThrow(/March 2026 must be closed first/);
    await as(w).mutation(api.billingCloses.commitClose, { projectId: w.projectId, periodStart: "2026-03-01" });
    await expect(
      as(w).mutation(api.billingCloses.commitClose, { projectId: w.projectId, periodStart: "2026-03-01" }),
    ).rejects.toThrow(/April 2026 must be closed first/);
  });

  it("an over-budget period without an overage rate is blocked", async () => {
    setToday("2026-04-10");
    const w = await world({ ...retainer, overageRate: 0 });
    await addEntry(w, "2026-03-04", 700);
    await expect(
      as(w).mutation(api.billingCloses.commitClose, { projectId: w.projectId, periodStart: "2026-03-01" }),
    ).rejects.toThrow(/no overage rate/);
  });
});

// ─── Locks (N1) ────────────────────────────────────────────────────────────

describe("entry locks", () => {
  it("a closed entry cannot be edited, deleted or skipped", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 700);
    await as(w).mutation(api.billingCloses.commitClose, { projectId: w.projectId, periodStart: "2026-03-01" });
    await expect(as(w).mutation(api.timeEntries.update, { id: a, note: "x" })).rejects.toThrow(
      /on a draft invoice/,
    );
    await expect(as(w).mutation(api.timeEntries.remove, { id: a })).rejects.toThrow(/on a draft invoice/);
    await expect(as(w).mutation(api.billingCloses.skipEntries, { entryIds: [a] })).rejects.toThrow(
      /Only open entries/,
    );
  });
});

// ─── Invoice lifecycle ─────────────────────────────────────────────────────

describe("invoice lifecycle", () => {
  async function drafted() {
    setToday("2026-04-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 700);
    const { closeId, invoiceId } = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    return { w, a, closeId, invoiceId: invoiceId! };
  }

  it("finalize numbers the invoice and finalizes the close; money is unchanged (N7, N9)", async () => {
    const { w, closeId, invoiceId } = await drafted();
    await setStatus(w, invoiceId, "invoiced");
    expect(await get(w, invoiceId)).toMatchObject({ status: "invoiced", number: 1, totalMinor: 15000 });
    expect((await get(w, closeId))?.status).toBe("final");
  });

  it("a never-numbered draft cannot be voided: it is deleted instead (N9)", async () => {
    const { w, closeId, invoiceId } = await drafted();
    await expect(setStatus(w, invoiceId, "void")).rejects.toThrow(NEVER_NUMBERED_VOID);
    expect(await get(w, invoiceId)).toMatchObject({ status: "draft" });
    expect((await get(w, closeId))?.status).toBe("draft");
    expect(await events(w)).toEqual(["close_committed"]);
  });

  it("revert keeps the number; void releases the close and reopens entries", async () => {
    const { w, a, closeId, invoiceId } = await drafted();
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "draft");
    expect(await get(w, invoiceId)).toMatchObject({ status: "draft", number: 1 });
    expect((await get(w, closeId))?.status).toBe("draft");

    await setStatus(w, invoiceId, "void");
    expect(await get(w, invoiceId)).toMatchObject({ status: "void", number: 1 });
    expect(await get(w, closeId)).toMatchObject({ status: "released", releasedReason: "invoice_voided" });
    expect((await get(w, a))?.closeId).toBeUndefined();
    // The period is committable again.
    const again = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    expect(again.invoiceId).not.toBeNull();
  });

  it("a never-numbered draft can be deleted; a numbered one cannot (B6)", async () => {
    const { w, a, closeId, invoiceId } = await drafted();
    await as(w).mutation(api.invoices.deleteInvoice, { id: invoiceId });
    expect(await get(w, invoiceId)).toBeNull();
    expect((await get(w, closeId))?.releasedReason).toBe("draft_deleted");
    expect((await get(w, a))?.closeId).toBeUndefined();

    const second = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    await setStatus(w, second.invoiceId!, "invoiced");
    await setStatus(w, second.invoiceId!, "draft");
    await expect(as(w).mutation(api.invoices.deleteInvoice, { id: second.invoiceId! })).rejects.toThrow(
      /gap in the series/,
    );
  });

  it("finalize needs a seller name; a paid invoice never returns to draft", async () => {
    const { w, invoiceId } = await drafted();
    await w.t.run(async (ctx) => {
      const settings = await ctx.db
        .query("orgSettings")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .first();
      await ctx.db.patch(settings!._id, { brandName: "  " });
    });
    await expect(setStatus(w, invoiceId, "invoiced")).rejects.toThrow(/seller name/);
    expect((await get(w, invoiceId))?.number).toBeUndefined();

    await w.t.run(async (ctx) => {
      const settings = await ctx.db
        .query("orgSettings")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .first();
      await ctx.db.patch(settings!._id, { brandName: "Test Agency" });
    });
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "paid");
    await expect(setStatus(w, invoiceId, "draft")).rejects.toThrow(/Cannot transition from "paid" to "draft"/);
  });

  it("time logged after the draft belongs to the next close (B3)", async () => {
    const { w, invoiceId } = await drafted();
    const late = await addEntry(w, "2026-03-20", 30);
    await setStatus(w, invoiceId, "invoiced"); // no stale-draft gate
    expect((await get(w, invoiceId))?.totalMinor).toBe(15000);
    expect((await get(w, late))?.closeId).toBeUndefined();

    setToday("2026-05-10");
    const april = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-04-01",
    });
    const rows = await snapshotOf(w, april.closeId);
    expect(rows.map((r) => [r.entryId, r.carried, r.monthKey])).toEqual([[late, "logged-late", "2026-04"]]);
  });

  it("mark paid and undo go through the same lifecycle", async () => {
    const { w, invoiceId } = await drafted();
    await setStatus(w, invoiceId, "invoiced");
    const { priorStates } = await as(w).mutation(api.invoices.markInvoicesPaid, { invoiceIds: [invoiceId] });
    expect((await get(w, invoiceId))?.status).toBe("paid");
    await as(w).mutation(api.invoices.undoMarkInvoicesPaid, { priorStates });
    expect((await get(w, invoiceId))?.status).toBe("invoiced");
  });

  it("every transition appends exactly one event (N10)", async () => {
    const { w, invoiceId } = await drafted();
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "paid");
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "draft");
    await setStatus(w, invoiceId, "void");
    expect(await events(w)).toEqual([
      "close_committed",
      "invoice_finalized",
      "invoice_paid",
      "invoice_unpaid",
      "invoice_reverted",
      "invoice_voided",
      "close_released",
    ]);
  });
});

// ─── Draft editing (D6) ────────────────────────────────────────────────────

describe("draft editing", () => {
  it("descriptions and manual lines only; totals follow the lines", async () => {
    setToday("2026-04-10");
    const w = await world(retainer);
    await addEntry(w, "2026-03-04", 700);
    const { invoiceId } = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    const [timeLine] = await linesOf(w, invoiceId!);

    await as(w).mutation(api.billingInvoices.setLineDescription, { lineId: timeLine._id, description: "Care plan" });
    await expect(
      as(w).mutation(api.billingInvoices.updateManualLine, { lineId: timeLine._id, quantity: 2 }),
    ).rejects.toThrow(/Only manual lines/);

    const { lineId } = await as(w).mutation(api.billingInvoices.addManualLine, { invoiceId: invoiceId! });
    await as(w).mutation(api.billingInvoices.updateManualLine, { lineId, quantity: 2, unitPrice: -12.5 });
    expect((await get(w, invoiceId!))?.totalMinor).toBe(15000 - 2500);
    await as(w).mutation(api.billingInvoices.removeManualLine, { lineId });
    expect((await get(w, invoiceId!))?.totalMinor).toBe(15000);
  });
});

// ─── Skip ──────────────────────────────────────────────────────────────────

describe("skipEntries", () => {
  it("skips to the next close, again one period further, and undoes", async () => {
    setToday("2026-05-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 100);
    await as(w).mutation(api.billingCloses.skipEntries, { entryIds: [a] });
    expect((await get(w, a))?.skippedThrough).toBe("2026-03-31");

    const march = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    expect(await snapshotOf(w, march.closeId)).toEqual([]);

    await as(w).mutation(api.billingCloses.skipEntries, { entryIds: [a] });
    expect((await get(w, a))?.skippedThrough).toBe("2026-04-30");
    await as(w).mutation(api.billingCloses.skipEntries, { entryIds: [a], clear: true });
    expect((await get(w, a))?.skippedThrough).toBeUndefined();

    const april = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-04-01",
    });
    expect((await snapshotOf(w, april.closeId)).map((r) => [r.entryId, r.carried])).toEqual([[a, "logged-late"]]);
    expect(await events(w)).toEqual([
      "entries_skipped",
      "close_committed",
      "entries_skipped",
      "entries_unskipped",
      "close_committed",
    ]);
  });
});

// ─── Reopen ────────────────────────────────────────────────────────────────

describe("reopenClose", () => {
  it("reopens the latest within-budget close; never one under a later live close", async () => {
    setToday("2026-05-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 100);
    const march = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-04-01",
    });
    await expect(as(w).mutation(api.billingCloses.reopenClose, { projectId: w.projectId, periodStart: "2026-03-01" })).rejects.toThrow(
      /later closed periods first/,
    );
    await as(w).mutation(api.billingCloses.reopenClose, { projectId: w.projectId, periodStart: "2026-04-01" });
    await as(w).mutation(api.billingCloses.reopenClose, { projectId: w.projectId, periodStart: "2026-03-01" });
    expect((await get(w, a))?.closeId).toBeUndefined();
    expect((await get(w, march.closeId))?.status).toBe("released");
  });
});

// ─── Fixed fee (D5) ────────────────────────────────────────────────────────

describe("createFixedInvoice", () => {
  it("bills installments up to the sold fee; entries never lock", async () => {
    setToday("2026-04-10");
    const w = await world({ billingType: "fixed", fixedPrice: 10000 });
    const a = await addEntry(w, "2026-03-04", 300);
    const first = await as(w).mutation(api.billingInvoices.createFixedInvoice, {
      projectId: w.projectId,
      amount: 6000,
    });
    await setStatus(w, first.invoiceId, "invoiced");
    await expect(
      as(w).mutation(api.billingInvoices.createFixedInvoice, { projectId: w.projectId, amount: 5000 }),
    ).rejects.toThrow(/Only 4000 EUR/);
    const second = await as(w).mutation(api.billingInvoices.createFixedInvoice, {
      projectId: w.projectId,
      amount: 4000,
    });
    await setStatus(w, second.invoiceId, "invoiced");
    expect(await get(w, second.invoiceId)).toMatchObject({ number: 2, totalMinor: 400000 });
    expect((await get(w, a))?.closeId).toBeUndefined();
  });

  it("finalize re-checks the remainder against sibling drafts (legacy data)", async () => {
    setToday("2026-04-10");
    const w = await world({ billingType: "fixed", fixedPrice: 10000 });
    const one = await as(w).mutation(api.billingInvoices.createFixedInvoice, { projectId: w.projectId, amount: 7000 });
    // A sibling draft from before the one-draft guard (A5): copy the first.
    const two = await w.t.run(async (ctx) => {
      const { _id, _creationTime, ...inv } = (await ctx.db.get(one.invoiceId))!;
      const invoiceId = await ctx.db.insert("invoices", inv);
      for (const li of await ctx.db.query("invoiceLineItems").withIndex("by_invoiceId", (q) => q.eq("invoiceId", _id)).collect()) {
        const { _id: lineId, _creationTime: lineTime, ...line } = li;
        void lineId;
        void lineTime;
        await ctx.db.insert("invoiceLineItems", { ...line, invoiceId });
      }
      void _creationTime;
      return { invoiceId };
    });
    await setStatus(w, one.invoiceId, "invoiced");
    await expect(setStatus(w, two.invoiceId, "invoiced")).rejects.toThrow(/exceeds the project's unbilled remainder/);
  });
});

// ─── Reconciliation (slice 6) ──────────────────────────────────────────────

describe("reconciliation", () => {
  const reconcile = (w: World) => w.t.run(async (ctx) => reconcileOrg(ctx, ORG_ID));
  const codes = async (w: World) => (await reconcile(w)).map((i) => i.code).sort();

  async function committed() {
    setToday("2026-04-10");
    const w = await world(retainer);
    const a = await addEntry(w, "2026-03-04", 700);
    const b = await addEntry(w, "2026-03-20", 30, { billable: false });
    const { closeId, invoiceId } = await as(w).mutation(api.billingCloses.commitClose, {
      projectId: w.projectId,
      periodStart: "2026-03-01",
    });
    return { w, a, b, closeId, invoiceId: invoiceId! };
  }

  it("a healthy lifecycle reconciles at every step", async () => {
    const { w, invoiceId } = await committed();
    expect(await reconcile(w)).toEqual([]);
    const { lineId } = await as(w).mutation(api.billingInvoices.addManualLine, { invoiceId });
    await as(w).mutation(api.billingInvoices.updateManualLine, { lineId, quantity: 1, unitPrice: 25 });
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "paid");
    expect(await reconcile(w)).toEqual([]);
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "void");
    expect(await reconcile(w)).toEqual([]);
  });

  it("flags a close whose stored money no longer matches its snapshot", async () => {
    const { w, closeId } = await committed();
    await w.t.run(async (ctx) => ctx.db.patch(closeId, { amountMinor: 1 }));
    expect(await codes(w)).toEqual(["amount", "invoice-amount"]);
  });

  it("flags a tampered line and a total that is not the sum of its lines", async () => {
    const { w, invoiceId } = await committed();
    const overage = (await linesOf(w, invoiceId)).find((l) => l.lineType === "overage")!;
    await w.t.run(async (ctx) => ctx.db.patch(overage._id, { amountMinor: overage.amountMinor + 1 }));
    expect(await codes(w)).toEqual(["invoice-amount", "invoice-total", "overage-line"]);
  });

  it("flags locks that disagree with the snapshot (N2)", async () => {
    const { w, a, closeId } = await committed();
    const stray = await addEntry(w, "2026-04-02", 10);
    await w.t.run(async (ctx) => {
      await ctx.db.patch(a, { closeId: undefined });
      await ctx.db.patch(stray, { closeId });
    });
    expect(await codes(w)).toEqual(["lock-missing-snapshot", "snapshot-missing-lock"]);
  });

  it("flags a released close that still locks entries", async () => {
    const { w, b, closeId, invoiceId } = await committed();
    await setStatus(w, invoiceId, "invoiced");
    await setStatus(w, invoiceId, "void");
    await w.t.run(async (ctx) => ctx.db.patch(b, { closeId }));
    expect(await codes(w)).toEqual(["released-still-locked"]);
  });
});
