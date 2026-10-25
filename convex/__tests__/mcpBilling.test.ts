// @vitest-environment edge-runtime
//
// MCP slice 6 (docs/prd-mcp.md D5, §9, §13): billing_preview → billing_commit
// and the invoice search type / invoice fetch, with OAuth identities.
//   - every action: the preview's effect is what the commit writes, and the
//     numbers equal the app's own cores (Close workspace, project periods);
//   - a close through MCP writes exactly what the app's commitClose writes;
//   - stale (data changed), expired, another user's / org's / connection's
//     token are refused; a second commit replays and writes nothing;
//   - members are refused (preview, commit, invoice search and fetch);
//   - invoice totals stay per currency; `via` is recorded on billing events.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { fromMinor } from "../lib/billing/money";
import { closeFlagLabel, summarizeCloseFlags } from "../lib/closeFlags";
import {
  BILLING_ADMIN_ONLY,
  DATA_CHANGED,
  EXPIRED_TOKEN,
  PREVIEW_KEEP_MS,
  PREVIEW_TTL_MS,
  UNKNOWN_TOKEN,
} from "../lib/mcpBilling";
import { INVOICES_ADMIN_ONLY } from "../lib/mcpRefs";
import { statusRow, taskRow } from "./helpers/taskFixtures";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_bill";
const OTHER = "org_bill_other";
const ORIGIN = "https://localhost:3001";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());
const setToday = (ymd: string) => vi.setSystemTime(new Date(`${ymd}T12:00:00Z`));

type Caller = "admin" | "admin2" | "member" | "other";
const SUBJECT: Record<Caller, [string, string]> = {
  admin: ["clerk_admin", ORG],
  admin2: ["clerk_admin2", ORG],
  member: ["clerk_member", ORG],
  other: ["clerk_other", OTHER],
};

/** A Clerk OAuth access token as Convex sees it: client_id + org_id, no role. */
const oauth = (t: T, caller: Caller, clientId = "client_claude") =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: clientId, org_id: SUBJECT[caller][1] });

/** An app session token (the UI's surface). */
const session = (t: T) =>
  t.withIdentity({ subject: "clerk_admin", tokenIdentifier: "test|clerk_admin", org_id: ORG, org_role: "org:admin" });

type World = {
  t: T;
  admin: Id<"users">;
  ret: Id<"projects">; // retainer, 10h/month, €100/h overage, from August
  wib: Id<"projects">; // retainer from September, stays within budget
  tm: Id<"projects">; // T&M, USD client, from September
  fix: Id<"projects">; // fixed fee €12,000
  retTask: Id<"tasks">;
  retTask2: Id<"tasks">;
  wibTask: Id<"tasks">;
  tmTask: Id<"tasks">;
  statusId: Id<"statuses">;
};

async function world(opts: { nextInvoiceNumber?: number } = {}): Promise<World> {
  const t = createT();
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const admin2 = await mkUser("Admin Two", "clerk_admin2");
    const member = await mkUser("Member", "clerk_member");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [admin2, "clerk_admin2", "admin", ORG],
      [member, "clerk_member", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId,
        brandName: "Konverted",
        defaultCurrency: "EUR",
        timezone: "UTC",
        roundingMinutes: 15,
        invoicePrefix: "INV-",
        ...(opts.nextInvoiceNumber !== undefined ? { nextInvoiceNumber: opts.nextInvoiceNumber } : {}),
        createdAt: now,
        updatedAt: now,
        createdBy,
      });
    }
    const statusId = await ctx.db.insert(
      "statuses",
      statusRow({ orgId: ORG, name: "Todo", category: "backlog", createdAt: now, updatedAt: now, createdBy: admin }),
    );
    const eur = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const usd = await ctx.db.insert("clients", { orgId: ORG, name: "Yankee", currency: "USD", prefix: "YNK", createdAt: now, updatedAt: now, createdBy: admin });
    const project = (fields: Partial<Doc<"projects">> & Pick<Doc<"projects">, "name" | "code" | "billingType" | "clientId">) =>
      ctx.db.insert("projects", { orgId: ORG, createdAt: now, updatedAt: now, createdBy: admin, ...fields });
    const ret = await project({
      clientId: eur, name: "Retainer", code: "RET", billingType: "retainer", startDate: "2026-08-01",
      includedMinutesPerMonth: 600, overageRate: 100, monthlyFee: 2000,
    });
    const wib = await project({
      clientId: eur, name: "Within budget", code: "WIB", billingType: "retainer", startDate: "2026-09-01",
      includedMinutesPerMonth: 600, overageRate: 100, monthlyFee: 2000,
    });
    const tm = await project({ clientId: usd, name: "Hourly", code: "TM", billingType: "t_and_m", startDate: "2026-09-01" });
    const fix = await project({ clientId: eur, name: "Website", code: "FIX", billingType: "fixed", fixedPrice: 12000 });
    const task = (projectId: Id<"projects">, title: string) =>
      ctx.db.insert(
        "tasks",
        taskRow({ orgId: ORG, title, statusId, projectId, assigneeIds: [admin], createdAt: now, updatedAt: now, createdBy: admin }),
      );
    return {
      admin,
      ret,
      wib,
      tm,
      fix,
      statusId,
      retTask: await task(ret, "Support"),
      retTask2: await task(ret, "Design"),
      wibTask: await task(wib, "Care"),
      tmTask: await task(tm, "Build"),
    };
  });
  return { t, ...ids };
}

