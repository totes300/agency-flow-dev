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
