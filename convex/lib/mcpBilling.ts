import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, invoiceKey } from "./mcpRefs";
import { referenceClientPrefix } from "./helpers";
import { getOrgSettings } from "./orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./timer";
import { closeFlagLabel, summarizeCloseFlags } from "./closeFlags";
import {
  applyClosePlan,
  applyReopen,
  planClose,
  planReopen,
  type Actor,
} from "./billing/closeLifecycle";
import {
  applyDeleteDraft,
  applyFixedInvoice,
  applyTransition,
  planDeleteDraft,
  planFixedInvoice,
  planTransition,
} from "./billing/invoiceLifecycle";
import { getLiveCloses, isClosableProject, toScopeProject } from "./billing/closeData";
import { formatInvoiceNumber } from "./billing/labels";
import { periodOfDate, type Period } from "./billing/periods";
import { periodRangeLabel } from "./billing/projectPeriods";
import {
  INVOICE_STATUS_COPY,
  PERIOD_STATE_COPY,
  invoiceDisplayStatus,
  type InvoiceDisplayStatus,
  type PeriodState,
} from "./billing/periodState";
import { loadActiveTimers } from "./billing/timers";
import { flagsFor, projectTaskIds, timersIn } from "../billingViews";
import {
  INVOICE_ACTIONS,
  PERIOD_ACTIONS,
  PROJECT_ACTIONS,
  type BillingAction,
  type BillingCommitResult,
  type BillingParams,
} from "./mcpBillingResults";
import { stableJson } from "../../lib/mcp/cursor";
import { sha256Hex } from "../../lib/mcp/sha256";

/**
 * MCP billing preview → commit (docs/prd-mcp.md D5, §9) for an
 * already-authorized caller.
 *
 * Every action runs the app's own write path in two halves
 * (lib/billing/closeLifecycle.ts, invoiceLifecycle.ts): `plan*` runs all of
 * the app's validation and computes everything the write would store, reading
 * only; `apply*` writes exactly that plan. A preview is the plan rendered; a
 * commit plans again, compares fingerprints and applies its own fresh plan —
 * so what the user approved is, value for value, what gets written.
 *
 * Fingerprint = SHA-256 of the canonical JSON of every value the commit would
 * write or that decides it (per action below), plus the action and target.
 * Anything that would change the outcome changes the fingerprint; a change
 * that would not (a note on an unrelated entry) does not block the commit.
 *
 * Money and roles, as the app: admins only (every billing route and mutation
 * is `requireAdmin`); one currency per action (the project's client
 * currency, or the invoice's); amounts in integer minor units straight from
 * the pricing core (rounding happens there, at commit, never here).
 *
 * Read budget: a close plans like the Close workspace — the project's entries
 * (one range), its live closes, org settings, one read per invoiced task for
 * line titles, and (preview only) the org's running timers and the project's
 * tasks for the review warnings. Invoice actions read the invoice, its lines,
 * its close and the close's snapshot rows (one range each).
 */

/** How long a preview's token commits (docs/prd-mcp.md §9). */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;
/** How long a committed token replays its result before the cron deletes it. */
export const PREVIEW_KEEP_MS = 24 * 60 * 60 * 1000;

export const BILLING_ADMIN_ONLY = "Billing is admin-only, as in the app.";
export const DATA_CHANGED = "Data changed since preview — run billing_preview again.";
export const UNKNOWN_TOKEN =
  "Unknown commit token. Run billing_preview first and pass the commitToken it returns (tokens work only for the user and connection that previewed).";
export const EXPIRED_TOKEN =
  "This commit token expired (tokens last 10 minutes). Run billing_preview again and show the user the new preview.";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The input as the tool passes it: references, resolved here in the caller's org (I3). */
export type BillingInput = {
  action: BillingAction;
  project?: string;
  period?: string;
  invoice?: string;
};

/** One invoice line as the preview shows it. */
type EffectLine = {
  lineType: Doc<"invoiceLineItems">["lineType"];
  description: string;
  quantity: number;
  /** Raw minutes behind a time / overage line; null for fixed and manual lines. */
  quantityMinutes: number | null;
  unitPriceMinor: number;
  amountMinor: number;
};

/**
 * What a commit would do, as data; the route renders it (D1: every number
 * here comes from the app's cores). One currency per effect.
 */