async function addEntry(
  w: World,
  projectId: Id<"projects">,
  taskId: Id<"tasks">,
  date: string,
  minutes: number,
  over: { billable?: boolean; rate?: number; currency?: string; note?: string } = {},
): Promise<Id<"timeEntries">> {
  return w.t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("timeEntries", {
      orgId: ORG,
      projectId,
      taskId,
      userId: w.admin,
      date,
      startedAt: Date.parse(`${date}T09:00:00Z`),
      durationMinutes: minutes,
      isBillable: over.billable ?? true,
      method: "manual",
      costRate: 0,
      billableRate: over.rate ?? 0,
      rateCurrency: over.currency ?? "EUR",
      ...(over.note ? { note: over.note } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: w.admin,
    });
  });
}

/** August on RET: 11h 40m billable (1h 40m over 10h) + 1h non-billable; one entry with a note. */
async function seedRetainerAugust(w: World) {
  return [
    await addEntry(w, w.ret, w.retTask, "2026-08-04", 400, { note: "Fixes" }),
    await addEntry(w, w.ret, w.retTask2, "2026-08-18", 300),
    await addEntry(w, w.ret, w.retTask, "2026-08-20", 60, { billable: false }),
  ];
}

type PreviewInput = { action: Doc<"mcpBillingPreviews">["action"]; project?: string; period?: string; invoice?: string };
const preview = (w: World, input: PreviewInput, caller: Caller = "admin", clientId?: string) =>
  oauth(w.t, caller, clientId).mutation(api.mcp.billing.preview, input);
const commit = (w: World, commitToken: string, caller: Caller = "admin", clientId?: string) =>
  oauth(w.t, caller, clientId).mutation(api.mcp.billing.commit, { commitToken, clientName: "Claude" });

const closesOf = (w: World, projectId: Id<"projects">) =>
  w.t.run(async (ctx) =>
    ctx.db
      .query("billingCloses")
      .withIndex("by_orgId_projectId_periodStart", (q) => q.eq("orgId", ORG).eq("projectId", projectId))
      .collect(),
  );
const invoiceOf = (w: World, id: Id<"invoices">) => w.t.run(async (ctx) => ctx.db.get(id));
const linesOf = (w: World, invoiceId: Id<"invoices">) =>
  w.t.run(async (ctx) =>
    (await ctx.db.query("invoiceLineItems").withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId)).collect()).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    ),
  );
const snapshotOf = (w: World, closeId: Id<"billingCloses">) =>
  w.t.run(async (ctx) => ctx.db.query("billingCloseEntries").withIndex("by_closeId", (q) => q.eq("closeId", closeId)).collect());
const eventsOf = (w: World) => w.t.run(async (ctx) => await ctx.db.query("billingEvents").collect());
const entryOf = (w: World, id: Id<"timeEntries">) => w.t.run(async (ctx) => ctx.db.get(id));

/** Every billing table's rows, for "wrote nothing" checks. */
const billingState = (w: World) =>
  w.t.run(async (ctx) => ({
    closes: await ctx.db.query("billingCloses").collect(),
    snapshot: await ctx.db.query("billingCloseEntries").collect(),
    invoices: await ctx.db.query("invoices").collect(),
    lines: await ctx.db.query("invoiceLineItems").collect(),
    events: await ctx.db.query("billingEvents").collect(),
    entries: await ctx.db.query("timeEntries").collect(),
    settings: await ctx.db.query("orgSettings").collect(),
  }));

const VIA = { kind: "mcp", clientId: "client_claude", clientName: "Claude" };

async function closeAugust(w: World) {
  const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
  const done = await commit(w, p.token);
  return { preview: p, done, invoiceId: done.invoice!.id };
}

