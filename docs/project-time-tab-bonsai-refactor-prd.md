# Project Time Tab — Bonsai-style Refactor (PRD)

Status: Ready for implementation (grilled 2026-04-19, rev 3)
Author: Adam Toth
Date: 2026-04-18 (rev 3: 2026-04-19)
Scope: Project detail page → **Time** tab (all billing types except non-billable)
Tracking branch: TBD via `iteration-brancher`

---

## 1. Goal

Refactor the project **Time** tab to match Bonsai's UX for agency time-tracking.
Same data model, richer UI: aggregated stats, flexible grouping, fast inline
billable toggle, and a manual "Add Time" entry flow. Header-level
"Invoice Unbilled Hours" shortcut alongside the existing per-row selection
flow.

### Non-goals
- No changes to the timer (`convex/timer.ts` start/stop flow).
- No changes to rate cascade, invoice generation logic, or retainer cycle handling.
- No changes to the Overview, Invoices, or Settings sub-tabs.
- No mobile-specific layout (desktop-first, existing breakpoints).

---

## 2. Locked design decisions (grilled 2026-04-18)

| # | Decision | Chosen |
|---|----------|--------|
| 1 | Group by default | **By Day** |
| 2 | Invoice Unbilled Hours button on Retainer | **Hidden** — T&M only |
| 3 | Billable toggle on invoiced entries | **Visible, disabled + tooltip** |
| 4 | Add Time task picker scope | **Current project only** |
| 5 | Stats row per billing type | **T&M: 4 stats, Fixed/Retainer: 3 stats** |
| 6 | Grouping options | **All 6**: None, Day, Week, Month, Member, Task |
| 7 | Duration input format | **HH:MM single field** |
| 8 | Add Time ACL | **Admin: any member · Member: self only** |
| 9 | Group header totals | **Hours only** (all billing types) |
| 10 | Invoice Unbilled Hours click behavior | **Opens existing `CreateInvoiceModal`** (preflight) |
| 11 | Add Time when project has zero tasks | **Inline quick-create task** inside the modal (title + category + assignee); on submit, task is pre-selected and time fields unlock (rev 3) |
| 12 | Billable toggle UI location | **Inline `$` icon in Billing column** |
| 13 | Selection checkboxes vs header button | **Keep both**; both open `CreateInvoiceModal` |
| 14 | Group collapse state persistence | **In-memory only** (no URL) |
| 15 | Inner-group sort | **Date desc, then creation desc** |
| 16 | Admin member picker scope | **Project team members first**, with "Show all org members" toggle (rev 3) |
| 17 | Non-T&M stats labels | **Total · Billable · Non-billable** |
| 18 | Category in Add Time modal | **Task-inherited, not editable** |
| 19 | Billable toggle feedback | **Immediate mutation + Undo toast** that fires a reverse mutation on click (no delayed-commit, no flush) (rev 3) |
| 20 | PR split | **Single atomic PR** |
| 21 | Row `⋯` menu actions | **Edit · Delete** |
| 22 | Header button with zero unbilled | **Disabled + tooltip** |
| 23 | Edit modal field lock | **All fields editable on non-invoiced entries** (task change re-resolves category + rate snapshot); invoiced entries fully locked (rev 3) |
| 24 | Date range filter | **Preset dropdown + custom picker** — presets: This week, Last week, This month, Last month, This year, All time, Custom. Default: All time. URL-synced via `dateRange=this_week\|last_week\|this_month\|last_month\|this_year\|all\|custom` + `from=YYYY-MM-DD&to=YYYY-MM-DD` when custom (rev 3) |
| 25 | Bulk billable toggle | **Selection toolbar gets "Mark Billable" / "Mark Non-Billable" buttons** alongside the existing Create Invoice button (T&M admin only). Each runs `api.timeEntries.update` in a loop client-side (acceptable for v1; selection size is bounded by visible rows) (rev 3) |

---

## 3. UX specification

### 3.1 Top stats row

Sits directly above the existing filter toolbar. Dot-separated label/value pairs, all tabular nums.

**T&M** (4 stats):
```
Total Hours  25h 56m  ·  Billable Hours  25h 56m  ·  Unbilled Hours  25h 56m  ·  Unbilled Amount  €384.14
```

**Fixed / Retainer** (3 stats):
```
Total Hours  37h 40m  ·  Billable Hours  37h 40m  ·  Non-billable  0h 0m
```

