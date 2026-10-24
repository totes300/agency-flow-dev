/**
 * Period state (docs/prd-project-billing-redesign.md §5) — every row of the
 * §5.1 derivation table, the §5.3 action matrix, the §5.4 undo matrix and the
 * §5.5 counts. Pure: no Convex runtime.
 */

import { describe, expect, it } from "vitest";
import {
  PERIOD_STATE_COPY,
  countPeriods,
  derivePeriodState,
  invoiceDisplayStatus,
  isNeedsAction,
  navBadge,
  periodPrimaryAction,
  periodUndoActions,
  type PeriodState,
  type PeriodStateInput,
} from "../billing/periodState";

const TODAY = "2026-10-24";

const ended = (over: Partial<PeriodStateInput> = {}): PeriodStateInput => ({
  periodEnded: true,
  liveClose: null,
  invoice: null,
  amountMinor: 0,
  missingRate: false,
  todayOrgTz: TODAY,
  ...over,
});

const ALL_STATES: PeriodState[] = [
  "in_progress",
  "ready_to_close",
  "ready_to_invoice",
  "needs_rate",
  "draft",
  "invoiced",
  "past_due",
  "paid",
  "closed",
];

const AUG = { key: "2026-08", label: "August 2026" };

// ─── §5.1 derivation ─────────────────────────────────────────────────────────

describe("§5.1 derivePeriodState — first match wins", () => {
  it("row 1: a period that has not ended is in progress, whatever else is true", () => {
    expect(derivePeriodState(ended({ periodEnded: false }))).toBe("in_progress");
    expect(derivePeriodState(ended({ periodEnded: false, amountMinor: 5000, missingRate: true }))).toBe(
      "in_progress",
    );
    expect(
      derivePeriodState(
        ended({ periodEnded: false, liveClose: { status: "draft" }, invoice: { status: "draft" } }),
      ),
    ).toBe("in_progress");
  });

  it("row 2: live close with a draft invoice → draft (reverted numbered drafts too)", () => {
    expect(
      derivePeriodState(ended({ liveClose: { status: "draft" }, invoice: { status: "draft" }, amountMinor: 100 })),
    ).toBe("draft");
  });

  it("row 2 (defensive): a draft close without an invoice still reads as draft", () => {
    expect(derivePeriodState(ended({ liveClose: { status: "draft" } }))).toBe("draft");
  });

  it("row 3: live close with a paid invoice → paid (even past its due date)", () => {
    expect(
      derivePeriodState(
        ended({ liveClose: { status: "final" }, invoice: { status: "paid", dueDate: "2026-01-01" } }),
      ),
    ).toBe("paid");
  });

  it("row 4: invoiced and due date before today (org timezone) → past due", () => {
    expect(
      derivePeriodState(
        ended({ liveClose: { status: "final" }, invoice: { status: "invoiced", dueDate: "2026-10-23" } }),
      ),
    ).toBe("past_due");
  });

  it("row 5: invoiced, due today, in the future or without a due date → invoiced", () => {
    for (const dueDate of [TODAY, "2026-11-03", undefined]) {
      expect(
        derivePeriodState(ended({ liveClose: { status: "final" }, invoice: { status: "invoiced", dueDate } })),
      ).toBe("invoiced");
    }
  });

  it("row 6: final close without an invoice → closed", () => {
    expect(derivePeriodState(ended({ liveClose: { status: "final" } }))).toBe("closed");
  });

  it("row 7: no live close and a missing overage rate → needs rate (beats an amount)", () => {
    expect(derivePeriodState(ended({ missingRate: true }))).toBe("needs_rate");
    expect(derivePeriodState(ended({ missingRate: true, amountMinor: 0 }))).toBe("needs_rate");
  });

  it("row 8: no live close and money to bill → ready to invoice", () => {
    expect(derivePeriodState(ended({ amountMinor: 1 }))).toBe("ready_to_invoice");
  });

  it("row 9: no live close, nothing to bill → ready to close", () => {
    expect(derivePeriodState(ended())).toBe("ready_to_close");
  });

  it("a void invoice is invisible: the period falls back to rows 7–9", () => {
    const voided = { liveClose: { status: "final" as const }, invoice: { status: "void" as const } };
    expect(derivePeriodState(ended({ ...voided, amountMinor: 2500 }))).toBe("ready_to_invoice");
    expect(derivePeriodState(ended({ ...voided, missingRate: true }))).toBe("needs_rate");
    expect(derivePeriodState(ended(voided))).toBe("ready_to_close");
  });

  it("a live close wins over live pricing inputs (frozen amount, rate fixed later)", () => {
    expect(derivePeriodState(ended({ liveClose: { status: "final" }, missingRate: true, amountMinor: 900 }))).toBe(
      "closed",
    );
  });
});

