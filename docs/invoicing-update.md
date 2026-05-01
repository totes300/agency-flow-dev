# Invoicing Update — PRD

> Last updated: 2026-05-01
> Status: **Finalized — ready for implementation**
> Builds on: `docs/invoicing-prd.md` (existing base system)
> Supersedes: prior Report-vs-Invoice draft of this file
> **Visual reference: `prototypes/invoicing-final.html`** — every surface in this PRD is rendered there
> Side-by-side polish review: `prototypes/invoicing-comparison.html`

---

## What This Is About

The current invoicing system has usability blockers that prevent production-ready use:

- Retainer Overview shows two duplicate banners for the same overage state, neither with an actionable CTA
- The actual "Invoice this month" button is buried inside a Monthly Breakdown accordion
- Fixed projects have zero invoice CTA on Overview — must navigate to Invoices tab
- No org-wide visibility of "what needs my attention" — owner can't see at a glance which projects need billing
- Generic "Create Invoice" labels don't reflect the agency's monthly delivery-report workflow

This PRD redesigns the invoicing surfaces to be production-ready, Bonsai/Xero/Harvest-quality, and Stripe-ready without rebuilding.

### Goals

1. **Zero forgotten invoicing** — agency owner sees pending work at a glance from any page
2. **One mental model** — every closed billing unit produces ONE invoice, regardless of whether money is due
3. **Transparent generation** — no black box, every invoice previewed before commit
4. **Stripe-ready architecture** — recurring fees acknowledged but not tracked in this app; structure prepares for future Stripe integration

---

## Mental Model — Single Document Type

### One artifact: `Invoice` (INV-)

There is **no** `Report` document type, no `RPT-` prefix, no dual color system. Every closed billing unit produces a single `Invoice`. When the period is within budget, the invoice totals to €0 and auto-marks as `Paid` on generation. When there's an overage (or fixed/T&M billable work), the invoice has a payable total and follows the standard `Outstanding → Paid` lifecycle.

Rationale: agencies need to send the client a delivery report every period. Inventing a second doc type doubles the mental model, prefix logic, color system, and labels. A €0 invoice is a normal accounting concept (Stripe, Xero, Bonsai all handle this) and serves the same delivery-report purpose without the duplication.

### Two parallel financial flows

| Flow | Handler | App involvement |
|---|---|---|
| **Recurring retainer fee** | Stripe (external, future integration) | Static "paid via subscription" line on invoices. Pre-Stripe: app assumes active subscription = paid. No payment-state tracking for the fee. |
| **Period invoice** (€0 or money-due) | This app | Generated on demand. €0 within-budget invoices auto-Paid. Money-due invoices follow draft → outstanding → paid. |

### Generation cadence by project type

| Project type | Billing unit | One invoice per |
|---|---|---|
| **Retainer · monthly (rollover OFF)** | Month | Closed month |
| **Retainer · cycle (rollover ON)** | Cycle | Closed cycle (mid-cycle months produce nothing in this scope) |
| **Fixed** | Project | Manual generation against remaining budget; user can split via in-editor edits |
| **T&M** | Period | Manual generation, monthly cadence is the recommended ritual |

**Mid-cycle reports for rollover retainers are deferred** until PDF infrastructure ships in a separate scope. The cycle-close invoice is the only persisted artifact for rollover retainers in this PRD.

---

## Per-Project-Type Behavior

### Retainer · monthly (rollover OFF or cycle = 1 month)

- Each closed month becomes an Inbox "To generate" row.
- Banner on project Overview surfaces the moment ≥1 closed uninvoiced month exists.
- Generated invoice contains: hours breakdown (delivery report) + retainer fee row (paid via subscription) + overage row (if any) + Total due.
- **Within budget:** Total due = €0. Invoice auto-marks `Paid` on generation. Never appears in Overdue.
- **Overage:** Total due = overage amount. Invoice goes to Outstanding, can become Overdue.

### Retainer · cycle (rollover ON)

- Mid-cycle: NO invoice generated. **No info card on Project Overview** — cycle progress state is rendered inline in the Monthly Breakdown card header (`{monthRange} cycle · X/Y months closed · Z% used`, plus a `Cycle closes {date}` pill on the right).
- Cycle close: a single invoice is generated covering all months in the cycle (combined hours breakdown, single overage settlement against the total cycle budget).
- Banner activates when cycle closes: `"{monthRange} cycle closed"` (e.g. "Apr–Jun cycle closed") with the overage amount in its own right-aligned column. Uses the month-range form, not a sequence number.
- **Within budget:** Total due = €0. Auto-Paid.
- **Overage:** Total due = cycle overage amount.

### Fixed

- Banner activates when `remaining > 0` (`fixedPrice − Σ invoiced`).
- Inbox "To generate" row appears 1 month after the most recent invoice on the project (or 1 month after project start if zero invoices), so freshly-created fixed projects don't immediately nag.
- Modal generates one fixed line item pre-filled with the full remaining balance.
- For milestone billing (50% deposit, 50% on delivery), the user edits the amount down in the editor. The next generation cycle pre-fills the new remaining.

### T&M

- Banner activates whenever uninvoiced billable hours > 0 — user can generate ad-hoc anytime.
- Inbox "To generate" row appears on the 1st of each month if any prior closed month has uninvoiced billable hours. Mid-month uninvoiced hours don't appear in the Inbox (they're visible on the project Overview only).
- Modal pre-fills with "previous month" preset; user can pick "all uninvoiced", custom range, or use the existing Time-tab checkbox flow (Path B).

### Non-billable

No invoicing surfaces. Hidden everywhere.

---

## Document Anatomy

Every invoice — regardless of project type or total — has the same structure:

```
INVOICE INV-2026-03         For: March 2026 — Acme Website Retainer
                            Issued: 2026-04-01
                            Due:    2026-05-01

[FROM]                              [TO]
Agency Name                         Client Name
Address, Tax ID, etc.               Billing details

──────────────────────────────────────────────────────────────────
WORK DELIVERED                                          38.0h / 40h
──────────────────────────────────────────────────────────────────
● Design                                                12.5h
  Homepage refinements                                  6.0h
  Mobile mockups                                        6.5h
● Development                                           25.5h
  API integration                                       18.0h
  Auth refactor                                         7.5h

──────────────────────────────────────────────────────────────────
Retainer fee (paid via subscription)              €5,000.00
Overage                                               €0.00
──────────────────────────────────────────────────────────────────
Total due                                             €0.00
══════════════════════════════════════════════════════════════════

Message to client                                  ← editable per invoice
─────────────────
Hi Sarah — busy month! Most of the overage came from the API
integration scope-creep we discussed on Apr 22. Happy to walk
through the breakdown anytime.

— Adam

Payment instructions
─────────────────
{org.paymentInstructions — IBAN, Stripe link, "Net 30 terms", etc.}
```

**"Message to client" block** — single Markdown textarea on every invoice document, between the totals and the payment instructions:

