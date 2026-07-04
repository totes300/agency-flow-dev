// @vitest-environment edge-runtime
//
// convex-test loads convex/**/*.ts via Vite's import.meta.glob, which
// requires an edge-runtime VM (the project's default `jsdom` env doesn't
// expose it). Per-file override keeps the React component tests on jsdom.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { applyStatusTransition } from "../invoices";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

// convex-test resolves `convex/**/*.ts` relative to the test file via
// Vite's `import.meta.glob`. Without this explicit map it falls back to
// the package's built-in glob (which assumes a fixed depth relative to
// its own dist file and breaks here). Documented at
// https://docs.convex.dev/functions/testing#vite-glob-imports.
//
// `(import.meta as ...)` cast: Vite injects `.glob()` at build time but
// the TypeScript `ImportMeta` ambient type doesn't include it without
// the `vite/client` reference, which we don't pull in globally to keep
// the rest of the codebase free of Vite-specific types.
const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

/**
 * Phase 8 Slice 1 — end-to-end transition tests.
 *
 * These exercise `applyStatusTransition` against the real Convex mock
 * (convex-test) with realistic fixtures: a project, a task, a billable
 * time entry, an invoice, and an invoice line item that references the
 * entry via `timeEntryIds`. After each transition we assert both the
 * invoice's status patch AND the entry's settlement snapshot.
 *
 * The 5 cases here match the PRD's stated acceptance for Slice 1
 * (`docs/phase-8-slice-1-settlement-foundation.md` § Tests):
 *
 *   1. draft → invoiced (T&M)  → settles with reason="invoiced"
 *   2. draft → invoiced (Fixed) → settles with reason="fixed_included"
 *   3. invoiced → void          → unsettles + clears invoiceId
 *   4. invoiced → draft         → unsettles + keeps invoiceId
 *   5. timeEntries.update/remove reject settled entries
 *
 * convex-test note: `t.run(...)` gives us a MutationCtx we can hand
 * directly to `applyStatusTransition`. The mutation-side helpers
 * (`changeInvoiceStatus`, `markInvoicesPaid`) require admin auth via
 * Clerk identity; we bypass that here because the unit under test is
 * the settlement wiring, not the auth layer.
 */

const ORG_ID = "org_test";

type SeedResult = {
  userId: Id<"users">;
  clientId: Id<"clients">;
  projectId: Id<"projects">;
  taskId: Id<"tasks">;
  entryId: Id<"timeEntries">;
  invoiceId: Id<"invoices">;
  lineItemId: Id<"invoiceLineItems">;
};

/**
 * Seed the minimal graph the settlement helpers walk:
 *   user → client → project → task → entry
 *                                    ↘
 *                                     invoice → lineItem.timeEntryIds = [entry]
 *
 * The entry already carries `invoiceId` pointing at the invoice — this
 * mirrors how `createInvoice` attaches entries before status transitions
 * fire. The invoice starts as `draft`; tests transition it.
 */
