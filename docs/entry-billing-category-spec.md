# Entry-Level Billing Category — Implementation Spec

- Status: approved by product owner, 2026-07-12 (this conversation is the approval)
- Depends on: nothing open; builds on the shipped snapshot-category attribution
  fix in `convex/worksheetsHelpers.ts` (worksheet groups by entry snapshot)
- Executor note: this spec is written to be executed without re-opening any
  design decision. Every "MUST" is a locked decision. Locate code by **symbol
  name and the provided `rg` commands, not by line number** — lines drift.
- Before starting, per AGENTS.md: read `convex/_generated/ai/guidelines.md`
  before touching Convex code; keep changes within this spec's scope; the
  worktree may contain concurrent work — inspect `git status` and do not touch
  unrelated modifications.

## 1. Problem

Time entries snapshot their billing category from the **task**
(`snapshotCategoryId := task.workCategoryId` at every writer). The category is
therefore a property of the to-do item, not of the work performed. When a
designer, a developer and a project manager each log time on the *same* task,
all their hours land under the task's single category and are billed at that
category's rate. Agencies cannot see (or bill) "3h Design + 4h Development +
2h PM" on one task, and a designer's hours on a "Development" task are billed
at the Development rate.

Industry reference (context, not requirements): Harvest attaches the work type
to the entry itself; Toggl attaches the bill rate to the person. We adopt the
Harvest-style entry-level category, defaulted per person so the daily UX costs
zero extra clicks.

## 2. Solution overview

The billing category becomes a property of the **entry**, resolved at entry
creation by this default chain and editable afterwards:

```text
entry category :=
  explicit user selection (form/edit)        — highest priority
  ?? entry OWNER's default work category     — new per-member setting
  ?? task.workCategoryId                     — current behavior, the fallback
```

Storage reuses the existing `timeEntries.snapshotCategoryId` field — every
financial reader (Monthly Report, invoice grouping, project overview/breakdown,
worksheet, timesheet) already groups by it, so **no reader changes are
required**. The rate engine's resolution logic is unchanged; only the *source*
of the category it receives moves from the task to the caller.

## 3. Decisions already made — do NOT re-open

1. **Default chain order is member-first** (owner default beats task category).
   A member with no default gets exactly today's behavior.
2. **Owner, not actor**: admin-on-behalf logging and archive auto-save use the
   **entry owner's** default category (mirrors the R5 cost-rate rule).
3. **Sticky category**: once written, `snapshotCategoryId` changes **only** via
   an explicit category edit. Task moves no longer re-snapshot it.
4. **Rate re-resolution** happens when (a) the category is explicitly changed,
   or (b) `isBillable` is toggled — and it MUST use the **entry's** category,
   not the task's.
5. **No new entry field.** No `categorySource` discriminator; simplicity wins.
6. **Retainer/non-billable semantics unchanged**: category is always recorded
   for grouping; retainer entries keep `billableRate = 0`; non-billable keep 0.
7. **No migration/backfill.** Existing entries keep their snapshots (they were
   inherited from the task at creation, which is exactly the fallback rule).
8. **Locked entries stay locked**: `invoiceId`/`settledAt` guards apply to
   category edits exactly as to duration edits.
9. Out of scope (do not build): FX conversion or base currency (locked owner
   decision), per-person bill rates, per-entry cost-rate override, changes to
   `convex/lib/rates.ts` (`resolveRate` is pure and stays untouched), Workday
   week-grid attribution (internal surface, stays task-category based),
   worksheet per-category sub-rows (possible later slice, not this one),
   bulk recategorization admin tool (named first follow-up slice if
   misclassified defaults show up in production).

### 3.1 Product workflow (locked, 2026-07-12) — calibrate copy and defaults to this

The owner-approved usage model this feature serves:

- **Member default is the motor.** Every member gets a one-time default work
  category (their home discipline). Daily logging requires zero category
  interaction.
- **Task category = the task's dominant discipline**, set once at creation.
  Its role after this feature: fallback for members without a default, and a
  work-organization label. It is NOT a billing steering wheel — re-categorizing
  a task to influence billing is the workaround this feature retires, and UI
  copy must never suggest it.
- **Manual selection is the exception path** (member doing atypical work),
  one click on the entry form's select.
- A task with NO category is valid when everyone logging has a default; a
  member without a default logging billable time on an uncategorized task must
  get the resolver's clear error, never a silent fallback.