- **Default content** comes from a new org-level field `orgSettings.invoiceMessageTemplate` (e.g. `"Thank you for your business. Reply with any questions."`). Editable per invoice in the editor.
- **Empty state:** if the message is empty, the block renders a subtle inline "+ Add a message to client" affordance in draft mode; nothing renders on the printed/sent invoice.
- **Renders on the printed invoice** as a soft-backgrounded block (similar to a callout) above payment instructions.
- This is the highest-leverage personalization surface — Bonsai users cite this when switching from Xero. Tiny field, big agency-relationship payoff.

**Variant by type:**
- **T&M:** No "Retainer fee" row. Work breakdown shows hours + rate + amount per task. Total = Σ line amounts.
- **Fixed:** No "Retainer fee" row. Work breakdown shows hours only. Billing summary card has a single fixed line item (project name × amount).
- **Retainer (any flavor):** Includes "Retainer fee (paid via subscription)" line as static text. Total = overage only (or €0).

The "paid via subscription" string is **static text** in this PRD — the app does not track subscription payment state. When Stripe integration ships, the string is replaced with real webhook-driven status. This avoids creating a fee-payment shadow tracker that becomes obsolete on the day Stripe lands.

---

## Surfaces

### 1. Sidebar — persistent badge

- The `Invoices` nav item shows a red badge with the count of **to-generate** items (closed uninvoiced periods + uninvoiced T&M from prior closed months + fixed projects with remaining > 0).
- Badge hidden when count = 0.
- A small red **calendar-clock icon** (Lucide `CalendarClock`) is appended next to the badge when one or more `Outstanding` invoices have a `dueDate < today`. Not a dot, not a generic alert — a calendar with a clock-face overlay, expressive of "scheduled date passed" so the meaning reads instantly without needing the tooltip.
- **Tooltip on hover** of the nav row: `"3 ready to bill · 2 overdue"` (or `"3 ready to bill"` / `"2 overdue"` when only one signal applies). Self-teaching — no docs needed to learn what the icon means.
- Visible from every page.

```
Invoices  [3]       ← 3 to generate, no overdue
Invoices  [3] 🕒    ← 3 to generate AND overdue exists  (calendar-clock icon)
Invoices  🕒        ← only overdue exists
Invoices            ← clean
```

### 2. Global Inbox (`/invoices`)

Two-thirds main column + one-third sidebar.

**Page header — minimal.** Title only (`Invoices`) plus a right-aligned `⚙ Invoicing settings` link. **No subline of counts/amounts** — the metric cards carry that data; a subline that repeats them is pure redundancy (Stripe Dashboard pattern).

**Main column:**

```
[Page header]   Invoices                                    [⚙ Invoicing settings]

[Metric cards row — 3 cards only, all actionable]
  ┌──────────────┬──────────────┬──────────────┐
  │ Outstanding  │ Overdue 🔴   │ Drafts       │
  │ €2,840·4 inv.│ €1,840·2 inv.│ 2 drafts     │
  └──────────────┴──────────────┴──────────────┘

[OVERDUE — red header — sorted oldest first]
  ☐ Acme · INV-2026-12        12 days late    €640    [Mark paid] [↗]
  ☐ Globex · INV-2026-09       5 days late  €1,200    [Mark paid] [↗]

  [Sticky action bar appears when ≥1 row checked]
  ║ 2 selected · €1,840 ║ [Mark as paid] [Cancel] ║

  [Undo toast appears for 5s after bulk Mark as paid]
  ║ 2 invoices marked as paid · €1,840 · Undo (5s) ║

[TO GENERATE]                              [Generate all within-budget reports (1)]
  Acme · Website Retainer  [within budget]  Mar 2026 · 38h/40h · last invoiced Feb 28    €0     [Generate]
  Acme · Website Retainer  [2.0h over]      Apr 2026 · 42h/40h · last invoiced Mar 1     €150   [Generate]
  Globex · Q2 Cycle        [6h over]        Apr–Jun cycle closed Apr 30                  €450   [Generate]
  Initech · Redesign       —                Fixed · last invoiced Mar 12                 €5,000 [Generate]
  Umbrella · T&M           —                Apr 2026 · 47.5h · last invoiced Apr 1       €4,750 [Generate]

[ALL INVOICES — existing list, filterable tabs: All | Draft | Outstanding | Paid]
```

**Metric cards (3 only):**
- **Outstanding** — `status = "invoiced" AND dueDate >= today AND total > 0`. Money to chase.
- **Overdue** — `status = "invoiced" AND dueDate < today AND total > 0`. Destructive variant.
- **Drafts** — `status = "draft"`. Work-in-progress to finish.
- **NOT included:** "Paid this month" — moves to a future Reports surface; the Inbox is for action, not reporting.

**State badges on To-generate rows** — harmonized 2-value dictionary across project types:
- Retainer (monthly OR cycle) within budget → green pill `within budget`
- Retainer (monthly OR cycle) over budget → amber pill `{N}h over` (e.g. `2.0h over`, `6h over`) — keeps the magnitude visible because the Inbox is a triage surface and the hours-over signal helps prioritize
- Fixed / T&M → no badge (the amount + subline carries the signal)

**Vocabulary parity with Monthly Breakdown:** the Inbox uses `{N}h over` (with magnitude) for triage-scannability while Monthly Breakdown uses `over budget` (fixed) because its adjacent Hours column carries the magnitude. Both surfaces share `within budget` (green) verbatim. There is **no `cycle close` vocabulary** — cycle context is carried by the project name + subline, not the pill.

**Row layout** is a 4-column grid: `[project + subline]  [state badge column]  [amount]  [Generate]`. The badge has its own dedicated column — never inline with the project headline. Rows without a badge leave the column empty so all rows stay vertically aligned across the table. Notion-clean.

**"Last invoiced X" temporal subline** on every applicable Inbox row:
- Retainer monthly: `"{month} · {Nh}/{available}h · last invoiced {date}"` (omitted on first invoice)
- Cycle close: `"{monthRange} cycle closed {date} · {Nh} over"`
- Fixed: `"Fixed · last invoiced {date}"` (or `"Fixed · no invoices yet"`)
- T&M: `"{month} · {Nh} · last invoiced {date}"`

**Cycle naming convention:** every system-generated reference to a cycle uses the **month range** (e.g. `"Apr–Jun cycle"`, `"Jan–Mar cycle"`), not a sequence number (`"Cycle 4"`). Users immediately know which cycle the row/badge refers to without having to remember which sequence number maps to which months. Applies everywhere: Inbox rows, banners, Monthly Breakdown header, invoice subjects, status copy. The project's own name (e.g. `"Globex · Q2 Cycle"` as a project title) is user-defined and untouched — only system-generated cycle references follow the month-range rule.