async function seed(
  t: ReturnType<typeof convexTest>,
  opts: {
    billingType: "t_and_m" | "fixed";
    invoiceStatus?: "draft" | "invoiced" | "paid";
    /** Seed the invoice WITHOUT a number — the post-2026-07-04 draft shape. */
    unnumbered?: boolean;
  },
): Promise<SeedResult> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Test Admin",
      externalId: "user_test",
      createdAt: now,
      updatedAt: now,
    });
    // orgMember + role record — required for `requireAdmin`/`getAuthContext`
    // in tests that go through public mutations (timeEntries.update/remove
    // below). The first four tests bypass auth via t.run, but the seed
    // covers both paths.
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID,
      clerkUserId: "user_test",
      userId,
      role: "admin",
      joinedAt: now,
    });
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID,
      defaultCurrency: "EUR",
      timezone: "UTC",
      roundingMinutes: 1,
      // Seller-identity gate (2026-07-04): draft → invoiced requires a
      // company name. Seeded so transition tests pass the gate; the gate
      // itself has a dedicated test below.
      brandName: "Test Agency",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID,
      name: "Todo",
      type: "backlog",
      color: "#000",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
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
      name: "Test Project",
      code: "PRJ-001",
      billingType: opts.billingType,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      ...(opts.billingType === "fixed" ? { fixedPrice: 10000 } : {}),
    });
    const taskId = await ctx.db.insert("tasks", {
      orgId: ORG_ID,
      title: "Test Task",
      statusId,
      statusType: "backlog",
      projectId,
      assigneeIds: [userId],
      billable: true,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const invoiceId = await ctx.db.insert("invoices", {
      orgId: ORG_ID,
      projectId,
      clientId,
      ...(opts.unnumbered ? {} : { number: 1 }),
      prefix: "INV-",
      status: opts.invoiceStatus ?? "draft",
      currency: "EUR",
      subtotal: 600,
      total: 600,
      issueDate: "2026-03-15",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const entryId = await ctx.db.insert("timeEntries", {
      orgId: ORG_ID,
      taskId,
      userId,
      date: "2026-03-15",
      startedAt: now,
      durationMinutes: 60,
      isBillable: true,
      method: "manual",
      costRate: 50,
      billableRate: 100,
      rateCurrency: "EUR",
      invoiceId,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const lineItemId = await ctx.db.insert("invoiceLineItems", {
      orgId: ORG_ID,
      invoiceId,
      sortOrder: 0,
      lineType: "time",
      description: "Test work",
      quantity: 1,
      unitPrice: 100,
      amount: 100,
      quantityMinutes: 60,
      timeEntryIds: [entryId],
      createdAt: now,
      updatedAt: now,
    });
    return {
      userId,
      clientId,
      projectId,
      taskId,
      entryId,
      invoiceId,
      lineItemId,
    };
  });
}

// ─── 1. T&M draft → invoiced ────────────────────────────────────────────────

describe("applyStatusTransition — T&M draft → invoiced", () => {
  it("settles entries with reason='invoiced'", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m" });

    const result = await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      return applyStatusTransition(ctx, ORG_ID, invoice!, "invoiced");
    });
    expect(result.ok).toBe(true);

    const entry = await t.run(async (ctx) => ctx.db.get(ids.entryId));
    expect(entry?.settledAt).toBeTypeOf("number");
    expect(entry?.settledReason).toBe("invoiced");
    expect(entry?.settledPeriodStart).toBe("2026-03-01");
    expect(entry?.settledPeriodEnd).toBe("2026-03-31");
    expect(entry?.invoiceId).toBe(ids.invoiceId); // invoiceId is preserved
  });
});

// ─── 2. Fixed draft → invoiced ──────────────────────────────────────────────

describe("applyStatusTransition — Fixed draft → invoiced", () => {
  it("settles entries with reason='fixed_included' (not 'invoiced')", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "fixed" });

    await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      const result = await applyStatusTransition(
        ctx,
        ORG_ID,
        invoice!,
        "invoiced",
      );
      expect(result.ok).toBe(true);
    });

    const entry = await t.run(async (ctx) => ctx.db.get(ids.entryId));
    // The whole point of the Fixed branch: revenue is the fixed line
    // item, not the time-line rate. Reporting must classify these hours
    // as "covered by fixed price", NOT "billed hourly".
    expect(entry?.settledReason).toBe("fixed_included");
    expect(entry?.settledAt).toBeTypeOf("number");
  });
});

// ─── 3. invoiced → void ─────────────────────────────────────────────────────

describe("applyStatusTransition — invoiced → void", () => {
  it("unsettles entries AND clears invoiceId (free the period)", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, {
      billingType: "t_and_m",
      invoiceStatus: "invoiced",
    });
    // Pre-settle the entry to simulate it being on a finalized invoice
    // (what would happen if draft→invoiced fired first).
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.entryId, {
        settledAt: Date.now(),
        settledReason: "invoiced",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      const result = await applyStatusTransition(ctx, ORG_ID, invoice!, "void");
      expect(result.ok).toBe(true);
    });

    const entry = await t.run(async (ctx) => ctx.db.get(ids.entryId));
    // Void frees the period — both axes cleared so the entry shows
    // "open" again and can be picked up by a fresh invoice run.
    expect(entry?.settledAt).toBeUndefined();
    expect(entry?.settledReason).toBeUndefined();
    expect(entry?.settledPeriodStart).toBeUndefined();
    expect(entry?.settledPeriodEnd).toBeUndefined();
    expect(entry?.invoiceId).toBeUndefined();
  });
});