- Hours formatted via `formatMinutes` (already `HH:MM`, but display spec calls for `Xh Ym`; we adopt `Xh Ym` specifically for the stats row — new helper `formatHoursCompact(minutes)` in `lib/format.ts`).
- Amounts via `formatCurrencyPrecise(amount, currency)`.
- Stats respect active filters (member, billingStatus, search). Values are client-side aggregates of `data.entries`; no backend change needed.
- Skeleton: 4×h-5 placeholders when `data === undefined`.

### 3.2 Filter + grouping toolbar

Current `ProjectTimeFilters` gains a **Group by** dropdown button next to the existing Filter pill. Bonsai's visual is a 2×2 grid icon + current group label (e.g., `⊞ By Day`).

**Grouping options** (dropdown menu):
- None
- Day *(default)*
- Week
- Month
- Member
- Task

**URL**: `?groupBy=day|week|month|member|task|none` — default (`day`) omitted from URL.

**Layout under the toolbar**:
- `groupBy === "none"` → flat table, current behavior.
- Otherwise: group header rows with caret, label, and right-aligned `Xh Ym` total.
- Collapsed groups hide their entries; state is local `useState<Set<groupKey>>`; reset on `groupBy` change.

**Group labels**:
| Group | Header format |
|-------|---------------|
| Day | Day-of-week + short date (`Today`, `Yesterday`, `Mon, Apr 6, 2026`) |
| Week | `Apr 13–19, 2026` (Monday–Sunday) |
| Month | `April 2026` |
| Member | Member name (sort: alpha asc) |
| Task | Task title (sort: alpha asc) |

**Within-group sort**: date desc, then entry `createdAt` desc (matches current flat-sort behavior).

**Group calendar chip**: leading calendar glyph only on date-based groups (Day/Week/Month) per Bonsai; member/task groups use an avatar or category dot placeholder — simplest: use the same `CalendarIcon`-in-tinted-box for date groups, no icon for member/task groups.

### 3.3 Table changes

Columns (kept from current, reordered to match Bonsai):

| Col | Content | Conditions |
|-----|---------|------------|
| — | Checkbox | T&M only |
| Date | `MM/DD/YYYY` | Always |
| Member | Avatar + name | Always |
| Task | Task title + note line | Always |
| Category | Dot + name badge | Always |
| Billing | **Inline `$` toggle** | Always (new) |
| Billing Status | Pill (Unbilled / Non-Billable / Invoice link) | Always |
| Hours | `HH:MM:SS` tabular-nums | Always |
| Rate | Currency | T&M only |
| Amount | Currency | T&M only |
| — | `⋯` row menu | Always (new) |

### 3.4 Inline billable toggle (`$` icon)

- Green filled `$` = billable; muted gray `$` = non-billable.
- **Click pattern = delayed-commit undo** via the existing `lib/hooks/use-undo-action.ts` hook (not optimistic-then-rollback). Flow:
  1. Local UI flips the `$` state immediately (visual-only, not a mutation). Add the entry id to a local `pendingToggles: Map<entryId, targetBillable>` state.
  2. `useUndoAction.trigger()` schedules `api.timeEntries.update({ id, isBillable })` after the default 5s delay and shows a toast with an **Undo** button.
  3. If the user clicks Undo → hook's `onUndo` fires → remove id from `pendingToggles`, visual state reverts naturally because the view derives `effectiveIsBillable = pendingToggles.get(id) ?? entry.isBillable`.
  4. If the timer fires → mutation runs. On success, hook leaves timer entry drained; on error, hook calls `onUndo` (rollback) + `onError` (toast). **Important**: `onUndo` is the *only* visual rollback path — `onError` is for extra messaging only, per `use-undo-action.ts:63–69` semantics. Avoid double-reverting.
- This matches the project-wide convention already used for archive/delete flows and avoids an out-of-band optimistic layer.
- **Invoiced entry**: icon stays in its current state color but is `cursor-not-allowed`, `pointer-events: none` on the click handler, tooltip `Can't change on invoiced entries`. Backend already blocks (`update` throws `Cannot edit an invoiced time entry`) — UI is defense in depth.
- Rate-less user/category when toggling to billable: the `update` mutation re-resolves the rate snapshot (see `convex/timeEntries.ts:317–338`). If resolution fails, the thrown error surfaces via `onError`.

**Invoice consistency while toggles are pending** (P0 from Codex rev-2):
The 5s delay means the backend still sees the old billable state during the undo window, so "Invoice Unbilled Hours" and the selection toolbar could capture or miss the wrong rows. Rule:
- The row's **effective** billable state for any invoicing UI = pending-target state, not backend state. Derive all unbilled counts, selection eligibility, and visible stats from `effectiveIsBillable`.
- When the user clicks **Invoice Unbilled Hours** or the selection toolbar's **Create Invoice**, we **flush all pending toggles synchronously** before opening `CreateInvoiceModal`: call `useUndoAction.flush()` (new method on the hook — runs every scheduled mutation immediately and cancels its timer). Hook change is ~10 lines and doesn't break existing callsites.
- If any flushed mutation fails, surface the error, keep the invoice modal closed.
- Bulk lock (disabling invoicing for 5s after every toggle) is rejected — too annoying for normal workflow.

