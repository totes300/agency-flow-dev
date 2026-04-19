# Modal Refactor — Handover Note

**Date:** 2026-04-18 → 2026-04-19
**Branch:** `invoiceing` (WIP, not yet committed)
**Goal:** Globally upgrade the modal look & feel to a Bonsai-grade, senior-quality UI. Extract shared modal chrome into a reusable primitive so future modals stay consistent by construction.

---

## 1. Motivation

The user compared our existing modals to Bonsai (hellobonsai.com) and flagged that ours looked "amateur": loose spacing, small title, aggressive focus rings, inconsistent sizing, cluttered nested bordered cards, weak overlay darkening, inconsistent close-button placement, and each modal re-implementing its own chrome with slight drift. Screenshots attached in the conversation.

Two-phase plan:
1. **Polish ONE modal** (`project-form-modal`) to Bonsai-grade quality, iterating visually.
2. **Extract the shared chrome** into a `FormModal` primitive and migrate the remaining creation/edit modals so the whole app looks coherent.

An independent review by Codex (via `codex:codex-rescue`) was requested before starting Phase 2 to avoid over-engineering. Codex returned GO WITH CHANGES — its feedback materially reshaped the `FormModal` API (see §4).

---

## 2. Architecture decisions (in order of scope)

### 2.1 Global primitive tweaks (`components/ui/*`)

These are **system-wide** changes that affect every form in the app. They were done deliberately because the user asked for a global polish.

| File | Change | Why |
|------|--------|-----|
| `components/ui/dialog.tsx` (`DialogOverlay`) | `bg-black/10 → bg-black/50` + removed `backdrop-blur-xs` | Bonsai-grade focus: the modal clearly pops over darkened context. Old 10% overlay felt absent. (Note: the final value `/50` was nudged up from my `/40` by the user in-session — see the system reminder in dialog.tsx showing a manual edit.) |
| `components/ui/input.tsx` | `h-8 → h-10`, padding `px-2.5 py-1 → px-3 py-2`, focus ring `ring-3 → ring-2 ring-ring/40`, added global spinner-hide (`[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`), added autofill background neutralizer | (a) Taller fields match Bonsai/Linear/Notion. (b) `ring-3` was aggressive — focused inputs shouted blue. (c) Browser number-input spinners are ugly. (d) Chrome blue autofill bg was distracting. |
| `components/ui/select.tsx` (`SelectTrigger`) | `data-[size=default]:h-8 → h-10`, padding `pl-2.5 pr-2 → pl-3 pr-2.5`, focus ring `ring-3 → ring-2 ring-ring/40` | Match Input height & ring for visual coherence. |
| `components/ui/input-group.tsx` (root `InputGroup`) | `h-8 → h-10`, focus ring `ring-3 → ring-2 ring-ring/40`, addon inner padding proportional (`pr-1.5 → pr-2`, `pl-1.5 → pl-2`) | Match Input height. |
| `components/ui/date-picker.tsx` (internal Button) | Added `h-10 px-3` to trigger button | DatePicker Button was still h-8 (Button default). For form-field parity it needs h-10. This is **scoped to DatePicker only**, not a global Button change. |

**Impact warning:** these changes affect every form/table in the app. Known touchpoints (not tested in this session):
- Tasks list inline edits
- Timer forms
- Settings pages
- Every existing modal — but all migrated modals benefit automatically.

If any screen looks over-spacious due to h-10 inputs, the fix is to override per-use-case with `className="h-8"` — don't revert the global.

### 2.2 `ToggleGroup` — no changes

The already-installed `ToggleGroup` + `Toggle` primitives were not modified. Pills stay at `h-8` by design (Bonsai also keeps pills smaller than inputs). Pill active-state styling is per-modal (applied via `className` with `data-[state=on]:...` variants) — see e.g. `project-form-step-basic.tsx` line ~231 and `create-invoice-modal.tsx` line ~252. Deliberately not baked into the primitive since different modals use different active colors.

### 2.3 New component: `components/ui/form-modal.tsx`

The heart of the Phase-2 work. See §4 for the full API rationale.

---

## 3. New file: `components/ui/form-modal.tsx`

A compound, **chrome-only** component. No behavior — only layout. Exports:

- `FormModal` — Dialog + DialogContent wrapper. Handles size mapping and inner scroll container.
- `FormModalHeader` — centered-by-default header region (`align="center"|"start"`).
- `FormModalTitle` — DialogTitle styled `text-2xl font-semibold`.
- `FormModalDescription` — DialogDescription with `srOnly` prop for accessibility-only descriptions.
- `FormModalBody` — thin FieldGroup wrapper with `gap-6 sm:gap-7` (consistent field rhythm). **Optional** — not every modal uses Fields.
- `FormModalFooter` — `align="stack"|"row"` layout wrapper for CTAs. Content composed by caller.

