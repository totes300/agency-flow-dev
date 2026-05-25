# Phase 9 — Client Worksheet Export (CSV + AI summary)

> **Goal**: A CSV companion to the work delivered in a given scope (a retainer month, a retainer cycle, an invoice's entry set, or an ad-hoc filtered range). Includes AI-generated client-facing task summaries. The user opens the CSV in Excel, edits if needed, and sends it alongside the invoice.
> **Depends on**: Phase 7 (time entries) + Phase 8 (settlement, retainer cycle math, invoice/report generation)
> **The mental model**: **Worksheet lives where the scope lives.** Wherever a surface defines a billable scope (a retainer month, a retainer cycle, an invoice, or a user-picked ad-hoc range), the worksheet trigger sits on that surface. The worksheet is a live render — never stored, never paired to an invoice as a coupled document.

---

## Decisions

| Question | Decision |
|---|---|
| Trigger surfaces | Scope-driven, not project-type-driven. See the placement table below. |
| Project type support (v1) | Retainer monthly (Slice 1) → AI (Slice 2) → Retainer cycle (Slice 3) → Invoice (Slice 4) → Ad-hoc project-header (Slice 5). Every project type is covered by the final shipped set. |
| Worksheet ↔ invoice coupling | **Decoupled by default.** The worksheet is a live render of tasks + entries in the chosen scope. For T&M invoices (which scope by user-selected entries), the *invoice row's* worksheet trigger uses `lineItems.timeEntryIds` as its scope source — but the worksheet itself is not "bound" to the invoice as a paired document. |
| Preview / edit before download? | ❌ No in-app preview/editor. The CSV is the editable draft; Excel/Sheets is the review surface. |
| Cache AI summaries on tasks? | ❌ No. Regenerate fresh every export. (Caching deferred — see §10.) |
| Row granularity | One row per task. Time = sum of that task's entries in scope. No Rate column. |
| Rate column | ❌ Skipped. The invoice carries the money — the worksheet carries the work. |
| Entry inclusion | Every entry in scope is included by default, billable and non-billable. The ad-hoc export adds a billable-only / non-billable-only filter; everywhere else, both are included. |
| Billable display | Split into `Billable hours`, `Non-billable hours`, `Total hours`. |
| Task inclusion rule | A task appears if at least one of its entries falls inside the scope. |
| Task description in CSV | AI-generated concise summary. Raw `tasks.description` (potentially long client input) is never dumped. |
| Per-task included-vs-overage split | ❌ Not at the row level. Retainer math surfaces only at the monthly subtotal rows in a cycle export. |
| AI model | `claude-sonnet-4-6` routed through **Vercel AI Gateway** with the `"anthropic/claude-sonnet-4-6"` provider string. Direct Anthropic SDK is a fallback only. |
| Where the AI call lives | Convex action (`convex/worksheets.ts`). Mutations cannot make external HTTP calls. |
| Concurrency | Bounded parallelism across tasks. |
| Empty-content fallback | If a task has no description, no subtasks, no comments, and no entry notes: skip the AI call. Emit deterministic title-based summaries. |
| Per-task AI error handling | Failed row gets deterministic fallback text. Export continues. Whole-batch failure → toast, no download. |
| Comment scope for AI | Flattened by `createdAt`, text only. Thread structure (`parentCommentId`), reactions, and attachments are ignored. |
| Permissions | Admin only (`requireAdmin`), matching invoice generation. |
| Multi-tenant guard | Internal query verifies `project.orgId === currentUser.orgId` before reading any data. |
| File encoding | UTF-8 with BOM, so Excel on Windows renders Hungarian / accented chars correctly. |
| Storage | None. Server returns CSV string; client downloads via `Blob` + anchor click. |
| Current periods | Current in-progress months are exportable. Worksheet reflects work logged so far. |

### Trigger placement table

| Surface | Project type | Scope source | Component |
|---|---|---|---|
| Retainer monthly row `⋯` | Retainer | The calendar month that row represents | `RowOverflow` in [`monthly-breakdown-card.tsx:834`](components/projects/monthly-breakdown-card.tsx:834) |
| Retainer cycle-close row `⋯` | Retainer | The full cycle the row closes | Same file, cycle-close variant at [`monthly-breakdown-card.tsx:772`](components/projects/monthly-breakdown-card.tsx:772) |
| Project header `⋯` → `Download worksheet…` | Fixed, T&M, Retainer | A picker modal (period preset/custom + category multi-select + billable filter). See §Ad-hoc export. | [`project-detail-header.tsx:125`](components/projects/project-detail-header.tsx:125) `DropdownMenu` |
| Invoice row `⋯` → `Download worksheet` | Any (primary: T&M) | The invoice's `lineItems.timeEntryIds` (canonical entry-set rule per [`schema.ts:379`](convex/schema.ts:379)) | [`invoice-row-actions.tsx:214`](components/invoices/invoice-row-actions.tsx:214) |

**`InvoiceBanner` is intentionally NOT a worksheet surface.** The banner represents "open / unbilled work" — it has no defined scope until the user generates an invoice. Worksheets only render *defined* scopes.

---

## CSV column spec

| Column | Source |
|---|---|
| Task name | `tasks.title` |
| Category | `workCategories.name` for the task's category |
| Task summary | AI-generated concise summary of what the task was about, based on title + parsed task description + subtasks. Replaces dumping the raw long task description. |
| What we did | AI-generated from title + description + subtasks + flattened comments + included entry notes. Fallback `"Worked on {title}."` when empty content. |
| First worked | Earliest included `timeEntries.date` for this task in scope. |
| Last worked | Latest included `timeEntries.date` for this task in scope. |
| Entry count | Count of included time entries for this task. |
| Billable hours | Sum of billable `timeEntries.durationMinutes` for entries in the scope, formatted `H:MM`. |
| Non-billable hours | Sum of non-billable `timeEntries.durationMinutes` for entries in the scope, formatted `H:MM`. |
| Total hours | Sum of all included `timeEntries.durationMinutes` for entries in the scope, formatted `H:MM`. |

**No Rate column. No per-row included/overage flag. No raw long task-description dump.**

---

## CSV file structure

### Single-scope export (retainer interim month, 1-month cycle, invoice scope, or ad-hoc with no filters)

```
Client:        Acme Corp
Project:       Acme Retainer
Period:        May 2026
Generated:     2026-05-25

Task name,Category,Task summary,What we did,First worked,Last worked,Entry count,Billable hours,Non-billable hours,Total hours
"Homepage hero redesign","Design","Refresh the homepage hero section with clearer positioning and updated visuals.","Refreshed the hero with new product photography and a sharper CTA.","2026-05-03","2026-05-08",3,4:00,0:00,4:00
"Bugfix: contact form","Dev","Resolve the reported contact form submission failure.","Fixed the form submission error reported on May 12.","2026-05-12","2026-05-12",1,1:30,0:00,1:30
"Internal sync","Account","Coordinate delivery details and next steps for the active workstream.","Held the weekly status call and aligned the next tasks.","2026-05-15","2026-05-15",1,0:00,0:30,0:30
,,,,,,,,,
,,,,,,,Total billable,5:30,
,,,,,,,Total non-billable,0:30,
,,,,,,,Total all,6:00,
```

### Full-cycle export (final month of a multi-month retainer cycle)

```
Client:        Acme Corp
Project:       Acme Retainer
Cycle:         Mar 1, 2026 – May 31, 2026 (3-month)
Generated:     2026-05-25

== March 2026 ==
Task name,Category,Task summary,What we did,First worked,Last worked,Entry count,Billable hours,Non-billable hours,Total hours
…rows…
,,,,,,,Subtotal billable,9:00,
,,,,,,,Allocation,8:00,
,,,,,,,Rollover into next month,+1:00,

== April 2026 ==
…rows…
,,,,,,,Subtotal billable,6:30,
,,,,,,,Allocation (with rollover),9:00,
,,,,,,,Rollover into next month,+2:30,

== May 2026 ==
…rows…
,,,,,,,Subtotal billable,11:00,
,,,,,,,Allocation (with rollover),10:30,
,,,,,,,Overage,+0:30,

== Cycle total ==
,,,,,,,Total billable hours worked,26:30,
,,,,,,,Total allocation,24:00,
,,,,,,,Net overage,+2:30,
```

The per-month subtotal / allocation / rollover / overage lines reuse the helpers extracted in commit `4568d22` (Phase 8 Slice 2). Specifically:
- Cycle boundaries + period/cycle overage context: [`convex/lib/retainerCycle.ts`](convex/lib/retainerCycle.ts) (`getCyclePeriods`, `computePeriodOverageContext`, `computeCycleOverageContext`)
- Per-month rollover ledger: [`convex/lib/retainerUsage.ts`](convex/lib/retainerUsage.ts) (`buildRetainerUsageRows`)

The worksheet is a flat rendering — no new business logic.

### Ad-hoc range export (project-header)

```
Client:        Acme Corp
Project:       Acme Retainer
Period:        Q1 2026 (Jan 1 – Mar 31, 2026)
Filters:       Categories: Design, Dev; Billable only
Generated:     2026-05-25

Task name,Category,Task summary,What we did,First worked,Last worked,Entry count,Billable hours,Non-billable hours,Total hours
…rows…
,,,,,,,Total billable,82:30,
,,,,,,,Total non-billable,—,
,,,,,,,Total all,82:30,
```

If no filters are applied beyond the period, the `Filters:` header line is omitted.

Ad-hoc ranges that cross retainer cycle boundaries **do not** render per-month subtotals, rollover, or overage rows. Those structures belong only to the cycle export. Ad-hoc is always a flat task list + final totals — even if the range happens to coincide with a single cycle or a single month. Keeps the rule simple ("ad-hoc = flat; cycle export = sectioned").

---

## Ad-hoc range export (project-header)

Used when an agency owner wants "everything we did for this client this year" or "Q1 2026, Design only" — independent of retainer cycles or invoices. This is intentionally a low-frequency power feature; it lives in the project-header `⋯` menu, not on a prominent button.

### Picker UI

Modal triggered by the `Download worksheet…` item in the project-header `⋯` ([`project-detail-header.tsx:125`](components/projects/project-detail-header.tsx:125)).

Three filter groups:

**Period** (radio + custom):
- This month *(default)*
- Last month
- This quarter
- Last quarter
- This year
- Last year
- All time
- Custom range → reveals two date inputs (start, end)

Presets resolve against `orgSettings.timezone`.

**Categories** (multi-select):
- All categories *(default)*
- Or specific picks from this org's `workCategories`

**Entry type** (radio):
- All entries *(default)*
- Billable only
- Non-billable only

Primary `Download worksheet` button. Disabled until period is valid (e.g. custom range with start ≤ end). On submit: spinner inside the button, dialog stays mounted until download fires or error toasts.

### Backend

New action `exportAdHoc({ projectId, periodStart, periodEnd, categoryIds?, billableFilter? })` in `convex/worksheets.ts`. Reuses the shared `collectWorksheetData` internal query with a widened scope arg.

### Filename

`{client-slug}-{project-slug}-{period-slug}-worksheet.csv`

`period-slug` examples:
- `2026-q1`
- `2026-may`
- `2025-2026-all-time`
- `2026-01-15-to-2026-04-30` (custom range)

Active filters appear in the CSV header but **not** in the filename — keeps the filename short and predictable.

### Empty-result behavior

If the resolved scope contains no time entries: toast `"No time entries match these filters."` No download.

---

## AI summary spec

### Per-task input

- Task title
- Plain-text task description. `tasks.description` is stored as a **JSON-stringified Tiptap doc** ([`schema.ts:97`](convex/schema.ts:97)) — must `JSON.parse` first, then pass to `extractPlainText` from [`lib/tiptap-utils.ts:17`](lib/tiptap-utils.ts:17). Precedent at [`convex/tasks.ts:835`](convex/tasks.ts:835).
- Subtasks (titles + `statusType === "done"` completion state). Subtasks are rows in the same `tasks` table linked by `parentTaskId` ([`schema.ts:112`](convex/schema.ts:112)).
- All comments flattened by `createdAt`, text only. Threading (`parentCommentId`), reactions, and attachments are ignored. `comments.content` is already a structured Tiptap object ([`schema.ts:479`](convex/schema.ts:479)) — pass directly to `extractPlainText`, no parse needed.
- Included time-entry notes in chronological order with date + duration + billable flag.

### AI-generated fields

#### `Task summary`

> Summarize what this task was asking us to do.
> Clear, straightforward, client-facing.
> 1 sentence, max ~180 chars.
> Do not include implementation chatter, teammate names, or raw copied client text.
> Preserve the practical intent of long descriptions without dumping the description itself.

#### `What we did`

> You are writing a single, client-facing line about work delivered.
> Past tense. Outcome-focused, not process-focused.
> 1–3 sentences, max ~280 chars.
> No internal jargon, no apologies, no mentions of teammates by name.
> Use the task description, subtasks, comments, and time-entry notes.
> If the task has no meaningful content, return just the task title rephrased as a past-tense statement.

### Output handling

- Trim whitespace, collapse internal newlines to single spaces, strip leading/trailing quotes.
- Escape commas and quotes for CSV.
- Length caps enforced post-response (`Task summary` ~220 chars, `What we did` ~320 chars, with ellipsis if the model overruns).
- Protect CSV consumers from formula injection. Any user/model field beginning with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed safely before CSV escaping.

### Concurrency + errors

| Scenario | Behavior |
|---|---|
| Task has no description / subtasks / comments / entry notes | Skip AI for `What we did`. Emit `"Worked on {title}."`; `Task summary` falls back to a concise title-based phrase. |
| Single task's AI call fails (timeout, rate limit, error) | Row's "What we did" = `[summary unavailable]`. Export continues. |
| All tasks fail / API key missing / network down | Throw from action. Frontend toasts error. No download. |
| Latency budget | Target < 5 s end-to-end for ≤ 30 tasks. Tasks run with bounded parallelism. |

---

## Backend

```
convex/worksheets.ts
  ├── exportMonth (action)     ← { projectId, year, month } → { csv, filename }              // Slice 1
  ├── exportCycle (action)     ← { projectId, cycleStart } → { csv, filename }               // Slice 3
  ├── exportInvoice (action)   ← { invoiceId } → { csv, filename }                           // Slice 4
  └── exportAdHoc (action)     ← { projectId, periodStart, periodEnd,                        // Slice 5
                                   categoryIds?, billableFilter? }
                                  → { csv, filename }

convex/worksheetsHelpers.ts (internal)
  ├── collectWorksheetData      ← internal query; auth + org guard + DB reads.
  │                                Accepts a unified discriminated scope:
  │                                  { kind: "period",  projectId, start, end, filters? }
  │                                  { kind: "cycle",   projectId, cycleStart }
  │                                  { kind: "invoice", invoiceId }
  ├── getTasksWithTimeInScope
  ├── summarizeTaskWithAI       ← Anthropic via Vercel AI Gateway
  ├── buildSingleScopeCsv       ← used for month, ad-hoc, invoice
  └── buildFullCycleCsv         ← used for retainer cycle only

lib/csv.ts (new)
  └── escapeCsvField, joinCsvRows  ← inline implementation, no library

lib/format.ts (additions)
  └── slugify(name)             ← 5-line helper, used by every filename builder
```

### Reuse from existing helpers

- Cycle boundaries + overage: [`convex/lib/retainerCycle.ts`](convex/lib/retainerCycle.ts)
- Per-month rollover ledger: [`convex/lib/retainerUsage.ts:buildRetainerUsageRows`](convex/lib/retainerUsage.ts)
- Tiptap → plain text: [`lib/tiptap-utils.ts:extractPlainText`](lib/tiptap-utils.ts) (remember the `tasks.description` `JSON.parse` step)
- Admin guard: [`convex/lib/auth.ts:requireAdmin`](convex/lib/auth.ts) — note it accepts `QueryCtx | MutationCtx`, not `ActionCtx`. That's why all DB reads must go through the internal query.

### Env vars

- `AI_GATEWAY_API_KEY` — primary, routes through Vercel AI Gateway with `"anthropic/claude-sonnet-4-6"`.
- `ANTHROPIC_API_KEY` — fallback for direct SDK use.
- **`.env.example` does not yet exist** in this repo — Slice 2 creates it.
- Add both keys (with `AI_GATEWAY_API_KEY` marked primary) to the **Pre-deployment Checklist** in `CLAUDE.md`.

### Permissions

- Public worksheet actions call an internal query to collect DB data. The internal query wraps `requireAdmin(ctx)`, verifies `project.orgId === currentUser.orgId`, and performs all task / time-entry / comment reads.
- The action handles AI calls and CSV rendering after the internal query returns authorized, org-scoped data.

### Implementation note

There is **no existing precedent in this repo** for a public action calling an internalQuery (`ctx.runQuery(internal.…)`). Slice 1 sets the pattern. Existing internal calls are httpAction→internalMutation only ([`convex/linkPreviews.ts:83`](convex/linkPreviews.ts:83) and [`convex/http.ts:49`](convex/http.ts:49) are the closest references, both shaped slightly differently).

---

## Frontend

### Shared components

`components/worksheet/worksheet-menu-item.tsx` — a `DropdownMenuItem` that handles loading state, action call, blob download, and error toast. Fires immediately on click. Used by the retainer monthly row, retainer cycle-close row, and invoice row.

`components/worksheet/ad-hoc-export-dialog.tsx` — the picker modal (period + categories + billable filter). Opened from the project-header `⋯` menu's `Download worksheet…` item.

Both share the same downstream logic: call the action, wrap the returned CSV string in a `Blob`, trigger an anchor-click download, error toast on failure (`toastError(err, "Couldn't generate worksheet")`).

### Touch points (final)

- Retainer monthly breakdown row `⋯` — Slice 1 ([`monthly-breakdown-card.tsx`](components/projects/monthly-breakdown-card.tsx) `RowOverflow`)
- Retainer cycle-close row `⋯` — Slice 3 (same file, cycle-close variant)
- Invoice row `⋯` — Slice 4 ([`invoice-row-actions.tsx`](components/invoices/invoice-row-actions.tsx))
- Project header `⋯` — Slice 5 ([`project-detail-header.tsx`](components/projects/project-detail-header.tsx); Fixed, T&M, Retainer)

---

## Implementation slices

Each slice is one PR. Each builds on the previous.

### Slice 1 — CSV infrastructure + retainer monthly export, no AI

- `lib/csv.ts` helpers
- `lib/format.ts` adds `slugify(name)`
- `convex/worksheets.ts` `exportMonth` action; `convex/worksheetsHelpers.ts` `collectWorksheetData` internal query
- Deterministic fallback (`Worked on {title}.`) fills the "What we did" column
- Billable / non-billable / total hour split
- First worked / last worked / entry count
- CSV formula-injection protection
- `WorksheetMenuItem` shared component
- Wire into retainer monthly breakdown row `RowOverflow`
- TS clean, mutation error handled, content-aware loading state
- Ships a usable feature on day one

### Slice 2 — AI summaries wired in

- Vercel AI Gateway integration in `summarizeTaskWithAI` using `"anthropic/claude-sonnet-4-6"` provider string
- Generate both `Task summary` and `What we did`
- AI input includes task title, parsed Tiptap task description (remember the `JSON.parse`), subtask titles + completion, all comments (flattened by `createdAt`, text only), and all included entry notes
- Prompt, bounded concurrency, per-task error handling
- Empty-content fallback preserved
- Create `.env.example`; add `AI_GATEWAY_API_KEY` (primary) and `ANTHROPIC_API_KEY` (fallback) there and in CLAUDE.md deploy checklist
- No schema change

### Slice 3 — Full-cycle retainer export

- `exportCycle` action
- `buildFullCycleCsv` — multi-month sections + rollover / deficit / overage rows
- Reuses `retainerCycle.ts` (boundaries + overage) and `retainerUsage.ts:buildRetainerUsageRows` (per-month rollover ledger)
- Wire into cycle-close row's `RowOverflow`
- The interim-month worksheet continues to scope to that month only

### Slice 4 — Invoice companion export

- `exportInvoice` action — scopes by `invoiceLineItems.timeEntryIds` (canonical entry-set rule)
- Wire into [`invoice-row-actions.tsx`](components/invoices/invoice-row-actions.tsx) `⋯` menu
- Works for any project type's invoice; T&M is the primary use case
- Verify multi-tenant + admin guards in this action path

### Slice 5 — Project-header ad-hoc export

- `AdHocExportDialog` (period preset/custom + categories multi-select + billable radio)
- `Download worksheet…` `DropdownMenuItem` in `project-detail-header.tsx` `⋯`
- `exportAdHoc` action with filter args; widens `collectWorksheetData` scope arg
- Period presets resolve against `orgSettings.timezone`
- CSV header reflects active filters (categories, billable filter)
- Cross-cycle ranges render flat (no per-month subtotals, no rollover/overage)
- Available on Fixed, T&M, and Retainer project pages from one code path
- Empty-result toast

---

## Verification

Per slice, before considering done:

- `npx tsc --noEmit` — 0 errors
- `npm run lint` — clean
- Manual: trigger from the seeded data, open CSV in Excel + Google Sheets + Numbers, confirm UTF-8 with BOM renders accented characters
- Manual: empty scope (no time entries) → user-friendly toast, no broken download
- Manual: current in-progress month → downloads logged work so far
- Manual: AI failure (mock by unsetting key) → graceful fallback rows, not a crashed export
- Manual: mixed billable/non-billable task → hours split correctly across the three columns
- Manual: long task description → CSV contains concise `Task summary`, not raw full description
- Manual: time-entry notes + comments both influence `What we did`
- Manual: field starting with `=SUM(...)` or `@...` opens in Excel/Sheets as text, not a formula
- Multi-tenant: call each `export*` action with a `projectId` / `invoiceId` from another org → throws
- **Slice 5**: each preset period (`This month`, `Last month`, `This quarter`, `Last quarter`, `This year`, `Last year`, `All time`) resolves correctly against `orgSettings.timezone`
- **Slice 5**: custom range crossing retainer cycle boundaries renders flat (no rollover/overage rows)
- **Slice 5**: category filter narrows the row set correctly
- **Slice 5**: billable filter changes both the rows shown and the total lines
- Backlog entries updated for the slice

---

## TODOs deferred to later phases

| Item | Reason / trigger |
|---|---|
| Cached AI summaries on the task | Adds schema + invalidation complexity. Revisit when token cost or latency hurts. |
| Editable client-facing summary field per task | Couples worksheet to task detail UX. Revisit when a user actually edits an AI line. |
| Excel / PDF output formats | CSV covers the email-the-client use case. PDF only when clients ask for it directly. |
| Non-billable internal-effort footer line on single-scope CSV | Today shown as inline rows with `Billable=No`. Promote to a summary line if visual noise becomes an issue. |
| Per-org style / tone instructions for the AI | Add `orgSettings.worksheetTone` when a second org gives opposing feedback. |
| Per-row included-vs-overage flag on cycle exports | Today only at the monthly subtotal level. Add per-row if accountants request it. |
| Multi-language summaries | English-only for v1. Locale follows `orgSettings.defaultCurrency` / `timezone` signal when added. |
| Recording the export as an audit event (`exports` table) | Today exports are pure on-demand renders. Add when compliance / sent-tracking matters. |
| Per-row task selection on invoice-scoped worksheet | Today uses the invoice's `lineItems.timeEntryIds` wholesale. Add row-level trimming if T&M users ask for it. |
| Saved ad-hoc export presets per project | Each ad-hoc export is configured from scratch. Add "save as preset" if owners run the same custom range monthly. |
| Cross-project ad-hoc export ("all our work in Q1") | Today scoped per-project. Promote when portfolio-level reporting is requested. |
| Comment thread structure / attachments in AI context | Today comments are flattened by `createdAt`, text only. Add threaded / attachment context if a client's most useful delivery detail starts hiding in attachment titles. |
