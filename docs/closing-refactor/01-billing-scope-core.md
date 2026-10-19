# 01 — billingScope core (pure scope + flags modules, golden test suite)

## Parent PRD

`docs/prd-month-close.md` — sections: Definitions, Core invariants (I1–I4), Module Design
(`billingScope`, `closeFlags`), Testing Decisions.

## What to build

The risk-bearing heart of the feature, with **no UI**: the schema field for skips and the two pure
modules that every later slice consumes. Verifiable entirely through its test suite — for money
logic, the tests are the demo.

- Add the optional `skippedThrough` field (ISO period-end date string) to time entries
  (direct-narrow schema change; MVP dummy-data stage, no migration).
- Implement `billingScope` as a pure module (plain-data in, scope report out) realizing invariants
  I1–I4 for all billing types: effective period, close scope with carried-in reasons
  (`skipped` / `logged-late`), usage/overage minutes and amount, typed issues
  (`not-earliest-open`, `missing-overage-rate`), committability under oldest-first.
- Implement `closeFlags` as a pure module: ordered flag list (missing note; duration ≥ 480 min;
  running timer = warning severity; missing overage rate = blocking severity) plus informational
  carried lines.

## Acceptance criteria

- [x] `skippedThrough` optional field exists on time entries; nothing reads it yet outside the new
      modules; schema deploys cleanly.
- [x] `billingScope` is pure (no ctx/db access), typed, and implements I1–I4 exactly as written in
      the PRD; retainer-monthly, retainer-cycle (incl. carried-in bucketing into the first month of
      the receiving cycle), T&M, and fixed are all covered.
- [x] Non-billable handling per I2: in scope for retainer settling, never in money; excluded from
      T&M scope entirely.
- [x] `closeFlags` returns the v1 flag set with severities (warning / info / blocking) and carried
      info lines, ordered deterministically.
- [x] All 12 golden scenarios from the PRD's Testing Decisions exist as unit tests and pass.
- [x] **No-skip baseline regression**: with no skip stamps and no late entries, scope membership
      and amounts are behaviour-identical to the current date-based selection (asserted against
      the existing ready-to-invoice logic's expectations).
- [x] Settlement-stamp immutability test: inserting a backdated entry after a period is closed
      changes nothing for that period; the entry resolves to the first open period with reason
      `logged-late`.
- [x] `npx tsc --noEmit` → 0 errors; all existing suites pass unchanged (3 pre-existing time/format
      failures in `format-activity-timestamp`, `taskActivityIndicators`, and vendored tiptap are
      unrelated to this slice — no shared imports; additive change only).

## Blocked by

None — can start immediately.

## User stories addressed

Foundational for all; directly proves stories 32 and 35 at test level, and invariants I1–I4.
