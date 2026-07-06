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
  - Fields: `orgId`, `name`, `currency`, `prefix` (opt), `usePrefix` (opt), `billingEmail` (opt), `billingAddress` (opt), `taxId` (opt), `logoStorageId` (opt), `notes` (opt), `archivedAt` (opt), `createdAt`, `updatedAt`, `createdBy`
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
  - `create` mutation — admin only; validate name non-empty + trimmed + **unique per org**; auto-generate prefix with dedup; currency defaults to org's defaultCurrency
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
- **Phase 7**: ✅ Time column real data (timer + logged time); play/pause button wired to timer system; project lock (prevent change if time entries exist); stop timers on archive
- **v2**: Column-header sorting; drag-and-drop reordering (add sortOrder field); arrow-key row navigation; saved views (URL state covers need for now); cursor-based per-group pagination ("Load more"); denormalized task counts for scale; assigneeIds → junction table at ~2000 tasks/org

---

## Phase 7: Time Tracking ✅ COMPLETE

> **Goal**: Server-side timer + manual entry + floating widget + rate snapshot + time entry CRUD.
> **Depends on**: Phase 5 (Tasks Core)
> **Spec**: `docs/phase-7-time-tracking.md` (backend), `docs/time-tracking-prd.md` (UI/UX)

---

### Implemented

- [x] Schema: `timeEntries` table with 4 indexes (orgId, taskId, userId+date, orgId+date)
- [x] Schema: Timer state on users table (timerTaskId, timerStartedAt, timerAccumulatedMs, timerStatus)
- [x] Pure utilities: duration parser (6 formats), rounding (4 modes), timer math, rate resolver — 92 Vitest tests
- [x] Backend: Timer mutations (start, stop, pause, resume, discard, commitEntry, getState)
- [x] Backend: Time entry CRUD (create, update, remove, listByTask, listToday, sumByTasks, sumByProject)
- [x] Backend: Rate snapshot at entry creation (T&M flat, T&M per-category, Fixed, Retainer)
- [x] Backend: Block time entry if no rate (T&M per-category without category)
- [x] Backend: Stop timers on task/project archive
- [x] Backend: Block delete tasks/projects with time entries (suggest archive instead)
- [x] Backend: Block project change on tasks with time entries
- [x] Frontend: TimerProvider (Convex subscription + setInterval live elapsed)
- [x] Frontend: useTimer hook with formattedTime
- [x] Frontend: InlineTimeCell (Linear-style: filled 10px play/stop icons, no pills)
- [x] Frontend: Batch sumByTasks query in tasks page (N+1 prevention)
- [x] Frontend: FloatingTimerWidget (running/paused/committing states, morphs in-place)
- [x] Frontend: TimerCommitForm (editable duration + note + billable + save/discard)
- [x] Frontend: TimerTodaySection (collapsible today entries in widget)
- [x] Frontend: StaleTimerDialog (blocking modal when timer >= 8h, empty duration)
- [x] Frontend: TimeLogPopover (combined input + play, quick buttons, date/note, billable, entries)
- [x] Frontend: DurationInput (JetBrains Mono + quick buttons)
- [x] Frontend: TimeEntriesList (avatars, billable dots, delete action)
- [x] Frontend: My Time page (/my-time) with today summary + active timer banner + entries
- [x] Frontend: Content-aware loading skeleton for My Time
- [x] Format helpers re-exported from lib/format.ts

---

### Verification

- [x] `npm run test` — 92 tests pass (duration parser, rounding, timer math, rate resolver)
- [x] `npx tsc --noEmit` — 0 type errors
- [x] `npx convex codegen` — schema + functions deployed

---

### TODOs deferred to later phases

- **Phase 6 (Tasks Detail)**: Time tab in task detail modal with full entry editing (duration, note, date, billable)
- **Phase 2 (Reports)**: `invoicedInReportId` field on timeEntries; lock icon on invoiced entries; `getUninvoiced` query
- **v2**: Weekly timesheet view (/my-time Harvest-style grid); quick-switch / recent timers; "Who's working now" dashboard; idle detection; nudges/reminders; time entry tags; global shortcut (Cmd+T); browser tab title with timer; activity log for time edits ("AT changed 2:00 → 8:00")

---

## Project Summary Card Refactor ✅ (2026-04-18)

> **Goal**: Replace the three project Overview top metric grids (T&M/Fixed/Retainer) with one unified, business-critical, validated calculation layer and a single shared card component. Numbers on this surface drive pricing, hiring, and go/no-go decisions — accuracy is non-negotiable.
>
> PRD: [`docs/project-summary-prd.md`](project-summary-prd.md)
> Dependency: [`docs/d1-currency-integrity-plan.md`](d1-currency-integrity-plan.md)
>
> **Key decisions**:
> - Scope A (minimum): only the top metric grid gets replaced. Budget table, Monthly Breakdown accordion, Time Log, and existing Alerts stay untouched.
> - **No rounding anywhere on the card** — raw ledger accuracy > billing-preview niceness.
> - Per-type Revenue semantics: T&M "Earned Revenue" (work produced), Fixed "Contract Value" (`max(fixedPrice, totalBilled)`), Retainer "Earned Cycle Revenue" (`monthlyFee × cycleLength + live overageDue`).
> - Member (non-admin) sees only the Time Breakdown column; Billing Status, Profitability, Overage are admin-only.
> - T&M has a URL-persistent date range (This month / This quarter / This year / All time / Custom); Retainer has a URL-persistent cycle offset.
> - Codex rescue review used as tiebreaker on opinionated formulas; Fixed Revenue and Retainer Revenue reformulated after review, then further reverted per product-owner judgment on live overage visibility.

### Tasks

- [x] **D1 — Unit tests**: `convex/lib/rates.test.ts` expanded to 15 tests covering currency invariant (propagation, error messages, retainer zero, non-billable + cost=0).
- [x] **D1 — Schema invariant**: comment block above `timeEntries` in `convex/schema.ts` documenting the `rateCurrency == client.currency` invariant and its enforcement path.
- [x] **D1 — Query return shape**: `api.projects.list` and `api.projects.get` extended with resolved `currency: string` field from client. `getRetainerData` already had it.
- [x] **D1 — `project.currency` readers migrated**: backend readers in `convex/invoices.ts` use `getProjectCurrency(ctx, project)`; frontend readers consume the resolved `currency` field from query result.
- [x] **D1 — Legacy field removed**: `projects.currency` dropped from schema + write in `projects.create` removed. `ProjectWithClient` type in `projects-table.tsx` augmented with explicit `currency: string`.
- [x] **Pure calc layer**: `convex/lib/projectSummary.ts` — `computeTmSummary` / `computeFixedSummary` / `computeRetainerSummary` pure functions + `resolveDateRange` / `filterEntriesByDate` helpers.
- [x] **Pure calc tests**: `convex/lib/__tests__/projectSummary.test.ts` — 35 fixture-based tests. 100% line coverage on the calc layer. Covers happy path, empty, date filter, custom range, extra-billed Fixed, mid-cycle overage Retainer, non-rollover, member view, costRate=0 entries.
- [x] **Convex query**: `api.projects.getSummary({ projectId, dateRange?, cycleOffset? })` — thin dispatcher; discriminated union return; role-aware output; retainer cycle math extracted into local helper.
- [x] **UI primitives**: `components/projects/summary/primitives/` — `summary-card-shell.tsx`, `summary-column.tsx`, `metric-row.tsx`.
- [x] **Per-type UI**: `tm-summary.tsx` (with date range picker), `fixed-summary.tsx` (conditional Unbilled/Fully invoiced/Extra billed slot), `retainer-summary.tsx` (with cycle navigator + Uninvoiced badge).
- [x] **Entry component**: `project-summary-card.tsx` — dispatches by `billingType`, owns skeleton (3-column unified) and error state, reads URL state for date range + cycle offset.
- [x] **Integrations**: `<ProjectSummaryCard>` swapped into `fixed-overview.tsx`, `tm-overview.tsx`, `retainer-overview.tsx`. Each drops its old top metric grid + deprecated skeleton variant. Budget table, Monthly Breakdown accordion, Time Log, and all Alerts preserved.

### Verification

- [x] `npx tsc --noEmit` — 0 errors
- [x] `npx vitest run convex/lib/rates.test.ts convex/lib/__tests__/projectSummary.test.ts` — 50 tests pass
- [x] `npm run lint` on the new files — 0 errors (only unused-import warnings cleaned)
- [ ] Manual verification per billing type in dev browser (owner to confirm)
- [ ] Extra billed state on Fixed verified with a manually-crafted +manual line invoice
- [ ] Retainer mid-cycle overage verified by logging time past budget in a test retainer

### TODOs deferred to later phases

- **D1 — Proactive UX (G4)**: inline warning in Project Settings → Team when an admin adds a user with no cost rate in project currency; same on Settings → Rates for categories missing a rate. Non-blocking, prevents cryptic time-logger errors.
- **D2 — Old query deprecation**: `timeEntries.projectOverview`, `projects.getRetainerData`, `invoices.getProjectInvoiceMetrics` remain; touched when Budget table / Monthly Breakdown accordion / Invoices tab are refactored next.
- **Change-order data model for Fixed**: distinguish positive manual extras (change orders) from discount credits. Today both lump together; future model change would let the card mark out-of-scope revenue explicitly.
- **Ledger vs invoice reconciliation row**: no UI for this today; if users report divergence concerns we can surface a reconciliation badge on the Billed row.
- **Retainer "All cycles" lifetime view**: explicitly out of scope v1; only per-cycle.
- **FX conversion / multi-currency per project**: platform doesn't support this; the PRD gates on the D1 invariant (one currency per project) holding.

---

## Project Time Tab — Bonsai-style Refactor ✅ (2026-04-19)

> **Goal**: Rework the project detail **Time** tab to match Bonsai's agency time-tracking UX: top stats row, flexible grouping, inline billable toggle, row action menu, Add Time modal (with zero-tasks quick-create), header-level "Invoice Unbilled Hours" button, bulk mark billable/non-billable, and preset + custom date-range filter.
>
> PRD: [`docs/project-time-tab-bonsai-refactor-prd.md`](project-time-tab-bonsai-refactor-prd.md) (rev 3)
>
> **Key decisions** (from PRD §2/§10):
> - Default grouping: **By Day**; all six options (None, Day, Week, Month, Member, Task) URL-synced via `?groupBy=`.
> - Billable toggle fires immediate mutation + Undo toast that runs the reverse mutation — no delayed-commit layer (simplified from rev 2).
> - Edit modal allows changing the Task on non-invoiced entries; backend re-resolves category + rate snapshot on task swap.
> - Add Time admin member picker: project team first, "Show all org members" toggle appends the rest.
> - Date range filter: This week, Last week, This month, Last month, This year, All time, Custom (URL-synced via `dateRange` + `from`/`to`).
> - Bulk billable toggle reuses the existing `update` mutation in a client-side `Promise.all` loop; bounded by visible rows.
> - Stats row: T&M = 4 stats (Total / Billable / Unbilled Hours + Unbilled Amount); Fixed / Retainer = 3 stats (Total / Billable / Non-billable).
> - `getInvoicePreview` extended with optional `timeEntryIds` + T&M-only guard so preview and create contracts can't drift.

### Tasks

- [x] **Shared date helpers**: `lib/date-buckets.ts` — `bucketKey`, `bucketLabel`, `resolveDateRangePreset`, `todayInTimezone`. Pure string math; ISO-week ambiguity avoided by keying week buckets on the Monday date. Colocated Vitest suite (`date-buckets.test.ts`, 23 tests) covers year boundaries, DST-safe labels, and preset date arithmetic.
- [x] **Format helper**: `formatHoursCompact(minutes)` in `lib/format.ts` — `Xh Ym` output for the stats row.
- [x] **Convex date validation**: `convex/lib/dateValidation.ts` — round-trip `assertValidDateString`. Applied in `timeEntries.create`, `timeEntries.update`, `timer.ts` stopAndLog (replaces three weak `new Date()` checks that accepted `2026-02-30`).
- [x] **Backend — `timeEntries.update`**: validator extended with `taskId?`; on task change, backend re-validates same-project + non-archived, overwrites `snapshotCategoryId`, and re-resolves the rate cascade. Invoiced-entry block unchanged.
- [x] **Backend — `timeEntries.listProjectEntries`**: optional `fromDate` / `toDate` filter args for the new date-range toolbar.
- [x] **Backend — `tasks.listByProject`**: new lightweight query for the time-entry modal task picker. Members see only their assigned tasks; admins see all. Archived excluded.
- [x] **Backend — `invoices.getInvoicePreview`**: optional `timeEntryIds` arg with T&M-only guard to mirror `createInvoice`'s Path B contract.
- [x] **UI — `project-time-stats.tsx`** (new): adaptive 4/3 stats row + content-aware skeleton primitive.
- [x] **UI — `project-time-filters.tsx`**: reorganized to `[Members][Billing Status (T&M)][Date range][Group by][Search]`. Date-range custom picker opens a Popover with two `DatePicker`s. Group by Select is URL-synced (`day` default omitted).
- [x] **UI — `project-time-table.tsx`**: new Billing column with green/muted `$` inline toggle (aria-pressed, tooltip, immediate-mutation + Undo toast). Row ⋯ menu (Edit / Delete, both disabled with tooltip on invoiced rows). Checkbox column only renders when selection is enabled (admin + T&M).
- [x] **UI — `project-time-grouped.tsx`** (new): collapsible group headers with caret + calendar glyph on date groupings + right-aligned hour total. Keyboard-operable (`role="button"`, `aria-expanded`, Enter/Space). Collapse state is local; resets on `groupBy` change.
- [x] **UI — `time-entry-modal.tsx`** (new): create + edit modes. Task select editable in edit mode, read-only date/duration/billable/note on invoiced entries. Inline quick-create-task block shown when project has zero tasks (title + category + assignee, calls `api.tasks.create`). Admin member picker is project-team-first with "Show all org members" toggle. Duration field reuses `parseDuration` (accepts `1:30` / `1h 30m` / `90m` / `1.5`).
- [x] **UI — `project-time-selection-toolbar.tsx`**: added Mark Billable / Mark Non-Billable buttons (client-side `Promise.allSettled` over the selection, partial-failure toast). Create Invoice button now opens `CreateInvoiceModal` in selection mode instead of calling `createInvoice` directly.
- [x] **UI — `create-invoice-modal.tsx`**: new `timeEntryIds` prop drives a compact "selection summary" card (replaces period/preset inputs). Preview + create mutation both forward ids. Retainer and selection modes are mutually exclusive.
- [x] **UI — `project-time.tsx`**: orchestrator owns stats, filters, header action row (Invoice Unbilled Hours + Add Time), flat vs grouped table switch, and the invoice / time-entry modals. Admin gating for the selection column and toolbar. URL state for `member`, `billingStatus`, `search`, `groupBy`, `dateRange`, `from`, `to`.
- [x] **UI — `project-time-skeleton.tsx`**: content-aware skeleton now mirrors the new layout (stats row + 4 filter pills + header buttons + table rows).

### Verification

- [x] `npx tsc --noEmit` — 0 errors
- [x] `npx vitest run lib/date-buckets.test.ts` — 23 tests pass
- [x] `npm run lint` on new/modified files — 0 errors (pre-existing repo-wide warnings untouched)
- [ ] Manual verification in dev browser: Add Time, inline task quick-create on zero-tasks project, inline `$` toggle + undo, ⋯ Edit/Delete, header Invoice Unbilled Hours → `CreateInvoiceModal`, selection toolbar bulk mark + Create Invoice, date-range presets + custom popover, grouping switch

### TODOs deferred to later phases

- **Bulk category reassignment / bulk delete / bulk move-to-task** on the selection toolbar (v2 — beyond PRD §10.6 scope).
- **Row ⋯ → Duplicate entry** (out of scope per PRD §8).
- **Inline cell editing** (double-click on cell to edit without opening the modal) — deferred.
- **Keyboard shortcut** for Add Time (`N`, etc.) — deferred per PRD §8.
- **Deep-link quick-create** (`/tasks?project=<id>&create=1`) — follow-up polish; today inline quick-create solves the zero-tasks case in-place.
- **Mobile-responsive grouped layout** — out of scope (desktop-first per PRD §1 non-goals).
- **Pagination / virtualization** for very long flat lists — current flat list is fine for MVP scale; revisit when a single project exceeds ~1k visible entries.
- **Tags column** — out of scope until a tags model exists.
- **Bulk billable activity log entry** for the new bulk toolbar actions — per-entry activity log still fires on each `update`, but a single "bulk edit" summary isn't persisted today.

### Senior review round 1 ✅ (2026-04-19)

> **Goal**: Eliminate tech debt introduced during the Bonsai-style Time tab refactor. Senior-level pass for shadcn/Tailwind best practices, React correctness, and shared-helpers consolidation.
>
> **Scope**: 48 audit findings triaged into P0 / P1 / P2 / skip. 17 concrete changes landed; 11 findings intentionally skipped as false-positives or scope-creep.

**P0 — CLAUDE.md rule compliance:**
- [x] `<EmptyStateBanner>` extracted to `components/projects/empty-state-banner.tsx` — page orchestrator rule ("page files are thin orchestrators; every section goes in its own file").
- [x] **Audited** the `lastFilterKey` / `lastGrouping` setState-during-render pattern and verified it's the React-recommended "store info from previous renders" pattern (not a useEffect sync). CLAUDE.md only bans useEffect sync — the current pattern is explicitly allowed. No change.

**P1 — Tech debt / shadcn / Tailwind:**
- [x] **Date helpers consolidated** to `lib/format.ts`: new `formatDateToYMDOrUndefined` (nullable overload of existing `formatDateToYMD`), `parseYMDToLocalDate`, and `formatDateToUS`. Removed 4 duplicate `dateToString`/`stringToDate`/`formatDate`/`toDateString` local functions from `create-invoice-modal.tsx`, `invoice-document.tsx`, `project-time-filters.tsx`, `project-time-table.tsx`, and `time-entry-modal.tsx`.
- [x] **Billable colors tokenized** — replaced the hard-coded `text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100/60 dark:hover:bg-emerald-500/15` combo with the existing global `--success` semantic token (`text-success hover:bg-success/10`). One less arbitrary-color site in the codebase; auto-dark-mode-safe.
- [x] **Raw `<button>` → `<Button>` swept across the refactor**: `BillableToggleCell` (table `$` toggle), `RowActionsMenu` (⋯ trigger), `GroupHeader` (grouped-view caret row), `FilterPopover` (Clear all), `SelectionToolbar` (clear selection X), `EmptyStateBanner` (View invoices action), `TimeEntryModal` (Show all org members link). All replaced with proper shadcn variants (`ghost` / `link` / `icon`).
- [x] **Pure `groupTimeEntries` extracted** from `project-time-grouped.tsx` into `lib/time-entry-grouping.ts` as a generic `<T extends GroupableEntry>` helper. Colocated Vitest suite (`time-entry-grouping.test.ts`) with 9 tests covering day / week / month / member / task axes, within-group sort stability, and empty/missing-createdAt edge cases. Enables reuse outside the project Time tab if a similar grouping lands later (e.g. reports).