- Side benefit (no code change, verify only): `projectCategoryEstimates`
  vs-actuals comparisons become discipline-accurate, since actuals are already
  grouped by `snapshotCategoryId`.

## 4. Data model changes (`convex/schema.ts`)

### 4.1 `orgMembers` — add the member default

Find the `orgMembers` table (`rg -n "orgMembers: defineTable" convex/schema.ts`)
and add:

```ts
defaultWorkCategoryId: v.optional(v.id("workCategories")),
```

No new index needed (lookups go through the existing `by_orgId_clerkUserId` /
`by_userId` indexes).

### 4.2 `timeEntries` — no field change

`snapshotCategoryId: v.optional(v.id("workCategories"))` already exists and is
reused as-is. Update its inline comment to say the value is resolved via the
member-default chain and is sticky (edited explicitly, never re-derived).

Run `npx convex codegen` after schema edits.

## 5. Backend changes

### 5.1 New helper — `resolveEntryCategory`

Add to `convex/lib/orgHelpers.ts`:

```ts
/**
 * Billing category for a new time entry — the single source for both the
 * rate lookup and the stored snapshotCategoryId. Chain (locked decision):
 * explicit selection ?? entry OWNER's default ?? task category.
 * `explicit` must already be org-validated by the caller when provided.
 */
export async function resolveEntryCategory(
  ctx: QueryCtx | MutationCtx,
  args: {
    ownerUserId: Id<"users">;
    orgId: string;
    task: Doc<"tasks">;
    explicit?: Id<"workCategories">;
  },
): Promise<Id<"workCategories"> | undefined> {
  if (args.explicit) return args.explicit;
  const member = await ctx.db
    .query("orgMembers")
    .withIndex("by_userId", (q) => q.eq("userId", args.ownerUserId))
    .filter((q) => q.eq(q.field("orgId"), args.orgId))
    .first();
  if (member?.defaultWorkCategoryId) {
    // Defensive: default may point at a deleted/foreign category.
    const cat = await ctx.db.get(member.defaultWorkCategoryId);
    if (cat && cat.orgId === args.orgId) return member.defaultWorkCategoryId;
  }
  return args.task.workCategoryId;
}
```

### 5.2 Change `resolveRateSnapshot` to take a category, not a task

In `convex/lib/orgHelpers.ts`, `resolveRateSnapshot` currently reads
`task.workCategoryId` in three places (the missing-category error branch, the
`projectRateOverrides` lookup, the `categoryRates` lookup). Change its args:

- REMOVE `task: Doc<"tasks">`
- ADD `workCategoryId: Id<"workCategories"> | undefined`

Replace every `task.workCategoryId` inside with `workCategoryId`. Keep the
error copy `"Set a category on this task before logging billable time"` but
reword to `"Choose a work category before logging billable time"` (the task is
no longer the only source). Everything else (currency lookup, userRates
lookup, retainer→0 branch, `resolveRate` call, throw-on-missing) is unchanged.

### 5.3 Update every caller (compile-driven; the list is exhaustive)

Find them: `rg -n "resolveRateSnapshot|snapshotCategoryId" convex --type ts`.
For each **writer**, the pattern is identical — compute the category ONCE via
`resolveEntryCategory`, pass it to `resolveRateSnapshot`, and store the SAME
value as `snapshotCategoryId`:

1. **`timeEntries.create`** (manual + admin-on-behalf): accept new optional
   arg `workCategoryId: v.optional(v.id("workCategories"))`. If provided,
   validate ownership (`ctx.db.get` → `cat.orgId === orgId`, else
   `ConvexError("Category not found")`) BEFORE use. Owner for the chain is the
   entry's `userId` arg (the owner), never the caller.
2. **`timeEntries.update`**: accept new optional arg `workCategoryId` with the
   same org validation. Semantics:
   - explicit `workCategoryId` present → set `snapshotCategoryId` to it and
     re-run `resolveRateSnapshot` with it (updates `costRate`/`billableRate`/
     `rateCurrency` under the same rules as creation);
   - `isBillable` toggled → re-run `resolveRateSnapshot` with the **entry's
     current** `snapshotCategoryId` (today it re-reads the task — change that);
   - task move → **delete the existing re-snapshot of `snapshotCategoryId`**
     (sticky-category decision). Keep all existing guards (locked entries,
     closed periods, cross-project rejection) untouched.
