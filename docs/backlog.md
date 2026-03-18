# Agency Flow — Backlog

## Phase 0: Foundation ✅ COMPLETE

> **Goal**: Org-aware infrastructure every module depends on. Auth helpers, org settings, statuses, navigation, route protection.
>
> **Key decisions made**:
> - URLs drop `/dashboard` prefix → `/tasks`, `/clients`, `/settings`, etc.
> - Onboarding via blocking modal on dashboard (not a dedicated route)
> - Statuses auto-seeded on onboarding completion (admin customizes later in Settings)
> - `/settings` page with tabs: General, Team, Statuses
> - Members see only Tasks (placeholder) in sidebar
> - Admin-only routes redirect members silently to `/tasks`
> - `navigation.ts` gets declarative `adminOnly` flag per NavItem
> - Users table retrofitted with `email`, `imageUrl`, `createdAt`, `updatedAt`

---

### Task 0.1 — Retrofit `users` table & sync logic ✅

- [x] **Schema**: `convex/schema.ts` — added `email`, `imageUrl`, `createdAt`, `updatedAt` (optional for backward compat with existing data)
- [x] **syncUser mutation**: `convex/users.ts` — populates email, imageUrl, timestamps from JWT identity
- [x] **Webhook sync**: `convex/users.ts` `upsertFromClerk` — populates from Clerk webhook payload
- [x] **Verify**: Schema deployed cleanly

---

### Task 0.2 — Auth helpers (`getAuthContext`, `requireAdmin`) ✅

- [x] **Created** `convex/lib/auth.ts` with `getAuthContext()` and `requireAdmin()`
- [x] Returns `{ userId, orgId, orgRole, isAdmin, user }`
- [x] Handles both `orgId`/`org_id` and `orgRole`/`org_role` JWT field names
- [x] Clear error messages for all failure cases

---

### Task 0.3 — `orgSettings` table & CRUD ✅

- [x] **Schema**: `orgSettings` table with all fields, `by_orgId` index
- [x] **Created** `convex/orgSettings.ts` — `get`, `create`, `update`
- [x] `create` triggers `statuses.seed` via scheduler
- [x] Validation via shared validators (currency, rounding)

---

### Task 0.4 — `statuses` table & CRUD ✅

- [x] **Schema**: `statuses` table with `by_orgId` and `by_orgId_type` indexes
- [x] **Created** `convex/statuses.ts` — `list`, `listAll`, `create`, `update`, `archive`, `restore`, `reorder`, `seed`
- [x] 8 default statuses seeded via internal mutation

---

### Task 0.5 — URL restructure (drop `/dashboard` prefix) ✅

- [x] Created routes: `/tasks`, `/clients`, `/projects`, `/reports`, `/my-time`, `/settings`
- [x] Dashboard home stays at `/dashboard`
- [x] Removed old `/dashboard/settings` route
- [x] Updated navigation.ts, layout, breadcrumbs
- [x] Updated CLAUDE.md routes section

---

### Task 0.6 — Navigation update with role-based filtering ✅

- [x] `NavItem` type has `adminOnly?: boolean`
- [x] Nav groups: Overview, Work, Manage, Finance, System
- [x] `NavMain` filters by `isAdmin` prop
- [x] `AppSidebar` reads role from `useOrganization().membership`
- [x] Saved Views placeholder section in sidebar
- [x] `adminOnlyUrls` exported for reuse

---

### Task 0.7 — Onboarding modal ✅

- [x] `components/onboarding-modal.tsx` — blocking dialog with timezone, currency, rounding
- [x] `components/onboarding-gate.tsx` — wraps children, shows modal for admin / "wait" message for member
- [x] Integrated in dashboard layout
- [x] Installed shadcn/ui: dialog, select, label, radio-group

---

### Task 0.8 — Settings page with tabs (General / Team / Statuses) ✅

- [x] `app/(dashboard)/settings/page.tsx` — tabbed layout
- [x] `components/settings/settings-general.tsx` — timezone, currency, rounding form
- [x] `components/settings/settings-team.tsx` — Clerk OrganizationProfile embed
- [x] `components/settings/settings-statuses.tsx` — full CRUD: list, create, edit, archive, restore, reorder
- [x] Installed shadcn/ui: tabs, badge, card

---

### Task 0.9 — Admin-only route protection (client-side) ✅

- [x] `components/admin-guard.tsx` — checks Clerk org role, redirects members to `/tasks`
- [x] Applied to: `/clients`, `/projects`, `/reports`, `/settings`

---

### Task 0.10 — Placeholder pages ✅

- [x] `/tasks` — "No tasks yet"
- [x] `/clients` — "No clients yet" (AdminGuard)
- [x] `/projects` — "No projects yet" (AdminGuard)
- [x] `/reports` — "No reports yet" (AdminGuard)
- [x] `/my-time` — "Track your time"

---

### Task 0.11 — Validation helpers & shared constants ✅

- [x] `convex/lib/constants.ts` — CURRENCIES, ROUNDING_OPTIONS, STATUS_TYPES, defaults, DEFAULT_STATUSES
- [x] `convex/lib/validators.ts` — currencyValidator, roundingValidator, statusTypeValidator

---

### Verification

- [x] `npx convex dev --once` — schema + functions deployed successfully
- [x] `npm run build` — clean build, all routes present
- [x] `npm run lint` — 0 errors (only auto-generated file warnings)
- [x] CLAUDE.md updated with new routes

---

### Acceptance criteria

- [x] `getAuthContext()` works — orgId + role + userId extractable
- [x] `requireAdmin()` throws if member
- [x] orgSettings table exists, created via onboarding modal
- [x] orgSettings.get and orgSettings.update work
- [x] statuses table exists, 8 defaults seeded on onboarding
- [x] statuses CRUD works (admin only)
- [x] Sidebar shows correct nav (admin: all items, member: Tasks + My Time)
- [x] Saved Views section placeholder in sidebar
- [x] Admin-only routes redirect members to /tasks
- [x] Every route has a placeholder page
- [x] Schema deployed and validated
- [x] Settings page has General / Team / Statuses tabs
- [x] Onboarding modal blocks dashboard until org is set up