**"Generate all within-budget reports" batch action** (Inbox header, right side):
- Visible only when ≥1 €0 within-budget retainer row exists in To-generate.
- Button label includes count: `"Generate all within-budget reports (N)"`.
- Single click → batch-generate all €0 invoices (each auto-Paid per existing rule). No per-row review modal — €0 invoices have no payment to verify, only delivery-report content which is already visible on the row's subline.
- Money-due rows are NOT batch-generatable. Each requires a per-row review (one row, one click, one modal preview).

**Sidebar (1/3):**
- `Outstanding €X` summary card
- `This month €X` summary card
- (Recently-generated list deferred — not in this PRD)

**Section rules:**
- **Overdue:** invoices where `status = "invoiced" AND dueDate < today AND total > 0`. €0 invoices never appear here (auto-Paid on generation).
- **To generate:** one row per closed billable unit. Includes €0 within-budget retainer rows — they ARE work the agency must complete (delivery report). Row clears when invoice generated.
- **All invoices:** existing table. Same component as today, filterable by status tab.

**Section headers carry counts and money totals inline:**
- `Overdue · 2 invoices · €1,840`
- `To generate · 5`

### 2a. Bulk Mark-as-Paid + Undo

- Each Overdue row has a leading checkbox.
- Selecting any row reveals a sticky action bar at the bottom of the viewport: `"N selected · €X · [Mark as paid] [Cancel]"`.
- **Bulk-select mode hides per-row actions.** When `selectedCount > 0`, the per-row `Mark paid` buttons disappear from every Overdue row — the sticky bar becomes the only action surface. Un-checking everything (or clicking Cancel) returns the per-row buttons. Same pattern as Linear / Notion / Gmail / Stripe Dashboard: one set of affordances per mode, no double-CTA ambiguity.
- Click `Mark as paid` → batch mutation commits **immediately** (no confirmation dialog) → rows update to `Paid` state in place → selection clears.
- An **undo toast** appears for 5 seconds at the bottom of the viewport: `"N invoices marked as paid · €X · Undo (5s)"`. Clicking `Undo` reverts all affected invoices to their prior state (`invoiced`, `paidAt: null`).
- Pattern matches Gmail/Linear archive — fast for the common case, recoverable for the mistake. No confirmation dialog blocks the happy path.

### 2b. Empty state — Inbox

When `Overdue` and `To-generate` are both empty:

```
            ✓ All caught up
   No invoices to generate · No overdue payments

       Last invoiced 3 days ago · INV-2026-15 · Acme
              Next month-close in 12 days
```

- Reward state. Center-aligned, ~12 visible lines, generous whitespace.
- Subtitle line 1: most recent invoice (number, client) + "X days ago".
- Subtitle line 2: next billing trigger (next month-close date / next cycle close).
- When **only Overdue is empty** but To-generate has items: render only the To-generate section, no empty state.
- When **only To-generate is empty** but Overdue has items: render only the Overdue section, no empty state.

### 3. Project Overview — `<InvoiceBanner />` (shared component)

Single shared component above the Monthly Breakdown / Time table. Continuous trigger — appears whenever there's something billable, no month-boundary gating.

**Visual style:** minimal — neutral icon chip, plain panel, no decorative left-border accent, no color-coded backgrounds. The banner is a clean horizontal row matching the rest of the project Overview surface (Notion-minimal).

**Layout (4-column grid):**
```
[icon] [title + subline]              [amount column]   [Generate invoice]
36px   1fr                            100px right       auto
```
- **Title** is pure prose context — never embeds the amount. Money lives in its own right-aligned column.
- **Amount column** has two rows: (1) the amount in `font-semibold tabular`, toned for state (amber-700 when overage, zinc-700 otherwise); (2) a one-word status label below in `text-xs` (`overage` / `within budget` / `remaining` / `unbilled`).
- This parallels the Inbox To-generate row layout — instant left-to-right scan: *what / when / how much / action*.

**Per-type icon (Lucide):**

| Type | Icon |
|---|---|
| Retainer · monthly | `Receipt` |
| Retainer · cycle | `Repeat` (sharper cycle metaphor than `RotateCcw`) |
| Fixed | `FileText` (a fixed contract is a document) |
| T&M | `Timer` (running time, sharper than generic `Clock`) |

**Per-type content:**

| Type | Trigger | Title | Subline | Amount | Status label |
|---|---|---|---|---|---|
| Retainer · monthly | ≥1 closed uninvoiced month | "{N} months ready to bill" | "Last invoiced {date} · {months ready}" | overage € or €0 | `overage` / `within budget` |
| Retainer · cycle (closed) | cycle closed, no invoice yet | "{monthRange} cycle closed" | "Closed {date} · {usage summary}" | overage € or €0 | `overage` / `within budget` |
| Fixed | `remaining > 0` | "Remaining to invoice" | "Last invoiced {date} · {pct}% billed" or "No invoices yet" | remaining € | `remaining` |
| T&M | uninvoiced billable hours > 0 | "Uninvoiced balance · {N}h" | "Last invoiced {date}" | unbilled € | `unbilled` |

**Cadence chip** — small zinc pill (`bg-zinc-100 text-zinc-600`, `⌛` + days) appended next to the T&M / Fixed banner title when `daysSinceLastInvoice ≥ 30`. Only on T&M and Fixed (retainers are month-aligned by definition). Subtle visual nudge for cadence drift; no color-coded urgency.

**CTA copy is always `"Generate invoice"`** — no intent-rich variants ("Bill April retainer", "Bill cycle 4", etc.). Minimal, consistent, matches Notion's restrained copy style.

The CTA opens the existing `CreateInvoiceModal`, pre-selected to the most relevant period (most recent uninvoiced month for retainer-monthly, the closed cycle for cycle retainers, all uninvoiced for T&M, full remaining for fixed).

**Cycle-in-progress retainer — NO banner.** The "Cycle X in progress · ends Y" info card is removed. Cycle progress state is folded into the Monthly Breakdown card's header instead — see section 4.

### 4. Project Overview — Monthly Breakdown card

**Retainer · monthly (no rollover):**

**Card header:**
- Title: `Monthly Breakdown`
- Right side: a `Sort: oldest first / newest first` toggle (default oldest first; persisted in URL/localStorage).

**Row layout — true 6-column grid for vertical alignment:**
```
[dot] [month name]  [hours]  [state pill]  [amount]  [action]
14px  1fr           88px     140px         92px      140px
```

| Column | Content |
|---|---|
| **dot** | `bg-emerald-500` (within budget) / `bg-amber-500` (over budget) / `bg-zinc-400` (in progress). Color matches the State pill. |
| **month name** | `January 2026` — `font-medium` only on the next-action row |
| **hours** | `38h / 40h` (right-aligned, tabular) |
| **state pill** | **fixed 3-word dictionary** (see below) — never any dynamic data |
| **amount** | tabular, right-aligned. `text-amber-700` when over budget, `text-zinc-700` otherwise |
| **action** | clickable doc number `INV-2026-01 ↗` (one link target, the number is the affordance) on generated rows; `[Generate]` button on closed-uninvoiced rows; empty on in-progress rows |