// ─── §5.2 vocabulary ─────────────────────────────────────────────────────────

describe("§5.2 vocabulary", () => {
  it("every state has the exact chip and tone", () => {
    expect(Object.fromEntries(ALL_STATES.map((s) => [s, [PERIOD_STATE_COPY[s].chip, PERIOD_STATE_COPY[s].tone]])))
      .toEqual({
        in_progress: ["In progress", "grey"],
        ready_to_close: ["Ready to close", "blue"],
        ready_to_invoice: ["Ready to invoice", "blue"],
        needs_rate: ["Needs rate", "amber"],
        draft: ["Draft", "amber"],
        invoiced: ["Invoiced", "green"],
        past_due: ["Past due", "red"],
        paid: ["Paid", "green"],
        closed: ["Closed", "green"],
      });
  });

  it("invoice display status: only an invoiced invoice past its due date is past due", () => {
    expect(invoiceDisplayStatus("invoiced", "2026-10-01", TODAY)).toBe("past_due");
    expect(invoiceDisplayStatus("invoiced", TODAY, TODAY)).toBe("invoiced");
    expect(invoiceDisplayStatus("invoiced", undefined, TODAY)).toBe("invoiced");
    expect(invoiceDisplayStatus("paid", "2026-01-01", TODAY)).toBe("paid");
    expect(invoiceDisplayStatus("draft", "2026-01-01", TODAY)).toBe("draft");
    expect(invoiceDisplayStatus("void", "2026-01-01", TODAY)).toBe("void");
  });
});

// ─── §5.3 action matrix ──────────────────────────────────────────────────────

describe("§5.3 periodPrimaryAction", () => {
  const committable = { isCommittable: true };
  const blocked = { isCommittable: false, blockedBy: AUG };

  it("in progress, paid and closed have no action", () => {
    for (const s of ["in_progress", "paid", "closed"] as const) {
      expect(periodPrimaryAction(s, committable)).toBeNull();
      expect(periodPrimaryAction(s, blocked)).toBeNull();
    }
  });

  it("ready to invoice, committable → Review & invoice, the only filled button", () => {
    expect(periodPrimaryAction("ready_to_invoice", committable)).toEqual({
      kind: "review_invoice",
      label: "Review & invoice",
      emphasis: "primary",
    });
  });

  it("ready to invoice, blocked → disabled with the reason and the blocking period", () => {
    expect(periodPrimaryAction("ready_to_invoice", blocked)).toEqual({
      kind: "review_invoice",
      label: "Review & invoice",
      emphasis: "secondary",
      blocked: { reason: "Close August 2026 first", by: AUG },
    });
  });

  it("ready to close, committable → Review & close (secondary)", () => {
    expect(periodPrimaryAction("ready_to_close", committable)).toEqual({
      kind: "review_close",
      label: "Review & close",
      emphasis: "secondary",
    });
  });

  it("ready to close, blocked → disabled with the reason", () => {
    expect(periodPrimaryAction("ready_to_close", blocked)?.blocked).toEqual({
      reason: "Close August 2026 first",
      by: AUG,
    });
  });

  it("not committable without a blocker (nothing earlier open) stays enabled", () => {
    expect(periodPrimaryAction("ready_to_close", { isCommittable: false })?.blocked).toBeUndefined();
  });

  it("needs rate → Set rate, committable or not", () => {
    for (const o of [committable, blocked]) {
      expect(periodPrimaryAction("needs_rate", o)).toEqual({ kind: "set_rate", label: "Set rate", emphasis: "secondary" });
    }
  });

  it("draft → Open draft", () => {
    expect(periodPrimaryAction("draft", blocked)).toEqual({ kind: "open_draft", label: "Open draft", emphasis: "secondary" });
  });

  it("invoiced and past due → Mark as paid (secondary)", () => {
    for (const s of ["invoiced", "past_due"] as const) {
      expect(periodPrimaryAction(s, committable)).toEqual({
        kind: "mark_paid",
        label: "Mark as paid",
        emphasis: "secondary",
      });
    }
  });

  it("only an enabled Review & invoice is ever primary", () => {
    for (const s of ALL_STATES) {
      for (const o of [committable, blocked]) {
        const a = periodPrimaryAction(s, o);
        if (a?.emphasis === "primary") expect([s, o.isCommittable]).toEqual(["ready_to_invoice", true]);
      }
    }
  });
});