export type BillingEffect = {
  action: BillingAction;
  /** The app's label for the action, e.g. "Create draft invoice". */
  outcome: string;
  project: { id: Id<"projects">; code: string; name: string; billingType: Doc<"projects">["billingType"] };
  client: { id: Id<"clients">; name: string; prefix: string | null } | null;
  currency: string;
  period: { start: string; end: string; label: string } | null;
  /** The period's state chip before and after (redesign §5.2); `after` null = reopens. */
  periodState: { before: string; after: string | null } | null;
  close: {
    entryCount: number;
    carriedCount: number;
    billableMinutes: number;
    nonBillableMinutes: number;
    /** Billable minutes counted for money (raw). */
    usageMinutes: number;
    /** Retainer only. */
    includedMinutes: number | null;
    overageMinutes: number | null;
    overageRateMinor: number | null;
    /** T&M only: the line rounding frozen into the close. */
    roundingMinutes: number | null;
    amountMinor: number;
  } | null;
  invoice: {
    /** null: the commit creates it. */
    id: Id<"invoices"> | null;
    number: string | null;
    /** The number after the commit (finalizing claims the next one). */
    numberAfter: string | null;
    /** Display statuses (Draft · Invoiced · Past due · Paid · Void); null before = new. */
    statusBefore: InvoiceDisplayStatus | null;
    statusAfter: InvoiceDisplayStatus | "deleted";
    subject: string | null;
    issueDate: string;
    dueDate: string | null;
    totalMinor: number;
    lines: EffectLine[];
  } | null;
  fixed: { feeMinor: number; billedMinor: number; amountMinor: number; remainingAfterMinor: number } | null;
  /** Entries that become editable again (reopen, void, delete draft). */
  reopened: { entryCount: number; minutes: number } | null;
  /** The Close workspace's "Before you close" lines (warnings never block, as in the app). */
  warnings: string[];
};

type Planned = {
  effect: BillingEffect;
  fingerprint: string;
  /** Preview only: extra reads for the review warnings. */
  warnings?: () => Promise<string[]>;
  apply: (ctx: MutationCtx, actor: Actor) => Promise<BillingCommitResult>;
};

function fingerprintOf(action: BillingAction, inputs: unknown): string {
  return sha256Hex(stableJson({ v: 1, action, inputs }));
}

function assertAdmin(auth: McpAuthContext): void {
  if (!auth.isAdmin) throw new ConvexError(BILLING_ADMIN_ONLY);
}

async function orgToday(ctx: QueryCtx, orgId: string): Promise<string> {
  const settings = await getOrgSettings(ctx, orgId);
  return getDateInTimezone(Date.now(), settings?.timezone ?? ORG_TIMEZONE_FALLBACK);
}

async function projectHeader(ctx: QueryCtx, orgId: string, project: Doc<"projects">) {
  const client = await ctx.db.get(project.clientId);
  return {
    project: { id: project._id, code: project.code, name: project.name, billingType: project.billingType },
    client: client && client.orgId === orgId ? { id: client._id, name: client.name, prefix: referenceClientPrefix(client) } : null,
  };
}

function periodOf(p: Period) {
  return { start: p.start, end: p.end, label: periodRangeLabel(p.start, p.end) };
}

const chip = (state: PeriodState) => PERIOD_STATE_COPY[state].chip;

/** A project that has no billing periods gets the action that fits it. */
function assertPeriodProject(project: Doc<"projects">): void {
  if (project.billingType === "fixed") {
    throw new ConvexError("Fixed-fee projects have no billing periods. Use create_fixed_invoice to invoice the fee.");
  }
  if (project.billingType === "non_billable") throw new ConvexError("Non-billable projects are never billed.");
}

// ─── Input → params ──────────────────────────────────────────────────────────