// ─── close_period ────────────────────────────────────────────────────────────

describe("close_period", () => {
  it("previews exactly what the commit writes, with the app's own numbers and warnings", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);

    const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    const e = p.effect;
    expect(e).toMatchObject({
      action: "close_period",
      outcome: "Create draft invoice",
      currency: "EUR",
      period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
      periodState: { before: "Ready to invoice", after: "Draft" },
      close: {
        entryCount: 3,
        carriedCount: 0,
        billableMinutes: 700,
        nonBillableMinutes: 60,
        usageMinutes: 700,
        includedMinutes: 600,
        overageMinutes: 100,
        overageRateMinor: 10000,
        roundingMinutes: null,
        amountMinor: 16667, // 100 min × €100/h, one rounding (priceMinutesMinor)
      },
      warnings: ["2 entries have no note"],
    });
    expect(e.invoice).toMatchObject({ id: null, statusBefore: null, statusAfter: "draft", subject: "August 2026 overage", totalMinor: 16667 });
    expect(p.expiresAt - Date.now()).toBe(PREVIEW_TTL_MS);

    // The app's own cores agree: the Close workspace and the project's period row.
    const ws = (await session(w.t).query(api.billingViews.getCloseWorkspace, { projectId: w.ret, period: "2026-08" }))!;
    expect(ws.amount).toBe(fromMinor(16667, "EUR"));
    expect([ws.usageMinutes, ws.includedMinutes, ws.overageMinutes]).toEqual([700, 600, 100]);
    expect(ws.entries.length).toBe(e.close!.entryCount);
    expect(summarizeCloseFlags(ws.flags).filter((s) => s.kind !== "carried-in").map(closeFlagLabel)).toEqual(e.warnings);
    const periods = (await session(w.t).query(api.billingViews.getProjectBillingPeriods, { projectId: w.ret }))!;
    expect(periods.periods.find((r) => r.key === "2026-08")).toMatchObject({ amountMinor: 16667, state: "ready_to_invoice" });

    const done = await commit(w, p.token);
    expect(done).toMatchObject({
      action: "close_period",
      outcome: "Create draft invoice",
      replayed: false,
      period: { start: "2026-08-01", end: "2026-08-31" },
      invoice: { number: null, status: "draft" },
      entryCount: 3,
    });
    const [close] = await closesOf(w, w.ret);
    expect(close).toMatchObject({
      status: "draft",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: e.currency,
      usageMinutes: e.close!.usageMinutes,
      includedMinutes: e.close!.includedMinutes,
      overageMinutes: e.close!.overageMinutes,
      overageRateMinor: e.close!.overageRateMinor,
      amountMinor: e.close!.amountMinor,
      invoiceId: done.invoice!.id,
    });
    expect((await snapshotOf(w, close._id)).length).toBe(e.close!.entryCount);
    const invoice = (await invoiceOf(w, done.invoice!.id))!;
    expect(invoice).toMatchObject({
      status: "draft",
      subject: e.invoice!.subject,
      issueDate: e.invoice!.issueDate,
      dueDate: e.invoice!.dueDate,
      totalMinor: e.invoice!.totalMinor,
      currency: "EUR",
    });
    expect(
      (await linesOf(w, invoice._id)).map((l) => ({
        lineType: l.lineType,
        description: l.description,
        quantity: l.quantity,
        quantityMinutes: l.quantityMinutes ?? null,
        unitPriceMinor: l.unitPriceMinor,
        amountMinor: l.amountMinor,
      })),
    ).toEqual(e.invoice!.lines);
    const [event] = (await eventsOf(w)).filter((ev) => ev.type === "close_committed");
    expect(event).toMatchObject({ via: VIA, closeId: close._id, invoiceId: invoice._id });
  });

  it("writes exactly what the app's commitClose writes on the same data", async () => {
    setToday("2026-10-15");
    const normalize = async (w: World) => {
      const [close] = await closesOf(w, w.ret);
      const invoice = (await invoiceOf(w, close.invoiceId!))!;
      const pick = <O extends object, K extends keyof O>(o: O, keys: K[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
      return {
        close: pick(close, ["status", "kind", "periodStart", "periodEnd", "currency", "roundingMinutes", "includedMinutes", "overageRateMinor", "usageMinutes", "overageMinutes", "amountMinor"]),
        snapshot: (await snapshotOf(w, close._id)).map((r) => pick(r, ["entryId", "taskId", "date", "monthKey", "minutes", "isBillable", "billableRateMinor", "carried"])),
        invoice: pick(invoice, ["status", "prefix", "subject", "currency", "subtotalMinor", "totalMinor", "issueDate", "dueDate", "number"]),
        lines: (await linesOf(w, invoice._id)).map((l) => pick(l, ["sortOrder", "lineType", "description", "quantityMinutes", "quantity", "unitPriceMinor", "amountMinor", "groupKey"])),
        locked: (await w.t.run(async (ctx) => await ctx.db.query("timeEntries").collect())).map((e) => e.closeId === close._id),
      };
    };
    const viaApp = await world();
    await seedRetainerAugust(viaApp);
    await session(viaApp.t).mutation(api.billingCloses.commitClose, { projectId: viaApp.ret, periodStart: "2026-08-01" });
    const viaMcp = await world();
    await seedRetainerAugust(viaMcp);
    await closeAugust(viaMcp);

    const app = await normalize(viaApp);
    const mcp = await normalize(viaMcp);
    // Different deployments, different IDs: compare the entries by position.
    expect({ ...mcp, snapshot: mcp.snapshot.map((r) => ({ ...r, entryId: null, taskId: null })) }).toEqual({
      ...app,
      snapshot: app.snapshot.map((r) => ({ ...r, entryId: null, taskId: null })),
    });
    // The app's events carry no via; MCP's do.
    expect((await eventsOf(viaApp)).every((ev) => ev.via === undefined)).toBe(true);
    expect((await eventsOf(viaMcp)).every((ev) => ev.via !== undefined)).toBe(true);
  });

  it("within budget: Close period, a final close and no invoice", async () => {
    setToday("2026-10-15");
    const w = await world();
    await addEntry(w, w.wib, w.wibTask, "2026-09-10", 120, { note: "ok" });
    const p = await preview(w, { action: "close_period", project: "WIB", period: "2026-09" });
    expect(p.effect).toMatchObject({
      outcome: "Close period",
      periodState: { before: "Ready to close", after: "Closed" },
      close: { amountMinor: 0, usageMinutes: 120, overageMinutes: 0 },
      invoice: null,
      warnings: [],
    });
    const done = await commit(w, p.token);
    expect(done).toMatchObject({ outcome: "Close period", invoice: null, entryCount: 1 });
    const [close] = await closesOf(w, w.wib);
    expect(close).toMatchObject({ status: "final", amountMinor: 0 });
    expect(close.finalizedAt).toBeDefined();
  });

  it("T&M in USD: line rounding frozen, money in the client's currency", async () => {
    setToday("2026-10-15");
    const w = await world();
    await addEntry(w, w.tm, w.tmTask, "2026-09-03", 50, { rate: 120, currency: "USD", note: "a" });
    await addEntry(w, w.tm, w.tmTask, "2026-09-04", 20, { rate: 120, currency: "USD", note: "b" });
    await addEntry(w, w.tm, w.tmTask, "2026-09-05", 30, { billable: false, note: "c" });
    const p = await preview(w, { action: "close_period", project: "TM", period: "2026-09" });
    expect(p.effect).toMatchObject({
      currency: "USD",
      close: { usageMinutes: 70, roundingMinutes: 15, amountMinor: 15000, includedMinutes: null },
    });
    expect(p.effect.invoice!.lines).toEqual([
      { lineType: "time", description: "Build", quantity: 1.25, quantityMinutes: 70, unitPriceMinor: 12000, amountMinor: 15000 },
    ]);
    const done = await commit(w, p.token);
    expect((await invoiceOf(w, done.invoice!.id))).toMatchObject({ currency: "USD", totalMinor: 15000 });
  });

  it("refuses periods the app offers no commit for, with the app's reasons", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    await expect(preview(w, { action: "close_period", project: "RET", period: "2026-09" })).rejects.toThrow(
      "August 2026 must be closed first.",
    );
    await expect(preview(w, { action: "close_period", project: "RET", period: "2026-10" })).rejects.toThrow(
      "October 2026 is still in progress (it ends 2026-10-31). Only ended periods can be closed.",
    );
    await expect(preview(w, { action: "close_period", project: "FIX", period: "2026-09" })).rejects.toThrow(
      /Fixed-fee projects have no billing periods/,
    );
    await closeAugust(w);
    await expect(preview(w, { action: "close_period", project: "RET", period: "2026-08" })).rejects.toThrow(
      /August 2026 is already closed/,
    );
    await expect(preview(w, { action: "close_period", project: "RET" })).rejects.toThrow(
      "close_period needs period. It takes: project, period.",
    );
  });
});

