# Phase 5 — Tasks Core: Implementation Plan

> **Date**: 2026-03-16
> **Status**: Planning
> **Depends on**: Phase 3 (Projects Core) — complete
> **Design approach**: Paper design for page layout (Chunk 4), row/group styles already mocked

---

## Decisions

| Question | Decision |
|----------|----------|
| statusType on tasks? | Yes — denormalized for index queries |
| systemRole on statuses? | Yes — Today tab is rename-safe |
| Saved Views? | Deferred — URL state + bookmarks |
| Tiptap editor? | Deferred — plain textarea in Phase 5 |
| sortOrder on tasks? | Dropped — createdAt DESC, add in v2 |
| Search scope? | Title-only via Convex searchIndex |
| Migration? | No backfill (fresh dev orgs only) |
| Priority? | Table + tabs + inline editing first |

## Staff Review Simplifications

- No column config abstraction — direct JSX, extract when needed
- Only 4 inline-edit cell files — other 6 cells inline in task-row
- No `taskHelpers.ts` — everything in `convex/tasks.ts`, extract if >400 lines
- `nuqs` for URL state — not hand-rolled serialization
- No `use-group-collapse.ts` — inline localStorage in task-group
- No pre-built `project-picker.tsx` — build in first consumer, extract on second use
- Merged backend queries + mutations into one chunk
- shadcn primitives first (Popover, Command, Dialog, Badge, Avatar, Sheet, etc.)

---

## 9 Chunks

### Chunk 1: Schema + Seed
**Size: M** | **Deps: none**

| Action | File |
|--------|------|
| Modify | `convex/schema.ts` — add tasks table (indexes + searchIndex), add systemRole to statuses |
| Modify | `convex/lib/constants.ts` — update DEFAULT_STATUSES with systemRole |
| Modify | `convex/lib/validators.ts` — add statusType union validator |
| Modify | `convex/statuses.ts` — seed writes systemRole |

**Test:** `npx convex dev` clean. `npx tsc --noEmit` = 0. Existing app works.

---

### Chunk 2: Backend — All Queries + Mutations
**Size: L** | **Deps: Chunk 1**

Everything in `convex/tasks.ts`. Queries and mutations together for end-to-end testability.

| Action | File |
|--------|------|
| Create | `convex/tasks.ts` — counts, list, listMore, create, update, archive, restore, remove, duplicate, bulkUpdate |
| Modify | `convex/statuses.ts` — check task references on status delete |

**Test:** Create tasks via Convex dashboard. Counts correct. List returns grouped results with joins. Filters + permissions work. CRUD works. statusType synced. Bulk ops work.

---

### Chunk 3: URL State + User Avatar
**Size: M** | **Deps: Chunk 2**

| Action | File |
|--------|------|
| Install | `nuqs` — Next.js URL state library |
| Create | `lib/hooks/use-task-filters.ts` — uses `nuqs` for tab, groupBy, search, filter operators |
| Create | `components/user-avatar.tsx` — shadcn Avatar + AvatarFallback with initials |

**Test:** URL round-trips. Set filters → refresh → same state. UserAvatar renders with/without image.

---

### Chunk 4: [DESIGN FIRST] Page Shell — Header + Tabs + Skeleton
**Size: M** | **Deps: Chunk 3**

Design in Paper first, then implement.

| Action | File |
|--------|------|
| Modify | `app/(dashboard)/tasks/page.tsx` — thin orchestrator |
| Create | `app/(dashboard)/tasks/loading.tsx` — content-aware skeleton |
| Create | `components/tasks/tasks-header.tsx` — title + search (Input) + Button "+ New task" |
| Create | `components/tasks/tasks-tabs.tsx` — 6 tabs with Badge counts, Filter/Group by Buttons |
| Create | `components/tasks/tasks-list-skeleton.tsx` — Skeleton matching table layout |
| Create | `components/tasks/tasks-empty-state.tsx` — per-tab messages |

**Test:** Navigate to `/tasks`. Header + tabs + live counts. Tab switching via URL. Empty states. Skeleton during load.

---

### Chunk 5: Task Table + Inline Editing
**Size: L** | **Deps: Chunk 4**

CSS Grid rows. Only 4 editable cells get their own files — rest inline in task-row.

| Action | File |
|--------|------|
| Create | `components/tasks/tasks-table.tsx` — CSS grid + sticky column headers |
| Create | `components/tasks/task-row.tsx` — 10 cells (6 inline JSX + 4 imported edit cells) |
| Create | `components/tasks/inline-status-cell.tsx` — Popover + Command dropdown |
| Create | `components/tasks/inline-category-cell.tsx` — Popover + Command dropdown |
| Create | `components/tasks/inline-project-cell.tsx` — Popover + Command, grouped client→project |
| Create | `components/tasks/inline-assignee-cell.tsx` — Popover + Command multi-select |
| Modify | `app/(dashboard)/tasks/page.tsx` — wire list query |