Size variants map to Tailwind max-w scale: `sm` (384px) → `3xl` (768px). Default `xl` (576px) — tuned to Bonsai project-creation modal proportions.

**Design principles:**
- **Chrome only, zero behavior.** Caller owns `<form>`, submit, button wiring, close logic. This avoids the anti-pattern codex flagged where prop-driven footer/submit APIs force all modals into one shape.
- **Opinionated visual defaults, override-friendly.** Title is `text-2xl font-semibold` by default — if someone needs different, className overrides.
- **Composable.** FormModalHeader accepts any children — wizard step 2 composes a back-arrow + FormModalTitle + FormModalDescription freely.

### Why this API shape (not the original proposal)

My original API draft had top-level `onSubmit`, `primaryLabel`/`cancelLabel`/`disabled`/`submitting` props on Footer, and a `back` prop on Header. Codex review called these out as anti-patterns:

1. **Top-level `onSubmit` assumes one submit path.** `create-invoice-modal` uses `onClick` on a Button (no `<form>`); `budget-estimates-modal` same. Top-level form wouldn't fit.
2. **`primaryLabel`/`cancelLabel` assumes one primary + Cancel.** `task-form-modal` has dual CTAs with a keyboard hint; `client-form-modal` edit mode has a different copy than create.
3. **`back` prop leaks wizard state into generic chrome.** Only the project creation step 2 needs a back arrow. Forcing every Header to accept it adds complexity for one caller.
4. **Baked-in `sr-only` description and `size="xl"` hard-code choices.** `create-invoice-modal` wants a visible description (project name + billing type context); `contact-form-modal` uses `size="md"`; `client-form-modal` uses `size="3xl"`.

The final chrome-only API satisfies all of the above. Each caller composes buttons, forms, and layouts freely.

---

## 4. Migrated modals

### 4.1 `components/projects/project-form-modal.tsx` (+ `project-form-step-basic.tsx` + `project-form-step-billing.tsx`)

**Before:** DialogContent + hardcoded inner `p-8` div + DialogHeader with centered title + form step content; each step had its own inline FieldGroup + button layout (full-width h-11 primary + Cancel text-button).

**After:** Uses `FormModal` + `FormModalHeader`/`FormModalTitle`/`FormModalDescription srOnly` at the shell; each step uses `FormModalBody` + `FormModalFooter`. Step 2 (`project-form-step-billing.tsx`) composes its own back-arrow inside a `FormModalHeader align="start"` with `className="flex-row items-center gap-3"` override — the back arrow is NOT a primitive concern, it's purely caller-owned layout.

**Notable intermediate state** (before the FormModal extraction — left for historical context and Phase 1 signal):
- Number pills for Billing Type were converted from a hand-rolled button loop with `aria-checked` to `ToggleGroup` + `ToggleGroupItem` with outlined-active variant — the senior shadcn pattern.
- Fixed-Fee / Monthly-Fee / Overage-Rate inputs were converted from `flex Input + span` to `InputGroup` + `InputGroupAddon align="inline-end"` for USD / h/mo / USD/h suffixes.
- Currency field (readonly, inherited from client) was changed from a custom `<div>` to a disabled `Select` for height parity.
- New-client inline section changed from `bg-muted/20 rounded-lg card` to `border-l-2 border-primary/30 pl-4` (subtle accent, less boxy).
- Outside circular X was added, then removed (see §5).
- Description "Add a new project to start tracking time and budgets." moved to `sr-only` — redundant next to a big "New Project" title.

### 4.2 `components/clients/contact-form-modal.tsx`

Second validation point for `FormModal`. Was using raw `Label` + `Input` + `space-y-2` div pattern — **upgraded** to `Field` + `FieldLabel` while migrating since the modal was small enough to clean fully. Horizontal-footer-with-Checkbox `label` hack replaced with `Field orientation="horizontal"` + shadcn `Checkbox`.

- `size="md"` (448px) — narrow form.
- Centered header (creation pattern).
- `FormModalDescription srOnly`.
- Vertical-stack footer: primary `h-11 w-full text-base` + Cancel text-button.

### 4.3 `components/invoices/create-invoice-modal.tsx`

**Structurally different** from project modal: nested cards (Period / Options / Preview) — which matches Bonsai image 1 (user reference). These are information-hierarchy, not redundant chrome. **Kept.**