**P2 — Architecture & safety:**
- [x] **`ProjectTimeContext` provider** at `components/projects/project-time-context.tsx`. Context carries `projectId`, `project`, `isAdmin`, `currentUserId`, `orgMembers`, `categories`, `timezone`. Eliminates prop-drilling through `TimeEntryModal`, `ProjectTimeTable`, `ProjectTimeGrouped`, `ProjectTimeSelectionToolbar`. Net: `TimeEntryModal` public props dropped from 8 → 3 (`open`, `onOpenChange`, `mode`+`entry`).
- [x] **Thin-wrapper collapse**: deleted `AddTimeModal`, `EditEntryModal`, and `RowEditTable` pass-through components from `project-time.tsx`. `TimeEntryModal` is now rendered directly with `mode` and `entry` props (no intermediate wrapper). Saves ~60 LOC of bookkeeping.
- [x] **In-flight guard on `BillableToggleCell`** via `useRef` — prevents double-firing the update mutation if a user spam-clicks the toggle. The undo-toast mutation also runs through the same guard.

**Skipped (audit false positives / scope creep):**
- Audit flagged the setState-during-render pattern as an anti-pattern; confirmed with React docs and CLAUDE.md that it's actually the recommended pattern for "reset state when prop changes" (useEffect is what's banned, not this).
- Checkbox `e.stopPropagation()` flagged as coupling — standard composite-row pattern, left as-is.
- Search `aria-label`-only input flagged for missing visible label — aria-label is sufficient for a secondary control with an icon affordance.
- Filter vs selection URL/local asymmetry flagged — agent self-admitted "current design is correct; no change needed."
- `IconBadge` component extraction — premature; only one use site in the codebase.
- Additional DST/boundary tests for date-buckets and a separate test file for `dateValidation` — deferred; the existing suite already covers the critical cases.

**Verification:**
- [x] `npx tsc --noEmit` — 0 errors.
- [x] `npx vitest run lib/date-buckets.test.ts lib/time-entry-grouping.test.ts lib/format.test.ts` — 72 tests pass.
- [x] `npm run lint` on touched files — 0 errors.

---

## Phase 8: Workday — Weekly Team View ✅ COMPLETE (2026-04-26)

> **Goal**: Read-only weekly grid at `/workday` showing every team member's logged work as colored, calendar-style boxes. Admin sees full team grid with member filter; member sees only own row. URL-persisted week / users / weekend toggle.
>
> **Scope**: 9 vertical tracer-bullet slices (`docs/workdays-issues/`). Schema → query → page → header (week picker, member filter, weekend toggle) → manual-log "Started at" chip → hover popover → click-to-drawer → adaptive box tiers + visual polish → overtime + edge cases.
>
> **Companion docs**: `docs/workdays-prd.md` (product spec), `docs/workdays-plan.md` (impl plan + verification checklist), `docs/workday-prototype.html` (visual reference).

### Schema + mutations
- [x] `convex/schema.ts` — `timeEntries.startedAt: v.number()` required (epoch ms; end derived as `startedAt + durationMinutes*60_000`).
- [x] `convex/timer.ts:commitEntry` — writes `startedAt = Date.now() − rounded*60_000` (synthetic; original-first-start through pause/resume tracked as v2+ improvement).
- [x] `convex/timeEntries.ts:create` — accepts required `startedAt`. All callers (`task-detail-time`, `time-log-popover`, `projects/time-entry-modal`) thread the value through.
- [x] `convex/migrations/wipeAllTimeEntries.ts` — one-shot wipe (run before pushing the schema change). Wipe-and-reseed sanctioned by memory `project_mvp_dummy_data.md`.

### Backend query
- [x] `convex/workday.ts:weekGrid({ startDate, endDate, userIds? })` returning `{ users: [{ user, totalMinutes, days: [{ date, totalMinutes, boxes: [{ taskId, taskTitle, project*, category*, totalMinutes, firstStart, entries[] }] }] }] }`.
- [x] Multi-tenancy: filters by `orgId` first via `by_orgId_date` index. Member auto-scoped to own `userId`; admin's `userIds` filter narrows the result.
- [x] Single round-trip hydration of users → tasks → projects → clients → categories. Members with zero entries still get a row (preserves team awareness).
- [x] Boxes within a day sorted by `firstStart` asc; entries within a box sorted by `startedAt` asc.

### Hooks
- [x] `lib/hooks/use-week-picker.ts` — pure date helpers (`startOfWeek`, `addDays`, `sameWeek`, ISO-week parse/format, `formatRange`, `weekRange`, `formatYMD`, `buildMonthGrid`, `useMonthGrid`). 25 vitest cases (DST, year-boundary `2025-W01` / `2026-W53`, `sameWeek` across timezone shifts, 6×7 grid generator).
- [x] `lib/hooks/use-workday-query-args.ts` — single source of truth for URL state: reads/writes `?week=YYYY-Www`, `?users=a,b`, `?weekend=1`. Setters merge into existing search params (no clobber). Filter toggles use `router.replace` (history hygiene); week navigation uses `router.push`.

### Components (`components/workday/`)
- [x] `workday-grid.tsx` — composed header strip + per-user rows with shared `grid-template-columns`. Empty-week renders `<WorkdayEmptyState>` while keeping member rows visible.
- [x] `workday-user-row.tsx` — 200 px identity column (avatar + name + role + week total + "this week"), then day cells.
- [x] `workday-day-cell.tsx` — flex-stack of boxes (1h = 40px height-scale), today-cell vertical accent gradient, weekend tint, day-total footer with overtime visuals.
- [x] `workday-task-box.tsx` — adaptive content tiers: ≥60 px (title + duration + project), 36–59 px (title + duration), 18–35 px (title only), <18 px sliver (50% tint, no text). `color-mix` tint at 11% → 18% on hover (50% on slivers). 6×6 category dot top-left. Focus ring `outline: 2px solid var(--cat-color); outline-offset: -1px`. Per-box CSS var consumed by the focus rule.
- [x] `workday-task-popover.tsx` — Notion-style hover card (200 ms open delay): header (cat dot + task title + project · category), monospace time-range entries with sans-serif notes + billable dot ring, "Total today" footer.
- [x] `workday-header.tsx` — title + sub left, controls right (week picker / member filter (admin-only) / weekend toggle), separated by 1 × 18 px hairline dividers.
- [x] `workday-week-picker.tsx` — `◀ [Apr 21 – 25 ▾] ▶` + 320 px calendar popover with whole-week-row hover, today dot, "Jump to this week" footer.
- [x] `workday-member-filter.tsx` — searchable popover, 22 px `<UserAvatar>` + name + role per row, Select all / Clear footer (clear = "all members" per story 33).
- [x] `workday-weekend-toggle.tsx` — Notion-style switch wired to URL state.
- [x] `workday-empty-state.tsx` — composes shared `<EmptyState>` (memory `feedback_no_custom_components.md`).
- [x] `workday-grid-skeleton.tsx` — content-aware skeleton with the same column widths and row heights as the grid.

### Page + nav
- [x] `app/(dashboard)/workday/page.tsx` — thin orchestrator under 200 lines. Stale-while-revalidate `useRef` (matches `app/(dashboard)/tasks/page.tsx` pattern) so member-filter / week / weekend toggles don't flicker the skeleton.
- [x] `app/(dashboard)/workday/loading.tsx` — route-level skeleton mirroring header + grid scaffold.
- [x] `lib/navigation.ts` — added Insights group (Workday + Reports). Reports moved out of Finance per memory `feedback_one_pr_refactors.md` (bundled refactor).
- [x] Drawer integration: page renders `<TaskDetailDrawer>` / `<TaskDetailModal>` based on user `taskDetailView` pref. `taskIds` prop receives the visible week's de-duplicated task IDs sorted by `firstStart` (scan order). `useTaskDetail.navigateToTask` wires box-click → drawer.

### Manual-log "Started at" chip
- [x] `components/tasks/time-log-popover.tsx` — chip below the Date row. Default `Just now` (`now − duration`); presets `15 minutes ago` / `30 minutes ago` / `1 hour ago` / `Pick a time…`. Custom mode reveals an inline `<input type="time">` combined with the popover's selected date. All math computed during render — no `useEffect` sync.

### Edge cases (slice 9)
- [x] Per-cell empty hint: muted "No work logged" top-aligned inside the day-stack when the cell has zero entries.
- [x] Week-level empty state: centered `WorkdayEmptyState` rendered above member rows when the entire visible grid has zero entries (rows still visible).
- [x] Overtime visuals: day total >8h renders in `text-destructive` with a `+Xh` pill; an "8h" hairline marker draws at the 320 px capacity line; day-stack auto-grows past 320 px (flex-stack — no clipping).

### Verification (slice 9 gate)
- [x] `npx tsc --noEmit` — 0 errors.
- [x] `npm run lint` — repo baseline preserved (1250 problems; 0 new in workday/hook/component files).
- [x] `npx vitest run lib/hooks/use-week-picker.test.ts` — 25/25 pass.
- [x] Convex dev console: `weekGrid` runs cleanly (manual smoke).
- [x] Member auto-scope: signed-in member sees only own row, no member-filter button visible.
- [x] Cross-tenant isolation: admin in another org sees zero leaks (server enforces by `orgId` index + auto-scope; client filter cannot bypass).
- [x] URL round-trip: `?week=…`, `?users=…`, `?weekend=1` all preserved on refresh + back/forward.
- [x] Click box → drawer opens at that task; popover row click also opens drawer at the task.
- [x] Drawer prev/next steps through visible-week task IDs in scan order.
- [x] Adaptive box tiers verified across mixed durations (5m / 25m / 45m / 90m render at correct tiers).
- [x] Today column: day name + number both in primary; subtle vertical accent gradient on today cells.
- [x] Loading skeleton matches final layout dimensions — no jump on load.

### TODOs deferred to later phases

**v2+ (data model already supports them — gating is product/UX scope)**:
- Drag a box between days to move an entry's date.
- Drag in empty grid space to inline-create a new entry (requires hour-grid view).
- Drag a box edge to resize duration.
- Click empty space → inline-create entry.
- Click box → inline-edit title / duration / category.
- Hour-grid view mode (Google Calendar-style, hour rulers, lane-management for overlapping wall-clock entries).
- Calendar integration (Google Calendar sync) — `startedAt` is now ready; sync code is the missing piece.
- Overlap detection / warning when two entries on the same user collide in time.
- Per-user weekly capacity overrides — v1 hardcodes 8h for everyone.
- PTO / out-of-office row labels — v1 just shows zero, not "Off."
- Project / category / billable filters on the workday page — v1 ships member + weekend only.
- Workday-level analytics (utilization heatmap, weekly trend, capacity planning).
- Pagination beyond 5k entries/week/org — back-pocket plan documented in `convex/workday.ts`; not implemented.
- Localization (Sunday-first locales, 12-hour clock, translated day names).

**Open items from PRD §"Open Questions"**:
- **Entry-level deep-link in the drawer's Time tab** (`?task=…&entry=…`): the page pushes `?task=…` only; entry-scroll requires drawer-side support that doesn't exist yet. Acceptable v1 fallback per PRD.
- **Pause/resume start-time semantics**: `commitEntry` writes synthetic `startedAt = Date.now() − elapsedMs`. Tracking original-first-start through pauses requires a small follow-up if calendar integration ever needs wall-clock fidelity.

**Test infrastructure gap**:
- Convex integration tests for `weekGrid` (cross-tenant isolation, member auto-scope, overtime totals not clipped) — repo has no `convex-test` harness yet. Acceptance criteria 8 / 9 in slices 1, 2, 4 left unchecked. Add when the harness lands.

## TipTap Task List Clipboard Interop ✅ (2026-05-01)

Two-layer interop fix because Notion and Google Docs largely ignore foreign HTML on paste — they read text/plain and run their own markdown parser.

**Layer 1 — HTML interop** (`components/tasks/portable-task-list.ts`): replaced default `TaskList` / `TaskItem` with `PortableTaskList` / `PortableTaskItem`. Override `renderHTML` to emit GFM-flavored HTML (`<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox">…</li></ul>`). Bigger `parseHTML` accepts GFM `li.task-list-item` and any `<li>` whose direct child (or `<label>` child) is `<input type="checkbox">`. Targets HTML-aware editors (GitHub, Linear, Obsidian).

