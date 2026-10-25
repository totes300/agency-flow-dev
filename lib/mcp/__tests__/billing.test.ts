import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { MCP_TOOLS, SEARCH_FILTERS, type McpActionRunner, type McpMutationRunner, type McpQueryRunner, type McpToolContext } from "../registry";
import { renderBillingCommit, renderBillingPreview, type BillingCommitData, type BillingPreviewData } from "../billing-render";
import { renderInvoiceSection, type InvoicePage } from "../render";
import { sha256Hex } from "../sha256";
import { BILLING_ACTIONS } from "../limits";

// MCP slice 6 (docs/prd-mcp.md §9, §13): the billing tools and the invoice
// search type on the route side, Convex replaced by stubs.

const ORIGIN = "https://localhost:3001";
const NOW = Date.UTC(2026, 9, 15, 12);
const tool = (name: string) => MCP_TOOLS.find((t) => t.name === name)!;

type Calls = Array<{ name: string; args: Record<string, unknown> }>;

function fake(answer: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: Calls = [];
  const run = (async (fn: Parameters<McpQueryRunner>[0], args: Record<string, unknown>) => {
    const name = getFunctionName(fn);
    calls.push({ name, args });
    return answer(name, args);
  }) as unknown;
  const ctx: McpToolContext = {
    runQuery: run as McpQueryRunner,
    runMutation: run as McpMutationRunner,
    runAction: run as McpActionRunner,
    appOrigin: ORIGIN,
    now: () => NOW,
    clientName: async () => "Claude",
  };
  return { ctx, calls };
}

const CLOSE_PREVIEW: BillingPreviewData = {
  token: "k57preview0000000000000000000000" as BillingPreviewData["token"],
  expiresAt: NOW + 600_000,
  effect: {
    action: "close_period",
    outcome: "Create draft invoice",
    project: { id: "p1" as never, code: "RET", name: "Retainer", billingType: "retainer" },
    client: { id: "c1" as never, name: "Arlow", prefix: "ARL" },
    currency: "EUR",
    period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
    periodState: { before: "Ready to invoice", after: "Draft" },
    close: {
      entryCount: 3,
      carriedCount: 1,
      billableMinutes: 700,
      nonBillableMinutes: 60,
      usageMinutes: 700,
      includedMinutes: 600,
      overageMinutes: 100,
      overageRateMinor: 10000,
      roundingMinutes: null,
      amountMinor: 16667,
    },
    invoice: {
      id: null,
      number: null,
      numberAfter: null,
      statusBefore: null,
      statusAfter: "draft",
      subject: "August 2026 overage",
      issueDate: "2026-10-15",
      dueDate: "2026-11-14",
      totalMinor: 16667,
      lineCount: 2,
      lines: [
        { lineType: "time", description: "Support | fixes", quantity: 6.67, quantityMinutes: 400, unitPriceMinor: 0, amountMinor: 0 },
        { lineType: "overage", description: "Overage (1.67h × 100/h)", quantity: 1.67, quantityMinutes: 100, unitPriceMinor: 10000, amountMinor: 16667 },
      ],
    },
    fixed: null,
    reopened: null,
    warnings: ["2 entries have no note"],
  },
};

