/**
 * `closeFlags` — derive the v1 review-checklist flags and informational
 * carried-in lines from a `billingScope` report plus running-timer info.
 *
 * PRD `docs/prd-month-close.md` § Review checklist (v1 flag set — fixed, not
 * configurable):
 *   - Missing note        (empty note on an in-scope entry)      → warning
 *   - Long entry          (duration ≥ 480 min)                   → warning
 *   - Running timer       (overlapping the period)               → warning
 *   - Missing overage rate (over-budget retainer, no rate)       → blocking
 *   - Carried-in          (foreign-dated entry pulled into close)→ info
 *
 * Pure — the same flag list feeds queue rows ("N to review") and the workspace
 * checklist. Carried-in entries produce informational (non-warning) lines, so
 * "All clear — ready to close" holds once no warning/blocking flag remains.
 */

import type { Id } from "../_generated/dataModel";
import type { BillingScopeReport, CarriedReason } from "./billingScope";

export const LONG_ENTRY_MINUTES = 480; // ≥ 8h — forgotten-timer suspicion.

export type CloseFlagSeverity = "blocking" | "warning" | "info";

export type CloseFlagKind =
  | "missing-overage-rate"
  | "running-timer"
  | "long-entry"
  | "missing-note"
  | "carried-in";

export type CloseFlag = {
  kind: CloseFlagKind;
  severity: CloseFlagSeverity;
  /** The entry the checklist row jumps to / highlights, when entry-anchored. */
  entryId?: Id<"timeEntries">;
  /** Carried-in only — reason + origin month for the info line copy. */
  carried?: { reason: CarriedReason; originMonthKey: string };
};

/** A running timer that overlaps the period (warning only — never blocking). */
export type RunningTimerInfo = {
  entryId?: Id<"timeEntries">;
  /** The user whose timer is running — for the checklist row copy. */
  userId?: Id<"users">;
};

export type CloseFlagsInput = {
  scope: BillingScopeReport;
  /** Timers currently running that overlap the period. Empty when none. */
  runningTimers?: RunningTimerInfo[];
};

// Deterministic ordering. Primary key = severity (blocking → warning → info),
// secondary = kind, so the checklist reads worst-first and never reshuffles.
const SEVERITY_RANK: Record<CloseFlagSeverity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};
const KIND_RANK: Record<CloseFlagKind, number> = {
  "missing-overage-rate": 0,
  "running-timer": 1,
  "long-entry": 2,
  "missing-note": 3,
  "carried-in": 4,
};

export function computeCloseFlags(input: CloseFlagsInput): CloseFlag[] {
  const { scope } = input;
  const flags: CloseFlag[] = [];

  // Blocking — missing overage rate on an over-budget retainer.
  if (scope.issues.includes("missing-overage-rate")) {
    flags.push({ kind: "missing-overage-rate", severity: "blocking" });
  }

  // Warning — running timers overlapping the period.
  for (const t of input.runningTimers ?? []) {
    flags.push({
      kind: "running-timer",
      severity: "warning",
      entryId: t.entryId,
    });
  }

  // Per-entry warnings + carried info lines.
  for (const e of scope.entries) {
    if ((e.note ?? "").trim() === "") {
      flags.push({ kind: "missing-note", severity: "warning", entryId: e.entryId });
    }
    if (e.durationMinutes >= LONG_ENTRY_MINUTES) {
      flags.push({ kind: "long-entry", severity: "warning", entryId: e.entryId });
    }
    if (e.carried && e.carriedReason) {
      flags.push({
        kind: "carried-in",
        severity: "info",
        entryId: e.entryId,
        carried: { reason: e.carriedReason, originMonthKey: e.originMonthKey },
      });
    }
  }

  return sortFlags(flags);
}

/**
 * One checklist LINE per flag kind — the display aggregation. Thirty
 * missing-note flags are one fact ("30 entries are missing a note"), not
 * thirty rows; the checklist stays a handful of lines no matter how messy
 * the month is, and `entryIds` powers the click-to-filter on the ledger.
 */
export type CloseFlagSummary = {
  kind: CloseFlagKind;
  severity: CloseFlagSeverity;
  count: number;
  /** Entries behind this line (empty for non-entry flags like overage rate). */
  entryIds: Id<"timeEntries">[];
};

export function summarizeCloseFlags(flags: CloseFlag[]): CloseFlagSummary[] {
  const byKind = new Map<CloseFlagKind, CloseFlagSummary>();
  for (const f of flags) {
    let summary = byKind.get(f.kind);
    if (!summary) {
      summary = { kind: f.kind, severity: f.severity, count: 0, entryIds: [] };
      byKind.set(f.kind, summary);
    }
    summary.count++;
    if (f.entryId) summary.entryIds.push(f.entryId);
  }
  return [...byKind.values()].sort((a, b) => {
    const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sr !== 0) return sr;
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
}

/** True when a review warning or blocker remains (info carried lines don't count). */
export function hasBlockingOrWarning(flags: CloseFlag[]): boolean {
  return flags.some((f) => f.severity === "blocking" || f.severity === "warning");
}

/** Count of review items surfaced on a queue row ("N to review") — excludes info. */
export function reviewFlagCount(flags: CloseFlag[]): number {
  return flags.filter((f) => f.severity !== "info").length;
}

function sortFlags(flags: CloseFlag[]): CloseFlag[] {
  return [...flags].sort((a, b) => {
    const sr = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sr !== 0) return sr;
    const kr = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (kr !== 0) return kr;
    const ae = a.entryId ?? "";
    const be = b.entryId ?? "";
    return ae < be ? -1 : ae > be ? 1 : 0;
  });
}
