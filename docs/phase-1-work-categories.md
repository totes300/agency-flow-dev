# Phase 1 — Work Categories

> **Goal**: Manage work categories (Design, Dev, PM, etc.). These thread through the entire app — projects, tasks, pricing.
> **Depends on**: Phase 0 (Foundation)
> **Access**: Admin only (Settings > Work Categories)

---

## Decisions

| Question | Decision |
|----------|----------|
| Rates on category? | ✅ Yes — starting values for new projects |
| Default person per category? | ❌ Not in v1 — only at project level (Phase 3, defaultAssignees) |
| Rate currency mismatch? | If the project is in a different currency: the number carries over, currency adjusts to the project's (€80/h → $80/h) |
| Seed set? | Design · Development · PM (3 defaults, currency: org default) |
| Color palette? | Notion-style preset (8-12 fixed colors), not custom color picker |
| Archiving? | archivedAt timestamp. Archived doesn't show in pickers, but old references remain. |

---

## Schema

```typescript
workCategories: defineTable({
  orgId: v.string(),
  name: v.string(),                         // "Design", "Development", etc.
  color: v.string(),                        // Preset color code
  defaultCostRate: v.optional(v.number()),  // Internal cost/hour
  defaultBillRate: v.optional(v.number()),  // Client-facing/hour
  currency: v.string(),                     // Default: org default, modifiable
  sortOrder: v.number(),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
}).index("by_orgId", ["orgId"])
```

## What it stores

- **Name**: e.g., "Design" — required, non-empty
- **Color**: Notion-style preset palette (8-12 colors, fixed set)
- **Default cost rate**: Internal cost/hour (optional) — starting value for new projects
- **Default bill rate**: Client-facing/hour (optional) — starting value for new projects
- **Currency**: Defaults to org default currency, but modifiable
- **Sort order**: sortOrder field, drag-and-drop or up/down arrows

## Color palette (preset)

Fixed set, not a custom color picker. Notion-style:
```
gray · brown · orange · yellow · green · blue · purple · pink · red
```
Each color is a hex code usable as badge background and text color.

## Rate inheritance rule

When creating a project and setting category rates:
- The work category default rates are the **starting values**
- If the project is in a different currency than the category: **the number carries over, the currency adjusts to the project's** (€80/h → $80/h)
- Can be overridden on the project

## Operations

### Create
- Modal form: name (required) + color (required, preset picker) + cost rate + bill rate + currency
- sortOrder: last + 1

### Edit
- Inline or modal: all fields modifiable
- Renaming: old tasks also show the new name (FK reference, not snapshot)

### Archive
- `archivedAt` = timestamp
- Archived category: **doesn't appear in pickers** (task creation, project rate grid)
- BUT: **old references remain** (if a task had "Design" and you archived it, the task still shows "Design", dimmed)
- Restore: `archivedAt` = undefined

### Seed
- If the org has **0 categories** → "Create default set" button
- Seed: Design (blue) · Development (purple) · PM (amber)
- Currency is the org default

## Queries / Mutations

```
workCategories.list      — all org categories (archived optionally)
workCategories.get       — one category by ID
workCategories.create    — admin only
workCategories.update    — admin only
workCategories.archive   — admin only (set archivedAt)
workCategories.restore   — admin only (unset archivedAt)
workCategories.reorder   — admin only (sortOrder update)
workCategories.seed      — admin only (if 0 exist)
```

## UI

### Settings > Work Categories tab

**List**:
- Sortable list (drag handle or up/down arrows)
- Each row: color dot + name + cost rate + bill rate + currency + ⋮ menu
- ⋮ menu: Edit, Archive (or Restore if archived)
- "Show archived" toggle
- If 0 categories: "Create default set" CTA button

**Create/Edit form** (modal):
- Name (text input, required)
- Color (preset palette, clickable colors)
- Cost rate (number input, optional) + currency display
- Bill rate (number input, optional) + currency display
- Currency (dropdown, default: org default)

## Acceptance criteria

- [ ] Admin can CRUD categories in Settings
- [ ] Color picker works (preset palette)
- [ ] Cost rate + bill rate saves with currency
- [ ] Archiving: disappears from pickers, but old references remain
- [ ] Restore works
- [ ] Seed button: if 0 categories → 3 defaults created
- [ ] Sorting works (order persisted)
- [ ] Member cannot access Settings
- [ ] All data filtered by orgId
