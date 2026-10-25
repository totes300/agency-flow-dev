/**
 * Period state — the ONE derivation of where a billing period stands, and the
 * one action (and undo set) each state offers.
 *
 * docs/prd-project-billing-redesign.md §5. Pure: plain data in, plain data
 * out. The project page, the Billing hub, the Close workspace and the sidebar
 * badge all read these rules, so they cannot disagree. The UI renders the
 * returned labels; it never re-derives a state or an action.
 *
 *   §5.1  derivePeriodState   first matching row wins
 *   §5.2  PERIOD_STATE_COPY   chip label, tone and hover meaning
 *   §5.3  periodPrimaryAction one action per state; blocked → disabled + reason
 *   §5.4  periodUndoActions   the ⋯ menu's undo items per state
 *   §5.5  isNeedsAction       ready_to_close · ready_to_invoice · needs_rate · draft
 */

// ─── States ──────────────────────────────────────────────────────────────────

export type PeriodState =
  | "in_progress"
  | "ready_to_close"
  | "ready_to_invoice"
  | "needs_rate"
  | "draft"
  | "invoiced"
  | "past_due"
  | "paid"
  | "closed";

export type InvoiceStatus = "draft" | "invoiced" | "paid" | "void";

export type PeriodStateInput = {
  /** `period.end < todayOrgTz`. */
  periodEnded: boolean;
  /** The period's live (draft or final) close; released closes are never passed. */
  liveClose: { status: "draft" | "final" } | null;
  /** The live close's invoice, when it has one. */
  invoice: { status: InvoiceStatus; dueDate?: string } | null;
  /** Live price for open periods; the frozen close amount otherwise. */
  amountMinor: number;
  /** Pricing issue `missing-overage-rate`. */
  missingRate: boolean;
  /** Today in the org timezone (YYYY-MM-DD) — decides past due. */
  todayOrgTz: string;
};

/**
 * §5.1, first match wins. A void invoice is invisible: voiding releases its
 * close, so the period falls back to the open rows (7–9).
 */
export function derivePeriodState(input: PeriodStateInput): PeriodState {
  if (!input.periodEnded) return "in_progress";

  const invoice = input.invoice && input.invoice.status !== "void" ? input.invoice : null;
  const live = input.invoice?.status === "void" ? null : input.liveClose;
  if (live) {
    if (invoice?.status === "draft") return "draft";
    if (invoice?.status === "paid") return "paid";
    if (invoice?.status === "invoiced") {
      return invoice.dueDate !== undefined && invoice.dueDate < input.todayOrgTz
        ? "past_due"
        : "invoiced";
    }
    // A draft close always carries a draft invoice; without one it still waits on it.
    return live.status === "draft" ? "draft" : "closed";
  }

  if (input.missingRate) return "needs_rate";
  if (input.amountMinor > 0) return "ready_to_invoice";
  return "ready_to_close";
}

/** States with no live close — the ones oldest-first applies to. */
export function isOpenState(state: PeriodState): boolean {
  return state === "ready_to_close" || state === "ready_to_invoice" || state === "needs_rate";
}

/** §5.5 — the month-end work queue. Past due is a separate signal. */
export function isNeedsAction(state: PeriodState): boolean {
  return isOpenState(state) || state === "draft";
}

// ─── Vocabulary (§5.2) ───────────────────────────────────────────────────────

export type StateTone = "grey" | "blue" | "amber" | "green" | "red";

export const PERIOD_STATE_COPY: Record<PeriodState, { chip: string; tone: StateTone; meaning: string }> = {
  in_progress: { chip: "In progress", tone: "grey", meaning: "Period not over yet" },
  ready_to_close: { chip: "Ready to close", tone: "blue", meaning: "Ended within budget — review and close" },
  ready_to_invoice: {
    chip: "Ready to invoice",
    tone: "blue",
    meaning: "Ended with billable work — review to create the draft",
  },
  needs_rate: { chip: "Needs rate", tone: "amber", meaning: "Over budget but no overage rate" },
  draft: { chip: "Draft", tone: "amber", meaning: "Draft invoice waiting to be finalized" },
  invoiced: { chip: "Invoiced", tone: "green", meaning: "Finalized, not yet paid" },
  past_due: { chip: "Past due", tone: "red", meaning: "Invoiced, past the due date" },
  paid: { chip: "Paid", tone: "green", meaning: "Paid" },
  closed: { chip: "Closed", tone: "green", meaning: "Closed within budget, nothing invoiced" },
};

/** Invoice-only statuses (Invoices views). An invoiced invoice past its due date is "Past due" everywhere. */
export type InvoiceDisplayStatus = "draft" | "invoiced" | "past_due" | "paid" | "void";

export const INVOICE_STATUS_COPY: Record<InvoiceDisplayStatus, { chip: string; tone: StateTone }> = {
  draft: { chip: "Draft", tone: "amber" },
  invoiced: { chip: "Invoiced", tone: "green" },
  past_due: { chip: "Past due", tone: "red" },
  paid: { chip: "Paid", tone: "green" },
  void: { chip: "Void", tone: "grey" },
};

export function invoiceDisplayStatus(
  status: InvoiceStatus,
  dueDate: string | undefined,
  todayOrgTz: string,
): InvoiceDisplayStatus {
  return status === "invoiced" && dueDate !== undefined && dueDate < todayOrgTz ? "past_due" : status;
}