/** Validates which params the action takes and resolves them in the caller's org (I3). */
export async function resolveBillingParams(
  ctx: QueryCtx,
  auth: McpAuthContext,
  input: BillingInput,
): Promise<BillingParams> {
  const { action } = input;
  const takes = (PERIOD_ACTIONS as readonly string[]).includes(action)
    ? ["project", "period"]
    : (PROJECT_ACTIONS as readonly string[]).includes(action)
      ? ["project"]
      : ["invoice"];
  for (const param of ["project", "period", "invoice"] as const) {
    const given = input[param] !== undefined;
    if (given && !takes.includes(param)) {
      throw new ConvexError(`"${param}" does not apply to ${action}. ${action} takes: ${takes.join(", ")}.`);
    }
    if (!given && takes.includes(param)) throw new ConvexError(`${action} needs ${param}. It takes: ${takes.join(", ")}.`);
  }
  const resolver = createRefResolver(ctx, auth);
  if (input.invoice !== undefined) {
    const resolved = await resolver.require(input.invoice, "invoice");
    if (resolved.type !== "invoice") throw new ConvexError(`${input.invoice} is not an invoice.`);
    return { invoiceId: resolved.invoice._id };
  }
  const resolved = await resolver.require(input.project!, "project");
  if (resolved.type !== "project") throw new ConvexError(`${input.project} is not a project.`);
  const project = resolved.project;
  if (input.period === undefined) return { projectId: project._id };
  if (!MONTH.test(input.period)) throw new ConvexError("period must be a month in YYYY-MM format, e.g. 2026-09.");
  assertPeriodProject(project);
  // A cycle period is named by any of its months; close snaps to its start.
  const day = `${input.period}-01`;
  const periodStart =
    action === "close_period" && isClosableProject(project) ? periodOfDate(toScopeProject(project), day).start : day;
  return { projectId: project._id, periodStart };
}

// ─── Plans ───────────────────────────────────────────────────────────────────

async function loadProject(ctx: QueryCtx, orgId: string, projectId: Id<"projects"> | undefined): Promise<Doc<"projects">> {
  const project = projectId ? await ctx.db.get(projectId) : null;
  if (!project || project.orgId !== orgId) throw new ConvexError("Project not found.");
  return project;
}

async function planClosePeriod(ctx: QueryCtx, auth: McpAuthContext, params: BillingParams): Promise<Planned> {
  const { orgId } = auth;
  const project = await loadProject(ctx, orgId, params.projectId);
  assertPeriodProject(project);
  if (!isClosableProject(project) || params.periodStart === undefined) throw new ConvexError("Project not found.");

  // What the app shows instead of a commit button: a closed or running period.
  const requested = periodOfDate(toScopeProject(project), params.periodStart);
  const label = periodRangeLabel(requested.start, requested.end);
  const live = (await getLiveCloses(ctx, orgId, project._id)).find(
    (c) => c.periodStart <= requested.end && c.periodEnd >= requested.start,
  );
  if (live) {
    throw new ConvexError(
      `${label} is already closed. Undo it first: reopen_period (a within-budget close) or the invoice's own actions (void_invoice, delete_draft).`,
    );
  }
  if (requested.end >= (await orgToday(ctx, orgId))) {
    throw new ConvexError(`${label} is still in progress (it ends ${requested.end}). Only ended periods can be closed.`);
  }

  const plan = await planClose(ctx, orgId, { projectId: project._id, periodStart: requested.start });
  const { price, members } = plan;
  const header = await projectHeader(ctx, orgId, project);
  const isRetainer = project.billingType === "retainer";
  const billable = members.filter((m) => m.entry.isBillable);
  const outcome = plan.invoice ? "Create draft invoice" : "Close period";
  const period = periodOf(plan.period);

  const effect: BillingEffect = {
    action: "close_period",
    outcome,
    ...header,
    currency: plan.currency,
    period,
    periodState: {
      before: chip(price.amountMinor > 0 ? "ready_to_invoice" : "ready_to_close"),
      after: chip(plan.invoice ? "draft" : "closed"),
    },
    close: {
      entryCount: members.length,
      carriedCount: members.filter((m) => m.carried !== undefined).length,
      billableMinutes: billable.reduce((sum, m) => sum + m.entry.minutes, 0),
      nonBillableMinutes: members.filter((m) => !m.entry.isBillable).reduce((sum, m) => sum + m.entry.minutes, 0),
      usageMinutes: price.usageMinutes,
      includedMinutes: isRetainer ? price.includedMinutes : null,
      overageMinutes: isRetainer ? price.overageMinutes : null,
      overageRateMinor: isRetainer ? plan.overageRateMinor : null,
      roundingMinutes: isRetainer ? null : plan.roundingMinutes,
      amountMinor: price.amountMinor,
    },
    invoice: plan.invoice
      ? {
          id: null,
          number: null,
          numberAfter: null,
          statusBefore: null,
          statusAfter: "draft",
          subject: plan.invoice.subject,
          issueDate: plan.invoice.issueDate,
          dueDate: plan.invoice.dueDate,
          totalMinor: price.amountMinor,
          lines: plan.invoice.lines.map((l) => ({
            lineType: l.lineType,
            description: l.description,
            quantity: l.quantity,
            quantityMinutes: l.quantityMinutes,
            unitPriceMinor: l.unitPriceMinor,
            amountMinor: l.amountMinor,
          })),
        }
      : null,
    fixed: null,
    reopened: null,
    warnings: [],
  };

  const fingerprint = fingerprintOf("close_period", {
    projectId: project._id,
    period: plan.period,
    currency: plan.currency,
    roundingMinutes: plan.roundingMinutes,
    overageRateMinor: plan.overageRateMinor,
    price: {
      usageMinutes: price.usageMinutes,
      includedMinutes: price.includedMinutes,
      overageMinutes: price.overageMinutes,
      amountMinor: price.amountMinor,
      overage: price.overage,
      lines: price.lines.map((l) => [l.groupKey, l.minutes, l.billedMinutes, l.rateMinor, l.amountMinor, l.entryIds]),
    },
    // The entries the close settles and locks, with every field its snapshot stores.
    members: members.map((m) => [
      m.entry._id,
      m.entry.taskId,
      m.entry.date,
      m.entry.minutes,
      m.entry.isBillable,
      m.entry.billableRateMinor,
      m.entry.categoryId ?? null,
      m.carried ?? null,
    ]),
    invoice: plan.invoice,
  });

  return {
    effect,
    fingerprint,
    // The workspace's review checklist: the same flags, the same lines.
    warnings: async () => {
      const settings = await getOrgSettings(ctx, orgId);
      const timers = await loadActiveTimers(ctx, orgId, settings?.timezone ?? ORG_TIMEZONE_FALLBACK);
      const taskIds = new Set((await projectTaskIds(ctx, orgId, project._id)).keys());
      const view = {
        period: plan.period,
        liveClose: null,
        members: members.map(({ entry, carried }) => ({ entry, ...(carried ? { carried } : {}), doc: entry.doc })),
        price,
        committable: plan.period,
        pendingAfter: 0,
      };
      return summarizeCloseFlags(flagsFor(view, timersIn(timers, taskIds, plan.period)))
        .filter((s) => s.kind !== "carried-in")
        .map(closeFlagLabel);
    },
    apply: async (mctx, actor) => {
      const result = await applyClosePlan(mctx, actor, plan);
      return {
        action: "close_period",
        outcome,
        project: { id: project._id, code: project.code, name: project.name },
        period,
        invoice: result.invoiceId ? { id: result.invoiceId, number: null, status: "draft" } : null,
        entryCount: result.entryCount,
      };
    },
  };
}