// ─── Token rules ─────────────────────────────────────────────────────────────

describe("commit token", () => {
  it("is refused after the data changed, and writes nothing", async () => {
    setToday("2026-10-15");
    const w = await world();
    const [first] = await seedRetainerAugust(w);
    const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });

    await w.t.run(async (ctx) => ctx.db.patch(first, { durationMinutes: 401 }));
    const before = await billingState(w);
    await expect(commit(w, p.token)).rejects.toThrow(DATA_CHANGED);
    expect(await billingState(w)).toEqual(before);

    // A late entry dated in the period changes the scope too.
    const again = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    await addEntry(w, w.ret, w.retTask, "2026-08-31", 15);
    await expect(commit(w, again.token)).rejects.toThrow(DATA_CHANGED);

    // Someone closed it in the app meanwhile: refused, saying what changed.
    const third = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    await session(w.t).mutation(api.billingCloses.commitClose, { projectId: w.ret, periodStart: "2026-08-01" });
    await expect(commit(w, third.token)).rejects.toThrow(`${DATA_CHANGED} Now: August 2026 is already closed.`);
    expect((await closesOf(w, w.ret)).length).toBe(1);
  });

  it("is refused when an invoice changed since the preview", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    const { invoiceId } = await closeAugust(w);
    const p = await preview(w, { action: "mark_invoiced", invoice: invoiceId });
    await session(w.t).mutation(api.invoices.updateInvoice, { id: invoiceId, note: "edited in the app" });
    await expect(commit(w, p.token)).rejects.toThrow(DATA_CHANGED);
    // Another invoice took the number the preview promised.
    const q = await preview(w, { action: "mark_invoiced", invoice: invoiceId });
    expect(q.effect.invoice!.numberAfter).toBe("INV-001");
    await w.t.run(async (ctx) => {
      const settings = (await ctx.db.query("orgSettings").withIndex("by_orgId", (x) => x.eq("orgId", ORG)).first())!;
      await ctx.db.patch(settings._id, { nextInvoiceNumber: 2 });
    });
    await expect(commit(w, q.token)).rejects.toThrow(DATA_CHANGED);
  });

  it("expires after 10 minutes", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    vi.setSystemTime(Date.now() + PREVIEW_TTL_MS + 1);
    await expect(commit(w, p.token)).rejects.toThrow(EXPIRED_TOKEN);
    expect(await closesOf(w, w.ret)).toEqual([]);
  });

  it("works only for the user, org and connection that previewed", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    await expect(commit(w, p.token, "admin2")).rejects.toThrow(UNKNOWN_TOKEN);
    await expect(commit(w, p.token, "other")).rejects.toThrow(UNKNOWN_TOKEN);
    await expect(commit(w, p.token, "admin", "client_codex")).rejects.toThrow(UNKNOWN_TOKEN);
    await expect(commit(w, "not-a-token")).rejects.toThrow(UNKNOWN_TOKEN);
    expect(await closesOf(w, w.ret)).toEqual([]);
    // The owner's commit still works.
    expect((await commit(w, p.token)).replayed).toBe(false);
  });

  it("commits once: the same token again returns the first result and writes nothing", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    const first = await commit(w, p.token);
    const state = await billingState(w);
    const second = await commit(w, p.token);
    expect(second).toEqual({ ...first, replayed: true });
    expect(await billingState(w)).toEqual(state);
    // Even past the 10-minute window, until the cleanup removes it.
    vi.setSystemTime(Date.now() + PREVIEW_TTL_MS + 1);
    expect((await commit(w, p.token)).replayed).toBe(true);
  });

  it("a preview writes no billing data, only its token row; the cron removes old rows", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    const before = await billingState(w);
    const p = await preview(w, { action: "close_period", project: "RET", period: "2026-08" });
    expect(await billingState(w)).toEqual(before);
    const row = await w.t.run(async (ctx) => ctx.db.get(p.token));
    expect(row).toMatchObject({ orgId: ORG, clientId: "client_claude", action: "close_period", params: { projectId: w.ret, periodStart: "2026-08-01" } });
    expect(row!.fingerprint).toMatch(/^[0-9a-f]{64}$/);

    vi.setSystemTime(Date.now() + PREVIEW_KEEP_MS + 1);
    await w.t.mutation(internal.mcpBillingPreviews.cleanupExpired, {});
    expect(await w.t.run(async (ctx) => ctx.db.get(p.token))).toBeNull();
  });
});