**State pill — fixed 3-word dictionary (never anything else):**

| Pill | Color | When |
|---|---|---|
| `within budget` | green | period closed AND `workedHours ≤ availableHours` |
| `over budget` | amber | period closed AND `workedHours > availableHours` |
| `in progress` | zinc | period not yet ended |

**No dynamic data in pills.** The pill never says `2.0h over` or `paid · €300` or `closes May 31`. Hour specifics live in the Hours column; payment state lives in the Inbox surface (Overdue / Outstanding sections). Money lives in the Amount column. The pill is a category tag, period.

**Status column dropped.** The State pill carries the period status: `within budget` and `over budget` only apply to closed periods; `in progress` only applies to non-closed periods. One signal, one column.

**Next-action affordance:** the **oldest closed-uninvoiced row** gets a subtle `bg-zinc-50/50` row wash and `font-medium` on the month name. Just enough to direct the eye, no chrome. No icon, no badge, no border.

**In-progress row:** the State pill is the literal value `in progress` (`bg-zinc-100 text-zinc-600`). The close date does NOT appear in the row — the period name (`May 2026`) and the calendar give that context. Keeps the State column dictionary fixed at exactly 3 values.

**Card footer — color-dot legend:**
```
● within budget    ● over budget    ○ in progress
```
Documents the dot semantics so first-time users don't have to guess. Vocabulary matches the State pill values verbatim.

**Retainer · cycle (rollover):**
- Card header carries the cycle progress state inline (no separate info card on the page):
  - Title: `Monthly Breakdown`
  - Subline: `"{monthRange} cycle · {X}/{cycleLength} months closed · {Y}% used"` — uses the month-range cycle name, not a sequence number
  - Right side of header: small pill `"Cycle closes {date}"` while in progress, or `"Cycle closed {date}"` when closed.
- Same 6-column grid as monthly retainer, but **no per-row Generate buttons** (cycle is the billing unit). Same fixed 3-value State pill dictionary — `within budget` / `over budget` / `in progress`. The cycle as a whole is invoiced at close; per-month payment state is not surfaced here.
- After cycle generation, the cycle-banner above the card shows the doc number + view link (banner is the surface for the artifact, not the breakdown).

**Fixed / T&M:**
- Existing time tables are unchanged. Banner is the only billing surface.

### 5. Per-project Invoices tab

Same list as today. The duplicate retainer callout (`<ProjectInvoicesRetainerCallout />`) is removed — its data is now structured into the Inbox "To generate" section. Header `New invoice` button (existing) remains.

### Removed surfaces (vs prior draft)

- **Dashboard billing-snapshot pointer card** — duplicates the sidebar badge. Drop.
- **`/projects` Status + To-bill columns** — billing triage belongs in the Inbox, not the project directory. Drop.
- **`Report` document type / `RPT-` prefix / dual color system** — single doc type only.
- **"Recently generated" sidebar list** — deferred.
- **PDF generation infrastructure** — deferred.
- **Mid-cycle rollover monthly reports** — deferred (need PDF infra first).

---

## Component Spec

### `<InvoiceBanner />` — new shared component

**Location:** `components/projects/invoice-banner.tsx` (rename from prior `<ReadyToInvoiceBanner />`).

**No `variant` prop** — the cycle-in-progress info card is removed. Banner is always actionable. Cycle progress is rendered in the Monthly Breakdown header (see `MonthlyBreakdownCard` below), not as a banner.

**Props:**
```ts
interface Props {
  icon?: LucideIcon                   // defaults to Receipt
  title: string                       // "3 months ready to bill", etc.
  amount?: { value: number; currency: string; tone: "overage" | "neutral" }
  chips?: Array<{ label: string; tone: "overage" | "within-budget" }>
  lastInvoicedAt?: string | null      // formatted "Mar 1, 2026" — renders the temporal subline
  subtitle?: string                   // optional context line, used when lastInvoicedAt isn't applicable
  onGenerate: () => void              // required — banner is always actionable
}
```

**Visual:**
- Plain panel, neutral icon chip, no decorative left-border accent, no color-coded background. Matches the rest of the project Overview surface.
- CTA label is fixed at `"Generate invoice"` — no per-type variations.

**Used by:**
- `components/projects/retainer-overview.tsx`
- `components/projects/fixed-overview.tsx`
- `components/projects/tm-overview.tsx`

### `MonthlyBreakdownCard` — header update for cycle retainers

**Location:** `components/projects/retainer-overview.tsx` (existing card).

When project is rollover-ON cycle retainer, the card header carries the cycle progress state inline:
- Title: `Monthly Breakdown`
- Subline (text-zinc-500, text-xs): `"{monthRange} cycle · {closedMonths}/{cycleLength} months closed · {Y}% used"` (e.g. `"Apr–Jun cycle · 2/3 months closed · 65% used"`). Uses the month-range cycle name; never includes a sequence number.
- Right side: small pill `"Cycle closes {date}"` (in progress) or `"Cycle closed {date}"` (closed).

This replaces the prior "Cycle X in progress · ends Y" info card on the page. Less chrome, more legible.

### `<InvoiceMessageBlock />` — new component on invoice document

**Location:** `components/invoices/invoice-message-block.tsx`.

- Editable Markdown textarea on the invoice document, between the totals and the payment instructions.
- Default content: `orgSettings.invoiceMessageTemplate` (new field).
- Empty in draft: shows subtle inline `"+ Add a message to client"` affordance; nothing renders on the printed/sent invoice.
- Read-only on `invoiced`/`paid` invoices.
- Renders on the printed invoice as a soft-backgrounded callout block.

### `CreateInvoiceModal` — minor updates

**Existing component:** `components/invoices/create-invoice-modal.tsx`.

**Changes:**
1. **Drop `kind` differentiation** — single doc type. No "Generate report" label variant.
2. **Header label** stays "Create Invoice" / footer "Create Invoice" for all paths.
3. **Retainer fee row in preview** — when retainer, preview shows: Total time + Retainer fee (paid via subscription, static label) + Overage (if any) + Total due.
4. **Within-budget preview** — when retainer total = €0, preview shows the breakdown with `Total due €0.00`. CTA stays enabled (the agency still needs to generate the doc to send the report).

No structural changes to the modal — the period selector, rounding options, preview card all stay.

### `<InboxOverdueSection />` — new component with bulk select + undo

**Location:** `components/invoices/inbox-overdue-section.tsx`.