- `size="lg"` (512px).
- Centered header.
- `FormModalDescription` **visible** — "Pragmatico — Time & Materials" context is useful.
- Period preset buttons converted from `Button variant="default|outline" rounded-full` to `ToggleGroup` `variant="outline" spacing={2}` with `rounded-full` className override + outlined-primary active state — consistency with project-modal billing-type pills.
- Start / End DatePickers converted from `<div><p className="text-xs">label</p><DatePicker /></div>` to `Field` + `FieldLabel`.
- CTA `h-12 w-full` → `size="lg" h-11 w-full text-base` (matches project modal's CTA rhythm).
- `LoaderIcon` spinner: `mr-2 size-4` → `data-icon="inline-start"` (shadcn convention).
- Cancel text-button added below CTA.
- Nested card `mb-3` → `mb-4` for tighter coherence with the modal's p-8 outer.

### 4.4 `components/clients/client-form-modal.tsx`

**Big modal** (~500 lines, two-column with Separator, logo upload, lots of fields). Scoped migration — only chrome, not the inner form.

- `size="3xl"` (768px) — matches existing.
- `FormModalHeader align="start"` — **left-aligned title**. This is an edit-pattern modal (matches Bonsai Project Settings images 4-6). Codex explicitly warned against forcing creation-style centered title here.
- `FormModalDescription` visible.
- `FormModalFooter align="row"` — **horizontal** Cancel + Save side-by-side, right-aligned. Different from creation-modal vertical stack; matches the edit-pattern convention.
- Default-size Buttons (h-8) in footer — no need for the h-11 tall CTA; edit modals use standard button sizing.
- Cancel is now `DialogClose asChild` wrapping a Button (no more prop-drilled `onOpenChange(false)`).

**Deferred cleanup in this modal** (would be a separate pass):
- Raw `Label` + `Input` + `space-y-1.5` pattern across ~15 fields → not upgraded to `Field` + `FieldLabel`.
- Raw `<input type="checkbox">` for "Use prefix" → not upgraded to shadcn `Checkbox`.
- Edit-mode Currency readonly `<div>` → not upgraded to disabled `Select` (project-form-modal already uses this pattern).

These were deferred to avoid scope creep and because the cleanup would touch ~50 lines without changing visual polish. **Recommend a follow-up pass.**

### 4.5 `components/projects/budget-estimates-modal.tsx`

Small focused edit modal — category-hours table.

- `size="md"` (448px) — narrow.
- `FormModalHeader align="start"` (edit pattern).
- Description visible.
- `FormModalFooter align="row"` Cancel + Save.
- Cancel in `DialogClose asChild` wrapper.
- Button sizes normalized to default (was `size="sm"` h-7 — inconsistent with the row footer pattern elsewhere).
- Body structure untouched — dense category list with `Input h-8 w-24` per row. **Intentional h-8 override** here since it's a tabular list, not standard form fields.

### 4.6 Not yet migrated: `components/tasks/task-form-modal.tsx`

Codex flagged this one as explicitly different structure (dual CTA + keyboard shortcut hint). Not migrated in this session. User agreed to leave for a separate decision.

---

## 5. In-session design pivot: outside circular X → Cancel text-button

At one point the project modal had a circular outlined X button positioned `absolute -right-12 top-0` outside the card (Bonsai image 9 match). The user questioned whether the X was necessary at all, citing Notion's pattern (text "Cancel" below primary CTA).

**Outcome:** After a back-and-forth UX discussion (see conversation), the decision was to **remove the X** and use a Notion-style **Cancel text-button below the primary CTA** in vertical-stack footers. Rationale:
- Notion does NOT use only-overlay-click; it has an explicit "Cancel" control.
- WCAG/a11y best practice requires a visible dismiss control.
- Creation forms are at high data-loss risk from accidental overlay-click — a visible Cancel provides the safety valve.
- Mobile has no Escape key — text button works universally.

The outside circular X was deleted from `project-form-modal.tsx` and not propagated to the other modals. Every migrated modal now uses either:
- **Vertical stack footer** (creation modals): primary full-width `h-11` + Cancel text-button below.
- **Row footer** (edit modals): Cancel outlined Button + primary Button, right-aligned.

No modal in the migrated set shows an X close icon — `DialogContent` is passed `showCloseButton={false}` via the `FormModal` primitive.

---

## 6. Out of scope / deferred

- **`components/tasks/task-form-modal.tsx`** — dual CTA + keyboard hint, needs separate design discussion.
- **`components/tasks/task-detail-modal.tsx`** — full-screen, uses `DialogFullscreenContent`, its own design. Not touched.
- **`components/onboarding/onboarding-modal.tsx`** — wizard with custom UI. Not touched.
- **`components/timer/stale-timer-dialog.tsx`** and **`components/confirm-dialog.tsx`** — confirmation dialogs, different category. Not touched.
- **Systematic `Label`+`Input`+`space-y-*` → `Field`+`FieldLabel` migration across the rest of the app** — inconsistency exists beyond the modals I touched; recommend a separate pass.
- **Raw `<input type="checkbox">` → shadcn `Checkbox` migration** — same reasoning.
- **Button `ring-3` → `ring-2`** — I only changed `Input`, `Select`, `InputGroup`. `Button` still has `ring-3 ring-ring/50` on focus-visible. Would be a small, safe global follow-up.

---

## 7. Known caveats

- **Not visually tested end-to-end by me.** Dev server runs on port 3000 but was behind an auth wall during testing. The user verified visually between iterations and approved each step.
- **`project-summary-card.tsx` has 3 pre-existing TS errors** (`AlertCircleIcon`, `Button` not imported). It's `??` in `git status` — untracked, another agent's work-in-progress. NOT caused by this refactor.
- **ESLint warning** in `project-form-step-basic.tsx`: `setCurrency` unused in the step. Pre-existing — was unused even before my changes since the writable currency path is modal-level. Low-priority cleanup.
- **`components/ui/toggle.tsx` and `components/ui/toggle-group.tsx`** were added via `npx shadcn@latest add toggle-group` during this session — new untracked files.

---

## 8. Verification

- `npx tsc --noEmit` on files I touched: **0 errors.**
- `npm run lint` not run full (pre-existing project has 800+ warnings unrelated to this refactor). Filtered to touched files: no new warnings.
- Visual validation: done interactively with the user (they approved each modal before moving on).

---

## 9. What to look for in review

**High-value checks:**
1. Does `components/ui/form-modal.tsx` correctly forward all Dialog props? Specifically: does `onOpenChange` submitting-guard still work (caller wraps it, but primitive should not interfere)?
2. `FormModalHeader align="start"` + children layout: in `project-form-step-billing.tsx` the back arrow is composed via `className="flex-row items-center gap-3"` override — does `twMerge` correctly override `flex-col` from DialogHeader's base? (Yes per my test, but worth confirming.)
3. In `create-invoice-modal.tsx`: the nested cards were preserved. Is the spacing between the outer `p-8` FormModal and the inner `p-6` cards visually right? I bumped card inner `mb-3` → `mb-4` — did that achieve coherence or does it still feel inconsistent?
4. `h-10` global Input change: any dense table inline-edits or compact forms that now feel over-padded? Known spots to check: `settings-work-categories.tsx`, `tm-overview.tsx`, task inline edits. Fix is `className="h-8"` override per case.
5. `client-form-modal.tsx` still uses raw `Label`/`Input`/`space-y`. Acceptable as scoped migration? Or should the next pass upgrade it before merging?

**Regression risks:**
- Every modal's close flow (Escape + overlay-click) — verify `DialogClose asChild` wrappers work as expected and submitting guards prevent close mid-mutation.
- Autofilled password/email Chrome blue bg — check that the transparent-shadow override actually neutralizes it (it works in my local tests but varies by Chrome version).
- Number inputs everywhere — verify spinner-hide doesn't break any screen that relied on the native spinner.

**Design coherence:**
- Edit modals use `align="start"` + row footer; creation modals use centered header + stack footer. This was an intentional dual pattern (Bonsai does the same). Confirm the split feels right and the user isn't expecting a single unified pattern.

---

## 10. Files changed (summary)

**New:**
- `components/ui/form-modal.tsx`
- `components/ui/toggle.tsx` (shadcn install)
- `components/ui/toggle-group.tsx` (shadcn install)

**Modified (global primitives):**
- `components/ui/dialog.tsx`
- `components/ui/input.tsx`
- `components/ui/select.tsx`
- `components/ui/input-group.tsx`
- `components/ui/date-picker.tsx`

**Modified (modals):**
- `components/projects/project-form-modal.tsx`
- `components/projects/project-form-step-basic.tsx`
- `components/projects/project-form-step-billing.tsx`
- `components/clients/contact-form-modal.tsx`
- `components/clients/client-form-modal.tsx`
- `components/invoices/create-invoice-modal.tsx`
- `components/projects/budget-estimates-modal.tsx`

**Not touched** (but in Glob results):
- `components/tasks/task-form-modal.tsx` — deferred
- `components/tasks/task-detail-modal.tsx` — out of scope (full-screen)
- `components/onboarding/onboarding-modal.tsx` — out of scope (wizard)
- `components/timer/stale-timer-dialog.tsx` — out of scope (confirmation)
- `components/confirm-dialog.tsx` — out of scope (confirmation)