async function planReopenPeriod(ctx: QueryCtx, auth: McpAuthContext, params: BillingParams): Promise<Planned> {
  const { orgId } = auth;
  const project = await loadProject(ctx, orgId, params.projectId);
  assertPeriodProject(project);
  if (params.periodStart === undefined) throw new ConvexError("Project not found.");
  const plan = await planReopen(ctx, orgId, { projectId: project._id, periodStart: params.periodStart });
  const { close } = plan;
  const period = periodOf({ start: close.periodStart, end: close.periodEnd });
  const effect: BillingEffect = {
    action: "reopen_period",
    outcome: "Reopen period",
    ...(await projectHeader(ctx, orgId, project)),
    currency: close.currency,
    period,
    periodState: { before: chip("closed"), after: null },
    close: null,
    invoice: null,
    fixed: null,
    reopened: { entryCount: plan.reopenedCount, minutes: plan.reopenedMinutes },
    warnings: [],
  };
  const fingerprint = fingerprintOf("reopen_period", {
    closeId: close._id,
    status: close.status,
    invoiceId: close.invoiceId ?? null,
    period: [close.periodStart, close.periodEnd],
    committedAt: close.committedAt,
    reopened: [plan.reopenedCount, plan.reopenedMinutes],
  });
  return {
    effect,
    fingerprint,
    apply: async (mctx, actor) => {
      const { reopenedCount } = await applyReopen(mctx, actor, plan);
      return {
        action: "reopen_period",
        outcome: "Reopen period",
        project: { id: project._id, code: project.code, name: project.name },
        period,
        invoice: null,
        entryCount: reopenedCount,
      };
    },
  };
}