// ─── Primary action (§5.3) ───────────────────────────────────────────────────

export type PeriodRef = { key: string; label: string };

export type PrimaryActionKind = "review_invoice" | "review_close" | "set_rate" | "open_draft" | "mark_paid";

export const PRIMARY_ACTION_LABEL: Record<PrimaryActionKind, string> = {
  review_invoice: "Review & invoice",
  review_close: "Review & close",
  set_rate: "Set rate",
  open_draft: "Open draft",
  mark_paid: "Mark as paid",
};

export type PrimaryAction = {
  kind: PrimaryActionKind;
  label: string;
  /** Filled button — only an enabled Review & invoice (one primary per view). */
  emphasis: "primary" | "secondary";
  /** Set when the period is not the committable one: the button renders disabled. */
  blocked?: { reason: string; by: PeriodRef };
};

/**
 * The single action a period offers, or null (in progress, paid, closed). A
 * later ended open period keeps its action but disabled, naming the period
 * that must be closed first (B3). Needs rate is never blocked: setting the
 * rate is allowed on any period.
 */
export function periodPrimaryAction(
  state: PeriodState,
  oldestFirst: { isCommittable: boolean; blockedBy?: PeriodRef },
): PrimaryAction | null {
  const make = (kind: PrimaryActionKind, emphasis: PrimaryAction["emphasis"]): PrimaryAction => ({
    kind,
    label: PRIMARY_ACTION_LABEL[kind],
    emphasis,
  });
  switch (state) {
    case "ready_to_invoice":
    case "ready_to_close": {
      const kind = state === "ready_to_invoice" ? "review_invoice" : "review_close";
      if (!oldestFirst.isCommittable && oldestFirst.blockedBy) {
        return {
          ...make(kind, "secondary"),
          blocked: { reason: `Close ${oldestFirst.blockedBy.label} first`, by: oldestFirst.blockedBy },
        };
      }
      return make(kind, kind === "review_invoice" ? "primary" : "secondary");
    }
    case "needs_rate":
      return make("set_rate", "secondary");
    case "draft":
      return make("open_draft", "secondary");
    case "invoiced":
    case "past_due":
      return make("mark_paid", "secondary");
    case "in_progress":
    case "paid":
    case "closed":
      return null;
  }
}

// ─── Undo (§5.4) ─────────────────────────────────────────────────────────────

export type UndoActionKind = "reopen_period" | "delete_draft" | "revert_to_draft" | "void_invoice" | "mark_unpaid";

export const UNDO_ACTION_LABEL: Record<UndoActionKind, string> = {
  reopen_period: "Reopen period",
  delete_draft: "Delete draft",
  revert_to_draft: "Revert to draft",
  void_invoice: "Void invoice…",
  mark_unpaid: "Mark as unpaid",
};

export type UndoAction = {
  kind: UndoActionKind;
  label: string;
  /** Void always confirms (B8). */
  confirm: boolean;
  /** Reopen behind a later live close: shown disabled with this reason. */
  disabledReason?: string;
};

/**
 * The ⋯ menu's undo items after "View entries · Download worksheet".
 * `draftNumbered`: the draft invoice has ever been numbered (a reverted
 * draft) — it can only be voided (N9). `laterLiveClose`: the nearest later
 * period that still has a live close — reopening must wait for it.
 */
export function periodUndoActions(
  state: PeriodState,
  ctx: { draftNumbered?: boolean; laterLiveClose?: PeriodRef } = {},
): UndoAction[] {
  const item = (kind: UndoActionKind, extra: Partial<UndoAction> = {}): UndoAction => ({
    kind,
    label: UNDO_ACTION_LABEL[kind],
    confirm: kind === "void_invoice",
    ...extra,
  });
  switch (state) {
    case "closed":
      return [
        item(
          "reopen_period",
          ctx.laterLiveClose ? { disabledReason: `Reopen ${ctx.laterLiveClose.label} first` } : {},
        ),
      ];
    case "draft":
      return [item(ctx.draftNumbered ? "void_invoice" : "delete_draft")];
    case "invoiced":
    case "past_due":
      return [item("revert_to_draft"), item("void_invoice")];
    case "paid":
      return [item("mark_unpaid")];
    case "in_progress":
    case "ready_to_close":
    case "ready_to_invoice":
    case "needs_rate":
      return [];
  }
}

// ─── Counts (§5.5) ───────────────────────────────────────────────────────────

export function countPeriods(states: PeriodState[]): { needsActionCount: number; pastDueCount: number } {
  let needsActionCount = 0;
  let pastDueCount = 0;
  for (const s of states) {
    if (isNeedsAction(s)) needsActionCount += 1;
    if (s === "past_due") pastDueCount += 1;
  }
  return { needsActionCount, pastDueCount };
}

/** Sidebar badge: needs action; past due only when nothing needs action. */
export function navBadge(counts: { needsActionCount: number; pastDueCount: number }): {
  count: number;
  tooltip: string;
} {
  const { needsActionCount: n, pastDueCount: m } = counts;
  return {
    count: n > 0 ? n : m,
    tooltip: `${n} ${n === 1 ? "period needs" : "periods need"} action · ${m} past due`,
  };
}