// ─── Roles ───────────────────────────────────────────────────────────────────

describe("members", () => {
  it("are refused billing preview, commit, invoice search and invoice fetch", async () => {
    setToday("2026-10-15");
    const w = await world();
    await seedRetainerAugust(w);
    const { invoiceId } = await closeAugust(w);
    await expect(preview(w, { action: "close_period", project: "RET", period: "2026-08" }, "member")).rejects.toThrow(BILLING_ADMIN_ONLY);
    const p = await preview(w, { action: "mark_invoiced", invoice: invoiceId });
    await expect(commit(w, p.token, "member")).rejects.toThrow(BILLING_ADMIN_ONLY);
    await expect(
      oauth(w.t, "member").query(api.mcp.search.invoices, { offset: 0, limit: 25, due: {}, now: Date.now() }),
    ).rejects.toThrow(INVOICES_ADMIN_ONLY);
    const fetched = await oauth(w.t, "member").query(api.mcp.fetch.records, { refs: [invoiceId, "INV-001"], include: [], now: Date.now() });
    expect(fetched.results.map((r) => (r.ok ? "ok" : r.message))).toEqual([INVOICES_ADMIN_ONLY, INVOICES_ADMIN_ONLY]);
  });
});

// ─── Invoice and period actions ──────────────────────────────────────────────