async function planCreateFixedInvoice(ctx: QueryCtx, auth: McpAuthContext, params: BillingParams): Promise<Planned> {
  const { orgId } = auth;
  const project = await loadProject(ctx, orgId, params.projectId);
  let plan;
  try {
    plan = await planFixedInvoice(ctx, orgId, { projectId: project._id });
  } catch (error) {
    // The app's structured DRAFT_EXISTS error carries the draft; say it in words.
    const data = error instanceof ConvexError ? (error.data as unknown) : null;
    if (data && typeof data === "object" && (data as { code?: unknown }).code === "DRAFT_EXISTS") {
      const draftId = String((data as { invoiceId?: unknown }).invoiceId);
      throw new ConvexError(
        `This project already has a draft invoice (ref ${draftId}). Open it in the app, or finalize it with mark_invoiced.`,
      );
    }
    throw error;
  }
  const effect: BillingEffect = {
    action: "create_fixed_invoice",
    outcome: "Create invoice",
    ...(await projectHeader(ctx, orgId, project)),
    currency: plan.currency,
    period: null,
    periodState: null,
    close: null,
    invoice: {
      id: null,
      number: null,
      numberAfter: null,
      statusBefore: null,
      statusAfter: "draft",
      subject: "Fixed fee",
      issueDate: plan.issueDate,
      dueDate: plan.dueDate,
      totalMinor: plan.amountMinor,
      lines: [
        {
          lineType: "fixed",
          description: plan.description,
          quantity: 1,
          quantityMinutes: null,
          unitPriceMinor: plan.amountMinor,
          amountMinor: plan.amountMinor,
        },
      ],
    },
    fixed: {
      feeMinor: plan.feeMinor,
      billedMinor: plan.billedMinor,
      amountMinor: plan.amountMinor,
      remainingAfterMinor: plan.feeMinor - plan.billedMinor - plan.amountMinor,
    },
    reopened: null,
    warnings: [],
  };
  const fingerprint = fingerprintOf("create_fixed_invoice", {
    projectId: project._id,
    currency: plan.currency,
    feeMinor: plan.feeMinor,
    billedMinor: plan.billedMinor,
    amountMinor: plan.amountMinor,
    description: plan.description,
    prefix: plan.prefix,
    issueDate: plan.issueDate,
    dueDate: plan.dueDate,
    messageToClient: plan.messageToClient ?? null,
  });
  return {
    effect,
    fingerprint,
    apply: async (mctx, actor) => {
      const { invoiceId } = await applyFixedInvoice(mctx, actor, plan);
      return {
        action: "create_fixed_invoice",
        outcome: "Create invoice",
        project: { id: project._id, code: project.code, name: project.name },
        period: null,
        invoice: { id: invoiceId, number: null, status: "draft" },
        entryCount: null,
      };
    },
  };
}

type InvoiceAction = (typeof INVOICE_ACTIONS)[number];
type InvoiceStatus = Doc<"invoices">["status"];

/** Which stored statuses each action starts from: the invoice states the app offers it in (§5.3, §5.4, invoice page). */
const INVOICE_FROM: Record<InvoiceAction, readonly InvoiceStatus[]> = {
  mark_invoiced: ["draft"],
  mark_paid: ["invoiced"],
  mark_unpaid: ["paid"],
  revert_to_draft: ["invoiced"],
  void_invoice: ["draft", "invoiced"],
  delete_draft: ["draft"],
};

const INVOICE_TARGET: Record<Exclude<InvoiceAction, "delete_draft">, InvoiceStatus> = {
  mark_invoiced: "invoiced",
  mark_paid: "paid",
  mark_unpaid: "invoiced",
  revert_to_draft: "draft",
  void_invoice: "void",
};

const INVOICE_OUTCOME: Record<InvoiceAction, string> = {
  mark_invoiced: "Mark as invoiced",
  mark_paid: "Mark as paid",
  mark_unpaid: "Mark as unpaid",
  revert_to_draft: "Revert to draft",
  void_invoice: "Void invoice",
  delete_draft: "Delete draft",
};

/** The period state a live close shows for its invoice's display status (§5.1 rows 2–5). */
const STATE_OF_INVOICE: Record<Exclude<InvoiceDisplayStatus, "void">, PeriodState> = {
  draft: "draft",
  invoiced: "invoiced",
  past_due: "past_due",
  paid: "paid",
};