- Each Overdue row has a leading checkbox.
- Selecting any row reveals a sticky action bar at the bottom of the viewport: `"N selected · €X · [Mark as paid] [Cancel]"`.
- `Mark as paid` → batch mutation `markInvoicesPaid({ ids: [...] })` commits **immediately** (no confirmation dialog) → rows update in place to `Paid` → selection clears.
- An **undo toast** appears for 5 seconds: `"N invoices marked as paid · €X · Undo (5s)"`. Clicking `Undo` calls a new `undoMarkInvoicesPaid({ ids: [...] })` mutation that reverts the affected invoices to their prior state.
- Section header carries inline counts: `Overdue · {N} invoices · €{total}`.
- Pattern matches Gmail/Linear archive-with-undo.

### `<InboxToGenerateSection />` — new component

**Location:** `components/invoices/inbox-to-generate-section.tsx`.

- Header: `"To generate · {N}"` on the left; `"Generate all within-budget reports ({N})"` button on the right (visible only when ≥1 €0 within-budget retainer row exists).
- One row per closed billable unit from `getReadyToInvoiceUnified` query.
- **State badges — harmonized 2-value dictionary:**
  - Any retainer (monthly OR cycle) within budget → `within budget` (emerald pill)
  - Any retainer (monthly OR cycle) over budget → `{N}h over` (amber pill, e.g. `2.0h over`, `6h over`) — keeps magnitude visible because the Inbox is a triage surface
  - Fixed / T&M → no badge (amount + subline carries the signal)
  - **Removed vocabulary:** no `cycle close`, no `paid`, no other variants. Cycle context lives in the project name + subline.
- **Last-invoiced subline** under each row (where applicable): `"{period} · {hours} · last invoiced {date}"`. For cycle-close rows: `"{monthRange} cycle closed {date}"`.
- `[Generate]` button per row — fixed copy, opens `CreateInvoiceModal` pre-filled. **No intent-rich CTAs, no hover-preview popover, no overflow ⋯ menu.**
- `Generate all within-budget reports` button → calls a new `generateAllWithinBudgetRetainerInvoices()` mutation that batch-creates and auto-Paid each €0 invoice. Toast on success: `"{N} delivery reports generated"`. No per-row review modal — €0 invoices have nothing to verify on payment.

### `<InboxEmptyState />` — new component

**Location:** `components/invoices/inbox-empty-state.tsx`.

- Renders when both Overdue and To-generate sections are empty.
- Center-aligned reward state: ✓ icon, `"All caught up"` headline, `"No invoices to generate · No overdue payments"` subline.
- Below: `"Last invoiced {N} days ago · {invoiceNumber} · {clientName}"` and `"Next month-close in {N} days"` derived from queries.

### `SidebarBadge` — new sidebar enhancement

Add to existing sidebar nav rendering. Single Convex query returns `{ toGenerateCount, hasOverdue }`.

**Render rules:**
- `toGenerateCount > 0`: red number badge with the count.
- `hasOverdue`: red **calendar-clock icon** appended after the badge (Lucide `CalendarClock`). Not a dot, not a generic alert — a calendar-with-clock, expressive of "scheduled date passed".
- If both are 0, render nothing.
- **Tooltip on hover** of the nav row using existing tooltip primitive. Content depends on which signals are present:
  - Both: `"3 ready to bill · 2 overdue"`
  - To-generate only: `"3 ready to bill"`
  - Overdue only: `"2 overdue"`

---

## Backend Changes

### `convex/schema.ts`

**`orgSettings` — new fields:**
```ts
paymentInstructions: v.optional(v.string())          // free text shown on every invoice
invoiceMessageTemplate: v.optional(v.string())       // default "Message to client" content
```

**`invoices` — new field:**
```ts
messageToClient: v.optional(v.string())              // per-invoice editable message; default seeded from invoiceMessageTemplate at creation
```

The `kind` field proposed in the prior draft is NOT added (single doc type).

### `convex/invoices.ts`

#### New query: `getReadyToInvoiceUnified`

Returns one row per pending billing unit across all projects:
- Retainer monthly (rollover OFF): one row per closed uninvoiced month.
- Retainer cycle (rollover ON): one row when cycle is closed and uninvoiced.
- Fixed: one row per project where `remaining > 0` AND (no prior invoice OR most recent invoice ≥1 month old).
- T&M: one row per project where prior closed months have uninvoiced billable hours (computed against `today − ≥1 calendar month`).

Used by `/invoices` Inbox `To generate` section AND by the sidebar badge count.

#### New query: `getOverdueInvoicesAggregate`

Returns `{ count, totalAmount, hasOverdue }` for the sidebar alert-icon indicator and Inbox header.

#### New query: `getInboxEmptyStateContext`

Returns `{ lastInvoice: { number, clientName, daysAgo } | null, daysToNextMonthClose: number }` for the Inbox empty state.

#### Updated mutation: `createInvoice`

- **Drop `kind` parameter.** Always creates a single `Invoice` record.
- **All retainer prefixes are `INV-`.**
- **Within-budget retainer auto-Paid:** if computed `total = 0` AND project type is retainer, mutation sets `status: "paid"` and `paidAt: Date.now()` at creation. The invoice skips the `draft → invoiced` flow.
- **Money-due invoices:** unchanged — created in `draft`, user transitions to `invoiced` via existing UI.
- **Seeds `messageToClient`** from `orgSettings.invoiceMessageTemplate` if present (user can edit per-invoice in the editor).

#### New mutation: `markInvoicesPaid`

```ts
markInvoicesPaid({ invoiceIds: Id<"invoices">[] })
```

- Validates all invoices belong to the user's `orgId`.
- Validates each invoice is in `invoiced` status with `total > 0`.
- Sets `status: "paid"` and `paidAt: Date.now()` for each.
- Returns `{ updated: number, skipped: Array<{id, reason}>, priorStates: Array<{id, status, paidAt}> }` — `priorStates` is consumed by the undo toast to power the revert.
- Used by the Inbox bulk-paid sticky action bar.

#### New mutation: `undoMarkInvoicesPaid`

```ts
undoMarkInvoicesPaid({ priorStates: Array<{id, status, paidAt}> })
```

- Reverts the affected invoices to their pre-`markInvoicesPaid` state within the 5-second undo window.
- Idempotent: if any invoice has been further mutated since, that one is skipped.

#### New mutation: `generateAllWithinBudgetRetainerInvoices`

```ts
generateAllWithinBudgetRetainerInvoices()
```

- Server-side: enumerates all closed uninvoiced retainer periods across the org where computed total = 0.
- Calls `createInvoice` for each (auto-Paid via existing rule).
- Returns `{ created: Id<"invoices">[], failed: Array<{projectId, period, reason}> }`.
- Used by the Inbox header batch-action button.

---

## What's Out of Scope (this PRD)