describe("invoice actions: each preview is what its commit does", () => {
  it("walks a period's invoice through the app's lifecycle", async () => {
    setToday("2026-10-15");
    const w = await world();
    const entries = await seedRetainerAugust(w);
    const { invoiceId } = await closeAugust(w);
    const run = async (action: PreviewInput["action"]) => {
      const p = await preview(w, { action, invoice: invoiceId });
      const done = await commit(w, p.token);
      const invoice = await invoiceOf(w, invoiceId);
      return { e: p.effect, done, invoice };
    };

    // The app voids only numbered drafts and pays only issued invoices.
    await expect(preview(w, { action: "void_invoice", invoice: invoiceId })).rejects.toThrow(/use delete_draft/);
    await expect(preview(w, { action: "mark_paid", invoice: invoiceId })).rejects.toThrow(
      "This draft invoice is Draft. Mark as paid applies to Invoiced and Past due invoices.",
    );

    const finalized = await run("mark_invoiced");
    expect(finalized.e.invoice).toMatchObject({ statusBefore: "draft", statusAfter: "invoiced", number: null, numberAfter: "INV-001" });
    expect(finalized.e.periodState).toEqual({ before: "Draft", after: "Invoiced" });
    expect(finalized.invoice).toMatchObject({ status: "invoiced", number: 1, prefix: "INV-" });
    expect(finalized.done.invoice).toEqual({ id: invoiceId, number: "INV-001", status: "invoiced" });
    expect((await closesOf(w, w.ret))[0].status).toBe("final");

    const reverted = await run("revert_to_draft");
    expect(reverted.e.invoice).toMatchObject({ statusAfter: "draft", numberAfter: "INV-001" });
    expect(reverted.invoice).toMatchObject({ status: "draft", number: 1 });
    expect((await closesOf(w, w.ret))[0].status).toBe("draft");

    // Re-finalizing keeps the number: no new number is claimed.
    const again = await run("mark_invoiced");
    expect(again.e.invoice!.numberAfter).toBe("INV-001");
    const settings = await w.t.run(async (ctx) => ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).first());
    expect(settings!.nextInvoiceNumber).toBe(2);

    const paid = await run("mark_paid");
    expect(paid.e.invoice).toMatchObject({ statusBefore: "invoiced", statusAfter: "paid" });
    expect(paid.e.periodState).toEqual({ before: "Invoiced", after: "Paid" });
    expect(paid.invoice!.status).toBe("paid");
    expect(paid.invoice!.paidAt).toBe(Date.now());

    const unpaid = await run("mark_unpaid");
    expect(unpaid.e.invoice).toMatchObject({ statusBefore: "paid", statusAfter: "invoiced" });
    expect(unpaid.invoice!.status).toBe("invoiced");
    expect(unpaid.invoice!.paidAt).toBeUndefined();

    const voided = await run("void_invoice");
    expect(voided.e.invoice!.statusAfter).toBe("void");
    expect(voided.e.reopened).toEqual({ entryCount: 3, minutes: 760 });
    expect(voided.e.periodState).toEqual({ before: "Invoiced", after: null });
    expect(voided.invoice!.status).toBe("void");
    expect(voided.done.entryCount).toBe(3);
    expect((await closesOf(w, w.ret))[0]).toMatchObject({ status: "released", releasedReason: "invoice_voided" });
    for (const id of entries) expect((await entryOf(w, id))!.closeId).toBeUndefined();

    // The period is open again; a new close drafts a new, never-numbered invoice.
    const second = await closeAugust(w);
    const p = await preview(w, { action: "delete_draft", invoice: second.invoiceId });
    expect(p.effect.invoice!.statusAfter).toBe("deleted");
    expect(p.effect.reopened).toEqual({ entryCount: 3, minutes: 760 });
    const deleted = await commit(w, p.token);
    expect(deleted.invoice).toEqual({ id: second.invoiceId, number: null, status: "deleted" });
    expect(await invoiceOf(w, second.invoiceId)).toBeNull();
    for (const id of entries) expect((await entryOf(w, id))!.closeId).toBeUndefined();

    // Every MCP billing event carries the connection; types match the app's lifecycle.
    const events = await eventsOf(w);
    for (const ev of events) expect(ev.via).toEqual(VIA);
    expect(events.map((ev) => ev.type)).toEqual([
      "close_committed",
      "invoice_finalized",
      "invoice_reverted",
      "invoice_finalized",
      "invoice_paid",
      "invoice_unpaid",
      "invoice_voided",
      "close_released",
      "close_committed",
      "draft_deleted",
      "close_released",
    ]);
  });

  it("reopen_period undoes a within-budget close; an invoiced period is refused", async () => {
    setToday("2026-10-15");
    const w = await world();
    const entry = await addEntry(w, w.wib, w.wibTask, "2026-09-10", 120, { note: "ok" });
    const close = await preview(w, { action: "close_period", project: "WIB", period: "2026-09" });
    await commit(w, close.token);
    const p = await preview(w, { action: "reopen_period", project: "WIB", period: "2026-09" });
    expect(p.effect).toMatchObject({
      outcome: "Reopen period",
      period: { label: "September 2026" },
      periodState: { before: "Closed", after: null },
      reopened: { entryCount: 1, minutes: 120 },
    });
    const done = await commit(w, p.token);
    expect(done).toMatchObject({ action: "reopen_period", entryCount: 1 });
    expect((await closesOf(w, w.wib))[0]).toMatchObject({ status: "released", releasedReason: "reopened" });
    expect((await entryOf(w, entry))!.closeId).toBeUndefined();

    await seedRetainerAugust(w);
    const { invoiceId } = await closeAugust(w);
    // A drafted period is not closed yet; a finalized one is billed on its invoice.
    await expect(preview(w, { action: "reopen_period", project: "RET", period: "2026-08" })).rejects.toThrow(
      "This period is not closed.",
    );
    await commit(w, (await preview(w, { action: "mark_invoiced", invoice: invoiceId })).token);
    await expect(preview(w, { action: "reopen_period", project: "RET", period: "2026-08" })).rejects.toThrow(
      "This period is billed on an invoice. Void that invoice to reopen it.",
    );
  });

  it("create_fixed_invoice drafts what is left of the fee, once", async () => {
    setToday("2026-10-15");
    const w = await world();
    const p = await preview(w, { action: "create_fixed_invoice", project: "FIX" });
    expect(p.effect).toMatchObject({
      outcome: "Create invoice",
      currency: "EUR",
      fixed: { feeMinor: 1200000, billedMinor: 0, amountMinor: 1200000, remainingAfterMinor: 0 },
      invoice: { statusAfter: "draft", subject: "Fixed fee", totalMinor: 1200000 },
    });
    const done = await commit(w, p.token);
    const invoice = (await invoiceOf(w, done.invoice!.id))!;
    expect(invoice).toMatchObject({ status: "draft", totalMinor: 1200000, issueDate: p.effect.invoice!.issueDate, dueDate: p.effect.invoice!.dueDate });
    expect((await linesOf(w, invoice._id)).map((l) => [l.lineType, l.description, l.amountMinor])).toEqual([["fixed", "Website", 1200000]]);
    await expect(preview(w, { action: "create_fixed_invoice", project: "FIX" })).rejects.toThrow(
      `This project already has a draft invoice (ref ${invoice._id}). Open it in the app, or finalize it with mark_invoiced.`,
    );
  });
});