// ─── 4. invoiced → draft ────────────────────────────────────────────────────

describe("applyStatusTransition — invoiced → draft", () => {
  it("unsettles entries but KEEPS invoiceId (entry displays as 'draft')", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, {
      billingType: "t_and_m",
      invoiceStatus: "invoiced",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.entryId, {
        settledAt: Date.now(),
        settledReason: "invoiced",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
        updatedAt: Date.now(),
      });
    });

    await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      const result = await applyStatusTransition(
        ctx,
        ORG_ID,
        invoice!,
        "draft",
      );
      expect(result.ok).toBe(true);
    });

    const entry = await t.run(async (ctx) => ctx.db.get(ids.entryId));
    expect(entry?.settledAt).toBeUndefined();
    expect(entry?.settledReason).toBeUndefined();
    // Critical distinction vs void: invoiceId stays so the row badge
    // reads "draft" (not "open") and the entry stays bound to the
    // invoice. Demoting an invoice to draft for edits must not strand
    // its entries.
    expect(entry?.invoiceId).toBe(ids.invoiceId);
  });
});

// ─── 5. timeEntries.update/remove reject settled entries ────────────────────

// ─── Numbering at finalization (2026-07-04) ─────────────────────────────────

describe("applyStatusTransition — number allocation at finalization", () => {
  it("allocates the next sequence number on draft → invoiced", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m", unnumbered: true });

    await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      expect(invoice?.number).toBeUndefined();
      const result = await applyStatusTransition(ctx, ORG_ID, invoice!, "invoiced");
      expect(result.ok).toBe(true);
    });

    const invoice = await t.run(async (ctx) => ctx.db.get(ids.invoiceId));
    expect(invoice?.number).toBe(1);
    // Counter bumped so the next finalization gets 2.
    const settings = await t.run(async (ctx) =>
      ctx.db
        .query("orgSettings")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .first(),
    );
    expect(settings?.nextInvoiceNumber).toBe(2);
  });

  it("re-finalizing a reverted draft keeps its original number (no double-claim)", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m", unnumbered: true });

    await t.run(async (ctx) => {
      let invoice = await ctx.db.get(ids.invoiceId);
      await applyStatusTransition(ctx, ORG_ID, invoice!, "invoiced");
      invoice = await ctx.db.get(ids.invoiceId);
      await applyStatusTransition(ctx, ORG_ID, invoice!, "draft");
      invoice = await ctx.db.get(ids.invoiceId);
      // Number survives the revert — issued identity is permanent.
      expect(invoice?.number).toBe(1);
      await applyStatusTransition(ctx, ORG_ID, invoice!, "invoiced");
    });

    const invoice = await t.run(async (ctx) => ctx.db.get(ids.invoiceId));
    expect(invoice?.number).toBe(1);
    const settings = await t.run(async (ctx) =>
      ctx.db
        .query("orgSettings")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .first(),
    );
    // Only one number consumed across finalize → revert → re-finalize.
    expect(settings?.nextInvoiceNumber).toBe(2);
  });
});

describe("applyStatusTransition — seller-identity gate", () => {
  it("rejects draft → invoiced when the org has no company name", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m", unnumbered: true });
    // Clear the seeded brand name to simulate a fresh org.
    await t.run(async (ctx) => {
      const settings = await ctx.db
        .query("orgSettings")
        .withIndex("by_orgId", (q) => q.eq("orgId", ORG_ID))
        .first();
      await ctx.db.patch(settings!._id, { brandName: undefined });
    });

    const result = await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      return applyStatusTransition(ctx, ORG_ID, invoice!, "invoiced");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/company details/);
    }

    // Nothing was mutated: still a draft, no number claimed, entry unsettled.
    const invoice = await t.run(async (ctx) => ctx.db.get(ids.invoiceId));
    expect(invoice?.status).toBe("draft");
    expect(invoice?.number).toBeUndefined();
    const entry = await t.run(async (ctx) => ctx.db.get(ids.entryId));
    expect(entry?.settledAt).toBeUndefined();
  });
});

// ─── Lifecycle tightening (2026-07-04) ──────────────────────────────────────