describe("billing_preview tool", () => {
  it("is read-only and lists every action with its params and one example", () => {
    const t = tool("billing_preview");
    expect(t.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    for (const action of BILLING_ACTIONS) expect(t.description).toContain(action);
    expect(t.description).toMatch(/show the preview to the user/i);
    expect(t.description).toContain("Example:");
  });

  it("checks the params each action takes before calling Convex", async () => {
    const { ctx, calls } = fake(() => CLOSE_PREVIEW);
    const run = (input: Record<string, unknown>) => tool("billing_preview").execute(input, ctx);
    expect(await run({ action: "close_period", project: "RET" })).toEqual({
      text: "Error: close_period needs period. It takes: project, period.",
      isError: true,
    });
    expect(await run({ action: "mark_paid", invoice: "INV-001", amount: 10 })).toEqual({
      text: 'Error: "amount" applies to create_fixed_invoice only.',
      isError: true,
    });
    expect(await run({ action: "mark_paid", invoice: "INV-001", project: "RET" })).toEqual({
      text: 'Error: "project" does not apply to mark_paid. mark_paid takes: invoice.',
      isError: true,
    });
    expect((await run({ action: "mark_paid", invoice: "https://evil.test/invoices/INV-001" })).text).toBe(
      'Error: invoice: "https://evil.test/invoices/INV-001" is not an Agency Flow link. Links must start with https://localhost:3001.',
    );
    await expect(run({ action: "close_period", project: "RET", period: "2026-13" })).rejects.toThrow(/YYYY-MM/);
    expect(calls).toEqual([]);
  });

  it("runs the preview and renders the effect, the warnings and the token", async () => {
    const { ctx, calls } = fake(() => CLOSE_PREVIEW);
    const result = await tool("billing_preview").execute({ action: "close_period", project: "RET", period: "2026-08" }, ctx);
    expect(calls).toEqual([
      { name: "mcp/billing:preview", args: { action: "close_period", project: "RET", period: "2026-08", invoice: undefined, amount: undefined } },
    ]);
    expect(result.isError).toBe(false);
    expect(result.text).toBe(renderBillingPreview(CLOSE_PREVIEW, { appOrigin: ORIGIN }));
  });

  it("passes Convex user errors through", async () => {
    const { ctx } = fake(() => {
      throw new ConvexError("August 2026 must be closed first.");
    });
    expect(await tool("billing_preview").execute({ action: "close_period", project: "RET", period: "2026-09" }, ctx)).toEqual({
      text: "Error: August 2026 must be closed first.",
      isError: true,
    });
  });
});

describe("billing_commit tool", () => {
  const done: BillingCommitData = {
    action: "close_period",
    outcome: "Create draft invoice",
    project: { id: "p1" as never, code: "RET", name: "Retainer" },
    period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
    invoice: { id: "inv1" as never, number: null, status: "draft" },
    entryCount: 3,
    amountMinor: 16667,
    currency: "EUR",
    replayed: false,
  };

  it("is destructive and idempotent, and sends the token with the client name", async () => {
    expect(tool("billing_commit").annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    const { ctx, calls } = fake(() => done);
    const result = await tool("billing_commit").execute({ commitToken: "tok" }, ctx);
    expect(calls).toEqual([{ name: "mcp/billing:commit", args: { commitToken: "tok", clientName: "Claude" } }]);
    expect(result).toEqual({
      isError: false,
      text: [
        "## Done · Create draft invoice · RET · August 2026",
        "- Project: [RET](https://localhost:3001/projects/p1) · Retainer",
        "- Period: August 2026 (2026-08-01 – 2026-08-31)",
        "- Close workspace: https://localhost:3001/billing/close/p1/2026-08",
        "- Invoice total: €166.67 (EUR)",
        "- Invoice: [draft invoice](https://localhost:3001/invoices/inv1) · Draft · ref inv1",
        "- Next: review the draft in the app, then mark it as invoiced (billing_preview action mark_invoiced).",
        "- Settled and locked 3 entries.",
      ].join("\n"),
    });
  });

  it("says a replay wrote nothing; stale tokens come back as the model-actionable error", async () => {
    expect(renderBillingCommit({ ...done, replayed: true }, { appOrigin: ORIGIN })).toContain(
      "Replayed: this token was already committed, so nothing was written again.",
    );
    const { ctx } = fake(() => {
      throw new ConvexError("Data changed since preview — run billing_preview again.");
    });
    expect(await tool("billing_commit").execute({ commitToken: "tok" }, ctx)).toEqual({
      text: "Error: Data changed since preview — run billing_preview again.",
      isError: true,
    });
  });
});

describe("billing renderers", () => {
  it("renders a close preview: one currency, raw minutes, the app's words", () => {
    const text = renderBillingPreview(CLOSE_PREVIEW, { appOrigin: ORIGIN });
    expect(text).toContain("## Billing preview · Create draft invoice · RET · August 2026");
    expect(text).toContain("- Currency: EUR (every amount below is in EUR)");
    expect(text).toContain("- Period: August 2026 (2026-08-01 – 2026-08-31) · Ready to invoice → Draft");
    expect(text).toContain("- Close workspace: https://localhost:3001/billing/close/p1/2026-08");
    expect(text).toContain("- Usage: 11h 40m billable of 10h included · overage 1h 40m × €100.00/h");
    expect(text).toContain("- Amount: €166.67");
    expect(text).toContain("Settles 3 entries (1 carried in from earlier periods): 11h 40m billable, 1h non-billable.");
    expect(text).toContain("| 1 | Support \\| fixes | Time | 6h 40m (6.67 h) | €0.00 | €0.00 |");
    expect(text).toContain("| 2 | Overage (1.67h × 100/h) | Overage | 1h 40m (1.67 h) | €100.00 | €166.67 |");
    expect(text).toContain("- 2 entries have no note");
    expect(text).toContain("- commitToken: k57preview0000000000000000000000");
    expect(text).toContain("get an explicit yes before calling billing_commit");
  });

  it("renders an invoice action with status before → after and the app's confirm copy", () => {
    const voidPreview: BillingPreviewData = {
      ...CLOSE_PREVIEW,
      effect: {
        ...CLOSE_PREVIEW.effect,
        action: "void_invoice",
        outcome: "Void invoice",
        periodState: { before: "Invoiced", after: "Ready to invoice" },
        close: null,
        invoice: { ...CLOSE_PREVIEW.effect.invoice!, id: "inv1" as never, number: "INV-001", numberAfter: "INV-001", statusBefore: "invoiced", statusAfter: "void" },
        reopened: { entryCount: 3, minutes: 760 },
        warnings: [],
      },
    };
    const text = renderBillingPreview(voidPreview, { appOrigin: ORIGIN });
    expect(text).toContain("## Billing preview · Void invoice · RET · INV-001");
    expect(text).toContain("· Invoiced → Ready to invoice");
    expect(text).toContain("### Invoice [INV-001](https://localhost:3001/invoices/INV-001)");
    expect(text).toContain("- Status: Invoiced → Void");
    expect(text).toContain("The invoice keeps its number and is marked void. The period reopens and its time can be billed again.");
    expect(text).toContain("3 entries (12h 40m) become editable again.");
    expect(text).not.toContain("Before you close");
  });

  it("shows a status-only action's total and line count, not its lines", () => {
    const paid: BillingPreviewData = {
      ...CLOSE_PREVIEW,
      effect: {
        ...CLOSE_PREVIEW.effect,
        action: "mark_paid",
        outcome: "Mark as paid",
        periodState: { before: "Invoiced", after: "Paid" },
        close: null,
        invoice: { ...CLOSE_PREVIEW.effect.invoice!, id: "inv1" as never, number: "INV-001", numberAfter: "INV-001", statusBefore: "invoiced", statusAfter: "paid", lines: [] },
        warnings: [],
      },
    };
    const text = renderBillingPreview(paid, { appOrigin: ORIGIN });
    expect(text).toContain("- Total: €166.67");
    expect(text).toContain("- Lines: 2 (unchanged by this action)");
    expect(text).not.toContain("| # |");
  });
});

describe("invoice search", () => {
  it("is a search type with its own filters", () => {
    expect(SEARCH_FILTERS.invoice).toEqual(["query", "status", "client", "project", "due_from", "due_to"]);
  });

  it("maps filters onto the invoice query and renders per-currency totals", async () => {
    const page: InvoicePage = {
      rows: [
        {
          id: "inv2" as never,
          number: null,
          status: "draft",
          daysOverdue: null,
          subject: "September 2026",
          client: { name: "Yankee", prefix: "YNK" },
          project: { id: "p2" as never, code: "TM", name: "Hourly" },
          period: { start: "2026-09-01", end: "2026-09-30", label: "September 2026" },
          issueDate: "2026-10-15",
          dueDate: "2026-11-14",
          totalMinor: 10000,
          currency: "USD",
        },
        {
          id: "inv1" as never,
          number: "INV-001",
          status: "past_due",
          daysOverdue: 14,
          subject: "August 2026 overage",
          client: { name: "Arlow", prefix: "ARL" },
          project: { id: "p1" as never, code: "RET", name: "Retainer" },
          period: { start: "2026-08-01", end: "2026-08-31", label: "August 2026" },
          issueDate: "2026-09-02",
          dueDate: "2026-10-01",
          totalMinor: 16667,
          currency: "EUR",
        },
      ],
      total: 2,
      offset: 0,
      incomplete: false,
      notes: [],
      totals: [
        { status: "draft", currency: "USD", totalMinor: 10000, count: 1 },
        { status: "past_due", currency: "EUR", totalMinor: 16667, count: 1 },
      ],
      today: "2026-10-15",
    };
    const { ctx, calls } = fake(() => page);
    const result = await tool("search").execute({ types: ["invoice"], status: "past_due", client: "client:ARL", due_to: "2026-10-31" }, ctx);
    expect(calls).toEqual([
      {
        name: "mcp/search:invoices",
        args: {
          offset: 0, limit: 25, now: NOW, query: undefined, status: "past_due", client: "client:ARL", project: undefined,
          due: { from: undefined, to: "2026-10-31" },
        },
      },
    ]);
    expect(result.text).toBe(renderInvoiceSection(page, { appOrigin: ORIGIN }));
    expect(result.text).toBe(
      [
        "### Invoices · 1–2 of 2",
        "Totals of all 2 matching invoices, by status and currency, void excluded:",
        "- Draft: $100.00 (1)",
        "- Past due: €166.67 (1)",
        "Today: 2026-10-15 (org timezone; Past due = Invoiced and due before today)",
        '- [Draft (never numbered, ref inv2)](https://localhost:3001/invoices/inv2) · Draft · $100.00 · client:YNK · Yankee · TM · Hourly · September 2026 · issued 2026-10-15 · "September 2026"',
        '- [INV-001](https://localhost:3001/invoices/INV-001) · Past due (14 days overdue) · €166.67 · client:ARL · Arlow · RET · Retainer · August 2026 · issued 2026-09-02 · due 2026-10-01 · "August 2026 overage"',
      ].join("\n"),
    );
  });
});

describe("sha256Hex", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    // UTF-8, not UTF-16: "é" is two bytes.
    expect(sha256Hex("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
    // Multi-block input (FIPS: one million "a").
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
});