**Grid:** `grid grid-cols-[32px_1fr_80px_110px_90px_140px_50px_80px_60px_28px]`

**Test:** All 10 columns render. Inline edit 4 fields. Optimistic update. Done state. Row menu.

---

### Chunk 6: Grouping + Inline Task Creation
**Size: M** | **Deps: Chunk 5**

| Action | File |
|--------|------|
| Create | `components/tasks/task-group.tsx` — header (chevron + name + count) + localStorage collapse |
| Create | `components/tasks/inline-add-task.tsx` — Input row, rapid entry, auto-inherits group |
| Modify | `components/tasks/tasks-table.tsx` — grouped rendering + per-group Load more |
| Modify | `app/(dashboard)/tasks/page.tsx` — wire Group by DropdownMenu |

**Test:** Grouping works. Collapse persists. Empty groups. Inline create inherits group value. Rapid entry. Pipeline order for status groups.

---

### Chunk 7: Filter System
**Size: M** | **Deps: Chunk 6**

| Action | File |
|--------|------|
| Create | `components/tasks/tasks-filter-bar.tsx` — pill row (Badge), hidden by default |
| Create | `components/tasks/filter-pill.tsx` — Popover two-step (operator → Command value list) |
| Modify | `components/tasks/tasks-tabs.tsx` — Filter button active state |
| Modify | `app/(dashboard)/tasks/page.tsx` — wire filter state via nuqs |

**Test:** Two-step filter works. Blue/red pills. URL state. Clear all. Due date presets + range. Member no Client filter.

---

### Chunk 8: Task Creation Modal + Bulk Operations
**Size: L** | **Deps: Chunk 7**

| Action | File |
|--------|------|
| Create | `components/tasks/task-form-modal.tsx` — Dialog, Input, Textarea, pill bar Popovers, split Button |
| Create | `components/tasks/bulk-toolbar.tsx` — fixed bottom bar, Popovers, AlertDialog pre-flight, useUndoAction |
| Modify | `app/(dashboard)/tasks/page.tsx` — wire modal + selection + toolbar |

**Test:** Modal creates tasks. Create & add another. Bulk max 50. All bulk ops. Pre-flight. Undo toast.

---

### Chunk 9: Mobile View + Polish + Docs
**Size: M** | **Deps: Chunk 8**

| Action | File |
|--------|------|
| Create | `components/tasks/task-card.tsx` — Card component for mobile |
| Modify | `app/(dashboard)/tasks/page.tsx` — responsive switch at 768px |
| Modify | `components/tasks/tasks-tabs.tsx` — scrollable on mobile |
| Modify | `components/tasks/tasks-filter-bar.tsx` — Sheet (bottom sheet) on mobile |
| Modify | `docs/backlog.md` — Phase 5 checklist + deferred TODOs |

**Test:** Mobile card view. FAB. Scrollable tabs. Bottom sheet filters. Full acceptance criteria. `npx tsc --noEmit` = 0. `npm run build` = success.

---

## Visual Direction (Paper mockups)

- **Row: B — Structured Clean (Asana)** — pill badges, thin borders, avatar initials
- **Group: A — Subtle Divider (Linear)** — muted text headers, no fill, indented tasks

## Architecture

- **CSS Grid (div-based)** — explicit Tailwind `grid-cols-[...]`, no config abstraction
- **shadcn primitives first** — Popover, Command, Dialog, Badge, Avatar, Sheet, Button, Input, etc.
- **4 inline-edit cell files** — status, category, project, assignee (have popover logic)
- **6 inline cells in task-row** — checkbox, name, activity, due, time, menu (trivial JSX)
- **`nuqs` for URL state** — type-safe, handles back button + SSR
- **Server-side enrichment** — `tasks.list` batch-joins all related data
- **One backend file** — `convex/tasks.ts`, extract helpers only if >400 lines
- **No premature abstractions** — extract on second use, not first
- **Tailwind only, no inline styles** — `cn()` for conditional classes
- **Reuse existing components** — StatusBadge, CategoryBadge, RowActionMenu, useUndoAction

## Reference Files
- `convex/clients.ts` / `convex/projects.ts` — backend patterns
- `components/clients/clients-table.tsx` — UI table pattern
- `lib/hooks/use-undo-action.ts` — archive undo
- `components/status-badge.tsx` / `components/category-badge.tsx` — domain badges
- `components/row-action-menu.tsx` — row ⋮ menu