describe("lifecycle tightening — paid immutability", () => {
  it("rejects paid → draft", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m", invoiceStatus: "paid" });

    const result = await t.run(async (ctx) => {
      const invoice = await ctx.db.get(ids.invoiceId);
      return applyStatusTransition(ctx, ORG_ID, invoice!, "draft");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Cannot transition from "paid" to "draft"/);
    }
  });

  it("deleteInvoice rejects a finalized invoice", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, {
      billingType: "t_and_m",
      invoiceStatus: "invoiced",
    });

    await expect(
      t
        .withIdentity({
          subject: "user_test",
          tokenIdentifier: "test|user_test",
          org_id: ORG_ID,
          // `requireAdmin` normalizes the Clerk role literal "org:admin";
          // plain "admin" parses as member and fails before the guard.
          org_role: "org:admin",
        } as never)
        .mutation(api.invoices.deleteInvoice, { id: ids.invoiceId }),
    ).rejects.toThrow(/Only draft invoices can be deleted/);
  });

  it("deleteInvoice removes a draft and releases its entries", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m" }); // status: draft

    await t
      .withIdentity({
        subject: "user_test",
        tokenIdentifier: "test|user_test",
        org_id: ORG_ID,
        org_role: "org:admin",
      } as never)
      .mutation(api.invoices.deleteInvoice, { id: ids.invoiceId });

    const [invoice, entry, lineItem] = await t.run(async (ctx) => [
      await ctx.db.get(ids.invoiceId),
      await ctx.db.get(ids.entryId),
      await ctx.db.get(ids.lineItemId),
    ]);
    expect(invoice).toBeNull();
    expect(lineItem).toBeNull();
    expect(entry?.invoiceId).toBeUndefined();
  });
});

describe("timeEntries.update / remove — settled-entry guards", () => {
  it("update rejects when settledAt is set, with the period-reopen hint", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m" });
    // Settle but DON'T link to an invoice (simulates retainer period
    // close — Slice 3's flow). The guard must fire on settledAt alone.
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.entryId, {
        invoiceId: undefined,
        settledAt: Date.now(),
        settledReason: "retainer_included",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity({
          subject: "user_test",
          tokenIdentifier: "test|user_test",
          // Clerk surfaces the org via `org_id` in the JWT; getAuthContext
          // reads it directly. Without this `requireAdmin` throws
          // "No organization selected" before the guard ever fires.
          org_id: ORG_ID,
          org_role: "admin",
        } as never)
        .mutation(api.timeEntries.update, {
          id: ids.entryId,
          durationMinutes: 90,
        }),
    ).rejects.toThrow(/Cannot edit a settled time entry — reopen the period first/);
  });

  it("update rejects when invoiceId is set, with the void-invoice hint", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m" });
    // Default seed entry has invoiceId set but no settledAt — the
    // invoice-linked branch of the guard.

    await expect(
      t
        .withIdentity({
          subject: "user_test",
          tokenIdentifier: "test|user_test",
          // Clerk surfaces the org via `org_id` in the JWT; getAuthContext
          // reads it directly. Without this `requireAdmin` throws
          // "No organization selected" before the guard ever fires.
          org_id: ORG_ID,
          org_role: "admin",
        } as never)
        .mutation(api.timeEntries.update, {
          id: ids.entryId,
          durationMinutes: 90,
        }),
    ).rejects.toThrow(
      /Cannot edit a time entry linked to an invoice — delete or void the invoice first/,
    );
  });

  it("remove rejects when settledAt is set", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t, { billingType: "t_and_m" });
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.entryId, {
        invoiceId: undefined,
        settledAt: Date.now(),
        settledReason: "retainer_included",
        updatedAt: Date.now(),
      });
    });

    await expect(
      t
        .withIdentity({
          subject: "user_test",
          tokenIdentifier: "test|user_test",
          // Clerk surfaces the org via `org_id` in the JWT; getAuthContext
          // reads it directly. Without this `requireAdmin` throws
          // "No organization selected" before the guard ever fires.
          org_id: ORG_ID,
          org_role: "admin",
        } as never)
        .mutation(api.timeEntries.remove, { id: ids.entryId }),
    ).rejects.toThrow(/Cannot delete a settled time entry/);
  });
});