- **Stripe integration** — `stripeCustomerId`, `stripeSubscriptionId`, webhook handler, payment intent creation. Future PR.
- **PDF generation** — print-to-PDF, server-side rendering, branded PDF output. Deferred.
- **Mid-cycle rollover monthly reports** — depend on PDF infra. Deferred.
- **Email sending from app** — no SMTP integration. User downloads PDF and emails outside the app.
- **Auto-generation cron** — no daily/monthly cron creates draft docs. Existing `retainerCron.ts` only creates `retainerPeriods` markers.
- **Milestone-based Fixed billing UI** — schema has no milestone concept. User edits amount in editor for partial billing.
- **Reminder emails for overdue** — not in MVP. `Mark as paid` button only.
- **Recently generated sidebar log** — deferred (low value at current usage).
- **Dashboard billing-snapshot card** — dropped (sidebar badge serves this need).
- **`/projects` table Status + To-bill columns** — dropped (Inbox is the billing surface).
- **`Report` doc type / `RPT-` prefix** — single-doc model.

---

## Implementation Order

Each step ships in one PR, in order:

1. **Backend foundation**
   - Add `orgSettings.paymentInstructions` and `orgSettings.invoiceMessageTemplate` fields
   - Add `invoices.messageToClient` field
   - Add `getReadyToInvoiceUnified` query (extends existing `getReadyToInvoice` to T&M and Fixed; T&M gated by ≥1 month-old uninvoiced hours; returns state-badge data + last-invoiced timestamp per row)
   - Add `getOverdueInvoicesAggregate` query
   - Add `getInboxEmptyStateContext` query
   - Add `markInvoicesPaid`, `undoMarkInvoicesPaid`, `generateAllWithinBudgetRetainerInvoices` mutations
   - Update `createInvoice`: within-budget retainer → auto-Paid; seed `messageToClient` from template

2. **`<InvoiceBanner />` shared component**
   - Build single-variant component (no info variant — cycle-in-progress lives in the breakdown header instead)
   - 4-column grid: `icon / title+subline / amount column / Generate`
   - Plain panel, neutral icon chip, no left-border accent, no color-coded background
   - Per-type Lucide icons: `Receipt` / `Repeat` / `FileText` / `Timer`
   - Amount column: value (font-semibold tabular, amber-700 for overage / zinc-700 otherwise) + one-word status label below (`overage` / `within budget` / `remaining` / `unbilled`)
   - Last-invoiced subline support
   - Cadence chip (`⌛ {N} days`, zinc-toned) on T&M / Fixed when `daysSinceLastInvoice ≥ 30`
   - Fixed `"Generate invoice"` CTA copy — no per-type variants
   - Migrate `tm-overview.tsx` to use it (canonical pattern, no behavior change)
   - Verify visual parity

3. **Retainer Overview redesign + Monthly Breakdown rebuild**
   - Replace duplicate banners on `retainer-overview.tsx` with single `<InvoiceBanner />`
   - **Remove** the cycle-in-progress info card; fold cycle progress state into the Monthly Breakdown card header (`{monthRange} cycle · X/Y months closed · Z% used` + `Cycle closes/closed {date}` pill)
   - Cycle-closed / monthly-uninvoiced → banner with month-range cycle name (`Apr–Jun cycle closed`, never `Cycle 4`) + last-invoiced subline
   - Rebuild Monthly Breakdown rows as a **6-column grid**: `dot / month / hours / state pill / amount / action`. Drop the Status column entirely.
   - State pill = fixed 3-word dictionary: `within budget` / `over budget` / `in progress`. No dynamic data ever.
   - Dot color matches the pill (emerald / amber / zinc)
   - Action column: clickable doc number (`INV-2026-01 ↗`) on generated rows; `[Generate]` button on closed-uninvoiced rows; empty on in-progress rows
   - Next-action affordance: oldest closed-uninvoiced row gets `bg-zinc-50/50` wash + `font-medium` month name
   - Color-dot legend in card footer
   - Sort toggle (`oldest first / newest first`) in card header, default oldest
   - Generated rows show doc number + status (Paid/Outstanding/Overdue) + clickable doc number link

4. **Fixed Overview redesign**
   - Add `<InvoiceBanner />` to `fixed-overview.tsx` (when remaining > 0)
   - Title: `Remaining to invoice` · Subline: last-invoiced date + `% of contract billed` (or "No invoices yet")
   - Amount column: remaining € + status label `remaining`

5. **Per-project Invoices tab cleanup**
   - Remove `<ProjectInvoicesRetainerCallout />` usage from `project-invoices.tsx`
   - Verify list still renders correctly for all 3 billing types

6. **CreateInvoiceModal updates**
   - Drop any `kind`-conditional UI (none in current code, but verify)
   - Update retainer preview to show "Retainer fee (paid via subscription)" static row
   - Verify within-budget preview shows "Total due €0.00" cleanly with CTA enabled

7. **Global Inbox redesign**
   - Restructure `/invoices` page
   - Page header is **title-only** (`Invoices` + `⚙ Invoicing settings`); no count/amount subline that repeats the metric cards
   - **3 metric cards** only: Outstanding, Overdue, Drafts (no "Paid this month")
   - `<InboxOverdueSection />`:
     - Header uses Lucide `CalendarClock` icon (matches the sidebar overdue indicator)
     - Inline section count: `Overdue · {N} invoices · €{total}`
     - Per-row checkbox + leading "Mark paid" button
     - **Bulk-select mode hides per-row buttons** when `selectedCount > 0` — sticky bar is the sole action surface
     - Sticky action bar: `N selected · €X · [Mark as paid] [Cancel]`
     - 5-second undo toast after commit
   - `<InboxToGenerateSection />`:
     - 4-column grid: project + subline / **dedicated badge column** / amount / Generate
     - State badges harmonized 2-value dictionary: `within budget` (green) or `{N}h over` (amber). No `cycle close` vocabulary.
     - Last-invoiced subline on each row; cycle rows use month-range form (`Apr–Jun cycle closed Apr 30`)
     - €0 within-budget rows visible
     - "Generate all within-budget reports (N)" header button (visible only when ≥1 €0 row)
   - `<InboxEmptyState />` for the "all caught up" reward state with last-invoiced + next-month-close context
   - Wire all new queries and mutations
   - Existing `InvoiceList` stays for the "All invoices" tab below

8. **Sidebar persistent badge**
   - Add badge count to Invoices nav item
   - Append red **calendar-clock icon** (Lucide `CalendarClock`) when overdue exists
   - Hover-tooltip with breakdown: `"3 ready to bill · 2 overdue"`

9. **Payment instructions on invoice doc**
   - Add `paymentInstructions` field to org settings UI (textarea in Settings → Invoicing)
   - Render block at the bottom of the invoice document body
   - Print-stylesheet-friendly

10. **Message to client block on invoice doc**
    - Add `invoiceMessageTemplate` field to org settings UI (textarea in Settings → Invoicing)
    - Build `<InvoiceMessageBlock />` component on invoice editor
    - Renders editable in draft (with "+ Add a message to client" empty affordance), read-only when invoiced/paid
    - Printed invoice shows it as a soft-backgrounded callout above payment instructions

---

## Acceptance Criteria