3. **`timer.stop` path — `convex/lib/timerEntry.ts`** (`buildTimerEntry` /
   the function that sets `snapshotCategoryId: opts.task.workCategoryId`):
   resolve via the chain with the **timer owner** as `ownerUserId`. No
   explicit selection exists at stop time (the commit form edits post-save via
   `timeEntries.update`).
4. **`timer.start` rate pre-check and `timer.previewRateForTask`**
   (`convex/timer.ts`, two `resolveRateSnapshot` calls): pass the chain result
   for the timer owner so the pre-start "missing rate" protection and the
   preview reflect the category that will actually be applied at stop.
5. **`timer.commitEntry`** (if it creates entries — verify with `rg -n
   "snapshotCategoryId" convex/timer.ts convex/lib/timerEntry.ts`): same chain.
6. **Archive auto-save** (`autoSaveTimersForTasks` in
   `convex/lib/timerEntry.ts`): runs per member — use EACH member's own
   default (ownerUserId = that member), not the acting admin's.
7. **Bulk billable update** (`timeEntries.bulkUpdateBillable`, the third
   `resolveRateSnapshot` caller in `convex/timeEntries.ts`): re-resolve with
   each entry's **own** `snapshotCategoryId`, not the task's.

Rule for all writers: `snapshotCategoryId` stored on the row MUST be the exact
value passed to `resolveRateSnapshot` for that row. One resolution, two uses.

### 5.4 New mutation — member default setting

Add to `convex/orgMembers.ts` if it exists, otherwise to the file that owns
member mutations (`rg -l "orgMembers" convex --type ts` and pick the module
that already exports member queries/mutations; create `convex/orgMembers.ts`
only if none exists):

```ts
export const setDefaultWorkCategory = mutation({
  args: {
    memberUserId: v.id("users"),
    workCategoryId: v.optional(v.id("workCategories")), // undefined = clear
  },
  handler: ...
});
```

Authorization: derive org + caller from server-side auth (never client
orgId). Allowed callers: org **admin** for any member, or a **member for
themselves** (`memberUserId === caller's userId`). Validate the category's
`orgId` when provided. Patch `orgMembers.defaultWorkCategoryId`.

Also expose a read: extend whatever query the Settings → User Rates screen
already uses to list members (find it from
`components/settings/settings-user-rates.tsx` imports) so it returns
`defaultWorkCategoryId` per member.

## 6. UI changes

Reuse existing shared components everywhere (owner rule: never hand-roll UI
when a shared component exists — look at how category selects are rendered in
task forms, e.g. `rg -l "workCategoryId" components/tasks components/projects`
and reuse that select/combobox). No bordered pill badges; quiet, Notion-style
controls (owner design rules).

1. **Settings → User Rates** (`components/settings/settings-user-rates.tsx`):
   add a "Default category" control per member row, wired to
   `setDefaultWorkCategory`. Empty state label: `Task category` (meaning: no
   personal default, entries inherit from the task). Help text under the
   section title: `New time entries use the member's default category; if none
   is set, the task's category. The category decides the billable rate.`
2. **Manual log form** (`components/tasks/time-log-form.tsx` and
   `components/projects/time-entry-modal.tsx` if it creates entries): add a
   category select, pre-filled by the chain (owner default ?? task category),
   submitted as `workCategoryId`. Label: `Category`. When the pre-fill came
   from the member default and differs from the task's category, show muted
   helper text: `Your default · task is <TaskCategoryName>`.
3. **Timer commit form** (`components/timer/timer-commit-form.tsx`): the entry
   is already persisted at stop (create-at-stop design — do NOT change that).
   Add the same category select showing the saved entry's category; changing
   it calls `timeEntries.update({ workCategoryId })`.
4. **Entry edit surfaces** (`components/projects/time-entry-modal.tsx`,
   `components/tasks/time-entries-table.tsx` row edit if it exists): same
   select via `timeEntries.update`. Locked entries render it disabled with the
   existing locked-entry affordance.