**Layer 2 — markdown clipboard** (`components/tasks/markdown-clipboard.ts` + `@tiptap/markdown`): adds a `MarkdownClipboard` extension that registers `clipboardTextSerializer` to write GFM markdown into text/plain on copy, and a `handlePaste` that detects task-list patterns in pasted text/plain (including normalizing Google Docs' ☐/☑ unicode glyphs to `- [ ]` / `- [x]`) and parses them via `editor.markdown.parse`. Targets editors that prefer plain text (Notion, Google Docs, Slack).

In-editor rendering is unchanged — TaskItem's NodeView still drives the viewport, and the CSS is untouched.

### TODOs deferred

- **Notion's text/plain markdown for to-dos** is not GFM standard — it uses leading bullets like `- ` followed by checkbox glyphs in some cases. If round-tripping from Notion misses items, expand `normalizeUnicodeCheckboxes` in `markdown-clipboard.ts`.

---

## Invoicing Refactor — One Document Per Period (2026-05-02)

> **Goal**: One document per closed retainer period. Overage > $0 → numbered invoice (lifecycle, pay this). Overage = $0 → on-demand "Monthly Report" (no number, no lifecycle, FYI). Monthly retainer fee is collected by Stripe — never billed here. `/invoices` Ready feed shows only periods that need an invoice.
>
> **Companion docs**: `docs/invoicing-refactor.md` (PRD), `docs/invoicing-refactor-issues/01-overage-only-invoices.md`, `…/02-monthly-report-rebrand.md`, `…/03-cutover-wipe-reseed-verification.md`.

### Issue #01 — Overage-only invoices + Stripe disclaimer
- [x] Schema — drop `v.literal("retainer_fee")` from `invoiceLineItems.lineType` union (`convex/schema.ts`).
- [x] `computeRetainerBalance` — `total = overageAmount` (monthly fee returned as separate context field). `convex/lib/retainerBalance.ts` + `retainerBalance.test.ts` updated.
- [x] `buildRetainerMonthlyReadyRows` / `buildRetainerCycleReadyRows` — drop within-budget rows, drop `invoiceTotal` plumbing. `convex/lib/readyToInvoice.ts` + `readyToInvoice.test.ts`.
- [x] `isInvoiceable` predicate — simplified to `row.amount > 0`. Single source of truth for batch-select gating.
- [x] `createInvoice` (retainer branch) — early throw on within-budget retainer with the user-facing `NO_OVERAGE_MESSAGE`. Rollover branch scopes time entries to the entire cycle and writes a single Overage line item. `convex/lib/invoiceCreation.ts` + `invoiceCreation.test.ts`.
- [x] `getRetainerInvoicePreview` — `total` returns overage only; `monthlyFee` returned as separate context field (no `retainer_fee` preview row).
- [x] Monthly Breakdown card — single primary action per row (invoice number link, "Generate", or "Download report"). Stripe disclaimer line below the card title (D11). `components/projects/monthly-breakdown-card.tsx`.
- [x] `CreateInvoiceModal` — deleted (D10). Click "Generate" → draft created → navigate to draft page. Hook lives at `lib/hooks/use-generate-invoice.ts`.
- [x] Invoice document — drops "Retainer fee" line, adds Stripe disclaimer context, renders activity summary prominently.

### Issue #02 — Monthly Report rebrand + in-progress support + `/reports` removal
- [x] Pure helper `classifyReportPeriod(year, month, todayStr)` returning `"past" | "current" | "future"`. `convex/lib/reportPeriod.ts` + `reportPeriod.test.ts` (3 branches).
- [x] `getRetainerStatement` query — accepts current month + adds `inProgress` flag (true for current month, false for closed, null for future). Cycle-to-date block returned for rollover projects (cycleStart, cycleEnd, includedMinutes, usedMinutes, balanceMinutes). Server symbol kept as-is per Open Question 1.
- [x] `MonthlyReportDocument` — replaces `StatementDocument`. Header text "Monthly Report" (D8). NO AMOUNT DUE block under any branch. Stripe disclaimer line. "In progress — partial data" badge when `inProgress: true` (badge only — no other UI affordance per Open Question 3). Cycle-to-date section for rollover projects (user story 17).
- [x] Route URL `/projects/[id]/statements/[period]` → `/projects/[id]/reports/[period]` per Open Question 2. All in-app links updated. Direct-URL probe → `notFound()` for future months.
- [x] Monthly Breakdown "Download report" — opens in a new tab (`target="_blank"`) so the owner can use the browser's native Print → Save as PDF dialog (user story 18).
- [x] `/reports` global route deleted. Reports nav entry removed from `lib/navigation.ts` (D13). Direct URL → 404.
- [x] Stale `retainer_fee` literal removed from codebase (`convex/lib/projectSummary.ts` LineItemInput type, comment in `convex/invoices.ts`, comments in `components/invoices/invoice-billing-summary.tsx` + `invoice-document.tsx`).
- [x] Inbox empty-state copy refers to "downloadable monthly reports" instead of "statements".

### Issue #03 — Cutover (HITL — pending user)
- [x] Wipe migration written: `convex/migrations/wipeInvoicingForRefactor.ts`. Run from the Convex dashboard with `npx convex run migrations/wipeInvoicingForRefactor:default '{"confirm":"WIPE_INVOICING_FOR_REFACTOR"}'`. Drains `invoices` → `invoiceLineItems` → `retainerPeriods` in 500-row batches; auto-advances tables.
- [ ] Confirm with user that the dev/dummy data is OK to wipe, then run the migration.
- [ ] Reseed through the app UI (or your existing dev-org seed flow) covering: monthly within-budget closed, monthly over-budget closed, rollover mid-cycle, rollover cycle-end with overage, rollover cycle-end within budget, T&M with billable hours, Fixed with remaining balance, in-progress current month.
- [ ] Run the verification list below end-to-end.

### Verification (Definition of Done)
- [x] `npx tsc --noEmit` returns 0 errors.
- [x] `npx vitest run` — all updated and new tests pass (pre-existing failures in `lib/format-activity-timestamp.test.ts`, `convex/lib/__tests__/taskActivityIndicators.test.ts`, and `.reference/tiptap-docs/...` are out of scope).
- [x] `npm run build` succeeds.
- [x] No `retainer_fee` literal remains in codebase (`rg "retainer_fee"` zero matches outside `docs/`).
- [ ] DB wipe + reseed verified: no `retainer_fee` line items remain.
- [ ] Zero retainer rows in `/invoices` Ready for within-budget projects.
- [ ] `/invoices` tabs (Ready / Draft / Sent / Paid / Overdue) all render and function as before.
- [ ] Monthly Report download works for every closed retainer period (mid-cycle and cycle-end, rollover and non-rollover).
- [ ] Monthly Report renders for in-progress current month with "In progress — partial data" badge.
- [ ] Stripe disclaimer line visible on retainer Project pages.
- [ ] Generate invoice: clicking Ready row → lands on draft page (no modal).
- [ ] Within-budget rows on Monthly Breakdown card show only "Download report" — no Generate invoice.
- [ ] Overage rows on Monthly Breakdown card show only "Generate invoice" (or invoice number link if billed) — no secondary statement download.
- [ ] Voiding an overage invoice causes the period to reappear in Ready. Voided invoice remains visible in the Voided tab with audit trail.
- [ ] T&M and Fixed Price flows demonstrate no behavioral change vs. pre-refactor.
- [x] `/reports` global route removed from nav and unreachable via URL.

### TODOs deferred to later phases
- **One-click "Send" via Resend** — auto-send the right artifact per period (invoice if overage, report if not). Backlog only; no cron, no Resend infra in MVP.

---

## Phase 8 — Time Entry Settlement ✅ COMPLETE (2026-05-24)

> **Goal**: Fix the reporting bug where within-budget retainer periods (and Fixed projects) leave time entries forever "open / not invoiced". Split *invoice linkage* from *client-facing work closure* via a lightweight settlement model on `timeEntries` + 2 new admin-action fields on `retainerPeriods`.
>
> **PRD**: `docs/phase-8-time-entry-settlement.md`
>
> **Slice plan**: 4 vertical slices. Slices 1 + 2 run in parallel; 3 blocks on both; 4 closes out the phase.
> - `docs/phase-8-slice-1-settlement-foundation.md` — T&M + Fixed + void settlement end-to-end ✅
> - `docs/phase-8-slice-2-retainer-cycle-extraction.md` — refactor + `isMonthClosed` rename ✅
> - `docs/phase-8-slice-3-period-close-reopen.md` — retainer within-budget close + write guard ✅
> - `docs/phase-8-slice-4-cycle-close-and-ui-polish.md` — rollover cycle close + drill-down + entry-list polish ✅

### Slice 1 — Settlement foundation + invoice transitions ✅ (2026-05-24)

The T&M / Fixed / void axis of the settlement model. After this slice, finalizing any invoice stamps its entries with `settledAt` + `settledReason`; voiding (or deleting, or reverting to draft) unsettles them per the transition table. The entry-edit/delete guards key on both `invoiceId` AND `settledAt`. A backfill mutation brought existing dummy invoices forward into the new model.

Retainer within-budget close (the headline ❌ bug) stays for Slice 3 — Slice 1 only handles the invoice-anchored paths.

- [x] Schema — added `settledAt`, `settledReason` (3-value enum: `invoiced` / `retainer_included` / `fixed_included`), `settledPeriodStart`, `settledPeriodEnd` to `timeEntries`. No new indexes; canonical-set rule documented inline.
- [x] New `convex/lib/settleEntries.ts` — `settleInvoiceEntries(ctx, invoiceId, orgId, periodStart?, periodEnd?, reason="invoiced")` and `unsettleInvoiceEntries(ctx, invoiceId, orgId, { clearInvoiceId? })`. Both walk via `invoiceLineItems.by_invoiceId` (no new index), enforce tenancy, and respect the canonical-set invariant (only entries referenced by a line item AND carrying matching `invoiceId` are touched).
- [x] `entryStatus(e)` derived helper — `!isBillable → non_billable`, `invoiceId && !settledAt → draft`, `settledAt → closed`, else `open`. 9 unit tests covering all reason values + invariants. Settled non-billable still displays `non_billable` (Revision Pass #5).
- [x] `applyStatusTransition` in `convex/invoices.ts` wired per the PRD's transition table: `draft → invoiced` settles (Fixed → `fixed_included`, else `invoiced`); `→ void` unsettles + clears `invoiceId`; demotions back to `draft` unsettle but keep `invoiceId` so entries display as `draft`. `paid → void` remains disallowed (existing `VALID_TRANSITIONS`).
- [x] `deleteInvoice` — inline unlink loop replaced with `unsettleInvoiceEntries({ clearInvoiceId: true })`. Same tenancy + canonical-set guarantees, plus clears the four settlement fields so a previously-settled entry doesn't carry stale snapshot data forward.
- [x] `timeEntries.update` / `timeEntries.remove` / `bulkUpdateBillable` — all three guards now key on `invoiceId || settledAt`. Distinct error messages for invoice-link vs settled-no-invoice so the unblock path is obvious.
- [x] `listProjectEntries.billingStatus` enum extended: `open` / `draft` / `closed` / `non_billable` (was `billable_uninvoiced` / `invoiced` / `non_billable`). Filter logic mirrors `entryStatus()` exactly. `Row` shape gained `settledAt` / `settledReason` / `settledPeriodStart` / `settledPeriodEnd` so Slice 4's tooltips and drill-down read straight from the query.
- [x] `projectOverview` shape renamed and extended (T&M-oriented entry buckets):
  - `uninvoicedMinutes/Amount` → `openMinutes/Amount`
  - `invoicedBillableMinutes/Amount` → `invoicedMinutes/Amount`
  - NEW `settledMinutes/Amount` — sum of `retainer_included` + `fixed_included`
  - Existing Fixed-specific `invoicedAmount` (sum of `lineType: "fixed"` line items) renamed to `fixedLineItemsAmount` to dodge the name collision; zero external readers.
- [x] All 8 consumer files updated: [convex/timeEntries.ts](convex/timeEntries.ts), [convex/lib/__tests__/projectOverview.test.ts](convex/lib/__tests__/projectOverview.test.ts), [components/projects/tm-overview.tsx](components/projects/tm-overview.tsx), [lib/invoice-banner-view.ts](lib/invoice-banner-view.ts) + [.test.ts](lib/invoice-banner-view.test.ts) (banner kind `tm` field rename), [components/invoices/project-invoices.tsx](components/invoices/project-invoices.tsx) + [project-invoices-payment-cards.tsx](components/invoices/project-invoices-payment-cards.tsx) (prop rename `uninvoicedAmount` → `openAmount`), [components/projects/project-time.tsx](components/projects/project-time.tsx) + [project-time-filters.tsx](components/projects/project-time-filters.tsx) (filter enum rename, dropdown options).
- [x] **Invoice-predicate audit (Revision Pass #4)** — every `invoiceId` billing predicate reclassified:
  - `convex/lib/readyToInvoice.ts:213` — added `|| e.settledAt` so settled hours can't bubble back into the Ready feed.
  - `convex/lib/projectSummary.ts:192` — `billed` bucket now keys on `invoiceId || settledAt` (a retainer-included hour is "billed" via the monthly fee, not "unbilled").
  - `convex/invoices.ts:880, 1355` — `createInvoice` candidate-entry filters now exclude `settledAt` so a Fixed-included or retainer-included hour can't be double-billed.
  - `convex/timeEntries.ts:526` — `bulkUpdateBillable` skip predicate covers both axes.
  - `components/projects/project-time-stats.tsx`, `project-time-selection-toolbar.tsx`, `time-entry-modal.tsx` — "unbilled" / "flippable" / `isLocked` predicates updated.
  - Upstream `EntryInput`/`TimeEntryInput` shapes in `projectSummary.ts` and `readyToInvoice.ts` gained `settledAt`; the two callsites in `convex/projects.ts:895` and `convex/invoices.ts:550` pass it through.
- [x] `convex/lib/settleEntries.ts → backfillSettledFromInvoiceId` internalMutation — walks every entry, stamps `settledAt`/`settledReason`/`settledPeriodStart/End` for entries linked to finalized invoices. Idempotent. Per-project `billingType` cache. Run with `npx convex run lib/settleEntries:backfillSettledFromInvoiceId` once after deploy.
- [x] 9 new tests for `entryStatus()`. All 99 retainer + settlement tests green (49 retainerBalance + 17 retainerCycle + 17 retainer-row-action + 7 projectOverview + 9 settleEntries = 99). Same 4 pre-existing failures (tiptap vendor / activity timestamp / task indicators) remain — untouched by this diff.
- [x] `npx tsc --noEmit` clean. Lint clean on every touched file (2 pre-existing `any` errors at `convex/invoices.ts:1022, 1104` from commit `cd496708` April 19 are out of scope).

#### Slice 1 review fixes (follow-up commit, 2026-05-24)

Self-review of the initial Slice 1 commit surfaced several issues. All addressed:

- [x] **C1 — Convex transition tests** (`convex/__tests__/invoiceTransitions.test.ts`, 7 tests) — installed `convex-test` + `@edge-runtime/vm`. Tests cover all 5 cases the PRD called for: T&M draft→invoiced, Fixed draft→invoiced (reason="fixed_included"), invoiced→void (unsettle + clear), invoiced→draft (unsettle + keep), and `timeEntries.update`/`remove` rejection on settled entries with the right error strings. Per-file `// @vitest-environment edge-runtime` keeps the rest of the suite on `jsdom`.
- [x] **C2 — `markInvoicesPaid` / `undoMarkInvoicesPaid` routed through `applyStatusTransition`** — these previously did a direct `ctx.db.patch(id, {status, paidAt})`. Functionally safe today (the only transitions they fire are invoiced↔paid, neither of which changes settlement per the PRD table) but brittle: a future widening of `classifyMarkPaid` would silently bypass settle/unsettle. Now central.
- [x] **C3 — projectOverview `draftMinutes/Amount` bucket added** — the PRD's strict 3-bucket model had no slot for billable entries on a draft invoice. My initial commit invented a "draft → invoiced bucket" rule, which inflated revenue figures. Fixed: now 4 buckets (open / draft / invoiced / settled), 1:1 with `entryStatus()`. New `billableOverviewBucket(e)` pure helper makes the routing testable without convex-test.
- [x] **C4 — Backfill execution flagged as user action** — see "Action required" below.
- [x] **H1 — projectOverview bucket math tested** — 6 new tests in `convex/lib/__tests__/settleEntries.test.ts` covering all four routing branches + a "settledReason wins over invoiceId" regression case + cross-mode invariants.
- [x] **H2 — `fixedLineItemsAmount` rename flagged** — see callout below.
- [x] **M1 — `backfillSettledFromInvoiceId` relocated to `convex/settleEntries.ts`** (top-level, not under `lib/`). Convention: `lib/` holds pure helpers; deployed mutations live at `convex/<domain>.ts`. PRD code sample placed it correctly; I had diverged. New run command: `npx convex run settleEntries:backfillSettledFromInvoiceId`.
- [x] **M2 — `SettledReason` consolidated to one definition** — single `settledReasonValidator` (Convex `v.union`) exported from `convex/lib/settleEntries.ts`; `SettledReason` TS type derived via `Infer<typeof ...>`. The schema imports the validator instead of redefining it. Adding a future `"manual_close"` value means editing ONE place.
- [x] **M3 — shared `EntrySettlementSnapshot` type in `convex/lib/types.ts`** — the four settlement fields previously lived in three duplicated definitions (schema, listProjectEntries `Row`, TimeEntryRow component type). Now defined once and referenced via type intersection.
- [x] **M4 — `applyOverageRule` and `assertRetainerInvoiceable` reconciled via shared `isOverageDueForScope` predicate** — both `computeRetainerBalance` (invoice-side) and `applyOverageRule` (read-side) now call the SAME literal predicate exported from `retainerBalance.ts`. No more parallel implementations that can drift.
- [x] **M5 + L1 + L2 — dead null-check removed, predicate forms standardized, docstring fixed** — `invoice.projectId ? ... : null` defensive check (schema requires the field) replaced with a comment explaining the only failure mode. Lock predicates standardized on `=== undefined` form across the 5 Slice 1 audit sites. `lib/retainer-row-action.ts` docstring no longer overloads "closed" colloquially.

**⚠️ Action required — backfill not yet run**

Existing finalized invoices in the dev dataset have entries with `invoiceId` set but no `settledAt`/`settledReason`. Until the backfill runs:
- `projectOverview.settledMinutes` will read `0` for Fixed projects whose hours should appear as "covered".
- `entryStatus()` will return `"draft"` instead of `"closed"` for those locked hours.
- Reports + the upcoming Slice 4 drill-down will show wrong numbers on historical data.

Run once against your dev deployment:

```bash
npx convex run settleEntries:backfillSettledFromInvoiceId
```

It's idempotent (skips already-settled entries) and logs the count of touched / skipped rows. Safe to re-run.

**⚠️ Breaking-shape callout — `projectOverview.invoicedAmount` semantics changed**

Before Slice 1 this field meant "sum of `lineType: 'fixed'` line items across this Fixed project's invoices" (line-item derived). After Slice 1 the SAME field name means "billable entry minutes × `billableRate` for entries with `settledReason: 'invoiced'`" (entry-derived). The old Fixed-specific value is preserved under the new name **`fixedLineItemsAmount`** — any client reading the old `invoicedAmount` for Fixed projects will now silently get a different number. Today's audit found zero consumers reading it, but anyone adding a new client-side reader should pick the correct field for their use case.

### Slice 2 — Retainer cycle extraction + `isMonthClosed` rename ✅ (2026-05-24)

Behavior-preserving refactor that consolidates the cycle math and renames the overloaded `isMonthClosed` flag. No entries are settled by this slice — `closedAt`/`closedBy` ship as optional schema fields, populated by Slice 3/4. The 3-state pill (`In progress` / `Open` / `Closed`) renders the new lifecycle even though `Closed` won't fire on real data until Slice 3 lands a Close button.

- [x] Schema — added `closedAt: v.optional(v.number())` and `closedBy: v.optional(v.id("users"))` to `retainerPeriods`. Naming matches the existing `createdBy` convention (no `UserId` suffix). No new indexes; the existing `by_projectId_periodStart` is sufficient.
- [x] New `convex/lib/retainerCycle.ts` with `getCyclePeriods` (pure boundary builder), `computePeriodOverageContext`, `computeCycleOverageContext` (async, DB-backed). All three share an internal `applyOverageRule` helper so the rollover-vs-non-rollover predicate is defined once and consumed identically by read path, period-close, and cycle-close.
- [x] `getRetainerData` refactored to consume `getCyclePeriods` (replacing ~50 lines of inlined cycle math). `resolveRetainerCycleContext` in `getSummary` also delegates to the shared helper — second inlined implementation dies.
- [x] `isMonthClosed` split into `periodEnded` (calendar) + `isClosed`/`closedAt` (admin) on each `getRetainerData` month row. `balanceStatus` continues to key on `periodEnded` (financial due-ness stays calendar-driven). `lib/retainer-row-action.ts` overage-bill gate also keyed on `periodEnded` — critical that billing overage does NOT require an admin Close first.
- [x] `components/projects/monthly-breakdown-card.tsx` — `billingStateOf` → `lifecycleStateOf` (3-state pill: `in_progress` neutral / `open` blue / `closed` green). Header counter relabeled "N/N months ended". `AmountCell` derives over-budget signal from `endBalance` directly now that the pill no longer carries the budget axis.
- [x] Unit tests for `getCyclePeriods` (monthly + rollover + year-wrap + offset navigation + null cycle) and `applyOverageRule` (all three modes + invariants). 17 new tests, all green. Existing `retainerBalance.test.ts` (49 tests) untouched and still green.
- [x] `npx tsc --noEmit` clean. Lint clean on touched files.

**Note**: pre-existing test failures in `lib/format-activity-timestamp.test.ts`, `convex/lib/__tests__/taskActivityIndicators.test.ts`, and `.reference/tiptap-docs/…` are unrelated to this slice (untouched files; failures predate this work).

### Slice 3 — Period close/reopen + backdated-entry guard ✅ (2026-05-24)

Closes out the retainer-within-budget ❌ row of the parent PRD's Problem Statement (the headline bug — "entries appear open forever in stats and filters"). After this slice, an admin can review an ended within-budget month's report, confirm `Close period`, and the month's entries flip to `Closed` with `settledReason: "retainer_included"`. Reopen reverses just that month. Logging time into a closed period is rejected from all three write paths.

Cycle-level close for rollover projects stays deferred to Slice 4 — this slice only handles single monthly periods. Rollover-monthly close is unblocked because rollover overage is cycle-level, not monthly.

- [x] **`convex/retainerPeriods.ts → closePeriod`** — admin-only mutation, accepts the natural UI key `{ projectId, periodStart }`. Extracted `ensureRetainerPeriodInternal` upserts the row inside the handler so the UI can call close for any month visible in the Monthly Breakdown without pre-creating a `retainerPeriods` row (Revision Pass #8). Two-gate flow via pure `evaluateCloseGate`: (1) `computePeriodOverageContext` from Slice 2 rejects when `isOverageDue` (single source of truth with `assertRetainerInvoiceable`); (2) belt-and-suspenders `findConflictingInvoice` rejects when any non-void invoice's period overlaps the close range. Settles entries via task fan-out (acknowledged N+1, same pattern as `convex/lib/retainerCycle.ts:sumBillableMinutes`) with `shouldSettleEntry` as the per-entry inclusion rule. Patches the period row with `closedAt` + `closedBy`. Body extracted as `closePeriodInternal` so Slice 4's `closeRetainerCycle` will reuse it verbatim.
- [x] **`convex/retainerPeriods.ts → reopenPeriod`** — same ensure-then-load flow. Reverses only entries whose `(settledReason, settledPeriodStart, settledPeriodEnd)` triple matches `("retainer_included", period.periodStart, period.periodEnd)` — the per-month-boundary criterion that makes per-month reopen unambiguous even after Slice 4 writes the same `closedAt` across N monthly periods of a rollover cycle. Clears `closedAt`/`closedBy` on the period row.
- [x] **`convex/lib/settleGuards.ts` (new)** — `assertEntryDateOpen(ctx, project, date)` matches the parent PRD code sample verbatim: short-circuits on non-retainer, walks `retainerPeriods.by_projectId_periodStart` with an in-DB filter on `periodStart ≤ date ≤ periodEnd && closedAt !== undefined`, throws `ConvexError("Cannot log time in a closed retainer period. Reopen the period first.")` if any match. Exports a pure `pickClosedCoveringPeriod` for unit testing the date-coverage rule.
- [x] **Guard wired into all three write paths** (Revision Pass #3a): `convex/timeEntries.ts:create` after the date is derived from `startedAt`; `convex/timer.ts:commitEntry` after its own date derivation (the path the original PRD missed); `convex/timeEntries.ts:update` when `date` OR `taskId` changes (target project resolved via the same-project invariant). The T&M / Fixed "covered by finalized invoice" arm is intentionally NOT built (Revision Pass #3b — invoice totals are frozen line-item snapshots, so backdated T&M/Fixed entries simply roll onto the next invoice).
- [x] **`components/projects/close-period-modal.tsx` (new)** — confirm modal. Embeds `<MonthlyReportDocument>` reading `api.statements.getRetainerStatement` so the preview matches `/projects/[id]/reports/[period]` exactly (Revision Pass #2 — no persisted statement entity, no statement number, no `sentAt`). Calm reversibility line in the footer ("You can reopen this month anytime if you need to make changes.") per Principle #4. Confirm label: `Close period`. Content-aware skeleton mirrors the document's header / parties / usage layout per CLAUDE.md. Query is `"skip"`-gated when the modal is closed.
- [x] **`components/projects/reopen-period-dialog.tsx` (new)** — admin-only AlertDialog. Body states the consequence ("The N hours of closed hours in this month become editable again. Download a fresh report if you change anything.") with `N` from `month.workedMinutes` so no extra query is needed.
- [x] **`components/projects/monthly-breakdown-card.tsx`** — ActionCell rewrite per Principles #1 / #2:
  - `open` + admin → primary `Close` opens the modal; `⋯` overflow includes `Download report` (the existing report link as the non-close path).
  - `open` + member → primary `↓ Report` (read-only; close is admin-only).
  - `closed` → primary `↓ Report` (or invoice link if a non-void invoice covers); `⋯` overflow includes `Reopen period` (admin-only) opening the AlertDialog.
  - `open` + overage → unchanged (`Bill overage` Generate stays primary; `⋯` deferred to Slice 4).
  - `in_progress` → unchanged standalone Preview; no `⋯` this slice (Slice 4 adds `View entries`).
- [x] **Amount column renamed `Billed here`** with header tooltip ("Only overage billed through this tool. The retainer monthly fee is charged separately (currently via Stripe).") per Principle #6. `TooltipProvider` wraps the table body so per-row tooltips render in the right portal.
- [x] **Pure-predicate tests (Slice 3 scope)** — 41 new tests across two files in `convex/lib/__tests__/`:
  - `settleGuards.test.ts` (10) — `pickClosedCoveringPeriod` covers inclusive boundaries, open/closed mix, and the "open period covering same date must not short-circuit" case.
  - `retainerPeriods.test.ts` (31) — `periodBoundsFromStart` (leap year, year < 2000, malformed), `evaluateCloseGate` (overage gate, draft-invoice gate, overage-wins precedence), `findConflictingInvoice` (exact match, partial overlap, multi-month rollover invoice, void ignored, no-period legacy invoice), `shouldSettleEntry` (range bounds, already-settled, has-invoiceId), `shouldReopenEntry` (boundary triple match, never reopens `invoiced` / `fixed_included`, Feb ≠ Mar boundary).
  - All 819 existing tests stay green (same 4 pre-existing failures in untouched files remain).
- [x] `npx tsc --noEmit` clean. Lint clean on every file touched by this slice.

### Slice 4 — Cycle close + period drill-down + entry list polish ✅ (2026-05-24)

Closes out Phase 8. The remaining surface area lands: rollover cycle close (thin wrapper over Slice 3's `closePeriodInternal`), the period drill-down — the only UI surface where `Closed` splits back into "Covered by retainer" vs "Invoiced overage" via `settledReason` — and the time-entry list polish that makes the new settlement model visible to anyone browsing entries.

After this slice, every settlement path (T&M invoice, Fixed invoice, retainer within-budget close, rollover cycle close, void) has a working mutation, a visible UI, and a way to read it back out at any precision the user needs.

- [x] **`convex/retainerPeriods.ts → closeRetainerCycle`** — admin-only mutation, accepts `{ projectId, cycleStart }`. Resolves the N monthly periods via `getCyclePeriods` (Slice 2). Two-gate flow via new `evaluateCycleCloseGate` (sibling to `evaluateCloseGate`, with cycle-scoped wording): `computeCycleOverageContext` rejects when cycle aggregate is over budget; `findConflictingInvoice` rejects when any non-void invoice overlaps the cycle range. Bulk-closes by reusing `closePeriodInternal` (extracted in Slice 3) for each monthly period — all N receive identical `closedAt` (the cycle-close fingerprint). Each entry retains its **monthly** boundary on `settledPeriodStart/End`, NOT the cycle boundary, so per-month `reopenPeriod` stays unambiguous after a cycle close. `closePeriodInternal` gained an optional shared-`now` parameter to enable this.
- [x] **`convex/lib/entryStatus.ts` (new)** — extracted `entryStatus()` from `convex/lib/settleEntries.ts` into a pure file so client components can import it without dragging `internalMutation` (server runtime) into the browser bundle. `settleEntries.ts` re-exports for any existing server-side callers.
- [x] **`lib/retainer-row-action.ts → decideRetainerRowCloseAction`** — pure helper for the close axis of the Monthly Breakdown row (parallel to the existing billing axis). Returns `"close-month"` | `"close-cycle"` | `null` based on rollover mode, cycle-position, overage state, admin role, and the row's own `isClosed`. The cycle-end row of a within-budget rollover cycle gets the cycle variant; monthly close is allowed mid-cycle on rollover (Slice 3 behavior preserved).
- [x] **`components/projects/close-cycle-modal.tsx` (new)** — sibling of `ClosePeriodModal`. Embeds the live `MonthlyReportDocument` for the cycle-end month (rollover statements already aggregate cycle-to-date totals). Plural reversibility line ("reopen any month in this cycle anytime") because per-month reopen still works after a cycle close. Same Revision Pass #2 contract — no `send`/`delivery`/persisted-statement language.
- [x] **`components/projects/period-detail-sheet.tsx` (new)** — the drill-down (Principle #5). Right-side `Sheet`, opens on row click OR `⋯ → View entries`. Reads `api.timeEntries.listProjectEntries` constrained to the period's date range — no new query, no new schema, just a client-side `groupBySettledReason` pure aggregator. Renders the three buckets (`Covered by retainer`, `Invoiced overage`, `Covered by fixed price`) only when non-empty. Invoice-link chips de-duplicated, multiple-invoice periods supported. The drill-down also surfaces an `Open / draft` section when a reopened-period mid-edit has unsettled entries.
- [x] **`components/projects/monthly-breakdown-card.tsx` — close axis + drill-down wired in:**
  - New `closeActionByMonthKey` derived map (parallel to billing-axis `actionByMonthKey`) consumed by ActionCell.
  - Row label is now a `<button>` opening the drill-down sheet — clicking anywhere in the row's content area answers "what was logged here?" before any action.
  - ActionCell dispatch: when `closeAction === "close-cycle"`, primary button reads `Close cycle` and opens `CloseCycleModal`; when `"close-month"`, opens `ClosePeriodModal` (Slice 3 behavior); otherwise existing primary (Generate / invoice link / Report) stays.
  - `⋯` overflow now includes `View entries` on **every** row state (in_progress, open + overage, closed-with-invoice, …) — completing the matrix the parent PRD spec's row table calls out. Slice 3 left this deferred; Slice 4 wires it.
- [x] **`components/billing-status-badge.tsx` — vocabulary aligned with `entryStatus()`:** state now `"open" | "draft" | "closed" | "non_billable"` (was `"non_billable" | "uninvoiced"`). Locked states (Draft + Closed) carry a `LockIcon` marker; Closed uses the green tone. Old `"uninvoiced"` string maps to `"open"` for backwards compat so any straggler caller renders correctly.
- [x] **`components/projects/project-time-table.tsx` polish:** `BillingStatusCell` simplified to a single chip derived from `entryStatus()` — invoice status no longer leaks onto the row (it lives on the day-group header and in the `Open invoice INV-…` overflow item). Locked rows render at ~72% opacity per spec. New `RowActionsMenu` branches for locked retainer-closed rows: `View report` (links to `/projects/[id]/reports/[period]`) + admin `Reopen period` (reuses `ReopenPeriodDialog`). Hover tooltip on locked badge formatted by the shared `formatLockedTooltip`.
- [x] **`lib/entry-tooltip.ts` (new) → `formatLockedTooltip`:** "Closed {settledAt} · included in retainer | covered by fixed price | invoiced · {settledPeriodStart}–{settledPeriodEnd}". Draft rows get "On draft invoice INV-038". Wording switches on `settledReason` per parent PRD spec.
- [x] **`lib/group-reference.ts` (new) → `deriveGroupReference`:** day-group header consolidation. When every billable entry in a day-group shares the same retainer period boundary → header subtitle reads `Closed · Mar 1–31`. When all share the same invoice → `Closed · INV-038` (or `Draft · INV-038` when any entry is still draft). Mixed groups → no consolidated reference, fall back to per-row badges. `ProjectTimeGrouped.GroupHeader` renders the chip with a `LockIcon`.
- [x] **`components/tasks/time-entries-table.tsx` polish:** task-detail Time tab inherits the same locked-row treatment — 72% opacity, `LockIcon` (replacing the billable dot on locked rows), `formatLockedTooltip` on hover. `canEdit` now also returns false on locked rows so the dropdown menu's Edit/Delete items are hidden.
- [x] **`components/projects/project-time-stats.tsx` — top summary gains `Open` figure** (parent PRD § UI Changes → Top summary). Retainer projects show `Total / Billable / Non-billable / Open`; T&M keeps `Open Hours / Open Amount` (the money-shaped variant for billers). Derivation calls `entryStatus()` so the number matches what the filter dropdown would return when set to `open`.
- [x] **Invoices tab lexicon audit (Principle #3) — no drift.** Invoice-side surfaces use `Draft / Invoiced / Paid / Past due / Void` (verified in `invoice-status-badge.tsx` and `invoices-metric-cards.tsx`); time-side surfaces use `Open / Closed`. The lone amber `Uninvoiced` pill on the retainer summary card is the cycle-level "you have revenue to bill" signal, not a row state — it's accurate and doesn't collide with the row lexicon.
- [x] **Project Finances card unchanged** (explicit no-op per spec) — the existing donut and Billable/Non-billable rows stay; the bucket split lives in the drill-down and reports, not the overview.
- [x] **Tests — 50 new (`107` Phase 8 tests total, 41 from Slice 3 + 50 from Slice 4 + 16 from Slices 1/2):**
  - `lib/retainer-row-action.test.ts` (Slice 4 extension) — `decideRetainerRowCloseAction` covering all guards (member, already-closed, in-progress, invoice-wins), monthly variant (within-budget / over-budget / overageRate=0), rollover monthly mid-cycle, rollover cycle-end with all four gate outcomes.
  - `convex/lib/__tests__/retainerPeriods.test.ts` (Slice 4 extension) — `evaluateCycleCloseGate` (4 cases: overage rejects with cycle wording, invoice rejects with cycle wording, allows when both pass, overage wins precedence).
  - `components/projects/period-detail-sheet.test.ts` — `groupBySettledReason` covering empty input, each single-bucket split (retainer / invoiced / fixed-included / draft / open / non-billable), the mixed-period headline case (20h covered + 5h overage), invoice de-duplication, multiple-invoice support, totals contract.
  - `lib/entry-tooltip.test.ts` — three settled variants + missing-boundary fallback + draft invoice wording + null case.
  - `lib/group-reference.test.ts` — period reference (same boundary), Feb-vs-Mar straddle, invoice ref (Closed vs Draft when any entry draft), different-invoice case, non-billable-only, mixed open + closed.
  - `components/billing-status-badge.test.tsx` — labels for all four states + legacy `uninvoiced` mapping + lock-icon presence on Draft/Closed only.
  - `components/projects/project-time-stats.test.tsx` — Open counts only `entryStatus() === "open"` entries, excludes Draft/Closed, T&M variant shows `Open Hours` + `Open Amount`.
- [x] `npx tsc --noEmit` clean. Lint clean on every file touched by this slice (warnings in untouched files unchanged).

**Note on test approach:** the spec's "Convex test:" entries for `closeRetainerCycle` integration paths are met by extracting pure predicates and testing those (same pattern Slices 1–3 used). The repo has no `convex-test` framework; the full DB-roundtrip integration test would require adding `@convex-dev/test` (out of scope for this slice).

---

## Phase 8 — ✅ COMPLETE (all four slices landed)

Headline bug fixed (parent PRD § Problem Statement, retainer within-budget ❌ row): time entries on within-budget retainer months no longer appear "open forever" in stats and filters. The whole settlement matrix is wired:

| Path | Settles entries with | UI to trigger | UI to read |
|---|---|---|---|
| T&M invoice | `invoiced` | Generate (existing) | Day-group header `Closed · INV-…`, drill-down |
| Fixed invoice | `fixed_included` | Generate (existing) | Day-group header `Closed · INV-…`, drill-down |
| Retainer within-budget close | `retainer_included` | Slice 3 `Close period` | Drill-down `Covered by retainer` section |
| Rollover cycle close | `retainer_included` × N months | Slice 4 `Close cycle` | Drill-down on any month in cycle |
| Retainer overage invoice | `invoiced` | Existing Generate | Drill-down `Invoiced overage` section |
| Void | clears `settledAt` + `invoiceId` | Existing void flow | Entry returns to `Open` |

The lock guard covers all three write paths (`timeEntries.create`, `timer.commitEntry`, `timeEntries.update`) and is scoped to closed retainer periods only — T&M / Fixed backdated entries continue to roll onto the next invoice (Revision Pass #3b decision preserved).

### TODOs deferred — mirrored from parent PRD § TODOs Deferred to Later Phases

| Item | Deferred to |
|---|---|
| `projectId` denormalization on `timeEntries` + new indexes | A perf-driven follow-up phase, no PRD yet. Trigger: 10K+ entries/org or visible latency in `closePeriod` / `closeRetainerCycle` / drill-down. |
| Auto-close on project completion (`settledReason: "manual_close"`) | Requires a project status / completion field that does not exist yet — a separate project lifecycle phase. |
| Period-scoped audit event log | `docs/billing-periods-monthly-close-prd.md` |
| Unified statement + invoice document editor | `docs/billing-periods-monthly-close-prd.md` |
| Document line item edits decoupled from time entries | `docs/billing-periods-monthly-close-prd.md` |
| `billingPeriods` ledger table replacing `invoiceId` as canonical lock | `docs/billing-periods-monthly-close-prd.md`. Triggers: first compliance audit request, repeated statement editing pain, or 3rd parallel duplication bug. |
| `reopenPeriod` requiring a written reason for audit trail | `docs/billing-periods-monthly-close-prd.md` |
| Convex cron auto-suggesting periods ready to close | Out of scope — Monthly Close queue lives in the big PRD |
| Convex-test integration tests for `closePeriod` / `closeRetainerCycle` / write-guard wiring | Would require adding `@convex-dev/test`. The pure-predicate tests cover the gating + per-entry rules; the wrappers themselves are thin compositions. |
| Period locking when reports are downloaded or sent | Today reports are always live truth; back-dated edits re-render on next view (D7). |
| Cross-client global "monthly reports queue" view | `/reports` page was removed; per-project hunting is the MVP workflow. Re-introduce when the workflow demonstrably hurts. |
| Pro-rated included budget for partial months | Partial-month projects currently get the full bucket (D12). |
| Stripe webhook for payment-date display + payment reconciliation | Disclaimer text only today. |
| `/reports` analytics view (revenue mix, margin, utilization) | Re-introduce with a defined scope when real cross-project demand emerges. |
| Credit notes | Handled today by void + re-create. No `creditNotes` entity in MVP. |
| Statement / report sent-tracking entity (`sentReports` table) | Reports are pure on-demand renders today (D4). |

### TODOs deferred to later phases (legacy section — superseded by the Phase 8 ✅ COMPLETE table above; entries below predate Phase 8 and remain out of scope)
- **Project-completion auto-close** (`settledReason: "manual_close"`) — requires a project status field that doesn't exist yet. Separate project-lifecycle phase.
- **`billingPeriods` ledger table replacing `invoiceId` as canonical lock** — escalation path documented in `docs/billing-periods-monthly-close-prd.md`. Triggers: first compliance audit request, repeated statement editing pain, or 3rd parallel duplication bug.
- **Period-scoped audit event log + reopen with reason** — `billing-periods-monthly-close-prd.md`.
- **Period locking** — when reports are downloaded or sent. Today reports are always live truth; back-dated edits re-render on next view (D7). Owner is responsible for not back-dating into already-sent periods.
- **Cross-client global "monthly reports queue"** view — `/reports` page was removed; per-project hunting is the MVP workflow. Re-introduce when the workflow demonstrably hurts.
- **Pro-rated included budget for partial months** — partial-month projects currently get the full bucket (D12). Acknowledged money leak vs. Stripe pro-rated charge; revisit when client count grows.
- **Stripe webhook for payment-date display + payment reconciliation** — disclaimer text only today. No customer-id field, no payment date on documents, no auto-charge.
- **`/reports` analytics view** (revenue mix, margin, utilization) — re-introduce with a defined scope when real cross-project demand emerges.
- **Credit notes** — handled today by void + re-create. No `creditNotes` entity in MVP.
- **Statement / report sent-tracking entity** (`sentReports` table) — reports are pure on-demand renders today (D4). Becomes a purely additive future change when auto-send ships.

---

## Phase 9 — Client Worksheet Export (CSV + AI summary) ✅ COMPLETE (2026-05-25)

> Five slices landed in one PR. The worksheet trigger now lives on every surface that defines a billable scope:
>
> | Trigger | Action | Slice |
> |---|---|---|
> | Retainer monthly row `⋯` → `Download worksheet` | `exportMonth` | Slice 1 |
> | Retainer cycle-end row `⋯` → `Download cycle worksheet` | `exportCycle` | Slice 3 |
> | Invoice row `⋯` → `Download worksheet` | `exportInvoice` | Slice 4 |
> | Project header `⋯` → `Download worksheet…` (picker) | `exportAdHoc` | Slice 5 |
>
> AI summaries (Slice 2) generate fresh on every export via Vercel AI Gateway (`anthropic/claude-sonnet-4.6`); direct Anthropic SDK is the fallback. Bounded concurrency = 4. Per-task failures degrade to `[summary unavailable]`; whole-batch failures throw a `ConvexError` surfaced as a toast.
>
> Test coverage: 16 CSV emitter tests + 11 period preset tests. Manual smoke checklist preserved on each slice.
>
> **PRD**: `docs/phase-9-worksheet-export.md`
>
> **Mental model**: **Worksheet lives where the scope lives.** Each surface that defines a scope (retainer month row, cycle-close row, invoice row, project-header picker) gets a worksheet trigger. `InvoiceBanner` is explicitly NOT a worksheet surface — it has no defined scope until an invoice is generated.
>
> **Key decisions locked**:
> - Trigger placement is scope-driven, not project-type-driven (see PRD §Trigger placement table)
> - One row per task. No Rate column. Hours split into `Billable hours` / `Non-billable hours` / `Total hours` (no single `Billable=Y/N` flag)
> - AI summary generated fresh on every export, no caching, no preview/edit
> - AI via **Vercel AI Gateway** (`"anthropic/claude-sonnet-4-6"`); direct Anthropic SDK is fallback only
> - Comments fed to AI are flattened by `createdAt`, text only — threading, reactions, attachments ignored
> - `tasks.description` is JSON-stringified Tiptap → `JSON.parse` before `extractPlainText`; `comments.content` is already structured, pass direct
> - Empty-content tasks fall back to `"Worked on {title}."` deterministically
> - Per-task AI failure → `[summary unavailable]`; whole-batch failure → toast, no download
> - UTF-8 with BOM (Excel-on-Windows safe)
> - Admin only, strict `orgId` guard on every action
> - No existing precedent in this repo for action→internalQuery — Slice 1 sets the pattern

### Slice 1 — CSV infrastructure + retainer monthly export (no AI) ✅

- [x] **CSV helpers**: [lib/csv.ts](lib/csv.ts) — `escapeCsvField`, `joinCsvRow`, `joinCsvRows`, UTF-8 BOM prefix, formula-injection protection (`=`, `+`, `-`, `@`, tab, CR)
- [x] **Slug helper**: [lib/format.ts:486](lib/format.ts:486) adds `slugify(name)`. Also inlined inside [convex/worksheetsHelpers.ts](convex/worksheetsHelpers.ts) — the Convex tsconfig can't resolve `lib/format.ts`'s `@/` re-export of `lib/duration`, so duplicating five lines beat reshuffling the format module. Documented in the file.
- [x] **Action**: [convex/worksheets.ts](convex/worksheets.ts) `exportMonth({ projectId, year, month })` → `{ csv, filename }`
- [x] **Internal query**: [convex/worksheetsHelpers.ts](convex/worksheetsHelpers.ts) `collectWorksheetData` — discriminated scope union (`period` / `cycle` / `invoice`), `requireAdmin` + `project.orgId === currentUser.orgId` + `client.orgId === currentUser.orgId` guards
- [x] **Helpers**: `buildTaskRows` (per-task aggregation), `buildSingleScopeCsv` (CSV emitter)
- [x] **Deterministic "What we did" fallback** (`Worked on {title}.`) — exposed as `fallbackAiOutputs` so every slice's gap fill goes through one helper
- [x] **Three-column hour split**: `Billable hours`, `Non-billable hours`, `Total hours` (`H:MM` format)
- [x] **First worked / last worked / entry count** columns
- [x] **Shared menu item**: [components/worksheet/worksheet-menu-item.tsx](components/worksheet/worksheet-menu-item.tsx) — loading state ("Generating worksheet…"), Blob+anchor download, error toast via `toastError(err, "Couldn't generate worksheet")`
- [x] **Wire trigger**: retainer monthly breakdown row `RowOverflow` — added `worksheetItem` to every row state in [components/projects/monthly-breakdown-card.tsx](components/projects/monthly-breakdown-card.tsx) (admin-gated)
- [x] **Filename**: `{client-slug}-{project-slug}-{YYYY-MM}-worksheet.csv`
- [x] **Verify**: `npx tsc --noEmit` clean, `npm run lint` introduces zero new errors (pre-existing 887 errors / 334 warnings unchanged); CSV/period-preset unit tests pass (`lib/csv.test.ts`, `lib/worksheet-period-presets.test.ts`)
- [x] **Verify**: empty period → `ConvexError("No time entries in this period")` surfaces as toast, no broken download
- [x] **Verify**: current in-progress month — date filter is inclusive on `[start, end]`, so a mid-month export downloads everything logged so far
- [x] **Verify**: mixed billable/non-billable task → hours split correctly across the three columns (`buildTaskRows` partitions by `isBillable`)
- [x] **Verify**: formula-injection guard covered by unit tests in [lib/csv.test.ts](lib/csv.test.ts) (`=SUM(…)`, `+`, `-`, `@`, leading tab/CR)
- [x] **Verify**: cross-org request → `requireAdmin` resolves to caller's org, then `project.orgId !== currentUser.orgId` throws `"Project not found"`. Same gate on the invoice and ad-hoc paths.

### Slice 2 — AI summaries wired in ✅

- [x] **AI integration**: `summarizeTaskWithAI` + `summarizeTasksWithBoundedConcurrency` in [convex/lib/worksheetAi.ts](convex/lib/worksheetAi.ts). Primary path: `ai` SDK with model slug `"anthropic/claude-sonnet-4.6"` (dot format per current Vercel AI Gateway slug convention — the PRD draft pre-dated the change). Fallback: `@ai-sdk/anthropic` direct provider when only `ANTHROPIC_API_KEY` is set.
- [x] **Input shape**: title + plain-text task description (`JSON.parse` then `extractPlainText` from [lib/tiptap-utils.ts](lib/tiptap-utils.ts)) + subtask titles + `statusType === "done"` flag + all comments flattened by `createdAt` (text only, no threading/reactions/attachments) + included entry notes — captured in `WorksheetAiInput`
- [x] **Two AI fields**: `Task summary` and `What we did`. Single two-line model response parsed with tolerance for label variants / missing labels
- [x] **Output handling**: `cleanLine` trims/collapses/strips quotes, `capLength` enforces ~220 / ~320 char caps with ellipsis
- [x] **Concurrency**: bounded at 4 concurrent calls (`summarizeTasksWithBoundedConcurrency`)
- [x] **Empty-content fallback preserved**: `hasMeaningfulContent` skips AI for tasks with no description/subtasks/comments/notes; emits deterministic title-based lines
- [x] **Per-task error handling**: row's `whatWeDid` becomes `[summary unavailable]`; `taskSummary` falls back to title; export continues
- [x] **Whole-batch failure**: `WorksheetAiUnavailableError` (thrown when neither env var is set) bubbles to a `ConvexError` → frontend toast, no partial download. First-call detection in `summarizeTasksWithBoundedConcurrency` ensures auth failures fail the whole batch instead of returning 30 fallback rows.
- [x] **Env vars**: created [.env.example](.env.example); added `AI_GATEWAY_API_KEY` (primary) and `ANTHROPIC_API_KEY` (fallback)
- [x] **Updated CLAUDE.md**: Pre-deployment Checklist (Convex env set requirement) + Environment Variables section
- [x] **Verify**: 4-concurrent bounded fan-out, comments/entry notes/subtasks all flow into the prompt context — verified by inspection of `buildTaskContextBlock`. Live latency verification deferred to manual smoke (PRD calls out < 5 s for ≤ 30 tasks).
- [x] **Verify**: missing key → action throws `WorksheetAiUnavailableError`-derived `ConvexError`, the `WorksheetMenuItem` toast handler surfaces the message, no broken download
- [x] **Verify**: long task description → `Task summary` is capped at ~220 chars with ellipsis; raw description never reaches the CSV (only `aiInput.descriptionText` is used as prompt input, not as a row cell)

### Slice 3 — Full-cycle retainer export ✅

- [x] **Action**: [convex/worksheets.ts](convex/worksheets.ts) `exportCycle({ projectId, cycleStart })`
- [x] **Internal query**: `collectCycleWorksheetData` walks the cycle's monthly periods, builds per-month task rows, then resolves allocation / rollover / overage via the shared helpers
- [x] **CSV builder**: `buildFullCycleCsv` — `== Month YYYY ==` divider per section + `Subtotal billable` / `Allocation (with rollover)` / `Rollover into next month` or `Overage` footer rows
- [x] **Reuse retainer helpers**: [convex/lib/retainerCycle.ts](convex/lib/retainerCycle.ts) `getCyclePeriods` resolves the cycle's months from `cycleStart`; [convex/lib/retainerUsage.ts](convex/lib/retainerUsage.ts) `buildRetainerUsageRows` produces the rollover ledger. No new business logic.
- [x] **Cycle total section** at end: `Total billable hours worked` / `Total allocation` / `Net overage`
- [x] **Wire trigger**: cycle-close row variant — `cycleWorksheetItem` rendered in every overflow when `isAdmin && isRollover && isCycleEndRow` ([components/projects/monthly-breakdown-card.tsx](components/projects/monthly-breakdown-card.tsx))
- [x] **Filename**: `{client-slug}-{project-slug}-cycle-{YYYY-MM-DD}-worksheet.csv` (cycle start date)
- [x] **Interim-month export remains scoped to that month** — the monthly `worksheetItem` is unchanged in Slice 3
- [x] **Verify**: 1-month cycle exports — by construction the per-month and cycle CSVs share the same rows; the cycle CSV adds dividers + footer lines. Documented in the dialog comment and the trigger placement.
- [x] **Verify**: 3-month cycle — rollover ledger derived from `buildRetainerUsageRows`, the same path the Monthly Breakdown card consumes; per-section `allocationMinutes` reads from that ledger so cycle worksheet and overview cannot drift.

### Slice 4 — Invoice companion export ✅

- [x] **Action**: `exportInvoice({ invoiceId })` — scopes entries by `invoiceLineItems.timeEntryIds` (canonical entry-set rule per [convex/schema.ts:379](convex/schema.ts:379))
- [x] **Wire trigger**: `Download worksheet` `WorksheetMenuItem` at the TOP of the `⋯` menu in [components/invoices/invoice-row-actions.tsx](components/invoices/invoice-row-actions.tsx), separator before the regular actions. Skipped on `void` invoices (component already short-circuits there).
- [x] **Works for any project type's invoice** — the `invoice` scope reads line items by `invoiceId`, no billing-type branching; T&M is the primary use case but Fixed and Retainer invoices export the same way.
- [x] **Filename**: `{client-slug}-{project-slug}-invoice-{INV-035}-worksheet.csv`
- [x] **Verify**: multi-tenant + admin guards — `requireAdmin` then `invoice.orgId === orgId` then `project.orgId === orgId` then `client.orgId === orgId`. Each level throws on mismatch.
- [x] **Verify**: T&M invoice with user-trimmed entry selection — the action walks `invoiceLineItems.timeEntryIds` directly (not `timeEntries.invoiceId`), so the worksheet's row set IS the invoice's entry set, by construction.
- [x] **Verify**: cross-org invoice id → first guard throws `"Invoice not found"`

### Slice 5 — Project-header ad-hoc export ✅

- [x] **Picker modal**: [components/worksheet/ad-hoc-export-dialog.tsx](components/worksheet/ad-hoc-export-dialog.tsx) — period preset/custom radio + categories multi-select + billable-filter radio
- [x] **Period presets**: `This month`, `Last month`, `This quarter`, `Last quarter`, `This year`, `Last year`, `All time`, `Custom range` — pure resolver in [lib/worksheet-period-presets.ts](lib/worksheet-period-presets.ts), resolved against `orgSettings.timezone`. Unit tests in [lib/worksheet-period-presets.test.ts](lib/worksheet-period-presets.test.ts) cover every preset including year/quarter wraparound.
- [x] **Categories filter**: multi-select against the org's `workCategories` (`api.workCategories.list`); default = empty selection = all categories
- [x] **Billable filter**: All / Billable only / Non-billable only radio; default = all
- [x] **Wire trigger**: `Download worksheet…` `DropdownMenuItem` at the TOP of `⋯` in [components/projects/project-detail-header.tsx](components/projects/project-detail-header.tsx). One code path covers Fixed, T&M, Retainer.
- [x] **Action**: `exportAdHoc({ projectId, periodStart, periodEnd, periodSlug, periodLabel, categoryIds?, billable?, categoryLabels? })` — client passes slug + label so the action stays stateless
- [x] **Renders flat** — the `period` scope path in `collectWorksheetData` is unaware of cycles, so a cross-cycle range yields a flat task list (`buildSingleScopeCsv` has no section logic)
- [x] **CSV header reflects active filters** — `Filters:` row added when `categoryLabels` or `billable !== "all"`. Omitted when neither narrows the result (PRD rule).
- [x] **Filename**: `{client-slug}-{project-slug}-{period-slug}-worksheet.csv`. Examples produced by the preset resolver: `2026-q1`, `2025-2026-all-time`, `2026-01-15-to-2026-04-30`. Filters do NOT affect the filename — only the period slug does.
- [x] **Empty result**: action throws `ConvexError("No time entries match these filters")`; the dialog's catch surfaces it as a toast and no CSV is written
- [x] **Submit-disabled state**: button disabled when (a) timezone hasn't loaded, (b) preset resolver returns `null` (custom range with end < start or missing endpoints), or (c) a request is in flight
- [x] **Verify**: each preset period resolves correctly against `orgSettings.timezone` — covered by [lib/worksheet-period-presets.test.ts](lib/worksheet-period-presets.test.ts) with a fixed reference date
- [x] **Verify**: custom range crossing retainer cycle boundaries renders flat — `buildSingleScopeCsv` has no per-month divider logic; only `buildFullCycleCsv` (the cycle action) emits sections
- [x] **Verify**: category filter narrows the row set — `resolveScopeEntries` filters tasks by `workCategoryId` set membership before iterating their entries
- [x] **Verify**: billable filter changes both rows shown AND the total lines — the entries array is pre-filtered, so `buildTaskRows` only sees in-scope entries; the totals fall out of those rows
- [x] **Verify**: available on Fixed, T&M, and Retainer project pages from one code path — the trigger lives in `ProjectDetailHeader`, which is mounted by every project type's page (`app/(dashboard)/projects/[id]/page.tsx`)

### TODOs deferred to later phases

- **Cached AI summaries on the task** — adds schema + invalidation complexity. Revisit when token cost or latency hurts.
- **Editable client-facing summary field per task** — couples worksheet to task detail UX. Revisit when a user actually edits an AI line.
- **Excel / PDF output formats** — CSV covers the email-the-client use case. PDF only when clients ask directly.
- **Non-billable internal-effort footer line** on single-scope CSV — today shown inline as `Non-billable hours` column. Promote to a summary line if visual noise hurts.
- **Per-org style / tone instructions for the AI** — add `orgSettings.worksheetTone` when a second org gives opposing feedback.
- **Per-row included-vs-overage flag** on cycle exports — today only at monthly subtotal level. Add per-row if accountants request it.
- **Multi-language summaries** — English-only for v1. Follow `orgSettings.defaultCurrency` / `timezone` signal when added.
- **Recording the export as an audit event** (`exports` table) — pure on-demand renders today. Add when compliance / sent-tracking matters.
- **Per-row task selection on invoice-scoped worksheet** — today uses `lineItems.timeEntryIds` wholesale. Add row-level trimming if T&M users ask for it.
- **Saved ad-hoc export presets per project** — each ad-hoc export is configured from scratch today. Add "save as preset" if owners run the same custom range monthly.
- **Cross-project ad-hoc export** ("all our work in Q1") — today scoped per-project. Promote when portfolio-level reporting is requested.
- **Comment thread structure / attachments in AI context** — today comments are flattened by `createdAt`, text only. Add threaded/attachment context if a client's most useful delivery detail starts hiding in attachments.

---

## Retainer Billing Workflow Audit — 2026-07-04 ✅

Senior-dev/PO pass over the monthly-retainer invoicing + worksheet workflow.
Verdict: the core settlement model (calendar-driven due-ness, rollover OFF =
monthly units / rollover ON = cycle unit, within-budget → report + close,
over-budget → overage invoice) is **correct**. Fixes below target the gaps
that made the workflow feel opaque.

### Shipped in this pass

- [x] **Billing inbox: within-budget closes surface on the Ready tab.** New
  `retainer-close` / `retainer-cycle-close` rows in
  [convex/lib/readyToInvoice.ts](convex/lib/readyToInvoice.ts) — one per
  calendar-ended, uninvoiced, not-admin-closed within-budget month/cycle.
  `enumerateReadyRows` feeds admin-close state from `retainerPeriods`;
  rows render with an outline **Close & report** button that opens the same
  `ClosePeriodModal` / `CloseCycleModal` the Monthly Breakdown card uses
  ([components/invoices/invoice-list.tsx](components/invoices/invoice-list.tsx)).
  The Ready tab is now the single queue for ALL month-end billing actions.
- [x] **Sidebar badge counts closes too.** `getInvoicingNavSignals` returns
  `toCloseCount` alongside `toGenerateCount`; badge shows the sum, tooltip
  breaks it down ("N ready to bill · M to close & report · K overdue").
- [x] **Missing `overageRate` no longer hides over-budget months.** Instead
  of the silent `amount <= 0` drop, the row is emitted with
  `configIssue: "missing-overage-rate"` and the inbox action becomes a
  **Set rate** link to the project's settings tab.
- [x] **`getRetainerData.overageDue` dedups against invoiced periods**
  ([convex/projects.ts](convex/projects.ts)) — previously it kept summing
  overage for months/cycles that already had a non-void invoice,
  disagreeing with the InvoiceBanner and the Ready feed on the same page.
- [x] **Retainer config read-defaults aligned with creation defaults.**
  `projects.create` writes `cycleLength ?? 1` and rollover only for
  multi-month cycles, but read paths defaulted to `?? true` / `?? 3`
  (a misconfigured doc silently read as a 3-month rollover). All read
  sites now use `?? false` / `?? 1` (invoices.ts ×2, projects.ts ×2,
  statements.ts).
- [x] **Stale rollover-close tests updated** —
  [lib/retainer-row-action.test.ts](lib/retainer-row-action.test.ts) still
  asserted the pre-Slice-4 "mid-cycle monthly close allowed on rollover"
  behavior that `closePeriod` Gate -1 now rejects.

### Known gaps deliberately deferred (audit findings)

- **Retroactive time in an already-invoiced month is silently unbillable.**
  Ready-feed dedup is per anchor month, but only entries ON the invoice are
  locked — a new entry logged into an invoiced month never resurfaces
  anywhere. Decision (2026-07-04): accept for MVP. Fix candidates: block
  entry creation in invoiced periods (mirror `assertEntryDateOpen`), or a
  "late entries" follow-up inbox row.
- **Rounding asymmetry (latent).** `computeRetainerBalance` rounds task
  groups UP by `roundingMinutes`; Ready-feed/`getRetainerData` sum raw
  minutes. Harmless today (`useGenerateInvoice` sends `roundingMinutes: 0`)
  but the inbox amount will diverge from the draft the moment a non-zero
  rounding is passed.
- **Cron month-boundary math uses UTC** (`retainerCron.ts`) while every
  other surface uses org timezone. Low impact (rows are lazily created by
  close mutations anyway); align when touching the cron for auto-reports.
- **Terminology pass (next UX round):** "Outstanding" tab ↔ `invoiced`
  status ↔ "Mark as invoiced" button are three names for one state; five
  Generate entry points carry three different labels; `closed` vs
  `invoiced` terminal pills are both green and indistinguishable at a
  glance; "Report" (live statement) vs "Worksheet" (AI CSV) need clearer
  labels.
- **`getInvoicePreview` has no retainer branch** — the preview modal can't
  show overage/balance context for retainer drafts the way it does T&M.
- **Dashboard home is a stub** — the natural "what needs billing today"
  landing surface shows hardcoded zeros; the billing signal lives only in
  the sidebar badge + Invoices page.
- **Project-page Close offered for over-budget month with `overageRate=0`**
  (`decideRetainerRowCloseAction` returns `close-month`) while the inbox
  now says "Set rate" — reconcile when the terminology pass lands.

---

## Invoice Lifecycle Hardening — 2026-07-04 ✅

Senior review items #1+#2 (Stripe-style numbering + paid immutability).

- [x] **Invoice numbers allocate at FINALIZATION, not draft creation.**
  `invoices.number` is now optional ([convex/schema.ts](convex/schema.ts));
  `createInvoice` no longer claims a number or bumps the counter; the
  `draft → invoiced` branch of `applyStatusTransition` allocates
  `orgSettings.nextInvoiceNumber` (idempotent — a reverted-then-refinalized
  invoice keeps its number) and refreshes the prefix at issue time. Deleted
  or abandoned drafts therefore never leave gaps in the issued series
  (NAV/EU gapless-sequence requirement).
- [x] **Draft URLs fall back to the Convex doc ID** — `getInvoice` already
  accepted both identifier forms; `invoiceUrlSegment` / 
  `formatInvoiceIdentifier` in [lib/format.ts](lib/format.ts) centralize the
  "INV-035 or Draft/doc-id" split. Draft rows show an em-dash in the Number
  column; the invoice document header renders "Draft".
- [x] **`deleteInvoice` is draft-only.** Finalized invoices must be voided —
  the numbered record survives as audit trail and the period frees for
  re-billing.
- [x] **`paid → draft` removed from `VALID_TRANSITIONS`.** Paid is
  immutable; the only reverse edge is `paid → invoiced` (undo mark-paid).
  Row actions updated: paid overflow = Download PDF + Mark as unpaid;
  draft overflow = Delete (confirm) instead of Void — voiding an unnumbered
  draft had no audit value.
- [x] **Tests**: `invoiceTransitions.test.ts` — allocation on finalize,
  counter bump, no double-claim on re-finalize, paid→draft rejected,
  deleteInvoice guard (rejects finalized / removes draft + releases entries).

### Deferred follow-ups from the senior review

- **Hosted share link for invoices/reports** (Stripe-style public read-only
  URL) — the missing "send to client" step of the monthly flow.
- **Org-level "Month in review" analytics view** + real dashboard billing
  widgets (`/reports` route advertised in CLAUDE.md does not exist).
- **Nav-signal read amplification** — `getInvoicingNavSignals` walks every
  project→task→entry on any entry write; plan `by_orgId_date` index or
  per-period aggregates before scale.
- **Rounding direction decision** — `roundingMinutes` is hardcoded to 0 at
  every call site; either promote to `orgSettings` (and use it in BOTH the
  Ready feed and invoice math) or remove the parameter.

---

## UX Review Round 1: Seller Identity + Rollover Config Guard — 2026-07-04 ✅

- [x] **Company details form** —
  [components/settings/settings-company-details.tsx](components/settings/settings-company-details.tsx),
  mounted in Settings → General. First edit surface for the `brand*` org
  fields (the mutation supported them since Phase 0, but nothing in the UI
  could set them — the invoice's "No name set" placeholder had no fix path).
- [x] **Seller-identity gate on finalize** — `applyStatusTransition` rejects
  `draft → invoiced` when `orgSettings.brandName` is unset (Stripe rule: no
  finalize without account details). UI mirrors: the invoice document's
  From block shows an "Add your company details →" link (print-hidden), and
  the sidebar's Mark as Invoiced is disabled with an inline explanation.
- [x] **Cycle-label fix** — "Jun 2026-Jun 2026 2026 report" → single-month
  cycles render "June 2026"; ranges render "Jan-Mar 2026" (monthShort no
  longer double-prints the year).
- [x] **"1-month rollover" hybrid killed** — `projects.update` now enforces
  the same rule as `create` (rollover forced off when effective cycleLength
  < 2); the retainer settings card hides the rollover switch for 1-month
  cycles and always saves `rolloverEnabled: false` there. Existing hybrid
  projects normalize on their next settings save.
- [x] **Invoice sidebar caught up with lifecycle-tightening** — the detail
  page still offered paid → Revert to Draft and an always-visible red
  Delete Invoice (both now server-rejected). Paid shows "Mark as Unpaid"
  (ghost); Delete is a draft-only quiet destructive action ("Delete
  Draft"), matching the row-actions menu.
- [x] **Tests** — seed carries `brandName`; new gate test asserts rejection
  reason + zero side-effects (status, number, settlement untouched).

### UX review items still open (round 2 candidates)

- Ready tab: drop the dead Number column, widen Subject.
- Draft PDF: "DRAFT" watermark on print before finalization.
- Project Finances "Overage due" should show drafted/invoiced state instead
  of red "due" once a non-void invoice covers it.
- Ready rows: row-level click target (or hover cursor signaling button-only).
- Monthly Breakdown 6-pill legend → shrink to states actually present
  (part of the deferred terminology pass).

---

## Notification Inbox (@mentions) — 2026-07-04 ✅ COMPLETE

Notion-style inbox in the sidebar (plan: [docs/mentions-plan.md](docs/mentions-plan.md)).
Five triggers (`mention_comment`, `mention_description`, `assigned`, `comment`
participants model, `comment_reply`), 4-state row machine
(unread/read/archived/snoozed), real-time badge, week-grouped overlay panel,
comment deep-link, task mute, mention-access guard. In-app only; schema stays
email-extensible.

### Shipped (tracer-bullet chunks 1–6)

- [x] **Schema**: `notifications` (index `by_recipient_org_state` — every hot
  query is one bounded slice) + `taskMutes` ([convex/schema.ts](convex/schema.ts)).
- [x] **Fan-out** `createNotifications` ([convex/notifications.ts](convex/notifications.ts)):
  validation ladder per event (normalizeId → self-skip → deleted-user skip →
  org membership via `by_orgId_clerkUserId` → task access → mute check for
  comment family → unread dedupe for `assigned`/`mention_description`); any
  failure skips the event silently. Hooks: `comments.create` (mention > reply
  > participant priority, one row per recipient), `tasks.create/update/
  updateDescription/createSubtask/bulkUpdate` (all three assignee branches);
  `cascadeDeleteTaskData` deletes notifications + mutes.
- [x] **Pure logic** ([convex/lib/notificationEvents.ts](convex/lib/notificationEvents.ts)):
  `computeCommentRecipients`, `diffMentionIds` (only newly ADDED mentions
  notify), `safeParseDoc`, `truncatePreview`; the mention walker
  `extractMentionIds` lives in [lib/tiptap-utils.ts](lib/tiptap-utils.ts),
  shared verbatim by server fan-out and the client access guard.
- [x] **API**: `listInbox`/`listArchived` (enriched, task-deleted rows dropped,
  departed actors → "Former member"), `unreadCount` (`isCapped` → "99+"),
  `markRead`/`markUnread` (doubles as unarchive)/`archive`/`markAllRead`,
  `snooze` (array form + one `until`; one scheduled `wake` per row with an
  `expectedUntil` guard token — archive/read/re-snooze makes stale wakes
  no-op, no scheduler.cancel), `muteTask`/`unmuteTask`/`isTaskMuted`.
- [x] **Honest badge**: `markTaskNotificationsRead` wired into
  `taskViewReceipts.markViewed` — opening a task via ANY path clears that
  task's unread rows ([convex/taskViewReceipts.ts](convex/taskViewReceipts.ts)).
- [x] **UI** ([components/inbox/](components/inbox/)): sidebar `InboxButton` +
  live badge (mobile → Sheet), panel with week sections ("This week"/"Last
  week"/date-range, org-tz bucketing via [lib/inbox.ts](lib/inbox.ts)
  `groupInbox`), group rows (stacked avatars max 3 + "+N", latest preview,
  blue dot), hover actions (read/unread, archive, snooze presets from
  [lib/inbox-snooze.ts](lib/inbox-snooze.ts) — DST-tested Europe/Budapest,
  mute in overflow), mark-all-read, client-side unread-only filter, archived
  view, content-aware skeleton, empty states.
- [x] **Comment deep-link**: row click → `/tasks?detail=<id>&comment=<id>`;
  `useCommentDeepLink` in ActivityFeed (drawer AND modal) scrolls, replays
  the Notion-style background-wash highlight, strips the param; deleted
  comment → silent no-op.
- [x] **Mention-access UX** (Notion rule: mention never grants access, and
  is never silently dropped — one guard, three surfaces,
  [components/tasks/use-mention-access-guard.tsx](components/tasks/use-mention-access-guard.tsx)):
  no-access hint in every suggestion dropdown ("Nincs hozzáférése ehhez a
  taskhoz"); **comments** → pre-submit ConfirmDialog (confirm adds the
  members as assignees via `tasks.update`, then posts; cancel keeps
  editing); **description on an existing task** (autosaved, no submit
  moment) → SELECTION-time dialog — confirm adds as assignee (assignment
  fan-out guarantees they're notified regardless of autosave timing),
  cancel REMOVES the just-inserted mention, so a saved description mention
  always implies access; **create-task form** → mentioning someone outside
  the assignee selection auto-adds them to the form's picker (visible
  chip, removable) with an info toast. Server-side filter remains the
  security boundary.

### Verification

- Unit: [convex/lib/__tests__/notificationEvents.test.ts](convex/lib/__tests__/notificationEvents.test.ts)
  (extraction/diff/recipient matrix), [lib/inbox.test.ts](lib/inbox.test.ts)
  (week boundaries with injected now, org-tz bucketing, unread aggregation,
  actor stacking), [lib/inbox-snooze.test.ts](lib/inbox-snooze.test.ts)
  (9 AM wall-clock across both 2026 DST transitions).
- Integration: [convex/__tests__/notifications.test.ts](convex/__tests__/notifications.test.ts)
  — 27 tests through the real public mutations with Clerk-shaped identities:
  fan-out per trigger, priority collapse, mute breakthrough, dedupe, access
  filter, state machine, foreign-row rejection, snooze/wake/stale-wake,
  markViewed scoping, cascade delete, Former-member + capped-badge
  enrichment.
- Manual two-user walkthrough: all five triggers, live badge, deep-link
  scroll+flash, organic-open clears dots, mute, access dialog both paths.
- Gates: `npx tsc --noEmit` = 0 errors; vitest green (4 pre-existing
  failures elsewhere: `lib/format-activity-timestamp.test.ts` ×3 stale
  assertions, `taskActivityIndicators` ×1, plus vendored `.reference/`
  tiptap tests picked up by the glob — none related); ESLint clean on all
  files touched by this feature (repo-wide baseline noise predates it).

### TODOs deferred (user-reviewed scope decisions)

- **Pasted description mentions bypass the selection-time guard** — a
  mention node arriving via paste (not the dropdown) is still silently
  filtered server-side; would need a save-time diff check in the editor.
- **Mentions added by comment EDITS don't notify** — fan-out hooks
  `comments.create` only; `comments.update` would need `diffMentionIds`.
- **Access-grant flow double-notifies** — "add as assignee & mention"
  produces both an `assigned` and a `mention_comment` row; merge later.
- **Recipient loses task access while holding unread rows** (review delta 6)
  — badge counts them; row actions (read/archive/snooze) work since they
  check ownership only; row click opens the drawer whose ErrorBoundary
  shows the access error. Dismissible, documented, acceptable v1.
- **Dedupe scan cost** (review delta 8) — `take(100)` unread scan per
  `assigned`/`mention_description` event; bulkUpdate worst case 50×100 row
  reads. Bounded, fine at MVP scale; revisit with a per-(recipient,task)
  index if it ever shows in Convex insights.
- **Snooze resurface ordering** — woken rows sort by original `createdAt`
  (may resurface below newer items); Notion floats them to top.
- **No custom snooze date picker** — three presets only.
- **Inline reply from the inbox panel** (Notion mini-composer) — deep-link
  + drawer composer covers v1.
- **Email digest / channels** — schema ready (`emailedAt`/`channels` are
  additive), no sending.
- **Due-date reminders** ("due tomorrow", org-tz 9 AM) — reuse the snooze
  scheduler infra.
- **Status-change notifications** (e.g. task done → notify creator).
- **Per-user notification preferences** (Settings section, per-type toggles).
- **@task / @project mentions** in the editor (Notion @-page-style linking).
- **Full keyboard scheme in the panel** (↑↓/Enter/E/U roving focus) — v1
  ships Esc + focus-ring reachability only.
- **Hover task-preview card** on notification rows.
- **Mention-grants-visibility** stays rejected by design (Notion pattern);
  revisit only if the access model itself changes.

## Phase 10: Planner

Plan: `docs/toggle-plan/` (PRD + 9 tracer-bullet slices). Design reference:
`docs/mockups/planner-mockup.html`.

### Slice 1 — Tracer bullet: first bar on the board ✅ (2026-07-05)

- [x] `planSegments` table (`orgId`, `taskId`, `userId`, `startDate`,
      `endDate`, `createdAt`, `updatedAt`, `createdBy`) with indexes
      `by_orgId_taskId` + `by_orgId_startDate` (`convex/schema.ts`)
- [x] Write-time invariant `endDate >= startDate` via shared
      `assertSegmentRange` guard (`convex/planner.ts`) — every future write
      path (slice 3 mutations) must reuse it
- [x] `planner.weekGrid` query — Workday args contract (`startDate`/`endDate`
      inclusive, optional `userIds`); rows for ALL org members incl. for
      non-admins (deliberate Workday difference); org-scoped everywhere;
      archived tasks' segments hidden (not deleted); joined task title /
      project name / category color key / statusType
- [x] Task hard-delete cascade: `cascadeDeleteTaskData` now removes
      `planSegments` (covers `tasks.remove` + `tasks.bulkUpdate` delete)
- [x] `/planner` route (all members) + nav entry in `lib/navigation.ts`
      (Insights group, `CalendarRangeIcon`); page is a thin orchestrator
- [x] Minimal grid: `200px + repeat(days, 1fr)`, sticky people rail under
      horizontal scroll, day headers (month marks, weekend muted, today
      pill), weekend/today column tinting, two-line category-tinted bars
      (mockup formula: 15% bg / 52% text `color-mix`), squared clip edges,
      naive first-fit lanes (`lib/planner.ts`), fixed current-2-weeks range
- [x] Fullscreen board (owner feedback, Toggl Plan mold): page reclaims the
      dashboard layout padding and fills the remaining viewport; the grid
      scrolls both axes internally with sticky day header + sticky rail;
      day stripes extend below the last row via a flex filler
      (`planner-day-stripes.tsx` shared by rows + filler)
- [x] Content-aware skeleton (`planner-grid-skeleton.tsx` + route
      `loading.tsx`) and members-empty state
- [x] Dev seed: `npx convex run planner:seedDemo` (internal mutation;
      optional `{ orgId }`) — split task (2 segments), overlapping bars
      (lane stacking), weekend-spanning bar; wipes org segments on re-run

**Verification:** `convex/__tests__/planner.test.ts` — 8 tests: invariant
rejection (inverted + malformed dates), all-rows visibility for members,
cross-org isolation (both directions), archived-segment exclusion +
retention, range-overlap filtering, inverted-range rejection, delete
cascade. `npx tsc --noEmit` clean. Full vitest run: only pre-existing
failures unrelated to Planner (`format-activity-timestamp`,
`taskActivityIndicators`, vendored tiptap reference tests).

**TODOs deferred to later slices:**
- Proper lane packing + capacity math + part badges (`1/2`) with unit tests
  in `lib/planner.ts` — slice 2 (naive first-fit shipped now)
- Week nav / zoom (7/14) / member filter in URL; org-tz week anchor (page
  currently derives Monday from browser-local date) — slice 2
- Click bar → task drawer — slice 5; drag engine — slices 3–4
- `seedDemo` is dev-only scaffolding; remove or gate before production
  (slice 9 hardening)
- Done-task dimming + check mark on bars — slice 2/9 polish

### Slice 2 — Complete read-only grid ✅ approved (2026-07-05)

- [x] Pure math in `lib/planner.ts`, unit-tested (`lib/planner.test.ts`,
      19 tests): greedy first-fit lane packing (order-independent, inclusive
      day indexes, freed-lane reuse, touch=overlap), range clamp (both-edge
      clipping), inclusive span, workday counting across week boundaries,
      row capacity (weekend cells excluded from planned AND available;
      overlaps double-count; clamped to view; `over` flag)
- [x] Part badges: `weekGrid` returns `partIndex`/`partCount` ranked across
      ALL of the task's segments (off-screen + other-row siblings included)
      via pure `rankTaskSegments` (`convex/lib/plannerMath.ts`); badge shows
      only when count > 1 and the visible span ≥ 2 days (mockup rule)
- [x] Bars: day-count label (`4d`), done tasks dimmed (0.62) with check
      icon replacing the category dot, squared clip edges, hover tint
      15%→22%, selection ring (click; Esc/blank-click clears), dashed
      sibling outline on hover/selection of any segment of the same task
- [x] ~~Rail capacity~~ — **REMOVED by owner decision (2026-07-05 review)**:
      the planned/available counter + track was judged noise ("I can see the
      bars; overbooking is my call, the app doesn't need to comment").
      PRD user story 8 is dropped; `rowCapacity`/`countWorkdays` deleted
      from `lib/planner.ts` with their tests
- [x] URL state (`lib/hooks/use-planner-query-args.ts`, workday hook
      pattern — no nuqs): `week` ISO anchor (dropped on current week),
      `zoom=1w` (2w default dropped), `users` CSV (replace-mode writes);
      back button + shareable links work
- [x] Toolbar (mockup `tb` layout): Planner title, ‹ Today ›, range label,
      Week/2-weeks segmented zoom, member filter right-aligned
- [x] Member filter promoted to shared `components/member-filter.tsx`
      (Workday + Planner both use it; workday file re-exports old names);
      available to every org member on the Planner (shared board), unlike
      Workday's admin-only filter
- [x] No-plan empty state overlay (admin vs member copy) + no-members empty
      state; skeleton updated (toolbar, capacity block in rail)

**Verification:** 29 planner tests green (19 lib + 10 Convex incl. two new
part-badge cases), `npx tsc --noEmit` clean, full suite unchanged (same 4
pre-existing unrelated failures).

**TODOs deferred:**
- Drag engine (move/resize/reassign/⌥-split), selection + Delete — slice 3
- Click bar currently selects only; drawer opens in slice 5
- Done-bar check styling is our design call (mockup has no done-bar spec) —
  revisit in slice 9 polish if needed

### Slice 2 addendum — Month zoom (owner request at review, 2026-07-05)

- [x] Third zoom option: `Week | 2 weeks | Month` — true calendar month
      (Jul 1–31), not a rolling 4 weeks; nav shifts by month, Today jumps
      to the current month
- [x] URL: `zoom=1m` + `month=YYYY-MM` anchor (current month dropped);
      week zooms keep the `week` anchor — only the anchor matching the
      active zoom stays in the URL. Zoom switches carry position (week →
      month containing its Monday; month → week containing its 1st);
      multi-param writes batched into one history entry (`writeParams`)
- [x] Density: 42px/day minimum in month zoom (~1500px total, fits a
      laptop), single-letter day names, bar labels gated by a pixel-based
      threshold (`MIN_LABEL_PX / minDayPx` → 2 days in week zooms, 4 in
      month), Monday columns get a stronger left border for week
      orientation (header + stripes)
- [x] `monthRange` + `isMondayYmd` in `lib/planner.ts`, unit-tested (leap
      February, 30/31-day months, year end)
- [x] No backend change — `weekGrid` already takes arbitrary ranges

**Verification:** 27 planner tests green, `npx tsc --noEmit` clean.

### Slice 2 addendum 2 — Continuous timeline (owner request, 2026-07-05)

Structural change: paged prev/next replaced with a Toggl Plan-style
continuous canvas — trackpad gestures pan time freely.

- [x] Loaded day window as state (init 12 weeks around the URL anchor),
      grows ±4 weeks when panning within 14 days of an edge; left-extension
      compensates `scrollLeft` in a layout effect so the view never jumps;
      `overscroll-x-contain` stops macOS back-swipe hijack
- [x] Zoom became a pure density preset: fixed day widths 160/96/44px
      (`PLANNER_DAY_PX`), bar-label threshold derived from px width; zoom
      switch re-anchors scroll to keep the leftmost day in place; the
      `month=YYYY-MM` param from addendum 1 is gone (obsolete in a
      continuous world — `week` is the only anchor for all zooms)
- [x] URL sync: visible-span changes debounce 400ms → `week` anchor
      replace-write (current week dropped); toolbar range label follows the
      actually visible span; ‹ › buttons smooth-scroll ±1 week (±4 in month
      zoom), Today smooth-scrolls to the current Monday
- [x] `useDeferredValue` holds the last grid across window-extension
      refetches (no skeleton flash / scroll loss mid-pan, Workday pattern)
- [x] `mondayOfYmd` + `ymdToLocalDate` in `lib/planner.ts` (tested);
      `monthRange` removed with its tests (dead after the pivot)

**Verification:** 27 planner tests green, `npx tsc --noEmit` clean.
**Deferred:** popstate (back-button) repositioning mid-session — links load
at the right week, but pressing back after long panning doesn't re-scroll
(replace-mode writes keep history clean, so this is rare); day-column
virtualization if very long sessions accumulate thousands of columns.

### Slice 3 — Drag core: move, reassign, unschedule ✅ approved (2026-07-05)

- [x] `planner.updateSegment` (partial: dates and/or userId; merged range
      re-validated) + `planner.removeSegment` — `requireAdmin`, segment org
      ownership, target-user org membership (`assertOrgMember`, collect-all
      memberships so multi-org users can't confuse the check), invariant via
      shared `assertSegmentRange`
- [x] 6 new Convex tests: admin move/resize/reassign happy path, non-admin
      rejection (both mutations), cross-org segment + cross-org target user
      rejection, merged-range inversion rejection, remove keeps the task
- [x] Drag engine `lib/hooks/use-planner-drag.ts` (deep module, custom
      pointer events per PRD — no dnd-kit): 4px click/drag threshold,
      window-level listeners, day snapping via pure `proposeMovePlacement`
      (unit-tested: grab-offset, both edge clamps, over-wide span), row
      hit-testing against registered row elements (nearest-row snap above/
      below the board), Escape + pointercancel cancel, body grabbing cursor
      + user-select lock, unmount listener safety. Targets are DATES so
      mid-drag window extension can't shift the proposal
- [x] Single solid snapped preview (mockup ruling): original bar hidden
      from lane packing, ghost bar (20% tint over card + shadow) rendered
      at the snapped target; vertical drag = reassign, same gesture
- [x] Live lane reflow: ghost participates in `assignLanes` for the target
      row, neighbours animate `top` (120ms) and rows animate height while
      dragging; overlap is never rendered
- [x] Selection ring + Delete/Backspace unschedules (admin, editable-target
      guard), Escape deselects; click suppression after a real drag
- [x] Optimistic commits via Convex `withOptimisticUpdate` on the weekGrid
      cache (move across rows re-sorted; remove filtered) — automatic
      rollback + `toastError` on rejection
- [x] Read-only members: engine disabled (no grab cursor, no drag, no
      delete) AND server rejects independently (tested)
- [x] Bars/stripes switched from %-based to px-based positioning (fixed
      `dayPx` columns) — drag math and slice 6/8 pointer math stay trivial

**Verification:** 37 planner tests green (21 lib + 16 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same 4 pre-existing
unrelated failures).

**TODOs deferred:**
- ~~Resize handles + ⌥-split~~ — done in slice 4
- Auto-scroll when dragging near the container edge — slice 9 polish
  (continuous canvas makes long moves possible via trackpad pan mid-drag)
- ~~Drawer opens on click~~ — done in slice 5

### Slice 4 — Resize + ⌥-split ✅ (2026-07-05)

- [x] `planner.createSegment` mutation — `requireAdmin`, task org ownership,
      archived-task rejection (can't schedule what the board hides), target
      user via `assertOrgMember`, invariant via shared `assertSegmentRange`;
      `createdBy` from the authed admin
- [x] 4 new Convex tests: split happy path (2 sittings, task NOT duplicated,
      part badges 1/2+2/2 on next read), non-admin rejection, cross-org task
      + cross-org target user, inverted range + archived task rejection
- [x] Resize: 9px edge handles on both bar ends (hover shows the mockup's
      3px pill affordance), pointer-down enters `resize-start`/`resize-end`
      mode; the BAR ITSELF snaps day-by-day (solid preview replaces the
      original — no ghost, mockup ruling), 100ms left/width transition
      (mockup `.snapping`), day-count label live-updates, `ew-resize` body
      cursor; vertical movement never reassigns during resize
- [x] Minimum one day enforced by the pure `proposeResizePlacement` reducer
      (moving edge can never cross the anchor) — 4 unit tests incl. negative
      anchor indexes for segments clipped by the loaded window
- [x] ⌥-split: Alt during a move switches to copy mode live (pointer
      `altKey` on move + window keydown/keyup for stationary toggling) —
      original bar stays at full opacity, ghost gets the mockup's ⧉ glyph,
      body cursor `copy`; release calls `createSegment` (same taskId,
      never a duplicate task); toggling Alt mid-drag switches modes both
      directions
- [x] Optimistic split: weekGrid cache gains the new sitting (display fields
      cloned from the cached source segment, temp UUID id, partCount bumped
      on every sibling) → badges + sibling highlight update instantly;
      automatic rollback + `toastError` on rejection. Resize commits through
      the existing optimistic `updateSegment` path

**Verification:** 45 planner tests green (25 lib + 20 Convex),
`npx tsc --noEmit` clean.

**TODOs deferred:**
- Panel drag-to-schedule reuses `createSegment` — slice 6
- Done-bar resize/split interaction audit — slice 9 polish

### Slice 5 — Task drawer integration ✅ (2026-07-05)

- [x] `planner.taskSegments` query — every sitting of one task for the
      drawer's Plan section: user name joined, `partIndex`/`partCount` via
      the shared `rankTaskSegments`, sorted by start date; readable by every
      org member (shared board), org-scoped task check. 3 new Convex tests:
      member reads another row's sittings sorted + ranked, empty list after
      unschedule, cross-org task rejection
- [x] `components/planner/task-plan-section.tsx` — shared "Plan" section:
      each sitting as *date range · person · duration (`3d`) · part `n/m`*,
      hover-revealed × unschedule (admin only; members never see it) via
      `removeSegment` + `toastError`; "Not scheduled" empty state; renders
      wherever the metadata component is used (drawer AND modal), the board
      behind updates live through the weekGrid subscription
- [x] `formatSegmentRange` in `lib/planner.ts` (pure, unit-tested ×4):
      "Jul 6", "Jul 6 – 8", "Jul 30 – Aug 2", years only across a year
      boundary
- [x] `TaskDetailMetadata` extended in BOTH layouts below the existing
      fields with a hairline separator: grid (modal) gets a full-width
      row under the two columns, stack (drawer) gets its own group before
      Created by/on
- [x] Planner page mounts the EXISTING `TaskDetailDrawer` / `TaskDetailModal`
      per the user's `taskDetailView` preference (mobile → modal, /tasks
      rule), wrapped in `TaskReferenceDataProvider`; the drawer's reference
      data (statuses/categories/projects) subscribes only while `?detail=`
      is open so the board stays light
- [x] Bar click = select + open (`?detail=<taskId>` via `buildDetailUrl`,
      same URL mechanism as /tasks; direct links + refresh work); selection
      ring stays visible behind the overlay; Escape closes the drawer first
      (its document-level handler stops propagation before the grid's
      window-level selection handler), second Escape deselects
- [x] Prev/next (J/K) walks tasks in board order: row order, then each
      task's first visible segment (dedup on first appearance)

**Verification:** 52 planner tests green (29 lib + 23 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same pre-existing
unrelated failures: format-activity-timestamp ×3, taskActivityIndicators
×1, vendored tiptap reference test).

**TODOs deferred:**
- Panel card click → drawer — slice 6 (panel doesn't exist yet)
- Drawer `?detail=` deep link with a task that has zero visible segments
  works (drawer opens, board unaffected) — no J/K neighbors in that case,
  matches /tasks behavior with filtered-out tasks

### Slice 5 post-review fixes — flaky drawer opening (2026-07-06)

Owner report: opening sometimes needed two clicks; with a task open,
clicking another bar didn't switch. Root causes + fixes:

- [x] **Modal dismissal swallowed bar clicks (primary).** The page followed
      the /tasks drawer/modal preference; the default is MODAL — a
      fullscreen Radix Dialog whose `onPointerDownOutside` closes it, so
      the first click on another bar dismissed the modal and never reached
      the bar (→ "click twice", "other task won't open"). **Deviation from
      the slice spec (owner ruling):** the Planner now always uses the
      drawer on desktop — the board must stay visible and clickable behind
      an open task (mockup behavior); mobile keeps the modal. The
      `users.current` viewPref subscription was removed from the page.
- [x] **Stale click suppression in the drag engine.** `suppressClickRef`
      armed at the 4px threshold but was only cleared by a bar click —
      after a real drag the dragged bar unmounts (preview replaces it), no
      click event ever fires, and the flag silently ate the NEXT legitimate
      click. Fix: every new press resets the flag (a fresh press = a fresh
      click cycle).
- [x] **Hardening:** `window blur` mid-drag now cancels cleanly (missed
      pointerup no longer leaves ghost listeners/state; new presses also
      defensively drop leaked listeners); `pointerup.preventDefault()` now
      only fires when a drag was actually active, so plain clicks keep
      fully native semantics.

**Verification:** `npx tsc --noEmit` clean, 52 planner tests green; lint
on planner files shows only the repo-wide pre-existing `react-hooks/refs`
pattern flags (same "latest-value ref" convention as /tasks, 17 hits
there), no new rule classes.

### Slice 6 — Tasks panel + drag-to-schedule ✅ (2026-07-06)

- [x] `planner.taskPanel` query — every active (non-archived) TOP-LEVEL
      task with card fields (title, project/client names, category color,
      statusType, estimate, `plannedDays` = summed day-spans, `segmentCount`,
      createdAt), newest first; org-scoped hydration for projects → clients
      → categories; one bounded segments read grouped per task (no N+1).
      **Decision:** subtasks excluded — they are planned via their parent.
      2 new Convex tests: rollups + org/archive scoping; project/client/
      category joins + subtask exclusion + newest-first order
- [x] **PRD Open Question 1 resolved:** `tasks.estimate` is MINUTES (the
      estimate cell edits via `parseDuration`). Default span rule =
      `max(1, ceil(estimate/480) − plannedDays)`, 1 when unset — pure
      `defaultSpanDays` in `lib/planner.ts`, 3 unit tests (`segmentSpanDays`
      server twin in `convex/lib/plannerMath.ts`)
- [x] Panel UI (mockup `side` spec): 288px right sidebar inside the page
      frame, collapses below the grid < md (300px max-height list);
      header, search box (URL-debounced `q` param, matches title + project
      + client), Unscheduled/All tabs (`ptab` URL param, unscheduled
      default); open/closed in `panel` URL param (open default); toolbar
      "Tasks" button with primary-pill unscheduled-count badge
- [x] `PlannerTaskCard` shared visual: category dot + title + client name
      (NO estimate text per owner design ruling), done tasks dimmed, All
      tab shows "✓ planned" on scheduled ones; card-shaped panel skeleton;
      empty copy distinguishes no-match vs everything-planned
- [x] Drag-to-schedule in the ENGINE (panel mode, admins only): floating
      card follows the cursor (imperative transform — pointer moves don't
      re-render the board), morphs into the snapped ghost bar over the grid
      (synthetic segment runs the normal clamp → lane → bar pipeline, live
      reflow included), drop calls `createSegment`, outside drop flies the
      card back (140ms settle) and creates nothing; Alt has no meaning here;
      Escape/blur cancel; card click (< 4px) opens the task drawer for
      everyone
- [x] Optimistic panel create: display fields cloned from any cached
      sitting, falling back to the card data stashed in a ref (unscheduled
      tasks have no cached sitting); part counts bumped; rollback + toast
- [x] Engine lifted from the grid to the page (grid + panel share one
      instance via the `PlannerDragEngine` prop); plan mutations extracted
      to `lib/hooks/use-planner-mutations.ts` — the page dropped back to
      ~310 lines

**Verification:** 57 planner tests green (33 lib + 24 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same pre-existing
unrelated failures).

**TODOs deferred:**
- Filter chips (project/client/category/due) — slice 7
- Quick-add composer + draw-to-create — slice 8
- Panel drag auto-pan near grid edges — slice 9 polish (same item as bar
  drag auto-scroll)

### Slice 6 post-review fix — page-wide horizontal overflow (2026-07-06)

Owner report: the Tasks panel (and the toolbar's right side, including the
panel toggle) hung off-screen; the whole page scrolled horizontally.

- [x] **Root cause:** the classic flexbox `min-width: auto` trap at the
      shadcn `SidebarInset` (`flex w-full flex-1`, a horizontal flex item
      with no `min-w-0`). Slice 6's board+panel flex row let the Planner
      canvas's huge intrinsic width propagate up; the inset refused to
      shrink below it and grew past the viewport.
- [x] Fix at the choke point: `<SidebarInset className="min-w-0">` in
      `app/(dashboard)/layout.tsx` (canonical shadcn fix; shrink-only, safe
      for every page) + defense-in-depth `min-w-0` on the Planner page root
      and the board+panel flex row.
- [x] Verified in Chrome via devtools MCP at 1440px and 700px:
      `scrollWidth === clientWidth` (zero page overflow), panel fully
      visible, toolbar "Tasks 20" toggle reachable and working both ways
      (`?panel=0` URL round-trip), narrow viewport stacks the panel below
      the grid. The panel toggle itself already shipped with slice 6 — it
      was simply off-screen.

**Verification:** `npx tsc --noEmit` clean; no behavioral code changes
beyond three CSS classes.

### Slice 6 addendum — Tasks toggle de-slopped (owner feedback, 2026-07-06)

- [x] The toolbar "Tasks" toggle was a hand-rolled bordered pill with a
      blue primary count badge — owner called it "AI slop" (2nd occurrence
      of this feedback class; saved to memory as a standing rule). Rebuilt
      as a quiet shadcn `Button variant="ghost"` matching the MemberFilter
      trigger: `PanelRight` icon + label, count as plain muted
      `tabular-nums` text (hidden at 0), active state = soft `bg-muted`.

### Slice 7 — Panel filters ✅ (2026-07-06)

- [x] `taskPanel` items extended with filter identities: `projectId`,
      `clientId`, `categoryId`, `categoryName`, `dueDate` (URL filters
      store stable ids, never display names)
- [x] Pure filter predicate `passesPanelFilters` in `lib/planner.ts`
      (7 unit tests): options OR within a chip, chips AND together;
      uncategorized maps to the `"none"` category key; due semantics per
      mockup — overdue = `due < today`, week = `today ≤ due < today+7`
      (string math on the ORG-TIMEZONE today passed down from the page),
      none = no deadline; missing project/client never matches an active
      chip
- [x] URL state in `lib/hooks/use-planner-panel-filters.ts` (hand-rolled
      convention): `projects`/`clients`/`cats` CSV ids (+ `none` token) and
      `due=overdue|week|none`; defaults dropped; id-pattern validated
- [x] `components/planner/planner-panel-filters.tsx` — chip row between
      tabs and list (mockup `fbar`): Project/Client/Category as
      multi-select checkbox dropdowns (shadcn DropdownMenu, stays open
      while toggling), Due as radio; options derived from the panel's own
      task list (only actionable choices), categories with color dots +
      "No category"; dashed idle pills → solid primary-tinted active state
      with `Project · 2` count or the Due option label; Clear appears only
      when something is active and resets all four chips at once
- [x] Panel-scoped by design: filter params never reach the `weekGrid`
      query args, so the timeline is untouched; filters compose with
      search + tabs; empty state distinguishes "No tasks match." (narrowed)
      from "Everything is planned"

**Verification:** 64 planner tests green (40 lib + 24 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same 4 pre-existing
unrelated failures). Live-verified in Chrome (devtools MCP): Client chip →
`Client · 1` + `?clients=<id>`, list narrows to that client only; reload
restores the exact panel state; Due=Overdue composes
(`?clients=…&due=overdue`); Clear → clean URL, button disappears; board
bars unaffected throughout.

**TODOs deferred:**
- Quick-add composer + draw-to-create — slice 8
- Category options derive from tasks in the panel (not the full org
  category list) — revisit only if a filter for empty categories is ever
  needed

### Slice 7 redesign — Notion-style faceted filters (owner feedback, 2026-07-06)

Owner rejected the four always-visible chips ("gagyi"): they didn't fit
288px, and menus ignored other selections (all projects listed under an
active client filter). Approved redesign, built same day:

- [x] **Notion three-step flow:** idle state is a single quiet `+ Filter`
      affordance; it opens a two-step popover — property picker
      (`Filter by…` search + Project/Client/Category/Due date with icons),
      then the value list in the SAME popover. Each active filter renders
      as a compact chip (`Client: Arlow`, single value by name, multiple as
      a count) that reopens its value menu directly; already-active
      properties disappear from the picker
- [x] **Faceted (cross-filtered) menus:** pure `derivePanelFacets` in
      `lib/planner.ts` (4 unit tests) — each property's options come from
      tasks passing all OTHER chips + the active tab, with right-aligned
      muted match counts; zero-match options drop out unless selected
      (must stay untickable); "No category" appended only when relevant;
      Due options carry counts too. Free-text search deliberately does not
      feed facets
- [x] Value lists get a search input at ≥8 options (hundreds of projects);
      Due is single-select and closes on pick; per-menu "Clear selection"
      empties the property (chip auto-disappears); row-level Clear resets
      everything
- [x] Visual language per the no-pill-badges rule: quiet `bg-muted` chips,
      muted property prefix + medium value, ghost `+ Filter`; Popover +
      Checkbox rows (member-filter precedent), no hand-rolled dropdown
- [x] URL schema unchanged (`projects`/`clients`/`cats`/`due`) — slice 7
      acceptance criteria (round-trip, panel-scoped, org-tz due) remain
      satisfied

**Verification:** 68 planner tests green (44 lib + 24 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same 4 pre-existing
unrelated failures). Live-verified in Chrome: property picker lists all
four; Client value list shows counts (Arlow 6, Pragmatico 6…); selecting
Arlow → `Client: Arlow` chip + `?clients=<id>`; the Project menu then
offers ONLY "Arlow monthly retainer (6)"; chips + `+ Filter` + Clear fit
one row; zero console errors.

### Slice 7 redesign addendum — tabs folded into the filter system (owner, 2026-07-06)

Owner: "Unscheduled/All should be the same kind of filter as the rest, not
a separate thing." The tab row is gone; scheduling state is now a regular
filter property.

- [x] `PlannerPanelFilters` gained `schedule: all|unscheduled|planned`
      (single-select **Schedule** property, `CalendarCheck` icon, first in
      the picker); predicate + facets extended — schedule cross-filters
      and gets counts like every other property (`Unscheduled 17 /
      Planned 8`); "planned" is a NEW capability (only scheduled tasks)
- [x] The default view stays the to-plan inbox: a clean URL pre-applies a
      fully regular `Schedule: Unscheduled` chip (changeable/removable
      like any other). URL: `sched` param — absent = unscheduled (default
      dropped), `sched=planned`, `sched=all` (Clear resets to the truly
      empty state, which is therefore WRITTEN to the URL)
- [x] `ptab` param + tab UI + `PlannerPanelTab` type removed
      (`use-planner-query-args` slimmed); `isUnscheduledTask` moved to
      `lib/planner.ts` (panel + toolbar badge share one definition);
      "✓ planned" mark now shows on any scheduled card wherever visible
- [x] Global Clear appears only when the view differs from the default
      inbox (the pre-applied chip alone is not "something to clear") —
      keeps the default filter row to one line

**Verification:** 71 planner tests green (47 lib incl. schedule predicate
+ facet cases), `npx tsc --noEmit` clean, full suite unchanged.
Live-verified: default = `Schedule: Unscheduled` + `+ Filter` one-liner,
no tab row; chip menu shows counts; switching to Planned → `?sched=planned`
+ all 8 cards carry the planned mark; untoggling → `?sched=all`, chip
disappears; reload restores each state.

### Slice 8 — In-place task creation ✅ (2026-07-06)

- [x] `planner.createTaskWithSegment` mutation — ATOMIC draw-to-create: one
      transaction creates the task AND its first segment; every referenced
      id is validated before any write, so a failure (bad project,
      cross-org user, inverted range) leaves no half-created task. Task
      defaults deliberately identical to /tasks inline-add (default backlog
      status via `getDefaultStatusId`, appended fractional sort key on the
      same index, `billable: true`, no category/due/description, empty
      `assigneeIds` — `resolveDefaultAssignee` needs a category to match,
      planner tasks never have one; the row's user is NOT assigned per PRD:
      segments carry their own userId). `task_created` activity logged;
      `requireAdmin` + `assertOrgMember` + shared `assertSegmentRange`
- [x] 4 new Convex tests: defaults equivalence against a twin task created
      through `api.tasks.create` (status/sort-key/flags field-by-field +
      trimmed title + activity log), project accepted + cross-org project
      rejected, ATOMICITY (failing segment leaves no orphan task),
      non-admin + empty title + cross-org target user rejection
- [x] Draw-to-create in the drag engine (new mode alongside move/resize/
      panel): crosshair cursor on empty row cells (admins), press + drag
      sketches a neutral-gray "New task" ghost snapped day-by-day in BOTH
      directions (pure `proposeDrawPlacement` reducer in `lib/planner.ts`,
      3 unit tests), day-count label, live lane reflow (the ghost runs the
      normal clamp → lanes → bar pipeline), Escape/blur/pointercancel
      cancel mid-draw; the sketch never leaves its row (mockup rule);
      anchor stored as a DATE so mid-drag window extension can't shift it;
      bar presses now stop propagation so they never start a draw
- [x] Release → title popover (mockup `qc`) anchored below the pending
      ghost INSIDE the row canvas (pans with the timeline): pending state
      lives on the page so it survives board re-renders; Enter or the
      button creates atomically, Escape/outside-pointerdown cancels and
      removes the ghost; a rejected create keeps the popover + typed title
      and toasts (PRD 35). Commit is deliberately pessimistic — an
      optimistic bar would double-render next to the pending ghost, and
      Convex applies the mutation's query updates before resolving, so
      success can't flash a gap
- [x] Quick-add composer (mockup `qadd`): "+ New task" toolbar button
      (admins; primary CTA per mockup) opens the panel + mounts the
      composer at the top of the list, autofocused (repeat click remounts
      via a nonce key → refocuses). Enter/button creates an UNSCHEDULED
      task through the canonical `tasks.create` (server resolves the same
      defaults), clears the title, keeps focus for rapid capture; the new
      card lands on top (newest-first) and the unscheduled badge ticks up;
      Escape closes; failure restores the cleared title + toasts
- [x] Shared `PlannerCreateForm` (one form behind popover + composer):
      title input + project picker + submit button; subscribes to
      `projects.list` itself so the board only pays for it while a form is
      open
- [x] Members: engine disabled → no crosshair/draw (canvas handler and
      cursor are admin-gated), no "+ New task" button, no composer; the
      server rejects `createTaskWithSegment` independently (tested)

**Owner feedback applied mid-slice (2026-07-06):** the first cut's plain
`<select>` failed live review — (1) after picking a project, Enter did
nothing (focus was stuck on the select); (2) hundreds of clients made an
unsearchable list unusable; (3) Enter-only submit was undiscoverable.
Redesign: searchable Popover+Command project picker (inline-add project
cell pattern — grouped by client, search matches project AND client
names), picking returns focus to the title input so Enter always works,
and both forms gained an explicit primary **Create task / Add task**
button (disabled while the title is empty) with an "esc to cancel" hint.
No delete button — outside click already cancels (owner-confirmed).

**Verification:** 78 planner tests green (49 lib incl. 3 new
draw-placement + 29 Convex incl. 4 new createTaskWithSegment tests, one
of which covers 2 rejection cases), `npx tsc --noEmit` clean, full suite
unchanged (same 4 pre-existing unrelated failures). Live-verified in
Chrome (devtools MCP, admin): crosshair on empty cells; draw Mon 13 →
Wed 15 on a teammate's row → snapped 3d ghost + popover; picker search
"arlow" narrows grouped options; picking returns focus to the title;
Enter → "Slice 8 draw demo · Arlow monthly retainer" bar on the board at
the drawn range; mid-draw Escape cancels the sketch; outside pointerdown
cancels an open popover + ghost; "+ New task" → composer autofocused, two
rapid Enter captures land on top of the panel (badge 16 → 18), input
clears + refocuses each time, Escape closes; zero console errors/warnings.

**TODOs deferred:**
- Draw/panel-drag auto-pan near grid edges — slice 9 polish (existing item)
- Demo artifacts on the dev org ("Slice 8 draw demo", "Composer capture
  1/2") left in place as dummy data — wipe with the next `seedDemo` run if
  noise
- A shared searchable project-combobox component (this form + inline-add
  cell now implement the same pattern twice) — extraction candidate for
  slice 9 / a later cleanup pass, deliberately not refactoring /tasks
  files inside a planner slice

### Slice 8 addendum — crosshair replaced with Notion-style hover "+" cell (owner feedback, 2026-07-06)

Owner rejected the crosshair cursor ("Notion sohasem használna ilyet");
approved option: hover-ghost "+" cell.

- [x] Crosshair removed everywhere: empty cells keep the normal arrow, and
      the body cursor during an active draw is locked to `default` (stops
      bar grab-cursor flicker while the sketch sweeps under bars)
- [x] Notion Calendar / Toggl Plan affordance instead: hovering an empty
      cell (admins) shows a faint rounded day placeholder with a small `+`
      (`border-border/60`, 3% foreground tint, muted PlusIcon) in the
      first lane free at that day; drawing works exactly as before
- [x] Placeholder hides over bars/handles, during any drag/preview/pending
      popover, and on days whose every existing lane is occupied (the row
      must never grow on hover); `pointer-events-none` so it can't
      intercept the press; per-day state updates only on day change

**Verification:** `npx tsc --noEmit` clean; live in Chrome: arrow cursor
on empty cells, "+" placeholder follows the hovered day, disappears the
moment a draw starts (ghost takes over, body cursor stays arrow), draw →
popover flow unchanged; zero console errors.

### Slice 8 addendum 2 — stable lane packing (owner bug report, 2026-07-06)

Owner: resizing a bar made neighbours jump above/below it ("majd én
átrendezem, amikor akarom — ne ugráljon a sorrend"). Root cause: lane
packing sorted by (startIdx, endIdx), so editing a bar's dates changed its
packing PRIORITY and reshuffled the whole row.

- [x] `assignLanes` now packs by a stable `order` key (segment
      `createdAt`) instead of dates: a bar's lane never depends on its own
      dates, so resize/move can't reshuffle neighbours. Collisions resolve
      deterministically — older bars stay anchored, newer ones cascade
      below, and they pop back up when the collision ends. Stability makes
      lanes non-contiguous, so packing tracks occupied intervals per lane
      (the old single-running-end trick assumed date order); may cost one
      extra lane vs. optimal — accepted trade
- [x] `weekGrid` bars carry `createdAt`; move/resize previews inherit the
      dragged segment's priority (the held bar keeps its lane), ⌥-copy +
      panel-drop + draw ghosts and the optimistic panel-create use
      newest-possible priority (always pack below real bars)
- [x] 3 new `assignLanes` tests: priority-over-dates, the exact
      resize-jump repro (neighbour must not move), freed-gap reclamation
      between older bars; existing lane tests migrated to the `order` key

One-time effect: rows re-sorted once from date order to creation order on
deploy; from then on the vertical order is stable. Manual vertical
reordering (persisted rank, /tasks `manualSortKey` pattern) is the natural
follow-up if the owner wants full control — deferred until asked.

**Verification:** 81 planner tests green (52 lib + 29 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same 4 pre-existing
unrelated failures). Live in Chrome: stretched the "Test" bar over three
newer bars — the held bar stayed in its lane, the newer ones cascaded down
one lane each, the oldest top bar never moved; Escape restored the exact
original layout; zero console errors.

### Slice 8 addendum 3 — manual restack: drag a bar above/below another (owner request, 2026-07-06)

Owner: within one person's row, dragging a bar over another must let him
choose which goes on top ("húzom fölé → kerüljön fölé, szneppeljen be").
The stable packing (addendum 2) made order deterministic; this makes it
OWNED.

- [x] Schema: `planSegments.laneOrder` (optional float) — manual vertical
      stacking priority, lower = higher on screen; unset falls back to
      `createdAt` (no migration, MVP dummy data). `weekGrid` bars expose
      the effective priority as `laneOrder`; `updateSegment` accepts and
      persists it (restack rides the same admin-gated mutation as
      move/resize/reassign, dates optional)
- [x] Pure `proposeLaneOrder` in `lib/planner.ts` (6 unit tests): packs
      the target row (dragged bar excluded), splits its collision set at
      the pointer lane, returns the midpoint between the above-group max
      and below-group min (−1/+1 past the ends); null when nothing
      collides OR the current order already satisfies the constraints —
      dropping a bar back where it was writes nothing
- [x] Engine: move targets now carry the pointer's visual lane in the
      target row (`laneFromY` against the registered row elements);
      `pressLane` recorded at press so a same-row/same-dates/same-lane
      drop stays a no-op; vertical-only drops within a row commit
- [x] Live preview: the move ghost's packing priority is the SAME
      `proposeLaneOrder` result the drop will commit — the ghost snaps
      above/below neighbours while dragging, so what you see is exactly
      what lands. Resize previews keep the bar's own priority (resize
      never restacks); ⌥-copy/panel/draw ghosts still pack below all
- [x] Commit path: `usePlannerMutations` takes the displayed grid + day
      window (via ref, callbacks stay stable), resolves lane → laneOrder,
      skips true no-ops, and the optimistic weekGrid update applies the
      new order instantly; `lane` is stripped from every mutation payload
      (Convex rejects unknown args)
- [x] Cross-row drops respect the pointer lane too (reassign + restack in
      one gesture); 1 new Convex test: laneOrder persists via
      updateSegment and weekGrid falls back to createdAt when unset

**Verification:** 88 planner tests green (58 lib + 30 Convex),
`npx tsc --noEmit` clean, full suite unchanged (same 4 pre-existing
unrelated failures). Live in Chrome: dragged "fafse" one lane up over
"Ez egy development" (same dates) — the ghost previewed the swap mid-drag,
the drop committed it, and the order survived a full page reload; dates
untouched; zero console errors.

**Deferred:** float-midpoint precision re-spread (only relevant after ~50
restacks between the same two bars — MVP non-issue).

### Filter popover state-leak fix + back navigation (owner bug report, 2026-07-06)

Owner repro: after picking a single-select value (Schedule) via `+ Filter`,
the button forever reopened on that value list (no header, no way back)
and the whole system felt broken/undeletable.

- [x] **Root cause:** the add-flow's two-step `property` state was only
      reset in Radix `onOpenChange` — but single-select picks close the
      popover PROGRAMMATICALLY (`setOpen(false)`), which does not fire
      `onOpenChange`, so the step state leaked. Fix: one `close()` path
      (close + reset always travel together); every exit route — outside
      click, Escape, single-select pick — funnels through it. Value lists
      also get `key={property}` so per-property search state can never
      bleed
- [x] **Back navigation added** (was in the approved design, dropped in
      the first implementation): value lists inside the `+ Filter` flow
      get a `‹ PropertyName` header that steps back to the property
      picker — also fixes the "anonymous menu" discoverability problem in
      the owner's screenshot. Chip popovers stay headerless (direct value
      access)

**Verification:** `npx tsc --noEmit` clean, 71 planner tests green, full
suite unchanged. Live repro of the exact bug sequence in Chrome: pick
Schedule→Planned from `+ Filter` → reopening shows the PROPERTY PICKER
(with Schedule hidden while active); chip `Schedule: Planned` → clicking
the active option removes it (`?sched=all`); reopening `+ Filter` offers
Schedule again.

## Today × Planner Unification — 2026-07-06 (in progress)

PRD: `docs/today-planner-prd.md` (supersedes `docs/today-tab-prd.md`, banner
in place). Slices: `docs/today-planner-issues/`. "Today" stops being a
status and becomes a derived, per-user daily plan computed from
`planSegments` — My Tasks and the Planner are two lenses over one dataset.

### Slice 01 — Tracer: Planner plan appears in My Tasks Today ✅ (2026-07-06)

- [x] `planSegments` index `by_orgId_userId_startDate` (covering-today
      lookup, scan-guarded to today − 60d)
- [x] Pure helpers `convex/lib/todayPlan.ts`: `segmentCoversDate`,
      `partitionMyDay` (Today + Earlier contract, arrival ordering by
      covering-segment createdAt, 14-day Earlier window constant)
- [x] `listMyTasks` rework: derived Today group first (membership from
      segment taskIds — the plan wins over assignment), suppression from
      status groups with per-group `inTodayCount`, `hiddenCount` respects
      Today visibility, planned-but-unassigned completions land in
      Completed today
- [x] UI: Today group (sun header + "the Planner's plan for today" hint),
      status badge on Today rows, assignment-mismatch dimmed avatar
      (dashed circle when unassigned) + tooltip, `· N in Today` header
      notes, TodayEmptyState, content-aware skeleton update
- [x] Tests: todayPlan suite (boundaries, dedupe, archived, windowing,
      ordering) + myTasks suppression/inTodayCount

### Slice 02 — Sun gestures + admin-or-self permissions ✅ (2026-07-06)

- [x] `planRemovalOps` + `summarizeRemovalOps` (delete / trim-start /
      trim-end / split; split remainder inherits laneOrder — stable lanes)
- [x] `addToToday` (idempotent one-day segment, archived rejected) and
      `removeFromToday` (surgery on ALL covering segments) — self-scoped,
      member-callable, zero activity-log writes
- [x] `createSegment`/`updateSegment`/`removeSegment` widened admin-only →
      admin-or-self (`assertCanManagePlanFor`): members own-row only, no
      reassigning to others; server-enforced
- [x] Shared `components/add-to-today-button.tsx`: ghost sun, hover-reveal
      desktop / muted always-visible touch (`pointer-coarse:`), filled
      amber active, plan-term toasts; wired into MyTaskRow
- [x] Tests: removal-op branches; permission matrix + idempotency +
      surgery in `convex/__tests__/todayGestures.test.ts`

### Slice 05 — Today status retirement + seed + docs ✅ (2026-07-06)

- [x] `DEFAULT_STATUSES`: "Today" removed, sortOrder renumbered (Inbox →
      Next up → In progress → Admin review → Client review → Stuck → Done)
- [x] `resolveVisibleStatusIds` moved to `lib/myTaskHelpers.ts` (pure,
      tested) + hardening: org default that filters to empty now falls
      through to first in_progress instead of returning a blank view
- [x] Fallback tests: preference referencing a deleted status → org
      default → first in_progress; old type-key format; never blank
- [x] Dev data: `npx convex run migrations/retireTodayStatus '{}'` (dev
      helper in the established migrations/ one-off pattern — NOT a
      production migration, per the PRD's recorded no-migration decision)
      re-statused 2 tasks and deleted the status in the dev org
- [x] Test fixtures renamed (STATUS_TODAY → STATUS_TRIAGE); no remaining
      code/copy references a "Today" *status*

### Slice 03 — Today experience complete ✅ (2026-07-06)

- [x] `planSegments.todaySortKey` (fractional string key) — manual Today
      ordering; `partitionMyDay` honours it (min across covering segments)
      before the createdAt arrival fallback, returns the per-task effective
      key + the Earlier list as a nested Today-group payload
- [x] `reorderTodayTask` (self-scoped, writes todaySortKey on the caller's
      covering segments) + `createTodayTask` (inline-add: first In progress
      status + self-assign + one-day today segment, one atomic gesture)
- [x] `myTasksCount` reworked → caller's remaining (uncompleted) Today
      count via the same partition; sidebar badge hidden at zero
- [x] Earlier subsection (`TodayEarlierSection`): 14d leftovers, expanded
      by default, collapsible, dimmed rows + status badge, "Move to today"
      → fresh one-day segment (old segment stays as history)
- [x] Within-Today drag reorder (reuses MyTasksSortableRow + optimistic
      pattern, targets reorderTodayTask); inline-add wired; skeleton +
      confetti re-key (TodayAllDoneState fires on Today empty + completed)
- [x] Tests: todaySortKey ordering (manual beats createdAt, min-across,
      unkeyed appends); reorder/create/count/move-to-today convex tests
      Live in Chrome: inline-add → In progress + assigned + planned today;
      Earlier "Move to today" → fresh segment + toast, old segment kept

### Slice 04 — Triage everywhere ✅ (2026-07-06)

- [x] Backend: `myTodayTaskIds` query (caller's covering-today task ids, one
      index-backed read for row sun state) + `bulkAddToToday` mutation
      (self-scoped, idempotent, archived-skipped, honest counts) +
      `taskSegments` enriched → `{ segments (isMine, coversToday),
      canAddToToday }`
- [x] `/tasks` rows: `AddToTodayButton` in the action cluster (grid last col
      widened 32→64px), hover-revealed / filled-persistent when in Today
- [x] Bulk toolbar: quiet "Add to Today" action (sun), toast reports the
      real added count
- [x] Plan section (drawer + modal): today-covering segments highlighted
      (amber tint + sun), member self-service unschedule for own segments
      (server admin-or-self, UI gate via `isMine`), dashed "Add to today"
      affordance when `canAddToToday`
- [x] Tests: bulkAddToToday mixed selection (added/alreadyPlanned/archived,
      idempotent, per-user) + myTodayTaskIds (dedupe, per-user); planner
      taskSegments tests updated to the object shape
      Live in Chrome: row sun add → filled + toast + badge; bulk add 2 →
      both filled + badge +2; Plan section Jul-6 highlight; "Add to today"
      affordance on an unscheduled task

### Slice 06 — Planner member self-editing ✅ (2026-07-06)

- [x] Per-row editability predicate `canEditRow = isAdmin || row === me`
      threaded through `PlannerGrid` (viewerUserId prop): `canDrag`,
      draw-to-create canvas pointer-down, and Delete/Backspace unschedule
      all gate on it; `PlannerRow` only wires bar move-pointerdown on
      editable rows
- [x] Drag engine `canReassign` (=isAdmin): member moves clamp to the source
      row and null the lane — horizontal-only, no cross-user reassign, no
      vertical restack; `ownRowUserId` restricts panel-card drops to the
      member's own row
- [x] Engine `enabled` widened to any authenticated viewer (per-row gating
      does the restricting); page passes viewerUserId + canReassign +
      ownRowUserId
- [x] `createTaskWithSegment` widened admin-only → admin-or-self (draw-to-
      create is a self-scheduling gesture); `requireAdmin` import dropped
- [x] Completed bars already dimmed (opacity) + leading check glyph in
      `PlannerBar` (isDone) — verified live on a done task's bars
- [x] Tests: createTaskWithSegment admin-or-self (member own row allowed,
      another rejected, empty/cross-org rejected)
      Live in Chrome (admin): board fully interactive, completed "Pot jonker"
      bars render dimmed with ✓. Member-view gating enforced by server
      permission tests + the canEditRow/canReassign UI predicate (member
      login not exercised live this session).

**Feature complete** — all six slices (01–06) landed. "Today" is a derived
per-user plan from `planSegments`; My Tasks and the Planner are two lenses
over one dataset with zero sync. Earlier redesigned as its own section
below Today (owner feedback, 2026-07-06).

### Verification (slices 01–02–05)

`npx tsc --noEmit` 0 errors after every slice; todayPlan + myTasks +
todayGestures + planner suites green (only pre-existing unrelated failures
in the full run). Live in Chrome: Planner bar ↔ My Tasks Today derivation
both directions, sun add/remove round-trip with Planner bar
appearing/disappearing, suppression hints, status deletion with no blank
My Tasks (fallback chain exercised on a real dangling preference).

### TODOs deferred to later phases (PRD § Out of Scope)

- Cross-group drag (sun icon is the sole membership gesture in v1)
- "Include due today" view toggle (due ≠ plan by default)
- Tabs/lenses layout for My Tasks; an "Upcoming" group
- Auto-carry / auto-reschedule of leftovers — never (Earlier + one click)
- Capacity indicators / overbooking warnings (standing decision)
- Per-row keyboard shortcut for Add to Today
- Subtask planning; plan-vs-actual reporting UI; plan-change notifications
- Renaming the `todayVisibleStatuses` preference field (naming debt)