**Single document model:**
- [ ] One document type only — no `Report` artifact, no `RPT-` prefix, no dual color system anywhere in code or UI
- [ ] Within-budget retainer invoice generation auto-marks the invoice as `Paid` (€0 total)
- [ ] Within-budget retainer invoices never appear under Outstanding or Overdue

**Project Overview banners:**
- [ ] Every billable project Overview has at most one billing banner with at most one CTA
- [ ] Banner uses a 4-column grid (`icon / title+subline / amount column / Generate`); money lives in its own right-aligned column, never embedded in the title prose
- [ ] Amount column shows the value (font-semibold tabular) + a one-word status label (`overage` / `within budget` / `remaining` / `unbilled`)
- [ ] Per-type icons use Lucide `Receipt` / `Repeat` / `FileText` / `Timer` (not generic alternates)
- [ ] Cadence chip (`⌛ {N} days`) renders on T&M / Fixed banners only when `daysSinceLastInvoice ≥ 30`
- [ ] Banner CTA copy is the literal string `"Generate invoice"` everywhere — no intent-rich variants
- [ ] Banner has no decorative left-border accent or color-coded background — minimal panel matching the rest of the surface
- [ ] Banner shows "Last invoiced {date}" subline where applicable
- [ ] Cycle-in-progress retainers show **no banner and no info card** — cycle progress is rendered in the Monthly Breakdown card header
- [ ] Cycle-closed retainers show an actionable banner with the cycle-level overage (or within-budget)

**Monthly Breakdown rows:**
- [ ] Rows are a 6-column grid (`dot / month / hours / state pill / amount / action`); every row aligns vertically regardless of content
- [ ] State pill uses **exactly 3 fixed values** — `within budget`, `over budget`, `in progress`. No `paid`, no `closes {date}`, no `{N.N}h over`, no other variants
- [ ] State pill never embeds dynamic data (hours, dates, money) — it's a category tag, period. Hour specifics live in the Hours column; payment state lives in the Inbox
- [ ] Dot color matches the pill: green = `within budget`, amber = `over budget`, zinc = `in progress`
- [ ] Generated rows use the doc number itself as the link affordance (`INV-2026-01 ↗`), not a separate "view" button
- [ ] Generate buttons appear inline on closed-uninvoiced months (monthly retainer only); rollover-cycle months are progress-only
- [ ] The oldest closed-uninvoiced row gets a subtle `bg-zinc-50` wash and `font-medium` month name (next-action affordance)
- [ ] Card footer shows a color-dot legend (`● within budget · ● over budget · ○ in progress`)
- [ ] Card header has a `Sort: oldest first / newest first` toggle, default oldest first
- [ ] No separate Status column — the State pill carries period status

**/invoices Inbox:**
- [ ] Page header is title-only (`Invoices` + `⚙ Invoicing settings`); no count/amount subline that repeats the metric cards
- [ ] Inbox metric cards: exactly 3 — Outstanding, Overdue, Drafts. No "Paid this month".
- [ ] Inbox has Overdue (top, red) + To-generate sections; €0 within-budget rows are visible in To-generate
- [ ] Overdue section header uses the same Lucide `CalendarClock` icon as the sidebar overdue indicator (consistency)
- [ ] To-generate state badges use the harmonized 2-value dictionary: `within budget` (green) or `{N}h over` (amber). No `cycle close` vocabulary; cycle context lives in the project name + subline.
- [ ] To-generate rows are a 4-column grid (project + subline / badge / amount / Generate); the badge has its own dedicated column, never inline with the project headline
- [ ] To-generate rows show "last invoiced {date}" subline
- [ ] Every system-generated cycle reference uses the month-range form (e.g. `Apr–Jun cycle`), never the sequence number (`Cycle 4`)
- [ ] To-generate rows have a fixed `[Generate]` button — no hover-preview popover, no overflow ⋯ menu, no intent-rich label variants
- [ ] "Generate all within-budget reports (N)" header button is visible only when ≥1 €0 row exists
- [ ] Bulk Mark as Paid works via checkbox + sticky action bar in the Overdue section, **commits immediately without confirmation dialog**
- [ ] **Bulk-select mode hides per-row Mark-paid buttons** — when `selectedCount > 0`, no row shows its own action button; the sticky bar is the sole action surface. Returns to per-row buttons when selection is cleared.
- [ ] 5-second undo toast appears after bulk Mark as Paid; clicking Undo reverts the state change
- [ ] Section headers show inline counts: `Overdue · {N} invoices · €{total}`, `To generate · {N}`
- [ ] Empty state renders when both sections empty: "All caught up" + last-invoiced + next-month-close context

**Sidebar:**
- [ ] Sidebar `Invoices` nav shows red badge with to-generate count (hidden at 0)
- [ ] Sidebar shows a red **calendar-clock icon** (Lucide `CalendarClock`, not a dot or generic alert) when overdue exists
- [ ] Hovering the nav row reveals a tooltip with breakdown text

**Invoice document:**
- [ ] Every generated invoice document includes the org-level `paymentInstructions` block (when set)
- [ ] Every invoice document has a "Message to client" block — editable per invoice, default seeded from `orgSettings.invoiceMessageTemplate`
- [ ] In draft, the message block shows "+ Add a message to client" affordance when empty; in invoiced/paid, it's read-only; on a printed/sent invoice, it's hidden when empty

**Disallowed surfaces (negative acceptance):**
- [ ] No row, banner, or page contains the words "Send invoice", "Send report", "Send statement", "Send reminder", or "Bulk send"
- [ ] No intent-rich CTA variants like "Bill April retainer", "Bill cycle 4", "Send March report" — exclusively `"Generate invoice"` or `"Generate"`
- [ ] No dashboard billing-snapshot card; no `/projects` Status or To-bill columns; no PDF endpoint; no recently-generated sidebar list
- [ ] No hover-preview popover on Inbox rows; no snooze / "Skip this period" overflow action

---

## Decision Log (full chronology)

The single-document model was approved through grilling rounds 1–5. The Notion-grade polish layer was approved through a side-by-side review against `prototypes/invoicing-comparison.html`. The **final visual reference is `prototypes/invoicing-final.html`** — every surface in this PRD is rendered there. This section consolidates every locked-in decision for quick scanning.

### Mental model

- **One artifact, one prefix:** `Invoice` / `INV-`. No `Report`, no `RPT-`, no dual color system.
- **€0 within-budget invoices auto-Paid** on creation; never appear under Outstanding/Overdue.
- **Retainer fee = static "paid via subscription"** on retainer invoices; not tracked pre-Stripe.
- **Cycle-rollover = one invoice per cycle** (not per mid-cycle month); mid-cycle PDFs deferred.
- **Fixed = pre-fill full remaining**; user splits via in-editor edits for milestone billing.
- **T&M = monthly cadence** for the Inbox; banner is continuous on project Overview.

### Surfaces — what ships

