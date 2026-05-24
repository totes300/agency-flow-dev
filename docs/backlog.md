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

## Phase 8 — Time Entry Settlement

> **Goal**: Fix the reporting bug where within-budget retainer periods (and Fixed projects) leave time entries forever "open / not invoiced". Split *invoice linkage* from *client-facing work closure* via a lightweight settlement model on `timeEntries` + 2 new admin-action fields on `retainerPeriods`.
>
> **PRD**: `docs/phase-8-time-entry-settlement.md`
>
> **Slice plan**: 4 vertical slices. Slices 1 + 2 run in parallel; 3 blocks on both; 4 closes out the phase.
> - `docs/phase-8-slice-1-settlement-foundation.md` — T&M + Fixed + void settlement end-to-end
> - `docs/phase-8-slice-2-retainer-cycle-extraction.md` — refactor + `isMonthClosed` rename ✅
> - `docs/phase-8-slice-3-period-close-reopen.md` — retainer within-budget close + write guard
> - `docs/phase-8-slice-4-cycle-close-and-ui-polish.md` — rollover cycle close + drill-down + entry-list polish

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

### TODOs deferred to later phases
- **Settlement model + invoice transition wiring** (T&M / Fixed / void) — Slice 1 of this phase.
- **Period close/reopen mutation + closed-period write guard** — Slice 3 of this phase.
- **Rollover cycle close, period drill-down, time-entry list polish** — Slice 4 of this phase.
- **`projectId` denormalization on `timeEntries`** — perf-driven follow-up; `closePeriod`/`reopenPeriod` use task fan-out (N+1 acknowledged). Trigger threshold: 10K+ entries/org or visible latency.
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