### 3.5 Row `⋯` menu

Dropdown items:
- **Edit** — opens `TimeEntryModal` in edit mode.
- **Delete** — confirm dialog (`Delete this entry?`), calls `api.timeEntries.remove({ id })` (existing mutation).
- Both disabled with tooltip `Can't modify invoiced entries` when `invoiceId` is set.
- Permission: members see the menu only on their **own** entries (backend already enforces); admin sees it on all non-invoiced entries.

### 3.6 Header action buttons

Right-aligned row above the table (after the filter toolbar):

```
[ Search ] [ Filter 1 ] [ ⊞ Group by: Day ]     [ Invoice Unbilled Hours ] [ Add Time ]
```

- **Invoice Unbilled Hours** (T&M only, **admin only**)
  - Primary outline-variant button. Hidden entirely for Retainer and Fixed. Hidden for non-admin users (backend `invoices.createInvoice` is `requireAdmin`).
  - Disabled + tooltip `No unbilled hours` when `unbilledCount === 0`.
  - Click → opens existing `CreateInvoiceModal` with `preset="all"` preselected and `projectId`. The modal's "all uninvoiced" preset already resolves the correct entries server-side via `getInvoicePreview`.

- **Add Time** (always visible to members and admins)
  - Primary filled button.
  - Click → opens new `TimeEntryModal` in create mode.

### 3.7 Selection toolbar (T&M admin only, enhanced hook-up)

- Keep the floating bottom toolbar (`ProjectTimeSelectionToolbar`).
- **Permission gate (new)**: the checkbox column and the floating toolbar render only when `isAdmin && project.billingType === "t_and_m"`. Member users on a T&M project see the table without the checkbox column — they can neither select nor bulk-invoice. Non-admin access to `createInvoice` already 403s at the backend; this change makes the UI match.
- **Change**: the "Create Invoice from Selected" button no longer calls `createInvoice` directly. It opens `CreateInvoiceModal` in the new `timeEntryIds`-summary mode (see §4.2).
- Reason: the user wants uniform preflight UX whether they click `Invoice Unbilled Hours` or select-rows-then-invoice.

### 3.8 `TimeEntryModal` (new)

Single modal, `mode: "create" | "edit"`.

**Fields** (all modes):
- **Task** — `Select` (searchable). Source: project's tasks (archived excluded — backend rejects archived), ordered by status then alpha. Required. In edit mode: read-only.
- **Date** — `DatePicker`. Required. Default: today in `orgSettings.timezone` (create) / existing date (edit). Field is disabled on invoiced entries.
- **Duration** — single text input. **Reuse `lib/duration.ts:parseDuration`** (already handles `1:30`, `1h30m`, `1h 30m`, `30m`, `1.5`, `90`). Display placeholder `01:30`. Required; parser must return `> 0`. No new parser — strict spec overridden to "use the shared flexible parser for consistency with the task-detail time entry UI".
- **Billable** — `Switch`. Default on create: inherits `task.billable`; follows task selection change. In edit: current `isBillable`. Disabled on invoiced entries.
- **Note** — textarea, optional. Backend trims and stores `undefined` for empty.
- **Member** — `Select` populated from `api.orgMembers.listOrgMembers` (all org members). **Admin only**; members don't see this field at all (defaults to self on backend). Default: current user. Validation is backend-side — `create` already checks admin + `validateAssignees` (see `convex/timeEntries.ts:197–202`).

**Empty-state guard**: if the project has zero tasks, modal body renders a blocking empty state: icon + "No tasks yet. Time entries must belong to a task." + primary CTA `Go to Tasks`. CTA navigates to `/tasks` (global tasks page, where task creation lives). The project detail page has no Tasks sub-tab, and neither the Overview nor the Retainer views expose a quick-create task flow — `/tasks` is the canonical creation surface. After creating the task there, the user returns to the project Time tab and retries Add Time. Follow-up polish (deep-link `/tasks?project=<id>&create=1`) is out of scope for this PR.