5. **Missing-rate error**: the create/stop error already surfaces; ensure the
   copy shown is the resolver's message (`Set a billable rate for this
   category in <CUR>` / `Choose a work category before logging billable
   time`) and not a stale hardcoded string
   (`rg -n "before logging billable" components lib convex`).

## 7. Explicitly unchanged (verify, do not modify)

- All readers: `statements.ts` grouping, `invoices.ts` invoice grouping,
  `timeEntries.projectOverview` / `projectMonthlyBreakdown`,
  `worksheetsHelpers.ts` (already snapshot-based), `timesheets.ts`, and any
  `projectCategoryEstimates` vs-actuals surface (`rg -n
  "projectCategoryEstimates" convex components` — confirm actuals come from
  entry snapshots; if so, zero changes).
- `convex/lib/rates.ts` (`resolveRate`) — pure function, untouched.
- Settlement/lock guards, date validation, rounding, tenancy checks.
- `userRates`, `categoryRates`, `projectRateOverrides` tables and screens.

## 8. Test plan (all must be written; use the existing convex-test pattern
from `convex/__tests__/invoiceTransitions.test.ts` for identity + db setup)

New file `convex/__tests__/entryCategory.test.ts`:

1. `create: member default beats task category` — member default = Design,
   task = Development → entry snapshot = Design, billableRate = Design's rate.
2. `create: no member default falls back to task category` (backward compat).
3. `create: explicit workCategoryId beats both`.
4. `create: admin-on-behalf uses the OWNER's default, not the admin's`.
5. `timer stop uses the owner's default` (start timer as member with default,
   stop, assert snapshot + rate).
6. `update: task move keeps snapshotCategoryId` (regression for the removed
   re-snapshot).
7. `update: billable toggle re-resolves from the ENTRY's category` — entry
   category Design on a Development task; toggle non-billable → billable;
   assert billableRate is Design's rate.
8. `update: explicit category change re-resolves billableRate and respects
   project overrides`.
9. `cross-org categoryId rejected` on `create`, `update`, and
   `setDefaultWorkCategory`.
10. `locked entry rejects category change` (invoiceId set → ConvexError).
11. `retainer entry records category, billableRate stays 0`.
12. `missing categoryRate in project currency throws before write; timer
    survives` (stop → error → timer state intact; mirrors existing rollback).
13. `setDefaultWorkCategory: member can set self, cannot set others; admin can
    set anyone; clearing works`.
14. `create: uncategorized task + owner default works` — task has no
    `workCategoryId`, owner default = Design → entry snapshot = Design.
15. `create: uncategorized task + no owner default + billable throws the
    resolver error before any write` (and the timer-stop variant keeps the
    timer alive).

Also extend one existing worksheet test to cover a task whose in-scope entries
carry two different snapshot categories (label lists both — behavior shipped
in the attribution fix).

## 9. Implementation order (one slice per PR-sized step)

1. Schema (§4) + `npx convex codegen`.
2. `resolveEntryCategory` + `resolveRateSnapshot` signature change + all
   writer call sites (§5.1–5.3). Compile errors are the checklist — the change
   is done when `npx tsc --noEmit` is clean and every former `task.workCategoryId`
   read inside writers flows through the chain.
3. `setDefaultWorkCategory` mutation + member-list read extension (§5.4).
4. Tests (§8) — write and run before UI, they pin the semantics.
5. UI (§6).
6. Full verification.

## 10. Verification (run all, report results)

```bash
npx tsc --noEmit
npx vitest run convex/__tests__/entryCategory.test.ts --reporter=dot
npm test -- --reporter=dot   # pre-existing failures: see docs/fable-to-review/results/_wip-agent-outputs/results-task-00.md (4 known activity-UI failures + .reference config defect) — introduce no NEW failures
npx eslint app components convex lib proxy.ts --quiet   # 63 pre-existing errors outside the chain; introduce no new ones
```

Manual browser check (dev server `next-dev`): set a default category for a
member; log manual time on a task with a different category; verify the entry
snapshot in the UI; verify Monthly Report and a period worksheet bucket that
entry under the member-default category.

## 11. Acceptance criteria

- [ ] Designer (default: Design), developer (default: Development) and PM
      (default: PM) logging on ONE task produce three entries with three
      different snapshot categories and each discipline's billable rate.
- [ ] Monthly Report, invoice grouping, worksheet and timesheet all bucket
      those hours identically (per entry snapshot) with zero reader changes.
- [ ] A member with no default gets exactly the pre-change behavior.
- [ ] An uncategorized task works when loggers have defaults; a defaultless
      member logging billable on it gets the clear resolver error, pre-write.
- [ ] Task moves never change an entry's category; explicit edits do; locked
      entries can't be edited.
- [ ] No FX, no per-person bill rates, no `resolveRate` changes, no backfill.
- [ ] All §8 tests pass; no new tsc/eslint/test failures.