const statusChips = (statuses: readonly InvoiceStatus[]) =>
  statuses
    .flatMap((s) => (s === "invoiced" ? ["Invoiced", "Past due"] : [INVOICE_STATUS_COPY[s].chip]))
    .join(" and ");

async function planInvoiceAction(
  ctx: QueryCtx,
  auth: McpAuthContext,
  action: InvoiceAction,
  params: BillingParams,
): Promise<Planned> {
  const { orgId } = auth;
  const invoice = params.invoiceId ? await ctx.db.get(params.invoiceId) : null;
  if (!invoice || invoice.orgId !== orgId) throw new ConvexError("Invoice not found.");
  const project = await loadProject(ctx, orgId, invoice.projectId);
  const today = await orgToday(ctx, orgId);
  const number = invoiceKey(invoice);
  const name = number ?? "This draft invoice";
  const before = invoiceDisplayStatus(invoice.status, invoice.dueDate, today);
  const outcome = INVOICE_OUTCOME[action];

  if (!INVOICE_FROM[action].includes(invoice.status)) {
    throw new ConvexError(
      `${name} is ${INVOICE_STATUS_COPY[before].chip}. ${outcome} applies to ${statusChips(INVOICE_FROM[action])} invoices.`,
    );
  }
  // The app voids only numbered drafts; a never-numbered one is deleted (N9, §5.4).
  if (action === "void_invoice" && invoice.status === "draft" && invoice.number == null) {
    throw new ConvexError("This draft was never numbered, so the app deletes it instead of voiding it: use delete_draft.");
  }

  const lines = (
    await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
      .collect()
  ).sort((a, b) => a.sortOrder - b.sortOrder);
  const closeRaw = invoice.closeId ? await ctx.db.get(invoice.closeId) : null;
  const close = closeRaw && closeRaw.orgId === orgId ? closeRaw : null;
  const snapshot = close
    ? await ctx.db
        .query("billingCloseEntries")
        .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
        .collect()
    : [];
  const releasesClose = (action === "void_invoice" || action === "delete_draft") && close !== null && close.status !== "released";

  let apply: (mctx: MutationCtx, actor: Actor) => Promise<void>;
  let allocate: { number: number; prefix: string } | null = null;
  let after: InvoiceDisplayStatus | "deleted";
  if (action === "delete_draft") {
    const plan = await planDeleteDraft(ctx, orgId, invoice);
    apply = (mctx, actor) => applyDeleteDraft(mctx, actor, plan);
    after = "deleted";
  } else {
    const target = INVOICE_TARGET[action];
    const planned = await planTransition(ctx, orgId, invoice, target);
    if (!planned.ok) throw new ConvexError(planned.reason);
    const plan = planned.plan;
    allocate = plan.allocate ? { number: plan.allocate.number, prefix: plan.allocate.prefix } : null;
    apply = (mctx, actor) => applyTransition(mctx, actor, plan);
    after = invoiceDisplayStatus(target, invoice.dueDate, today);
  }
  const numberAfter = allocate ? formatInvoiceNumber(allocate.prefix, allocate.number) : number;
  const period = close ? periodOf({ start: close.periodStart, end: close.periodEnd }) : null;

  const effect: BillingEffect = {
    action,
    outcome,
    ...(await projectHeader(ctx, orgId, project)),
    currency: invoice.currency,
    period,
    periodState:
      close && before !== "void"
        ? {
            before: chip(STATE_OF_INVOICE[before]),
            after: after === "deleted" || after === "void" ? null : chip(STATE_OF_INVOICE[after]),
          }
        : null,
    close: null,
    invoice: {
      id: invoice._id,
      number,
      numberAfter,
      statusBefore: before,
      statusAfter: after,
      subject: invoice.subject ?? null,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate ?? null,
      totalMinor: invoice.totalMinor,
      lines: lines.map((l) => ({
        lineType: l.lineType,
        description: l.description,
        quantity: l.quantity,
        quantityMinutes: l.quantityMinutes ?? null,
        unitPriceMinor: l.unitPriceMinor,
        amountMinor: l.amountMinor,
      })),
    },
    fixed: null,
    reopened: releasesClose
      ? { entryCount: snapshot.length, minutes: snapshot.reduce((sum, r) => sum + r.minutes, 0) }
      : null,
    warnings: [],
  };

  const fingerprint = fingerprintOf(action, {
    invoice: [
      invoice._id,
      invoice.status,
      invoice.number ?? null,
      invoice.prefix,
      invoice.currency,
      invoice.subtotalMinor,
      invoice.totalMinor,
      invoice.issueDate,
      invoice.dueDate ?? null,
      invoice.paidAt ?? null,
      // The document fields a finalize freezes, even when an edit kept updatedAt.
      invoice.subject ?? null,
      invoice.note ?? null,
      invoice.messageToClient ?? null,
      invoice.updatedAt,
    ],
    lines: lines.map((l) => [l._id, l.lineType, l.description, l.quantity, l.unitPriceMinor, l.amountMinor]),
    close: close ? [close._id, close.status, snapshot.map((r) => r.entryId)] : null,
    allocate,
  });

  return {
    effect,
    fingerprint,
    apply: async (mctx, actor) => {
      await apply(mctx, actor);
      return {
        action,
        outcome,
        project: { id: project._id, code: project.code, name: project.name },
        period,
        invoice: { id: invoice._id, number: numberAfter, status: after },
        entryCount: effect.reopened?.entryCount ?? null,
      };
    },
  };
}