// ─── §5.4 undo matrix ────────────────────────────────────────────────────────

describe("§5.4 periodUndoActions", () => {
  const kinds = (s: PeriodState, ctx?: Parameters<typeof periodUndoActions>[1]) =>
    periodUndoActions(s, ctx).map((a) => a.label);

  it("closed → Reopen period", () => {
    expect(periodUndoActions("closed")).toEqual([{ kind: "reopen_period", label: "Reopen period", confirm: false }]);
  });

  it("closed with a later live close → Reopen disabled with the reason", () => {
    expect(periodUndoActions("closed", { laterLiveClose: { key: "2026-09", label: "September 2026" } })).toEqual([
      {
        kind: "reopen_period",
        label: "Reopen period",
        confirm: false,
        disabledReason: "Reopen September 2026 first",
      },
    ]);
  });

  it("draft never numbered → Delete draft; numbered (reverted) → Void invoice…", () => {
    expect(kinds("draft")).toEqual(["Delete draft"]);
    expect(kinds("draft", { draftNumbered: false })).toEqual(["Delete draft"]);
    expect(kinds("draft", { draftNumbered: true })).toEqual(["Void invoice…"]);
  });

  it("invoiced and past due → Revert to draft · Void invoice…", () => {
    expect(kinds("invoiced")).toEqual(["Revert to draft", "Void invoice…"]);
    expect(kinds("past_due")).toEqual(["Revert to draft", "Void invoice…"]);
  });

  it("paid → Mark as unpaid", () => {
    expect(kinds("paid")).toEqual(["Mark as unpaid"]);
  });

  it("open and in-progress periods have nothing to undo", () => {
    for (const s of ["in_progress", "ready_to_close", "ready_to_invoice", "needs_rate"] as const) {
      expect(kinds(s)).toEqual([]);
    }
  });

  it("void always confirms; nothing else does", () => {
    for (const s of ALL_STATES) {
      for (const ctx of [{ draftNumbered: true }, { draftNumbered: false }]) {
        for (const a of periodUndoActions(s, ctx)) expect(a.confirm).toBe(a.kind === "void_invoice");
      }
    }
  });
});

// ─── §5.5 counts ─────────────────────────────────────────────────────────────

describe("§5.5 needs action and past due", () => {
  it("needs action = ready to close, ready to invoice, needs rate, draft", () => {
    expect(ALL_STATES.filter(isNeedsAction)).toEqual(["ready_to_close", "ready_to_invoice", "needs_rate", "draft"]);
  });

  it("counts every period (blocked ones too); past due is separate", () => {
    expect(
      countPeriods(["ready_to_close", "ready_to_close", "ready_to_invoice", "draft", "past_due", "paid", "in_progress"]),
    ).toEqual({ needsActionCount: 4, pastDueCount: 1 });
  });

  it("badge shows needs action; past due only when nothing needs action", () => {
    expect(navBadge({ needsActionCount: 3, pastDueCount: 2 })).toEqual({
      count: 3,
      tooltip: "3 periods need action · 2 past due",
    });
    expect(navBadge({ needsActionCount: 0, pastDueCount: 2 }).count).toBe(2);
    expect(navBadge({ needsActionCount: 1, pastDueCount: 0 })).toEqual({
      count: 1,
      tooltip: "1 period needs action · 0 past due",
    });
    expect(navBadge({ needsActionCount: 0, pastDueCount: 0 }).count).toBe(0);
  });
});