**Submit**:
- Create → `api.timeEntries.create({ taskId, durationMinutes, date, isBillable, note, userId? })` — **existing mutation; no new one needed** (see §4.1).
- Edit → `api.timeEntries.update({ id, durationMinutes?, date?, isBillable?, note? })` — existing; §4.1a adds date validation on this path.
- Success toast; modal closes; Convex reactivity refreshes the list.

---

## 4. Backend changes

> **Correction (Codex review):** No new `createManualTimeEntry` mutation is needed. The existing `api.timeEntries.create` already supports all Add Time requirements (admin `userId` override with `validateAssignees`, org-timezone date default, YYYY-MM-DD format validation, rate snapshot, rounding, archived-task rejection). See `convex/timeEntries.ts:182–275`.

### 4.1 Reuse `api.timeEntries.create` (no new mutation)

Existing validator:
```ts
{
  taskId: v.id("tasks"),
  durationMinutes: v.number(),
  note: v.optional(v.string()),
  isBillable: v.optional(v.boolean()),
  date: v.optional(v.string()),
  userId: v.optional(v.id("users"))
}
```

Already handles: orgId scoping, admin-only `userId` override, cross-org user rejection, YYYY-MM-DD format validation, rate cascade + snapshot, org-timezone date default, archived-task rejection, rounding, activity log.

**One small spec delta needed**: the create mutation currently accepts any date string that parses as a Date — it does **not** reject future dates. Product decision: **allow future dates in both create and edit** (no change needed). Reasoning: agencies sometimes pre-book time. If the user disagrees, add a "date must be ≤ today in orgTz" guard in both `create` and `update` behind a single helper.

### 4.1a Harden date validation across time-entry mutations

Current code (`convex/timeEntries.ts:314–316`) writes `args.date` verbatim with no validation. The `create` guard at `convex/timeEntries.ts:204–208` and `convex/timer.ts:277` use a weak `new Date()` check that accepts impossible dates like `2026-02-30`. A stricter round-trip validator already exists at `convex/projects.ts:436–443`.

Required refactor — extract and reuse:
```ts
// convex/lib/dateValidation.ts (new)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export function assertValidDateString(s: string, fieldName = "date") {
  if (!DATE_REGEX.test(s)) throw new ConvexError(`Invalid ${fieldName} format — expected YYYY-MM-DD`);
  const [y, m, d] = s.split("-").map(Number);
  const testDate = new Date(y, m - 1, d);
  if (testDate.getFullYear() !== y || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
    throw new ConvexError(`Invalid ${fieldName}`);
  }
}
```

Apply in all three callsites:
- `convex/timeEntries.ts:204` (`create`) — replace the weak regex+NaN check.
- `convex/timeEntries.ts:314` (`update`) — add the check (new; was missing).
- `convex/timer.ts:277` — replace for consistency.

Net behavior: `2026-02-30` and similar impossible calendar dates now throw instead of silently parsing to March 2.

Invoiced-entry block, admin/self permission check, and rate re-snapshot on billable toggle already exist — no further change to `update`.

### 4.2 `CreateInvoiceModal` — add `timeEntryIds`-summary mode

Today the modal works by date-range preset (or retainer month) and calls `api.invoices.getInvoicePreview` with `{ startDate, endDate, roundingMinutes }`. It does **not** accept an explicit id list.

**Extensions needed (UI + backend preview):**

1. **Component prop (new)**: `timeEntryIds?: Id<"timeEntries">[]`. Callsite passes the selection from the toolbar.
2. **UI branch**: when `timeEntryIds` is provided, the component hides the preset chips, date pickers, and retainer month dropdown. Instead it shows a compact readonly summary: `N entries · Apr 6 → Apr 18, 2026`, with the date range derived client-side from `entries.map(e => e.date)` min/max (already available in `ProjectTimeSelectionToolbar` via props).
3. **Preview query**: the existing `api.invoices.getInvoicePreview` needs a new optional arg `timeEntryIds?: Id<"timeEntries">[]`. When provided, preview aggregates totals over those ids (still `requireAdmin`, still filtered by `orgId`). When omitted, existing date-range behavior. Keeps backward compatibility with non-toolbar callsites.
4. **T&M-only contract mirror**: `createInvoice` already rejects `timeEntryIds` unless the project is T&M (`convex/invoices.ts:~977`). `getInvoicePreview` must enforce the same rule when `timeEntryIds` is provided — throw `ConvexError("timeEntryIds is only supported for T&M projects")` — so preview and mutation contracts cannot drift.
5. **Retainer-preview mutual exclusion**: reject simultaneous `timeEntryIds` + retainer-month args; the two flows are incompatible.
6. **Create call**: the modal already calls `api.invoices.createInvoice` which already accepts `timeEntryIds`. Just forward the prop.