---

## Frontend Quality Refactor ✅ COMPLETE

> **Goal**: Eliminate code duplication, split monolithic components, establish scalable patterns before continuing to Phase 2+.
> **Triggered by**: Full codebase review against shadcn/ui and Tailwind best practices.

---

### Refactor R.1 — Split onboarding modal (740 → 5 files) ✅

- [x] Deleted monolithic `components/onboarding-modal.tsx` (740 lines)
- [x] Created `components/onboarding/onboarding-modal.tsx` (182 lines) — orchestrator only
- [x] Created `components/onboarding/step-general.tsx` (85 lines)
- [x] Created `components/onboarding/step-statuses.tsx` (246 lines)
- [x] Created `components/onboarding/step-categories.tsx` (190 lines)
- [x] Created `components/onboarding/shared.tsx` (53 lines) — types, color dot helpers, validation
- [x] Updated `onboarding-gate.tsx` dynamic import path

---

### Refactor R.2 — Shared `<EmptyState>` component ✅

- [x] Created `components/empty-state.tsx` — accepts `icon`, `title`, `description`
- [x] Refactored 5 placeholder pages to use it: clients, my-time, projects, reports, tasks

---

### Refactor R.3 — Shared `<ColorPickerDropdown>` component ✅

- [x] Created `components/color-picker-dropdown.tsx` — generic, typed, render-prop for swatches
- [x] Replaced duplicate dropdown code in `settings-statuses.tsx`
- [x] Replaced duplicate dropdown code in `settings-work-categories.tsx`

---

### Refactor R.4 — Consolidated color labels ✅

- [x] Added `CATEGORY_COLOR_LABELS` to `lib/display-constants.ts` (single source of truth)
- [x] Removed duplicate `COLOR_LABELS` record from `settings-work-categories.tsx`

---

### Refactor R.5 — Button size variants (use existing, stop overriding) ✅

- [x] Replaced `className="size-6"` overrides with `size="icon-xs"` in onboarding steps
- [x] Replaced `className="h-6 px-2 text-xs"` overrides with `size="xs"` in onboarding steps

---

### Refactor R.6 — Accessibility & code quality ✅

- [x] Added `role="progressbar"` with `aria-valuenow/min/max` to onboarding step indicator
- [x] Replaced template literal class toggling with `cn()` in step indicator
- [x] Extracted `validateStatuses()` and `validateCategories()` to shared module (eliminates duplication between UI `canNext` check and submit handler)

---

### Verification

- [x] `npx tsc --noEmit` — 0 type errors
- [x] `npm run build` — clean build, all routes present

---

## Phase 1: Work Categories

> **Goal**: Admin can manage work categories (Design, Dev, PM, etc.) in Settings. Categories thread through the entire app — projects, tasks, pricing.
> **Depends on**: Phase 0 (complete)
> **Access**: Admin only (Settings > Work Categories tab)

---

### Task 1.1 — Schema: `workCategories` table ✅

- [x] Add `workCategories` table to `convex/schema.ts`
  - Fields: `orgId`, `name`, `color`, `defaultCostRate` (optional), `defaultBillRate` (optional), `currency`, `sortOrder`, `archivedAt` (optional), `createdAt`, `updatedAt`, `createdBy`
  - Index: `by_orgId` on `[orgId]`
- [x] Add color palette constants to `convex/lib/constants.ts`
  - `CATEGORY_COLORS` map: Notion-style named tokens → `{ bg, text }` hex pairs
  - Names: `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red`
  - Light pastel bg + darker saturated text (e.g. blue: `{ bg: "#E9F3F7", text: "#487CA5" }`)
  - `DEFAULT_CATEGORIES` seed data array (Design/blue, Development/purple, PM/orange)
- [x] Add `categoryColorValidator` to `convex/lib/validators.ts`
- [x] Deploy schema: `npx convex dev --once`

---

### Task 1.2 — Backend: `workCategories` queries & mutations ✅

- [x] Create `convex/workCategories.ts` with all operations:
  - `list` query — all categories for org (filter archived via arg `includeArchived`)
  - `get` query — single category by ID (with orgId check)
  - `create` mutation — admin only; validate name non-empty + **unique per org**, color from preset, currency from CURRENCIES; set sortOrder = max + 1
  - `update` mutation — admin only; all fields modifiable; **name uniqueness enforced on rename**
  - `archive` mutation — admin only; set `archivedAt = Date.now()`
  - `restore` mutation — admin only; unset `archivedAt`
  - `reorder` mutation — admin only; accept `ids: Id[]`, update `sortOrder` for each
  - `seed` mutation — admin only; guard: only if org has 0 categories; insert 3 defaults using org's `defaultCurrency`

---

### Task 1.3 — UI: Settings tab + category list ✅

- [x] Modify `app/(dashboard)/settings/page.tsx` — add 4th tab "Work Categories"
- [x] Create `components/settings/settings-work-categories.tsx`
  - Fetches `workCategories.list` via `useQuery`
  - Empty state: "No categories yet" + "Create default set" CTA (calls `workCategories.seed`)
  - "Show archived" toggle
  - "Add category" button → opens create modal
  - Each row: color dot · name · cost rate · bill rate · currency · ⋮ menu
  - ⋮ menu actions: Edit, Archive (or Restore if archived)
  - Archived rows shown dimmed when "Show archived" is on
  - Reorder via up/down arrow buttons → calls `workCategories.reorder`

---

### Task 1.4 — UI: Create/Edit category modal ✅