// ─── Invoice search and fetch ────────────────────────────────────────────────

describe("invoice search and fetch", () => {
  async function twoCurrencies(w: World) {
    await seedRetainerAugust(w);
    const eur = await closeAugust(w);
    await addEntry(w, w.tm, w.tmTask, "2026-09-03", 60, { rate: 100, currency: "USD", note: "a" });
    const p = await preview(w, { action: "close_period", project: "TM", period: "2026-09" });
    const usd = (await commit(w, p.token)).invoice!.id;
    return { eur: eur.invoiceId, usd };
  }
  const search = (w: World, args: Record<string, unknown> = {}) =>
    oauth(w.t, "admin").query(api.mcp.search.invoices, { offset: 0, limit: 25, due: {}, now: Date.now(), ...args });

  it("lists invoices newest first with totals per currency, never summed across currencies", async () => {
    setToday("2026-10-15");
    const w = await world();
    const { eur, usd } = await twoCurrencies(w);
    const page = await search(w);
    expect(page.rows.map((r) => [r.id, r.status, r.totalMinor, r.currency])).toEqual([
      [usd, "draft", 10000, "USD"],
      [eur, "draft", 16667, "EUR"],
    ]);
    expect(page.totals).toEqual([
      { currency: "EUR", totalMinor: 16667, count: 1 },
      { currency: "USD", totalMinor: 10000, count: 1 },
    ]);
    expect(page.rows[1]).toMatchObject({ number: null, client: { name: "Arlow", prefix: "ARL" }, project: { code: "RET" }, period: { label: "August 2026" } });
    expect((await search(w, { client: "client:YNK" })).rows.map((r) => r.id)).toEqual([usd]);
    expect((await search(w, { project: "RET", query: "draft" })).rows.map((r) => r.id)).toEqual([eur]);
  });

  it("uses the app's statuses: past due is invoiced past its due date (org timezone)", async () => {
    setToday("2026-10-15");
    const w = await world();
    const { eur } = await twoCurrencies(w);
    await commit(w, (await preview(w, { action: "mark_invoiced", invoice: eur })).token);
    expect((await search(w, { status: "invoiced" })).rows.map((r) => r.id)).toEqual([eur]);
    await w.t.run(async (ctx) => ctx.db.patch(eur, { dueDate: "2026-10-01" }));
    expect((await search(w, { status: "invoiced" })).rows).toEqual([]);
    const pastDue = await search(w, { status: "past_due" });
    expect(pastDue.rows.map((r) => [r.number, r.status])).toEqual([["INV-001", "past_due"]]);
    expect((await search(w, { query: "INV-001" })).rows.map((r) => r.id)).toEqual([eur]);
    await expect(search(w, { status: "overdue" })).rejects.toThrow("Invoice status must be one of: draft, invoiced, past_due, paid, void.");
  });

  it("fetches an invoice by number, link or ID with the invoice page's lines and totals", async () => {
    setToday("2026-10-15");
    const w = await world();
    const { eur } = await twoCurrencies(w);
    await commit(w, (await preview(w, { action: "mark_invoiced", invoice: eur })).token);
    const fetched = await oauth(w.t, "admin").query(api.mcp.fetch.records, {
      refs: ["INV-001", `${ORIGIN}/invoices/INV-001`, eur],
      include: [],
      now: Date.now(),
    });
    const page = (await session(w.t).query(api.invoices.getInvoice, { identifier: "INV-001" }))!;
    for (const r of fetched.results) {
      expect(r.ok).toBe(true);
      if (!r.ok || r.record.type !== "invoice") throw new Error("expected an invoice");
      expect(r.record).toMatchObject({
        id: eur,
        number: "INV-001",
        status: "invoiced",
        currency: "EUR",
        totalMinor: page.invoice.totalMinor,
        project: { code: "RET" },
        period: { label: "August 2026" },
      });
      expect(r.record.lines.map((l) => [l.description, l.amountMinor])).toEqual(page.lineItems.map((l) => [l.description, l.amountMinor]));
    }
  });

  it("an invoice number shaped like a task key returns both candidates, never a guess", async () => {
    setToday("2026-10-15");
    const w = await world({ nextInvoiceNumber: 120 });
    const { eur } = await twoCurrencies(w);
    await commit(w, (await preview(w, { action: "mark_invoiced", invoice: eur })).token);
    await w.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert(
        "tasks",
        taskRow({ orgId: ORG, title: "Clash", statusId: w.statusId, projectId: w.ret, identifier: "INV-120", createdAt: now, updatedAt: now, createdBy: w.admin }),
      );
    });
    const [result] = (await oauth(w.t, "admin").query(api.mcp.fetch.records, { refs: ["INV-120"], include: [], now: Date.now() })).results;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.candidates.map((c) => c.type).sort()).toEqual(["invoice", "task"]);
    // The billing tool expects an invoice, so the same number resolves there.
    const p = await preview(w, { action: "mark_paid", invoice: "INV-120" });
    expect(p.effect.invoice!.id).toBe(eur);
  });
});