### 4.3 Group-by timezone helper (new, `lib/date-buckets.ts`)

The PRD's Week/Month groups require bucketing time entries into org-timezone-aware buckets. `entry.date` is already a `YYYY-MM-DD` string in org timezone (produced server-side via `getDateInTimezone`), so bucketing is pure string math — but the Day-group label (`Today`, `Yesterday`, `Mon, Apr 6, 2026`) needs "today" computed in `orgSettings.timezone`, not `new Date()`.

New helpers (pure):
```ts
export function bucketKey(date: string, grouping: "day" | "week" | "month"): string
export function bucketLabel(date: string, grouping: "day" | "week" | "month", orgTimezone: string): string
```

`bucketKey` returns a stable, unambiguous string:
- Day → `2026-04-06` (date itself)
- **Week → the Monday-of-week date as YYYY-MM-DD, e.g. `2026-04-13`** (NOT ISO `2026-W15` — avoids ISO-week vs calendar-year ambiguity at Dec/Jan boundaries).
- Month → `2026-04`

`bucketLabel` formats the human label; Today/Yesterday are computed by comparing `date` to the org-tz `today` string (same approach already used elsewhere in the codebase — reuse `formatter.format(now)` pattern from `create-invoice-modal.tsx:52–55`). Week range is computed Monday–Sunday via UTC date arithmetic like `lib/daily-notes-helpers.ts:12`, never via `new Date()` with local time (which drifts at DST boundaries).

**Unit tests required** (co-located `date-buckets.test.ts`) covering at minimum:
- Week bucket for Mon/Sun same-week entries resolves to the same key.
- Week bucket spanning Dec 30 → Jan 3 year boundary produces the expected Monday key (no ISO week-year confusion).
- Month bucket for `2026-12-31` and `2027-01-01` sit in different buckets (`2026-12` vs `2027-01`).
- DST boundary dates produce stable labels.

### 4.4 No schema changes

Everything needed is already in `timeEntries` and `invoices`. No migration required.

---

## 5. Permissions summary

| Action | Member | Admin |
|--------|--------|-------|
| View Time tab | Own entries on projects they're on team of | All entries |
| Add Time (self) | ✅ | ✅ |
| Add Time (for another user) | ❌ (no member picker rendered) | ✅ (picker lists all org members) |
| Edit entry | Own entries only, not invoiced | Any non-invoiced entry |
| Delete entry | Own entries only, not invoiced | Any non-invoiced entry |
| Toggle billable (`$` icon) | Own entries only, not invoiced | Any non-invoiced entry |
| See checkbox column + selection toolbar | ❌ (column hidden) | ✅ (T&M only) |
| Invoice Unbilled Hours (header button) | ❌ (hidden) | ✅ (T&M only) |
| Create invoice from selection | ❌ | ✅ (T&M only) |

Enforcement is **backend-first** (all `invoices.*` mutations are `requireAdmin`; `timeEntries.update`/`remove` check `isAdmin || entry.userId === userId`; `timeEntries.create` gates `userId` override on admin + `validateAssignees`). UI hides/disables the controls as defense in depth.

The client checks admin status via the existing `useIsAdmin` hook; non-admin T&M users see a "read-only" version of the tab (same table, no selection column, no invoicing affordances, no Add Time member picker).

---

## 6. Edge cases

- **Zero entries, no filters** → existing empty state (`No time logged yet`).
- **Zero entries, filters active** → existing empty state (`No entries match your filters` + Clear link).
- **T&M, all billable invoiced** → existing "All billable time has been invoiced" banner still shows.
- **Member with zero rate at toggle to billable** → mutation resolves via cascade; if cascade still yields 0, rollback + `toastError`.
- **Group by Member when filters narrow to one member** → single group rendered; keep header for consistency.
- **Group by Task where an entry's task is archived** → archived tasks still group normally using their title; badge for archived state deferred (out of scope).
- **Cross-timezone entries** — group boundaries (Day/Week/Month) use `orgSettings.timezone`, not local browser tz. `entry.date` is already org-tz YYYY-MM-DD (produced server-side); the Today/Yesterday label must compute "today" via the `Intl.DateTimeFormat("en-CA", { timeZone: orgTimezone })` pattern used elsewhere, never via `new Date()` directly.
- **Week bucket boundary** — Monday–Sunday, not Sunday-first. Label format: `Apr 13–19, 2026` (same month) or `Apr 28 – May 4, 2026` (cross-month). Pure string math on `YYYY-MM-DD`.
- **Invoiced entry in selection** — the existing code already excludes invoiced entries from select-all-visible; keep that guarantee.
- **User toggles billable → undoes → navigates away** — undo toast uses a ref to cancel if the component unmounts; no ghost mutation.