- [x] Create `CategoryForm` component (inline in settings-work-categories.tsx) — shared for create + edit
  - Name (text input, required)
  - Color (preset palette picker — clickable color swatches)
  - Default cost rate (number input, optional)
  - Default bill rate (number input, optional)
  - Currency (dropdown, default: org's `defaultCurrency`)
- [x] Wire to `workCategories.create` / `workCategories.update` mutations
- [x] Modal closes on success, list refreshes automatically (Convex reactivity)

---

### Task 1.5 — Seed logic & empty state ✅

- [x] Seed mutation reads org's `defaultCurrency` from `orgSettings`
- [x] Inserts: Design (blue), Development (purple), PM (orange)
- [x] Empty state CTA in list component triggers seed
- [x] List auto-populates via Convex reactive query

---

### Verification

- [x] `npx convex dev --once` — schema + functions deploy cleanly
- [x] `npm run build` — no errors
- [x] `npm run lint` — 0 errors (warnings only: pre-existing unused imports)

---

### Acceptance criteria

- [ ] Admin can create, edit, archive, restore categories in Settings > Work Categories
- [ ] Color picker shows preset palette (9 Notion-style colors)
- [ ] Cost rate + bill rate save with currency
- [ ] Archiving: category disappears from list (unless "Show archived" is on)
- [ ] Restore works (unsets archivedAt)
- [ ] Seed button: if 0 categories → 3 defaults created with org currency
- [ ] Sorting works (order persisted via reorder mutation)
- [ ] Member cannot access Settings (existing AdminGuard)
- [ ] All data filtered by orgId

---

## Phase 2: Clients ✅ COMPLETE

> **Goal**: Client directory — CRUD, contacts, billing details, logo upload, archive/restore cascade, hard delete guard.
> **Depends on**: Phase 0 (complete)
> **Access**: Admin only
> **Spec**: `docs/phase-2-clients.md`
>
> **Design decisions from Staff review**:
> - Client names unique per org (enterprise-safe default)
> - Invoice prefix auto-deduplicated on backend (append digit if collision)
> - `DropdownMenu` for entity row/header actions (not hover-reveal icons)
> - Reusable `useUndoAction` hook for 5s delayed archive (reused in Phase 3, 5+)
> - `EmptyState` extended with optional `action` prop
> - Dynamic breadcrumbs for `[id]` routes (one-time investment)
> - Search debounced via `useDeferredValue` (React 19)

---

### Task 2.0 — Prerequisites: install sonner + textarea ✅

- [x] Install sonner: `npx shadcn@latest add sonner`
- [x] Install textarea: `npx shadcn@latest add textarea`
- [x] Install checkbox: `npx shadcn@latest add checkbox`
- [x] Wire `<Toaster />` into root layout (`app/(dashboard)/layout.tsx`)
- [x] Extend `EmptyState` with optional `action?: ReactNode` prop
- [x] Create `lib/hooks/use-undo-action.ts` — reusable hook: `{ trigger, cancel }`, manages timeout + sonner toast
- [x] Create `lib/hooks/use-breadcrumb-title.ts` — context-based dynamic breadcrumb title
- [x] Create `components/breadcrumb-title-provider.tsx` — wraps layout with breadcrumb context
- [x] Update `components/dashboard-breadcrumb.tsx` — supports multi-segment paths + dynamic titles from context

---

### Task 2.1 — Schema: `clients` + `clientContacts` tables ✅

- [x] Add `clients` table to `convex/schema.ts`
  - Fields: `orgId`, `name`, `currency`, `invoicePrefix`, `billingEmail` (opt), `billingAddress` (opt), `taxId` (opt), `logoStorageId` (opt), `notes` (opt), `archivedAt` (opt), `createdAt`, `updatedAt`, `createdBy`
  - Index: `by_orgId` on `[orgId]`, `by_orgId_name` on `[orgId, name]`
- [x] Add `clientContacts` table to `convex/schema.ts`
  - Fields: `orgId`, `clientId`, `name`, `email`, `phone` (opt), `isPrimary`, `createdAt`, `updatedAt`, `createdBy`
  - Indexes: `by_clientId` on `[clientId]`, `by_orgId_email` on `[orgId, email]`
- [x] Deploy schema: `npx convex dev --once`

---

### Task 2.2 — Invoice prefix helper ✅

- [x] Create `generateInvoicePrefix(name: string): string` in `convex/lib/helpers.ts`
  - Strip diacritics (`normalize("NFD").replace(…)`)
  - Take first 4 alphanumeric chars, uppercase
  - "Acme Corp" → "ACME", "Müller & Co" → "MULL", fallback → "CLIE"
- [x] Create `ensureUniquePrefix(ctx, orgId, prefix, excludeClientId?): string` — if prefix exists on another client, append incrementing digit ("ACME" → "ACME2" → "ACME3")

---

### Task 2.3 — Backend: `clients` queries & mutations ✅

- [x] Create `convex/clients.ts` with:
  - `list` query — all clients for org; args: `includeArchived`
  - `get` query — single client by ID + orgId check; resolves `logoUrl` from storage
  - `create` mutation — admin only; validate name non-empty + trimmed + **unique per org**; auto-generate invoicePrefix with dedup; currency defaults to org's defaultCurrency
  - `update` mutation — admin only; all fields modifiable including `logoStorageId`; name uniqueness enforced on rename; name change does NOT auto-change prefix
  - `archive` mutation — admin only; sets `archivedAt = Date.now()`; (cascade to projects/tasks added in Phase 3/5)
  - `restore` mutation — admin only; unsets `archivedAt`; does NOT cascade
  - `remove` mutation — admin only; hard delete; cascade deletes contacts; (time entry guard deferred to Phase 7)
  - `generateUploadUrl` mutation — for logo upload via Convex storage
  - `removeFile` mutation — for logo deletion

---

### Task 2.4 — Backend: `clientContacts` queries & mutations ✅

- [x] Create `convex/clientContacts.ts` with:
  - `list` query — all contacts for a client (by clientId + orgId check)
  - `create` mutation — admin only; validate name + email non-empty; email uniqueness check within org (query `by_orgId_email` index); auto-set `isPrimary = true` if first contact; descriptive error with conflicting client name
  - `update` mutation — admin only; email uniqueness re-checked on change
  - `remove` mutation — admin only; if removing primary → oldest remaining becomes primary
  - `setPrimary` mutation — admin only; unset old primary, set new one

---

### Task 2.5 — UI: Client list page (`/clients`) ✅

- [x] Convert `app/(dashboard)/clients/page.tsx` from placeholder to full list
  - `"use client"` component
  - Query `clients.list` via `useQuery`
  - **Table columns**: Name, Currency (badge), Invoice Prefix, ⋮ `DropdownMenu` (Edit, Archive, Delete)
  - **Search**: filter by name, debounced via `useDeferredValue`
  - **"Show archived" toggle** with checkbox
  - **"+ New client" button** → opens create modal
  - **Row click** → navigates to `/clients/[id]`
  - **Empty state**: `<EmptyState>` with `action` CTA button
  - Optimistic hide on archive with undo toast

---

### Task 2.6 — UI: Create/Edit client modal ✅

- [x] Create `components/clients/client-form-modal.tsx`
  - Shared for create + edit (receives optional `client` prop)
  - Fields: Name (required), Currency (dropdown, default: org's), Invoice Prefix (auto-generated, editable, uppercase forced)
  - Billing section: Billing email, Billing address (`Textarea`), Tax ID
  - Notes field (`Textarea`)
  - Wire to `clients.create` / `clients.update`
  - Inline error display for name uniqueness violations
  - Form resets correctly on open/close and create/edit transitions

---

### Task 2.7 — UI: Client detail page (`/clients/[id]`) ✅

- [x] Create `app/(dashboard)/clients/[id]/page.tsx`
  - Query `clients.get` + `clientContacts.list`
  - **Header**: Name + currency badge + invoice prefix + Edit button + ⋮ `DropdownMenu` (Archive/Restore, Delete)
  - **Contacts section**: embedded `ContactList` component
  - **Billing details section**: billing email, address, tax ID (with icons)
  - **Notes section**: pre-formatted text
  - **Logo section**: `LogoUpload` component
  - **Active projects section**: placeholder with dashed border "Projects will appear here" (Phase 3)
  - Archive/Restore/Delete all wired with undo toast and confirmation dialog
- [x] Dynamic breadcrumb: `useBreadcrumbTitle(client.name)` sets "Clients > Acme Corp" automatically
- [x] `BreadcrumbTitleProvider` wraps `SidebarInset` in layout — works for all future `[id]` pages

---

### Task 2.8 — UI: Contact management (within client detail) ✅

- [x] Create `components/clients/contact-list.tsx`
  - Contacts table with `DropdownMenu` per row (Edit, Set Primary, Delete)
  - Primary badge display
  - Success toast on primary change
  - Delete confirmation via `AlertDialog`
- [x] Create `components/clients/contact-form-modal.tsx`
  - Shared for create + edit
  - Fields: Name (required), Email (required), Phone (optional), Is Primary (checkbox, shown only on create)
  - Email uniqueness error displayed inline from mutation error

---

### Task 2.9 — Logo upload ✅

- [x] Create `components/clients/logo-upload.tsx`
  - Two-step Convex storage upload (`generateUploadUrl` → POST)
  - Max 2MB, image types (PNG, JPG, SVG) — client-side validation
  - Preview thumbnail after upload
  - Replace and Delete buttons
  - Loading state with spinner during upload
  - Toast feedback for success/error

---

### Task 2.10 — Archive/Restore with undo toast ✅

- [x] `useUndoAction` hook wired to archive action on both list and detail pages
  - On archive: optimistic hide (list) or inline state (detail), sonner undo toast (5s)
  - Undo → cancel mutation, revert optimistic state
  - Network error → auto-revert + error toast
- [x] Restore: calls `clients.restore`; info toast "Projects and tasks are still archived — restore them individually"
- [x] Applied on both list page DropdownMenu and detail page DropdownMenu

---

### Task 2.11 — Hard delete with confirmation ✅

- [x] Confirmation `AlertDialog` on both list and detail pages
  - "This will permanently delete [name] and all associated data. This cannot be undone."
- [x] Calls `clients.remove`; on success navigates to `/clients` from detail page
- [x] Error toast on failure (Phase 7: guard against time entries)

---

### Verification ✅

- [x] `npx convex dev --once` — schema + functions deploy cleanly
- [x] `npm run build` — no errors, `/clients` static + `/clients/[id]` dynamic
- [x] `npm run lint` — 0 errors (4 warnings: pre-existing auto-generated files)

---

### Acceptance criteria

- [x] Admin creates client (name + currency), appears in list
- [x] Client name unique per org (error on duplicate)
- [x] Invoice prefix auto-generated, auto-deduplicated, and editable
- [x] Contacts list: CRUD, email uniqueness within org
- [x] Primary flag: exactly one per client
- [x] Currency modifiable (no lock)
- [x] List view shows table with search (debounced) + archived toggle
- [x] DropdownMenu used for row/header actions (not hover-reveal icons)
- [x] Archive removes from list with 5s undo toast (sonner)
- [x] Restore does NOT cascade + info message
- [x] Hard delete shows confirmation + blocked if time entries exist (guard wired in Phase 7)
- [x] Logo upload and preview works
- [x] Client detail page shows all sections
- [x] Dynamic breadcrumbs work for `/clients/[id]`
- [x] Member cannot see the /clients route (existing AdminGuard)
- [x] All data filtered by orgId

---

## Phase 3: Projects Core ✅ COMPLETE

> **Goal**: Project CRUD with Fixed + T&M billing types. Retainer is schema-only (Phase 4). Monthly breakdown is a placeholder shell (Phase 7).
> **Depends on**: Phase 1 (Work Categories) + Phase 2 (Clients)
> **Access**: Admin only
> **Spec**: `docs/phase-3-projects-core.md`
>
> **Key decisions**:
> - Code uniqueness: retry on conflict (up to 3 attempts)
> - Settings: per-section Save buttons
> - Monthly breakdown: placeholder shell only, full UI in Phase 7
> - User refs: Convex `v.id("users")`
> - activeProjectCount: batch query, no N+1
> - billingType + tmRateMode immutable after creation
> - Currency lock: stub (always allows, TODO when reports table exists)

---

### Task 3.1 — Schema: `projects` + `projectCategoryEstimates` tables ✅

- [x] Add `projects` table to `convex/schema.ts`
  - Fields: `orgId`, `clientId`, `name`, `code`, `billingType` (fixed/retainer/t_and_m), `currency`
  - Retainer stub fields (all optional, Phase 4): `retainerStatus`, `includedMinutesPerMonth`, `overageRate`, `startDate`, `rolloverEnabled`, `cycleLength`
  - T&M fields (optional): `hourlyRate`, `tmCategoryRates` (array), `tmRateMode` (flat/per_category)
  - `defaultAssignees` (optional array of workCategoryId + userId)
  - `archivedAt`, `createdAt`, `updatedAt`, `createdBy`
  - Indexes: `by_orgId`, `by_clientId`, `by_orgId_code`
- [x] Add `projectCategoryEstimates` table (Fixed budget rows)
  - Fields: `orgId`, `projectId`, `workCategoryId`, `estimatedMinutes`, `internalCostRate` (opt), `clientBillingRate` (opt)
  - Index: `by_projectId`
- [x] Deploy schema

---

### Task 3.2 — Validators ✅

- [x] Add `billingTypeValidator` to `convex/lib/validators.ts` — `v.union(v.literal("fixed"), v.literal("retainer"), v.literal("t_and_m"))`
- [x] Add `tmRateModeValidator` — `v.union(v.literal("flat"), v.literal("per_category"))`

---

### Task 3.3 — Helpers: project code generation ✅

- [x] Add `generateNextProjectCode(ctx, orgId)` to `convex/lib/helpers.ts` — finds max PRJ-XXX, returns PRJ-{max+1} zero-padded to 3 digits
- [x] Add `ensureUniqueProjectCode(ctx, orgId, code, excludeProjectId?)` — throws if taken

---

### Task 3.4 — Queries: `projects.list`, `projects.get`, `projects.nextCode` ✅

- [x] `projects.list` — args: includeArchived, clientId, billingType; batch joins client names (one query, build lookup map); returns `{ ...project, clientName }`
- [x] `projects.get` — validates project.orgId === auth.orgId; returns full project + clientName
- [x] `projects.nextCode` — returns next available PRJ-XXX string

---

### Task 3.5 — Mutations: `projects.create`, `update`, `archive`, `restore`, `remove` ✅

- [x] `projects.create` — validates name ≤100, client exists + same org, currency in CURRENCIES; auto-generates code with retry on conflict (up to 3 attempts); T&M validation (rate mode required, hourly rate or category rates)
- [x] `projects.update` — immutable guard (billingType, tmRateMode cannot change); validates code uniqueness excluding self; currency lock stub (TODO)
- [x] `projects.archive` — sets archivedAt; TODO Phase 5: cascade to tasks; TODO Phase 7: stop timers
- [x] `projects.restore` — clears archivedAt; does NOT cascade-restore tasks
- [x] `projects.remove` — cascade deletes projectCategoryEstimates; TODO Phase 7: block if time entries exist

---

### Task 3.6 — `projectCategoryEstimates` CRUD ✅

- [x] `projectCategoryEstimates.list` — enriched with categoryName + categoryColor from workCategories
- [x] `projectCategoryEstimates.upsert` — finds existing estimate for project+category, updates if exists, creates if not; validates non-negative rates
- [x] `projectCategoryEstimates.remove` — validates org ownership

---

### Task 3.7 — Wire `activeProjectCount` in clients ✅

- [x] In `clients.listWithContacts`: replaced hardcoded `activeProjectCount: 0`
- [x] Batch query: all org projects ONCE (by_orgId index), build `Map<clientId, count>` of non-archived projects
- [x] No N+1 — one query for all projects, not one per client

---

### Task 3.8 — Wire cascade delete in `clients.remove` ✅

- [x] `clients.remove` now cascade deletes all projects for the client
- [x] Each deleted project's estimates are also cascade deleted
- [x] TODO Phase 5: cascade delete tasks under each project

---

### Task 3.9 — Shared components ✅

- [x] `components/billing-type-badge.tsx` — colored badge: Fixed (blue), T&M (green), Retainer (purple)
- [x] `components/health-badge.tsx` — on_track (green) / at_risk (amber) / over_budget (red) + `getHealthStatus(utilization)` utility
- [x] `components/projects/time-log-placeholder.tsx` — empty state shell for Phase 7

---

### Task 3.10 — UI: Create Project Modal ✅

- [x] `components/projects/project-form-modal.tsx`
  - Client select (auto-fills currency), Project name (max 100), Project code (pre-filled from nextCode, editable)
  - Billing type radio (Fixed/T&M/Retainer disabled) with immutability warning
  - T&M section (visible when billingType="t_and_m"): Rate mode radio (flat/per-category) with immutability warning
  - Flat → hourly rate input + currency suffix
  - Per-category → grid: category dropdown + rate input per row, pre-populated from defaultBillRate; + Add / × remove
  - Currency select (defaults to client's)
  - Success → navigates to `/projects/[newId]`

---

### Task 3.11 — UI: Project List Page (`/projects`) ✅

- [x] Replaced stub with full list page following `clients/page.tsx` pattern
  - Stats bar (divide-x): Active | Fixed | T&M | Retainer counts
  - Filters: Client dropdown, Type dropdown, Sort (Name/Client), Archived toggle
  - Search with `useDeferredValue`
  - Table columns: Name, Code (monospace), Type (BillingTypeBadge), Client, Currency (badge), Last activity (placeholder "—"), Actions ⋮
  - Row click → `/projects/[id]`
  - Archive: optimistic hide + 5s undo toast (`useUndoAction`)
  - Delete: AlertDialog confirmation
  - Empty state: EmptyState with CTA

---

### Task 3.12 — UI: Project Detail Page (`/projects/[id]`) ✅

- [x] `app/(dashboard)/projects/[id]/page.tsx` — `"use client"` with Tabs (Overview | Settings)
- [x] **Header**: Name (h1) + BillingTypeBadge + Archived badge; Code + client + currency metadata; Last logged placeholder; Edit button (→ Settings tab); ⋮ menu (Archive/Restore, Delete)
- [x] **Fixed Overview tab**:
  - Info banner: "Fixed projects are for budget tracking only"
  - Budget Overview card: progress bar + % + hours + HealthBadge + est. cost/revenue
  - Per-Category Breakdown table: CategoryBadge + Estimated/Actual/Remaining/Progress per row + Total footer
  - Time Log section: TimeLogPlaceholder
  - All actuals = 0 until Phase 7
- [x] **T&M Overview tab**:
  - 4 metric cards (Uninvoiced, Last invoiced, This month, Last logged) — all placeholder zeros
  - Time Log section: TimeLogPlaceholder
- [x] **Retainer Overview**: placeholder message "Phase 4"
- [x] **Settings tab — General section**: name, code, billingType (read-only badge), currency (select); per-section Save
- [x] **Settings tab — Budget Estimates (Fixed only)**: editable grid (category select + est. hours + cost rate + bill rate + × remove); + Add category; pre-populates from workCategory defaults; Save → batch upsert/remove
- [x] **Settings tab — Rates (T&M only)**: rate mode (read-only); flat → hourly rate input; per-category → table with rates; Save
- [x] **Settings tab — Default Assignees**: category + user pairs; Save → `projects.update({ defaultAssignees })`
- [x] **Not found**: redirects to `/projects`

---

### Verification

- [x] `npx convex dev --once --typecheck disable` — schema + functions deploy cleanly
- [x] `npx tsc --noEmit` — 0 errors in Phase 3 files (4 pre-existing errors in clients code)

---

### Acceptance criteria

- [x] Admin creates project (client + name + billing type + currency), appears in list
- [x] Project code auto-generated (PRJ-XXX), editable, unique per org with retry
- [x] billingType + tmRateMode immutable after creation (enforced in update mutation)
- [x] T&M flat: hourlyRate required; T&M per-category: category rates required
- [x] Fixed: budget estimates per category with cost/bill rates
- [x] List view: table with search + client/type/sort filters + archived toggle
- [x] Archive with 5s undo toast, Restore without cascade
- [x] Hard delete cascades to estimates (time entry guard wired in Phase 7)
- [x] activeProjectCount wired in clients list (batch query, no N+1)
- [x] Client cascade delete wired for projects + estimates
- [x] Project detail page with Overview + Settings tabs
- [x] CategoryBadge used in breakdown (matches Work Categories design)
- [x] TimeLogPlaceholder shell ready for Phase 7 expansion
- [x] All data filtered by orgId

---

### TODOs deferred to later phases

- **Phase 5**: Archive cascade from projects → tasks; cascade delete tasks on project delete
- **Phase 7**: Time entry data in overview (actual hours, utilization, monthly breakdown); block project delete if time entries exist; stop running timers on archive; currency lock when reports exist; "Last activity" column with real dates

---

## Phase 4: Projects Retainer ✅ COMPLETE

> **Goal**: Full Retainer billing type — monthly hour allowance, rollover cycles, overage billing, cycle navigation, balance computation.
> **Depends on**: Phase 3 (Projects Core)
> **Access**: Admin only
> **Spec**: `docs/phase-4-projects-retainer.md`
>
> **Key decisions**:
> - Balance always computed fresh from time entries (query, no cache)
> - Rollover toggle change → entire history recalculates automatically (since balance is derived)
> - Mid-cycle config change → retroactive to current cycle + confirmation dialog
> - Active/Inactive is pausable (not archive), data preserved
> - Cron skeleton for auto-report generation (full reports in Phase 2 Reports)
> - No donut chart (progress bar + metrics are sufficient)
> - Monthly breakdown uses shadcn Accordion with single-open behavior

---

### Task 4.0 — Prerequisites: install shadcn components ✅

- [x] Install `alert`, `accordion`, `progress`, `popover`, `calendar` via `npx shadcn@latest add`
- [x] Verified `date-fns` already installed (v4.1.0)

---

### Task 4.1 — Schema updates ✅

- [x] Fixed retainer field types on `projects` table:
  - `retainerStatus`: `v.optional(v.union(v.literal("active"), v.literal("inactive")))` (was `v.optional(v.string())`)
  - `startDate`: `v.optional(v.string())` for YYYY-MM-DD (was `v.optional(v.number())`)
  - `cycleLength`: `v.optional(v.number())` for 1-12 (was `v.optional(v.string())`)
- [x] Added `retainerPeriods` table with fields: `orgId`, `projectId`, `periodStart`, `periodEnd`, audit fields; index `by_projectId`

---

### Task 4.2 — Validators ✅

- [x] Added `retainerStatusValidator` to `convex/lib/validators.ts` — `v.union(v.literal("active"), v.literal("inactive"))`

---

### Task 4.3 — Mutation: `projects.create` retainer support ✅

- [x] Extended `projects.create` with retainer-specific args: `includedMinutesPerMonth`, `overageRate`, `startDate`, `cycleLength`, `rolloverEnabled`
- [x] Retainer validation: monthly hours > 0, overage rate >= 0, valid YYYY-MM-DD start date, cycle length 1-12
- [x] On create: sets `retainerStatus: "active"`, defaults `rolloverEnabled: true`, `cycleLength: 3`

---

### Task 4.4 — Mutation: `projects.updateRetainer` ✅

- [x] Created `projects.updateRetainer` mutation
  - Editable fields: `includedMinutesPerMonth`, `overageRate`, `startDate`, `cycleLength`, `rolloverEnabled`, `retainerStatus`
  - `confirmed` flag required for config changes (frontend shows dialog first)
  - Throws `"CONFIRMATION_REQUIRED"` if changing config fields without `confirmed: true`
  - Validation: same constraints as create (hours > 0, rate >= 0, cycle 1-12)

---

### Task 4.5 — Query: `projects.getRetainerData` (balance computation) ✅

- [x] Created `projects.getRetainerData` query — the core balance engine
  - Args: `id` (project), `cycleOffset` (0 = current, -1 = previous, etc.)
  - Computes cycle boundaries from `startDate + cycleLength`
  - Sequential balance chain (for loop, not map — each month depends on previous):
    - **Rollover ON**: `startBalance = prev.endBalance`, `available = startBalance + allowance`
    - **Rollover OFF**: `startBalance = 0`, `available = allowance`
    - `endBalance = available - workedMinutes`
  - Badge status logic: `due` | `deficit` | `rollover` | `unused` | `on_track`
  - Cycle totals: `cycleBudget`, `cycleWorked`, `cycleBalance`, `utilization`
  - Overage: rollover ON → only at cycle end; rollover OFF → per closed month
  - Returns: `hasPreviousCycle`, `hasNextCycle` for cycle navigator
  - **Phase 7 stub**: `workedMinutes = 0` per month (TODO: real time entry aggregation)

---

### Task 4.6 — Backend: `retainerPeriods` CRUD ✅

- [x] Created `convex/retainerPeriods.ts`:
  - `list` query — all periods for a project, sorted by periodStart
  - `ensure` mutation — lazy-creates period for a given month if none exists; computes periodStart/periodEnd from year+month

---

### Task 4.7 — Cron skeleton ✅

- [x] Created `convex/crons.ts` — registers monthly cron (1st of month, 06:00 UTC)
- [x] Created `convex/retainerCron.ts` — `generateMonthlyPeriods` internal mutation:
  - Finds all active retainer projects across all orgs
  - Creates period record for the previous month if none exists
  - TODO Phase 2 (Reports): auto-generate reports here

---

### Task 4.8 — Shared components ✅

- [x] `components/metric-card.tsx` — reusable metric display card with `<Card size="sm">`, `tabular-nums`, color variant support (default/destructive/warning)
- [x] `components/budget-progress.tsx` — two-segment progress bar (budget + overage), reusable for Fixed + Retainer
- [x] `components/retainer-balance-badge.tsx` — 5 badge variants: `due` (red), `deficit` (red), `rollover` (amber), `unused` (yellow), `on_track` (green)
- [x] `components/retainer-status-badge.tsx` — Active (green dot) / Inactive (gray dot) inline status
- [x] `components/cycle-dots.tsx` — cycle position indicator (●●○ for 2/3)
- [x] `components/confirm-dialog.tsx` — reusable AlertDialog wrapper for confirmation flows
- [x] `components/ui/date-picker.tsx` — shadcn Popover + Calendar date picker

---

### Task 4.9 — UI: Create Modal — retainer flow ✅

- [x] Enabled retainer option in `project-form-modal.tsx` (was disabled)
- [x] Retainer config section (visible when billingType="retainer"):
  - 2-col grid: Monthly hours (h/mo) + Overage rate (currency/h)
  - 2-col grid: Start date (DatePicker, default: 1st of current month) + Cycle length (Select, 1-12 months)
  - Rollover toggle (Switch) with contextual explanation text
- [x] On submit: converts hours → minutes, formats date as YYYY-MM-DD
- [x] Removed unused `toast` import (lint clean)

---

### Task 4.10 — UI: Retainer Overview tab ✅

- [x] Created `components/projects/retainer-overview.tsx` — replaces "Coming soon" placeholder
  - **Cycle Overview Card** (`<Card>` with `CardHeader`/`CardContent`/`CardFooter`):
    - CardTitle: "Cycle Overview" + CardDescription: date range + cycle config
    - CardAction: Cycle Navigator (◀ Cycle N ▶) with `cycleOffset` state
    - BudgetProgress bar (budget segment + overage segment)
    - 3 MetricCards in responsive grid: Hours Used, Over Budget, Overage Due
    - CardFooter: cycle summary stats
  - **Overage Invoice Banner** — `<Alert variant="destructive">` when cycle closed + overage exists
    - Shows amount due + calculation breakdown + disabled "Create Invoice" button (Phase 2)
  - **Monthly Breakdown** — `<Card>` wrapping `<Accordion type="single" collapsible>`:
    - AccordionTrigger per month: label + CycleDots + worked/available + balance + RetainerBalanceBadge
    - AccordionContent: balance detail grid (start balance, available, worked) + time entries placeholder
    - Default open: current month (or last month of closed cycle)
  - **Cycle-End Settlement Card** — inside accordion after last month:
    - Overage variant: `border-destructive/20 bg-destructive/5` with ZapIcon + amount + disabled invoice button
    - Forfeited variant: `bg-muted/50` with unused hours message
  - **TimeLogPlaceholder** — existing component
  - Content-aware loading skeleton

---

### Task 4.11 — UI: Retainer Settings tab ✅

- [x] Created `components/projects/settings-retainer.tsx`
  - `<Card>` with `CardHeader` (title + CardAction: status badge + Switch toggle)
  - `<Alert>` info banner: "Changes retroactively affect the current billing cycle"
  - 2-col grid: Monthly hours + Overage rate
  - 2-col grid: Start date (DatePicker) + Cycle length (Select 1-12)
  - `<Separator>` + Rollover toggle with explanation text
  - `CardFooter`: Save button
  - **Active/Inactive toggle** fires immediately via separate mutation call (not batched with Save)
  - **Confirmation dialogs** (using `<ConfirmDialog>`):
    - Config change: "These changes will retroactively affect the current billing cycle"
    - Status toggle: "Pause retainer?" / "Activate retainer?"

---

### Task 4.12 — Wire into project detail page ✅

- [x] Updated `app/(dashboard)/projects/[id]/page.tsx`:
  - Overview tab: `<RetainerOverview>` replaces placeholder
  - Settings tab: `<SettingsRetainer>` added for retainer projects
  - Header: shows `<RetainerStatusBadge>` + h/mo metadata for retainer projects
  - Fixed `text-[10px]` → `text-xs` accessibility issue (Archived badge)

---

### Task 4.13 — Accessibility fixes ✅

- [x] Fixed `text-[11px]` → `text-xs` in `billing-type-badge.tsx` (WCAG minimum text size)
- [x] Fixed `text-[10px]` → `text-xs` in project detail page
- [x] All numeric values use `tabular-nums` class for stable column width
- [x] Cycle navigator buttons have `aria-label`
- [x] Retainer status Switch has `aria-label`

---

### Task 4.14 — Format helpers ✅

- [x] Added `formatCurrencyPrecise(amount, currency)` to `lib/format.ts` — 2 decimal places for overage amounts
- [x] Added `formatMinutes(minutes)` — converts minutes to HH:MM format (e.g., 630 → "10:30")
- [x] Added `formatHours(minutes)` — alias for formatMinutes

---

### Verification

- [x] `npx tsc --noEmit` — 0 type errors
- [x] `npx convex typecheck` — passed
- [x] `npm run lint` — 0 errors (4 warnings: pre-existing auto-generated files only)

---

### Acceptance criteria

- [x] Retainer project creatable from modal (all required fields: hours, rate, start date, cycle, rollover)
- [x] Cycle overview card: progress bar, 3 metrics — with computed data
- [x] Monthly breakdown: balance chaining correct (rollover ON and OFF)
- [x] Cycle-end settlement: overage OR unused/forfeited card
- [x] Deficit indicator on mid-cycle negative balance
- [x] Overage invoice banner appears if cycle closed + overage exists
- [x] Cycle navigator (prev/next) for older cycles
- [x] Rollover toggle change: history recalculates + confirmation
- [x] Mid-cycle config change: retroactive + confirmation
- [x] Active/Inactive toggle works (immediate, separate mutation)
- [x] Settings tab: all config editable with 2-col responsive grid
- [x] Balance always computed fresh (no stale data)
- [x] Auto-report cron skeleton ready (trigger logic, period creation)
- [x] All shared components follow domain UI convention (separate files in components/)
- [x] All data filtered by orgId

---

### TODOs deferred to later phases

- **Phase 5**: Archive cascade from projects → tasks
- **Phase 7**: Real time entry aggregation in `getRetainerData` (currently `workedMinutes = 0`); monthly breakdown with grouped entries by category; "Log entry" link per month
- **Phase 2 (Reports)**: Auto-report generation in cron job; "Create Invoice" button on overage banner and settlement card; overage billing queue

---

## Phase 5: Tasks Core ✅ COMPLETE

> **Goal**: Main task list — table, filtering, grouping, inline editing, bulk operations, task creation modal.
> **Depends on**: Phase 3 (Projects Core)
> **Access**: Admin: all tasks. Member: only assigned tasks.
> **Spec**: `docs/phase-5-tasks-core.md`, `docs/superpowers/specs/2026-03-16-phase-5-tasks-core-design.md`

---

### Implemented

- [x] Schema: `tasks` table with statusType denormalization, searchIndex, 5 indexes
- [x] Schema: `orgMembers` junction table (Clerk webhook-synced membership)
- [x] Schema: `systemRole: "today"` on statuses table
- [x] Backend: `tasks.counts` (per-tab, permission-filtered, Today via systemRole)
- [x] Backend: `tasks.list` (tab + filter operators + grouping + search + server-side enrichment)
- [x] Backend: `tasks.create/update/archive/restore/remove/duplicate/bulkUpdate`
- [x] Backend: `orgMembers.listOrgMembers` query + `upsertMembership/deleteMembership` mutations
- [x] Webhook: `organizationMembership.created/updated/deleted` events handled
- [x] URL state via `nuqs` (tab, groupBy, search, filters with operators)
- [x] 6 tabs with count badges
- [x] 10-column CSS Grid table (desktop)
- [x] Inline editing: status, category, client/project, assignee (Popover + Command)
- [x] Grouping: project, client, category, assignee, status, none
- [x] Collapsible group headers with localStorage persistence
- [x] Inline task creation ("+ Add task..." with rapid entry, group-inherited defaults)
- [x] Stripe-style filter pills with operators (is/isNot/anyOf/noneOf)
- [x] Status, Project, Category, Assignee filters (all multi-select)
- [x] Task creation modal (Linear-style, project picker, property pills, Cmd+Enter)
- [x] Bulk operations toolbar (status, add/remove assignee, category, archive)
- [x] Select all (header + per-group), max 50 cap
- [x] Checkboxes hidden by default, appear on row hover (ClickUp-style)
- [x] Mobile card view below md breakpoint
- [x] Mobile FAB for task creation
- [x] Horizontally scrollable tabs on mobile
- [x] Responsive header (stacks on mobile)
- [x] Empty cell placeholders (dashed circle icon + label, hover-to-reveal)
- [x] Search with debounce (local state + 300ms delay)
- [x] Archive with undo toast
- [x] Delete with confirmation dialog
- [x] Done tasks: green checkbox + strikethrough + opacity
- [x] Activity column with mock data (subtask, comment, attachment icons)
- [x] UserAvatar shared component (shadcn Avatar + initials fallback)
- [x] Content-aware loading skeleton

---

### Verification

- [x] `npx tsc --noEmit` — 0 type errors
- [x] `npx convex dev --once` — schema + functions deployed
- [x] All shadcn Checkbox used (no hand-rolled checkboxes)
- [x] All inline cells use toast.error on failure
- [x] Design tokens used throughout (no hardcoded colors)

---

### TODOs deferred to later phases

- **Phase 6**: Activity column real data (subtask/comment/attachment queries); task subtitle real activity feed; task detail modal (replaces creation modal for editing); subtasks; rich text description (Tiptap)
- **Phase 7**: Time column real data (timer + logged time); play/pause button wired to timer system; project lock (prevent change if time entries exist); stop timers on archive
- **v2**: Column-header sorting; drag-and-drop reordering (add sortOrder field); arrow-key row navigation; saved views (URL state covers need for now); cursor-based per-group pagination ("Load more"); denormalized task counts for scale; assigneeIds → junction table at ~2000 tasks/org