async function planBilling(
  ctx: QueryCtx,
  auth: McpAuthContext,
  action: BillingAction,
  params: BillingParams,
): Promise<Planned> {
  switch (action) {
    case "close_period":
      return await planClosePeriod(ctx, auth, params);
    case "reopen_period":
      return await planReopenPeriod(ctx, auth, params);
    case "create_fixed_invoice":
      return await planCreateFixedInvoice(ctx, auth, params);
    default:
      return await planInvoiceAction(ctx, auth, action, params);
  }
}

// ─── Preview and commit ──────────────────────────────────────────────────────

/**
 * `billing_preview`: runs the action's plan (the app's validation and
 * computation, no domain writes), stores the preview row whose ID is the
 * commit token, and returns the effect.
 */
export async function previewBilling(ctx: MutationCtx, auth: McpAuthContext, input: BillingInput) {
  assertAdmin(auth);
  const params = await resolveBillingParams(ctx, auth, input);
  const planned = await planBilling(ctx, auth, input.action, params);
  const warnings = planned.warnings ? await planned.warnings() : [];
  const now = Date.now();
  const expiresAt = now + PREVIEW_TTL_MS;
  const token = await ctx.db.insert("mcpBillingPreviews", {
    orgId: auth.orgId,
    userId: auth.userId,
    clientId: auth.clientId,
    action: input.action,
    params,
    fingerprint: planned.fingerprint,
    createdAt: now,
    expiresAt,
  });
  return { token, expiresAt, effect: { ...planned.effect, warnings } };
}

/**
 * `billing_commit`: the token must be this user's, in this org, from this
 * OAuth client, unexpired. The plan is recomputed from the stored params;
 * any difference from the preview refuses. Otherwise the app's write path
 * runs as the caller (with `via`, D15). A committed token replays its first
 * result and writes nothing (§9.5).
 */
export async function commitBilling(
  ctx: MutationCtx,
  auth: McpAuthContext,
  token: string,
): Promise<BillingCommitResult & { replayed: boolean }> {
  assertAdmin(auth);
  const id = ctx.db.normalizeId("mcpBillingPreviews", token.trim());
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.orgId !== auth.orgId || row.userId !== auth.userId || row.clientId !== auth.clientId) {
    throw new ConvexError(UNKNOWN_TOKEN);
  }
  if (row.result) return { ...row.result, replayed: true };
  const now = Date.now();
  if (now > row.expiresAt) throw new ConvexError(EXPIRED_TOKEN);

  let planned: Planned;
  try {
    planned = await planBilling(ctx, auth, row.action, row.params);
  } catch (error) {
    // The preview's plan passed; failing now means its inputs changed.
    if (error instanceof ConvexError && typeof error.data === "string") {
      throw new ConvexError(`${DATA_CHANGED} Now: ${error.data}`);
    }
    throw error;
  }
  if (planned.fingerprint !== row.fingerprint) throw new ConvexError(DATA_CHANGED);

  const result = await planned.apply(ctx, { orgId: auth.orgId, userId: auth.userId, via: auth.via });
  await ctx.db.patch(row._id, { committedAt: now, result });
  return { ...result, replayed: false };
}