---

## 7. Acceptance criteria

Functional:
- [ ] Stats row shows 4 values on T&M and 3 on Fixed/Retainer, respects active filters.
- [ ] Group by dropdown offers all 6 options; default on first visit is `By Day`; state persists in URL.
- [ ] Group headers show hour total; clicking caret toggles collapse; state resets on `groupBy` change.
- [ ] Inline `$` toggle flips billable state with undo toast; invoiced entries show disabled state + tooltip.
- [ ] Row `⋯` menu offers Edit and Delete; both disabled with tooltip on invoiced entries.
- [ ] `Add Time` modal creates a manual time entry for current user (member) or any org member (admin).
- [ ] `Add Time` duration input parses `HH:MM`, `1h30m`, `1:30`, `90m`, `1.5h` correctly.
- [ ] No-tasks project → modal shows blocking empty state with `Create a task first` CTA.
- [ ] `Invoice Unbilled Hours` header button visible on T&M only, disabled when no unbilled, opens `CreateInvoiceModal`.
- [ ] Selection toolbar "Create Invoice" now opens `CreateInvoiceModal` with `timeEntryIds` pre-bound.
- [ ] Edit mode locks Task field; invoiced entries are fully read-only.
- [ ] All mutations multi-tenant safe (orgId filtering).

Quality:
- [ ] `npx tsc --noEmit` → 0 errors.
- [ ] `npm run lint` → 0 errors.
- [ ] Loading skeletons are content-aware (stats row placeholders, grouped rows skeleton).
- [ ] Empty-state flow follows the Loading → Empty → Content pattern.
- [ ] `CLAUDE.md` conventions respected (component separation, parameterized helpers, 0 inline components in `page.tsx`, URL-state for filterables).

Accessibility:
- [ ] Group header rows are keyboard-operable (`role="button"`, `tabIndex={0}`, Enter/Space toggles collapse).
- [ ] Collapse state has an `aria-expanded` attribute on each header.
- [ ] Row `⋯` menu uses the shadcn `DropdownMenu` primitive (already keyboard + screen reader wired).
- [ ] Inline `$` toggle has `aria-label="Toggle billable"` and `aria-pressed` reflecting state; disabled state uses `aria-disabled` + `title`.
- [ ] `TimeEntryModal` uses shadcn `Dialog` with initial focus on the Task field (create) or Duration field (edit). Esc closes, click-outside closes when pristine, asks for confirmation when dirty.

Error states:
- [ ] All mutations (`create`, `update`, `remove`, `createInvoice`) wrapped in `try/catch` with `toastError(...)` per CLAUDE.md mandatory-error-handling rule.
- [ ] `getInvoicePreview` failures inside `CreateInvoiceModal` surface an inline error block (already present pattern) and disable the CTA.
- [ ] Undo-toast action revert path shows a destructive toast on mutation error. **Single rollback source**: the visual `pendingToggles` entry is cleared in `onUndo` only (which `use-undo-action` calls automatically on both user-Undo and mutation failure); `onError` is reserved for extra messaging/telemetry and must NOT touch the visual state — double-reverting would flip the icon back to the unwanted target value.

---

## 8. Deferred / out of scope