- **Sidebar:** to-generate red number badge + Lucide `CalendarClock` icon when overdue exists + hover tooltip with breakdown.
- **/invoices Inbox:** title-only header, 3 metric cards (Outstanding / Overdue / Drafts), Overdue section with `CalendarClock` header + bulk select + undo toast, To-generate section with 4-column grid + harmonized 2-value state badges + "Generate all within-budget reports" batch action, "All caught up" empty state.
- **Project Overview banner:** single shared `<InvoiceBanner />`, 4-column grid (`icon / title+subline / amount column / Generate`), per-type Lucide icons (`Receipt` / `Repeat` / `FileText` / `Timer`), cadence chip on T&M/Fixed when ≥30 days, fixed `"Generate invoice"` CTA.
- **Monthly Breakdown card:** 6-column grid, fixed 3-value State pill dictionary, clickable doc-number link, oldest-uninvoiced row gets next-action wash, color-dot legend in footer, sort toggle in header. Cycle progress state lives in the card header (no separate info card).
- **Invoice document:** "Message to client" block (org-template default, per-invoice editable) + "Payment instructions" block (org-level).

### Vocabulary — locked dictionaries

| Surface | State pill values | Notes |
|---|---|---|
| **Inbox To-generate** | `within budget` (green) · `{N}h over` (amber) | 2 values; magnitude in pill for triage |
| **Monthly Breakdown** | `within budget` (green) · `over budget` (amber) · `in progress` (zinc) | 3 values; never any dynamic data |
| **Project Overview banner status label** | `overage` · `within budget` · `remaining` · `unbilled` | one word, paired with the amount in the right column |
| **Cycle references everywhere** | `{monthRange} cycle` (e.g. `Apr–Jun cycle`) | never `Cycle 4` or any sequence number |
| **Banner CTA** | `Generate invoice` (always) | no intent-rich variants |
| **Inbox row CTA** | `Generate` (always) | no intent-rich variants |

### Added (vs prior draft)

- **"Message to client" block** on every invoice document — editable per invoice, default from org template
- **"Last invoiced {date}" temporal subline** on banners and Inbox To-generate rows
- **State badges with harmonized 2-value dictionary** on Inbox To-generate rows — `within budget` / `{N}h over` only
- **State pill dedicated column** on Inbox To-generate rows (badge never inline with the project headline)
- **State pill fixed 3-word dictionary** on Monthly Breakdown rows — `within budget` / `over budget` / `in progress`, no dynamic data ever
- **Per-type Lucide icons** on banners — `Receipt` / `Repeat` / `FileText` / `Timer`
- **Amount column** on banners — separated from title prose, right-aligned, with one-word status label below
- **Cadence chip** (`⌛ {N} days`) on T&M / Fixed banners when `daysSinceLastInvoice ≥ 30`
- **Color-dot legend** in Monthly Breakdown footer
- **Sort toggle** in Monthly Breakdown header (oldest first / newest first)
- **Next-action affordance** on Monthly Breakdown — subtle wash + `font-medium` on oldest closed-uninvoiced row
- **Clickable invoice number** as the link affordance (`INV-2026-01 ↗`), not a separate "view" button
- **Cycle progress state** rendered in Monthly Breakdown card header (replaces the deleted info card)
- **Cycle naming via month range** (`Apr–Jun cycle`, never `Cycle 4`) on every system-generated reference
- **"Generate all within-budget reports (N)" batch action** in Inbox header
- **Empty state** for Inbox — `"All caught up"` with last-invoiced + next-month-close context
- **Undo toast** on bulk Mark-as-Paid (5-second window, no confirmation dialog)
- **Bulk-select mode hides per-row Mark-paid buttons** — sticky bar is the sole action surface in select mode
- **Sidebar tooltip** on hover (`"3 ready to bill · 2 overdue"`)
- **Sidebar overdue indicator** = calendar-clock icon (Lucide `CalendarClock`, expressive of "scheduled date passed")
- **Overdue Inbox section header** uses the same `CalendarClock` icon for cross-surface consistency

### Refined

- **Inbox page header is title-only** (no count/amount subline that repeats the metric cards)
- **Section headers** carry inline counts and money totals: `Overdue · 2 invoices · €1,840` / `To generate · 5`

### Removed (vs prior draft)

- **`Report` document type / `RPT-` prefix / dual color system** — single doc type only
- **"Cycle X in progress" info card** → folded into Monthly Breakdown card header
- **"Paid this month" metric card** → moves to a future Reports surface (not action-relevant)
- **Status column** in Monthly Breakdown — the State pill carries period status; one signal, one column
- **`cycle close` pill vocabulary** in the Inbox — cycle context lives in the project name + subline
- **`paid` / `paid · €300` pills** in Monthly Breakdown — payment state belongs in the Inbox, not the budget breakdown
- **Dynamic data in pills** (`2.0h over`, `closes May 31`) on Monthly Breakdown — pills are category tags only
- **"(delivery report)" parens** on banner status copy — internal jargon
- **Decorative left-border accents** on banners — kept minimal Notion-style
- **Dashboard billing-snapshot pointer card** — sidebar badge serves this need
- **`/projects` table Status + To-bill columns** — Inbox is the billing surface

### Deferred (out of scope this PRD)

- **PDF generation infrastructure**
- **Mid-cycle rollover monthly reports** (depends on PDF infra)
- **Stripe integration** (replaces "paid via subscription" static text with real webhook data)
- **Email sending / SMTP integration**
- **Auto-generation cron** for invoices
- **Reminder emails for overdue**
- **"Recently generated" sidebar log**
- **Milestone-based Fixed billing UI** (user edits amount in editor instead)

### Explicitly rejected (kept simple, Notion-minimal)

- **Intent-rich CTA labels** ("Bill April retainer", "Bill cycle 4", "Send March report") — kept `"Generate invoice"` / `"Generate"` everywhere
- **Hover-preview popover** on To-generate rows
- **Snooze / "Skip this period"** overflow action
- **Decorative left-border accents** on banners
- **Dashboard pointer card** and **/projects status column**

---

## References

- **Final visual reference:** `prototypes/invoicing-final.html` — every surface in this PRD rendered at production fidelity
- **Side-by-side polish review:** `prototypes/invoicing-comparison.html` — documents the senior-UX polish layer applied on top of the base PRD
- **Existing PRD:** `docs/invoicing-prd.md` — base invoicing system this PRD updates
- **Audit:** `docs/invoicing-audit.md` — original UX audit that triggered this redesign
- **Inspiration:** Bonsai (single-doc model, €0 delivery summaries, "Message to client" block), Xero (invoice document anatomy), Stripe Dashboard (one-fact pills, undo toasts, mode-aware affordances), Notion (minimal chrome, fixed-vocabulary state tags), Linear (bulk-select pattern)
- **Stripe integration:** future PR — schema fields (`stripeCustomerId`, `stripeSubscriptionId`, `stripePaymentIntentId`) and webhook handler will be added in a separate scope and will replace the static "paid via subscription" string with real payment-state data