- Tags column (Bonsai has it, we don't have a tags model yet).
- Custom date-range filter on the Time tab (today we only have member/status/search).
- Bulk billable toggle (checkbox + "Mark selected non-billable").
- Row `⋯` → Duplicate entry.
- Inline editing (double-click on cell to edit without modal).
- Keyboard shortcuts for Add Time (`N`, etc.).
- Mobile-responsive grouped layout.
- Pagination / virtualization (current implementation is flat list; fine for MVP).

---

## 9. Implementation sketch

File footprint (expected):

```
convex/
  timeEntries.ts                  # + date-format validation in `update`
  invoices.ts                     # + optional timeEntryIds arg in getInvoicePreview
components/projects/
  project-time.tsx                # orchestrator — adds stats row + groupBy + admin gating
  project-time-stats.tsx          # new — top summary row (adaptive by billing type)
  project-time-filters.tsx        # + Group by dropdown (URL sync for groupBy)
  project-time-table.tsx          # adds inline $ toggle, row ⋯ menu; hides checkbox for non-admin
  project-time-grouped.tsx        # new — renders grouped variant with collapsible headers
  project-time-selection-toolbar.tsx  # opens CreateInvoiceModal with timeEntryIds
  time-entry-modal.tsx            # new — create+edit modal (reuses api.timeEntries.create/update)
components/invoices/
  create-invoice-modal.tsx        # + timeEntryIds prop + summary-mode UI branch
lib/
  format.ts                       # + formatHoursCompact (`Xh Ym`)
  date-buckets.ts                 # new — bucketKey/bucketLabel helpers, org-tz aware
  date-buckets.test.ts            # new — year-boundary + DST unit tests
  hooks/use-undo-action.ts        # + flush() method (runs all scheduled actions immediately; cancels timers)
  duration.ts                     # (reused as-is, no changes)
convex/lib/
  dateValidation.ts               # new — assertValidDateString (round-trip guard)
```

Any invoice entrypoint (`Invoice Unbilled Hours` header button, selection-toolbar `Create Invoice`) **awaits** `useUndoAction.flush()` before opening `CreateInvoiceModal`, so the backend sees the latest billable state.

Estimated diff: ~850–1050 lines across ~13 files. Net backend change is small: `update` gets a date-format guard (~5 lines), `create` and `timer.ts` get refactored to use the shared helper (~5 lines each net), `getInvoicePreview` gets an optional arg branch with T&M guard (~35 lines). Everything else is UI.

Dependencies to verify with `context7` before touching:
- shadcn Select/Dialog/DropdownMenu/Switch (latest APIs).
- None for Convex (follow `_generated/ai/guidelines.md`).

---

## 10. Rev-3 deltas (2026-04-19)

These override the corresponding paragraphs in §3–§4. Everything not listed here stays as written.

### 10.1 Billable toggle — simplified undo model (overrides §3.4)

Drop the delayed-commit / `pendingToggles` / `flush()` design entirely. New flow:

1. User clicks the `$` icon.
2. Fire `api.timeEntries.update({ id, isBillable: !current })` immediately. UI reflects backend state via Convex reactivity (no local override needed).
3. Show a toast: `Marked ${billable ? "billable" : "non-billable"} · Undo`.
4. Undo click → fire the reverse mutation (`update({ id, isBillable: current })`). Dismiss the toast. No further UI work — reactivity handles the revert.
5. On mutation error (forward or reverse) → `toastError(err, "Couldn't update entry")`. Convex query stays authoritative; UI self-corrects.

**Consequences:**
- `lib/hooks/use-undo-action.ts` **does not** need a `flush()` method. That task is removed.
- Invoice entrypoints no longer need to await anything — backend state is always current.
- `effectiveIsBillable` / `pendingToggles` disappear from §3.1 stats, §3.4 row rendering, §3.7 selection eligibility.
- Rate re-resolution still happens backend-side on every `update` (unchanged).

**Net LOC saved**: ~120 lines vs rev 2.

### 10.2 Add Time — inline task quick-create (overrides §3.8 empty-state guard)

If the project has zero tasks, the modal **does not redirect**. Instead, above the Task select, render an inline quick-create form:

```
Task *                                            ┌─ no tasks yet ─┐
[ Create your first task for this project: ]
[ Title:     _____________________________ ]
[ Category:  ▾ (defaults to first category)  ]
[ Assignee:  ▾ (defaults to current user)    ]
[                             [ Create task ] ]
```

On submit:
- Call the existing `api.tasks.create` mutation with `{ projectId, title, categoryId, assigneeId }`. No new backend.
- On success, the created task becomes the selected value of the Task select; the rest of the Add Time form (Date, Duration, Billable, Note, Member) unlocks. User fills it in and submits normally.
- On error, toast + keep the form open with entered values.

After the first task exists, the project is no longer in the "no tasks" state; subsequent Add Time opens use the normal task picker (empty-state scaffold doesn't render again).

**Scope note**: this is a create-task affordance *inside* the time-entry modal only. The broader `/tasks` flow is unchanged.

### 10.3 Edit modal — task field is editable (overrides §3.8 "In edit mode: read-only" and decision #23)

On non-invoiced entries, all fields including **Task** are editable. Behavior on task change:
- On `update({ id, taskId: newTaskId })`: backend re-validates task belongs to same project + org, not archived, and re-resolves `categoryId` + `rateSnapshot` from the new task (mirrors the billable-toggle rate-resolution path in `convex/timeEntries.ts:317–338`).
- Backend work: add `taskId: v.optional(v.id("tasks"))` to the `update` validator; on presence, run the same archived-check/org-check used in `create`, overwrite `categoryId`, re-run the rate cascade if entry is billable. Invoiced-entry block stays in place.
- UI: Task select is enabled with same options as create mode, plus a "Category will be updated to …" helper line when user picks a task with a different category.

On invoiced entries, modal stays fully read-only (unchanged).

### 10.4 Add Time — member picker scope (overrides decision #16)

Admin's Member select renders a two-section dropdown:
- **Project team** (default, top section) — members already on `project.teamMembers`.
- **All org members** — toggle link `Show all org members` at the bottom of the list; on click, appends remaining `api.orgMembers.listOrgMembers` entries (filtered by `!project.teamMembers.includes`) as a second `SelectGroup`.
- If the project has no team members defined, the picker falls back to all org members with no toggle.

Non-admins never see the picker (unchanged).

### 10.5 Date range filter (new, supersedes §6 "Deferred: custom date-range filter")

Adds a **Date range** select to `ProjectTimeFilters`, left-to-right: `[Members] [Billing Status (T&M)] [Date range] [Group by] [Search]`.

**Preset options** (in order):
- This week (Mon–Sun in org-tz, anchored on today)
- Last week (prior Mon–Sun)
- This month (1st → last of current month in org-tz)
- Last month (1st → last of prior month)
- This year (Jan 1 → Dec 31 current year in org-tz)
- All time (default; URL value omitted)
- Custom… → opens a two-field date picker (from/to), both required, to ≥ from.

**URL state**:
- `?dateRange=this_week|last_week|this_month|last_month|this_year|custom`
- When `custom`: also `&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- Default (`all`) is omitted from URL.

**Backend**: extend `api.timeEntries.listProjectEntries` validator with optional `fromDate?: string` and `toDate?: string` (YYYY-MM-DD). Use `assertValidDateString` from §4.1a. Filter `.filter(q => q.gte("date", fromDate))` and `.lte("date", toDate)` in the existing query; no new index needed because the query already walks project-scoped entries.

**Preset → date** computation lives client-side in `lib/date-buckets.ts` (already introduced in §4.3). Add:
```ts
export function resolveDateRangePreset(
  preset: DateRangePreset,
  orgTimezone: string,
): { from: string; to: string } | null // null for "all"
```

All org-tz math must use the same `Intl.DateTimeFormat("en-CA", { timeZone })` pattern the PRD already mandates — no `new Date()` shortcuts.

**Unit tests** (extend `date-buckets.test.ts`):
- This week on a Sunday resolves to the Monday 6 days prior (not the next Monday).
- Last month in January resolves to prior December.
- DST-boundary week doesn't skip or duplicate a day.

### 10.6 Bulk billable toggle (new, extends §3.7)

Selection toolbar (T&M admin only) gains two buttons:
- **Mark Billable** — visible when selection has ≥ 1 row with `isBillable === false && invoiceId == null`.
- **Mark Non-Billable** — visible when selection has ≥ 1 row with `isBillable === true && invoiceId == null`.

Click → call `api.timeEntries.update({ id, isBillable })` once per affected row in a `Promise.all`. Selection is bounded by visible rows (no pagination in v1), so client-side loop is acceptable. If any mutation fails, surface a single `toastError("N of M entries updated")` and keep selection intact so user can retry.

Invoiced rows in the selection are skipped silently (backend already blocks; UI simply filters them out of the call list).

No new backend mutation — reuse `update`.

**Deferred still**: bulk category reassignment, bulk delete, bulk move-to-task.

### 10.7 File footprint updates (overrides §9 sketch)

Additions vs rev 2:
- `lib/date-buckets.ts` — add `resolveDateRangePreset`.
- `components/projects/project-time-filters.tsx` — add date-range Select + custom picker.
- `components/projects/time-entry-modal.tsx` — inline task quick-create block; project-team-first member picker with "Show all" toggle; editable Task field in edit mode.
- `components/projects/project-time-selection-toolbar.tsx` — Mark Billable / Mark Non-Billable buttons.
- `convex/timeEntries.ts` — `update` gains `taskId` optional arg with category+rate re-resolution; `listProjectEntries` gains `fromDate`/`toDate` optional args.

Removals vs rev 2:
- `lib/hooks/use-undo-action.ts` **no longer needs** `flush()` — the whole delayed-commit flow is gone.
- No `pendingToggles` state in `project-time.tsx`.
- No `flush-before-invoice` coupling anywhere.

Net impact: roughly neutral on total LOC. The undo simplification (~-120) and removed coupling roughly offset the new date-range preset logic (~+100) and inline task quick-create (~+60).

---

## 11. Next steps

1. User reviews this PRD (rev 3).
2. `iteration-brancher` creates a branch off `main`.
3. Implementation proceeds in the single atomic PR per §2.20.
4. Backlog entry added to `docs/backlog.md` per CLAUDE.md.
