# Workday — Implementation Plan

**Phase:** 8 (post Phase 7 Time Tracking)
**Route:** `/workday`
**Owner:** Adam Toth
**Status:** Spec locked, design approved, ready to implement
**Visual reference:** `docs/workday-prototype.html` (open in browser before starting)

---

## 1. Goal

A weekly view that shows what every team member worked on, day-by-day, with Google-Calendar-like colored boxes representing time on tasks. Built so it can later evolve into an interactive editor (drag, create, edit time entries inline).

**v1 is read-only.** Visualization, hover popover, click → task drawer. No drag, no inline create, no inline edit.

---

## 2. Audience & permissions

| Role | What they see |
|---|---|
| **Admin** | Full team grid: every org member as a row, with the member filter popover for sub-selection. |
| **Member** | Their own row only. No user switcher. No member filter button. |

Wired via `getAuthContext` — server-side auto-scope; the page itself reads `useUser()` + role to hide the filter button for members.

---

## 3. Data model changes

> **Migration not required** — repo is on dummy data only (per memory `project_mvp_dummy_data.md`). Wipe & re-seed.

### 3.1 `convex/schema.ts` → `timeEntries`

**Add one required field:**

```ts
timeEntries: defineTable({
  // ... existing fields ...
  startedAt: v.number(),          // NEW — REQUIRED. Epoch ms.
  // durationMinutes stays the source of truth
  // date stays denormalized, derived from startedAt + org timezone at write time
})
  .index("by_orgId", ["orgId"])
  .index("by_taskId", ["taskId"])
  .index("by_userId_date", ["userId", "date"])
  .index("by_orgId_date", ["orgId", "date"]),
```

**Decisions:**
- `startedAt` is **required**, not optional. Toggl/Harvest/Clockify/Tempo all store start time; this unlocks the future editor, calendar integrations, overtime billing rules, and overlap detection without a second migration later.
- We do **not** store `endedAt`. Compute as `startedAt + durationMinutes * 60_000`. Avoids the rounding paradox where `durationMinutes` is rounded per `orgSettings.roundingMinutes` but the wall-clock end isn't.
- `date` (YYYY-MM-DD) **stays** as denormalized index. Derived from `startedAt + org timezone` at write time. Existing indexes (`by_userId_date`, `by_orgId_date`) keep working.

### 3.2 Mutations that write `startedAt`

- **`convex/timer.ts:commitEntry`** — write `startedAt = Date.now() - elapsedMs` (wall-clock equivalent of session start). Acceptable that pause/resume gives a slightly synthetic start; tracking original-first-start through pauses is a separate small follow-up.
- **`convex/timeEntries.ts`** manual-create mutation (whatever its current name) — accept required `startedAt: v.number()`.
- **Any seed/dummy data scripts** — write a sensible `startedAt` (e.g. distribute entries across 9:00–18:00 per day in org timezone).

### 3.3 Manual log popover (`components/tasks/time-log-popover.tsx`)

Add an **inline "Started at" chip** below the duration chip row:

```
┌──────────────────────────────┐
│  AT  Adam Toth      ▾   │
│  0h 00m              ▶  │
│  [15m][30m][1h][2h]...   │
│  📅 Today, Apr 25         │
│  ⏱ Started at: now ▾     │  ← NEW
│  ≡ Add a note            │
│  Billable    •─          │
│                  [ Save ]│
└──────────────────────────────┘
```

- Default value: `now − duration` (the "I just finished doing this" case is one click).
- Dropdown options: `now − duration`, `15m ago`, `30m ago`, `1h ago`, `Pick time…`.
- "Pick time…" reveals an inline time input (HH:MM).
- The chip writes `startedAt` (required) on save. The selected `date` from the date picker provides the calendar day; the time portion comes from this chip.

---

## 4. Backend: new query

### 4.1 `convex/workday.ts` — `weekGrid`

```ts
// convex/workday.ts
export const weekGrid = query({
  args: {
    startDate: v.string(),   // YYYY-MM-DD inclusive
    endDate:   v.string(),   // YYYY-MM-DD inclusive (e.g. start + 6 for full week)
    userIds:   v.optional(v.array(v.id("users"))),  // admin filter
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    // Member auto-scope
    const scopedUserIds = isAdmin
      ? args.userIds                      // undefined = all members
      : [userId];

    // Always filter by orgId — see CLAUDE.md multi-tenancy rule
    let entries = await ctx.db
      .query("timeEntries")
      .withIndex("by_orgId_date", q =>
        q.eq("orgId", orgId).gte("date", args.startDate).lte("date", args.endDate))
      .collect();

    if (scopedUserIds) {
      const allowed = new Set(scopedUserIds);
      entries = entries.filter(e => allowed.has(e.userId));
    }

    // Hydrate tasks, projects, categories, users
    // (use a single round-trip per ID set — Convex parallel ctx.db.get is fine)
    const taskIds      = [...new Set(entries.map(e => e.taskId))];
    const tasks        = await Promise.all(taskIds.map(id => ctx.db.get(id)));
    const taskMap      = new Map(tasks.filter(Boolean).map(t => [t!._id, t!]));

    const projectIds   = [...new Set(tasks.filter(Boolean).map(t => t!.projectId).filter(Boolean) as Id<"projects">[])];
    const projects     = await Promise.all(projectIds.map(id => ctx.db.get(id)));
    const projectMap   = new Map(projects.filter(Boolean).map(p => [p!._id, p!]));

    const categoryIds  = [...new Set(tasks.filter(Boolean).map(t => t!.workCategoryId).filter(Boolean) as Id<"workCategories">[])];
    const categories   = await Promise.all(categoryIds.map(id => ctx.db.get(id)));
    const categoryMap  = new Map(categories.filter(Boolean).map(c => [c!._id, c!]));

    const userIdSet    = [...new Set(entries.map(e => e.userId))];
    const users        = await Promise.all(userIdSet.map(id => ctx.db.get(id)));
    const userMap      = new Map(users.filter(Boolean).map(u => [u!._id, u!]));

    // Aggregate to (user, day, task) "boxes"
    type Entry = { _id: string; startedAt: number; durationMinutes: number; note?: string; isBillable: boolean; userId: Id<"users"> };
    type Box   = { taskId: string; task: any; project: any; category: any; totalMinutes: number; firstStart: number; entries: Entry[] };

    const boxesByUserDay = new Map<string, Box[]>();
    for (const e of entries) {
      const k = `${e.userId}|${e.date}|${e.taskId}`;
      // ... aggregate, push entries, recompute firstStart, totalMinutes ...
    }

    // Return shape: nested by user → day → boxes (entries sorted by startedAt asc within each box)
    return {
      users: scopedUsers.map(u => ({
        user: { _id: u._id, name: u.name, imageUrl: u.imageUrl, role: ... },
        days: dateRange(args.startDate, args.endDate).map(date => ({
          date,
          totalMinutes: ...,
          boxes: (sorted by firstStart asc),
        })),
      })),
    };
  },
});
```

**Implementation rules:**
- **Always filter by orgId** in the index query (per CLAUDE.md multi-tenancy rule).
- **Single round-trip hydration** — collect IDs, batch fetch with `Promise.all(ids.map(ctx.db.get))`. Don't N+1.
- **Member auto-scope** before any user-level filter is applied.
- **Sort entries by `startedAt` ascending within each box.** Sort boxes within each day by `firstStart` (= min startedAt in the box) ascending.
- **Currency invariant (D1) is irrelevant here** — this query reads but doesn't compute money totals. No currency partitioning needed.
- **Convex 16k-doc limit:** safe for v1 team sizes (10 people × 7 days × 10 entries/day ≈ 700 docs). Add a back-pocket plan to switch to per-user paged queries past ~5k entries/week/org.

### 4.2 Bonus: `weekTotals` micro-query (optional, for sidebar widgets)

Not needed for v1, but the same shape can power dashboard cards later. Skip.

---

## 5. Frontend

### 5.1 Routing & nav

**Route:** `app/(dashboard)/workday/page.tsx`

**Nav placement:** new **Insights** group in `lib/navigation.ts`.

```ts
// lib/navigation.ts — replace existing groups partially
{
  label: "Insights",
  items: [
    { title: "Workday", url: "/workday",  icon: CalendarDaysIcon },
    { title: "Reports", url: "/reports",  icon: FileTextIcon, adminOnly: true },
  ],
},
// remove "Reports" from the "Finance" group at the same time
```

The page is **not** admin-only — members see their own row.

### 5.2 Page file (thin orchestrator — per CLAUDE.md)

```tsx
// app/(dashboard)/workday/page.tsx
"use client"

import { useConvexAuth } from "convex/react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useWorkdayQueryArgs } from "@/lib/hooks/use-workday-query-args"
import { WorkdayHeader } from "@/components/workday/workday-header"
import { WorkdayGrid } from "@/components/workday/workday-grid"
import WorkdayLoading from "./loading"

export default function WorkdayPage() {
  const { isAuthenticated } = useConvexAuth()
  const args = useWorkdayQueryArgs()  // reads URL state
  const data = useQuery(
    api.workday.weekGrid,
    isAuthenticated ? args.queryArgs : "skip",
  )

  if (data === undefined) return <WorkdayLoading />

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <WorkdayHeader {...args} />
      <WorkdayGrid data={data} showWeekend={args.showWeekend} />
    </div>
  )
}
```

**File must stay under 200 lines** (per CLAUDE.md) — every section, table, card lives in its own component file.

### 5.3 Component breakdown (`components/workday/`)

| File | Responsibility |
|---|---|
| `workday-header.tsx` | Title + sub on left; week nav + member filter + weekend toggle on right. Composes the next three. |
| `workday-week-picker.tsx` | The unified week control: ◀ [date label ▾] ▶ + the calendar popover (whole-week rows hover-highlight, "Jump to this week" footer). |
| `workday-member-filter.tsx` | Filter button (`👥 N members ▾`) + popover with search field, checkbox list (avatar + name + role), Select all / Clear footer actions. |
| `workday-weekend-toggle.tsx` | Notion-style switch with "Weekend" label. URL-persisted. |
| `workday-grid.tsx` | Header strip (Mon 21 / Tue 22 / …) + per-user row cards. Uses a shared `grid-template` with `grid-template-columns: 200px repeat(N, minmax(168px, 1fr))`. |
| `workday-user-row.tsx` | One user's lane: identity column (avatar + name + role + "30h 10m / this week" total) + day cells. |
| `workday-day-cell.tsx` | One day for one user: day-stack (positioned boxes) + day total at bottom (hairline divider). |
| `workday-task-box.tsx` | The colored block. Adaptive content tier based on box height. Tooltip-trigger + click-to-drawer wired here. |
| `workday-task-popover.tsx` | The hover popover (200ms delay) — entry list with `09:00–10:30  1.5h  • note  🟢` rows + total footer. Click an entry row → opens task drawer scrolled to Time tab on that entry. |
| `workday-empty-state.tsx` | "No work logged this week" — used when entire grid has 0 entries. Per-cell empty is just `— No work logged` text. |

### 5.4 Shared hooks (`lib/hooks/`)

| File | Responsibility |
|---|---|
| `use-workday-query-args.ts` | Reads URL search params (`week`, `users`, `weekend`), returns `{ queryArgs, selectedWeek, selectedUserIds, showWeekend, setWeek, setUsers, setShowWeekend }`. URL-driven state per CLAUDE.md. |
| `use-week-picker.ts` | Pure date logic: `startOfWeek(d)`, `addDays(d, n)`, `sameWeek(a,b)`, formatting `Apr 21 – 25, 2026`. Plus the calendar grid generator (6 weeks × 7 days). Reusable later. |

### 5.5 URL state contract

```
/workday                                          → current week, all members, weekend hidden
/workday?week=2026-W17                            → ISO week
/workday?week=2026-W17&users=u_abc,u_def          → filtered to two users
/workday?week=2026-W17&weekend=1                  → 7-day grid
```

- `week` is ISO week (`YYYY-Www`). Fall back to `startOfWeek(today)` if missing.
- `users` is comma-separated user IDs. Empty/missing = all.
- `weekend` is `1` or absent.

Browser back/forward works. Refresh preserves state. Links are shareable.

### 5.6 Loading state

`app/(dashboard)/workday/loading.tsx` — content-aware skeleton (per CLAUDE.md). Render the same grid scaffold (header strip + N user-row cards) with shimmering box-shaped placeholders inside each day cell. Same heights, same column widths, same row heights — should not jump on data load.

### 5.7 Empty state

Two flavors:

| Scenario | Render |
|---|---|
| Entire week has zero entries (e.g. no team members logged anything) | `<WorkdayEmptyState>` centered in grid area, all member rows still rendered (preserves team awareness) |
| Single day cell has zero entries | "No work logged" text inside the day-stack, muted, top-aligned |

PTO is **not in v1** — a member with zero entries this week just shows zero totals. No "Off" label, no dimmed row.

---

## 6. Visual design — the "Notion-grade" spec

> All values exactly as in `docs/workday-prototype.html`. Don't re-derive — port them.

### 6.1 Tokens

```css
/* override / supplement existing app tokens for this page */
--bg: #ffffff;
--surface: #ffffff;
--surface-2: #fbfaf9;
--border: #ececeb;
--border-strong: #e0dfdd;
--fg: #37352f;
--fg-muted: #787673;
--fg-subtle: #a8a6a1;
--accent: #2383e2;        /* Notion blue */
--danger: #e03e3e;
```

In practice, reuse the project's existing shadcn theme tokens; only the **prototype** uses raw Notion hex values. Map to existing `--background`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--destructive`.

### 6.2 Box rendering

- **Tinted background** via `color-mix(in srgb, var(--cat-color) 11%, transparent)`.
- **Tiny 6×6 category dot** in box top-left at `8px, 9px` (replaces the discarded heavy 3px left border).
- **Title** in `--fg` (not category-tinted) at 12.5px / weight 500 / `-0.005em` tracking.
- **Project subtitle** at 11.5px in `--fg-muted`.
- **Duration** right-aligned, 11px in `--fg-muted`, monospace tabular numerals.
- **Hover:** background tint deepens from 11% → 18%. No scale, no shadow, no lift.
- **Focus ring:** 2px solid `var(--cat-color)` with `-1px` offset.

**Adaptive content tiers (height in px):**

| Height | Content visible |
|---|---|
| ≥ 60px | title · duration → project subtitle |
| 36–59px | title · duration (single line) |
| 18–35px | title only (truncated, no duration shown) |
| < 18px | colored sliver, min 6px, no text |

**Sliver style:** `color-mix(in srgb, var(--cat-color) 50%, transparent)` solid bar, no padding, no dot.

### 6.3 Grid scale

- **1 hour = 40 px**, full 8-hour workday = **320 px** column height (`--workday-h`).
- Empty space below the last box = unlogged capacity (visual signal, no label).
- **Overtime:** day-stack `height` grows past 320px to fit the actual content (no clipping). A hairline `--border-strong` line is drawn at the 320px mark with a tiny "8h" label flush right — quiet capacity marker. Day total goes red (`var(--danger)`) and shows `+30m` overtime pill.

### 6.4 User row card

- Background: `var(--surface)` (white).
- Border: `1px solid var(--border)`, radius `8px`.
- **No drop shadow** at rest. Hover only changes the border color to `--border-strong`.
- 10px gap between cards (vertical `flex` container).
- **No colored left stripe** — explicitly rejected.
- Identity column: 200px wide, `var(--surface-2)` warm off-white background, `1px solid var(--border)` right divider.
- Avatar: 32px, no shadow.
- Week total: 22px / weight 600 / tabular numerals, label "this week" below in muted 12px.

### 6.5 Header strip (above row cards)

- "Team member" column header is invisible (`color: transparent` on a `·` character) — the column speaks for itself.
- Day columns: lowercase day name (`mon`) at 11.5px in `--fg-subtle`, then `21` at 18px / weight 600 / -0.01em tracking.
- **Today column:** day name + number both in `--accent` (no underline, no background, no badge).

### 6.6 Day cell

- Padding: `14px 10px 12px`.
- 1px solid right divider in `--border` (not dashed — solid reads cleaner).
- **Today** day cell: subtle vertical accent gradient at top (`linear-gradient(to bottom, rgba(35,131,226,0.025) 0%, transparent 80px)`).
- Weekend cells: `--surface-2` background.
- Day total (bottom): hairline top border, 10px padding-top, "total" label on left in muted, value right-aligned monospace.

### 6.7 Hover popover

- 280–360px wide.
- Header: 8px category dot + task title (13.5px / weight 600), then small muted "Project · Category" line.
- Entry rows: grid `96px 48px 1fr auto`. `09:00–10:30` (mono) · `1.5h` (mono muted) · note (truncates) · billable dot.
- Footer: hairline top, "Total today" label + bold mono total.
- Animation: opacity 0 → 1 with 2px slide, 120ms.
- 200ms delay before opening to prevent spam when scanning across boxes.
- Click anywhere on a row → opens task drawer scrolled to Time tab on that entry. Click box body → opens task drawer (no specific entry).

### 6.8 Top toolbar (page header)

```
Workday                            [◀ Apr 21 – 25, 2026 ▾ ▶]  │  [👥 All members ▾]  │  Weekend ●─
See what your team worked on this week.
```

- **Title:** 28px / weight 700 / -2% tracking.
- **Sub:** 13px in `--fg-muted`.
- **Right cluster:** week-nav, hairline divider, member filter, hairline divider, weekend toggle.
- **Hairline dividers:** 1px × 18px in `--border`, `0 4px` margin.
- **No avatars row.** Member filter is a popover button — scales to 30+ people.
- **Today/week-label merged into one control** — click the date label opens the calendar week-picker.

### 6.9 Week picker popover

- 320px wide.
- `crosse` 6 rows × 7 days, **whole-week rows are the click target.** Hover row → entire week highlights `--surface-2`. Click row → selects week, closes popover.
- Selected week row: `color-mix(in srgb, var(--accent) 12%, transparent)` background.
- Today: `--accent` text + 3px accent dot below the number.
- Days outside current month: dimmed `--fg-subtle` at 55% opacity (still selectable as part of their week).
- Footer: "Jump to this week" link in `--accent`.

### 6.10 Member filter popover

- 280px wide.
- Search field at top (`Search members…`), focuses `--accent` border.
- Each row: 16px checkbox + 22px avatar + name + small role label.
- Footer: "Select all" / "Clear" actions (Clear resets to all; truly empty state would be useless).
- Button label dynamic: "All members" / "3 of 12 members" / single user's full name.

---

## 7. Click-through and integration

### 7.1 Task drawer

Reuse existing `TaskDetailDrawer` (`components/tasks/task-detail-drawer.tsx`) via the existing `useTaskDetail` URL-driven hook.

- **Click box body:** push `?task=<taskId>` to URL.
- **Click an entry row in popover:** push `?task=<taskId>&entry=<entryId>` (new optional param). The drawer's Time tab reads `entry` param and scrolls/highlights that row. If the param/feature doesn't exist yet, just open the drawer — entry-scroll is a small nice-to-have, not a blocker.
- **Drawer's `taskIds` prop:** pass the visible week's task IDs (de-duplicated, sorted by first appearance) so prev/next navigation in the drawer steps through them sensibly.

### 7.2 Avatars

Reuse `<UserAvatar>` from `components/user-avatar.tsx`. Don't roll a new one per CLAUDE.md "no custom components when shared exist".

### 7.3 Category color

Reuse the same `color-mix` pattern from `components/category-badge.tsx`:

```css
background: color-mix(in srgb, var(--cat-color) 11%, transparent);
color: color-mix(in srgb, var(--cat-color) 65%, var(--fg));
```

`var(--cat-color)` is set per box via `style="--cat-color: <category.color>"`.

---

## 8. Implementation order (PR slicing)

> Per memory `feedback_one_pr_refactors.md` — bundle related refactor work in one PR. Suggest **two PRs**, gated:

### PR 1 — Schema + mutation foundation

1. Add `startedAt` to `timeEntries` schema (required).
2. Update `convex/timer.ts:commitEntry` to write `startedAt`.
3. Update manual-entry mutation in `convex/timeEntries.ts` to require `startedAt`.
4. Update `time-log-popover.tsx` with the "Started at" chip.
5. Update any seed scripts to write `startedAt`.
6. Wipe & re-seed dummy data.
7. Verify: `npx tsc --noEmit` clean. Existing time logging UI still works end-to-end.

**Ship + verify in dev.** No user-facing surface yet for the new field, but it must persist correctly.

### PR 2 — Workday page

1. Create `convex/workday.ts:weekGrid`.
2. Create `lib/hooks/use-workday-query-args.ts` and `lib/hooks/use-week-picker.ts`.
3. Create all `components/workday/*.tsx` files.
4. Create `app/(dashboard)/workday/page.tsx` and `loading.tsx`.
5. Update `lib/navigation.ts` — add Insights group, move Reports.
6. Update `lib/route-access.ts` if Reports' admin-only enforcement lives there.
7. Verify: visual match against `docs/workday-prototype.html`. Click flows end-to-end. Member auto-scope works (sign in as member, only see own row). Admin filter works. Week picker, weekend toggle, all URL-state round-trips.

**Update `docs/backlog.md`** with this phase entry per CLAUDE.md.

---

## 9. Verification checklist

Before marking the phase done:

- [ ] `npx tsc --noEmit` returns zero errors (CLAUDE.md hard rule)
- [ ] `npm run lint` clean
- [ ] Convex dev console shows `weekGrid` query running with no errors
- [ ] Open `docs/workday-prototype.html` side-by-side with the real page in browser. Visual diff must be near-zero on:
  - Header layout (title, sub, week nav, filter, weekend toggle)
  - User-row card chrome (border, radius, no shadow at rest, identity column gradient)
  - Box rendering at all four content tiers (verify with mixed durations)
  - Hover popover (200ms delay, entry rows, total footer)
  - Week picker (whole-row highlight, today dot, jump-to-this-week)
  - Member filter popover (search, checkboxes, scroll past 8)
- [ ] Click box → drawer opens
- [ ] Click entry row in popover → drawer opens (optionally on the entry)
- [ ] Click a different week in picker → URL updates → grid re-fetches
- [ ] Toggle weekend → label updates Mon–Fri ↔ Mon–Sun, columns appear/disappear
- [ ] Sign in as member → only own row, no member filter button visible
- [ ] Sign in as admin in another org → empty grid, no cross-tenant leaks (manual check by comparing with another org's `_id`)
- [ ] Loading skeleton matches final layout dimensions exactly (no jump on data load)
- [ ] Day total turns red + shows `+Xh` pill when day exceeds 8h
- [ ] An "8h" capacity hairline appears at the 8h mark on overtime days
- [ ] Tiny entries (< 25m) render as colored slivers, hover popover still surfaces details
- [ ] Empty week renders the centered empty-state component, member rows still visible
- [ ] Backlog updated in `docs/backlog.md`

---

## 10. Out of scope (v2+)

Explicitly **not** in this phase:

- ❌ **Drag a box between days** to move an entry's date
- ❌ **Drag in empty grid space** to create a new entry (requires hour-grid UI)
- ❌ **Drag a box edge** to resize duration
- ❌ **Click empty space** to inline-create entry
- ❌ **Click box to inline-edit** title / duration / category
- ❌ **Hour-grid view mode** (Google Calendar-style with hour rulers)
- ❌ **PTO / out-of-office** label/dimming for member rows
- ❌ **Project / category / billable filters** (start with just member + weekend)
- ❌ **Workday-level analytics** (utilization heatmap, weekly trend chart)
- ❌ **Calendar integration** (Google Calendar sync) — but `startedAt` is now ready for it
- ❌ **Overlap detection / warning** when two entries on same user collide in time
- ❌ **Entry-level deep link in the drawer's Time tab** — nice-to-have, ship without if it adds complexity

The data model now supports all of these — the gating constraint is product/UX scope, not data.

---

## 11. References

- Prototype: `docs/workday-prototype.html` (open in browser; the source of truth for visual polish)
- CLAUDE.md rules invoked:
  - Multi-tenancy: every Convex query filters by `orgId`
  - Page files thin (under 200 lines, no inline component definitions)
  - Loading skeletons content-aware
  - Domain UI elements as shared components
  - Filterable views persist state in URL
  - Loading → Empty → Content three-phase pattern
  - Shadcn / Tiptap / dnd-kit: check Context7 docs before touching (not used here, but noted)
  - 0 TS errors at all times
  - Backlog tracking mandatory
- Existing patterns to copy:
  - `components/category-badge.tsx` — color-mix tint formula
  - `components/tasks/task-detail-drawer.tsx` + `use-task-detail.ts` — drawer wiring
  - `components/user-avatar.tsx` — avatar component
  - `components/empty-state.tsx` — empty-state component
- Memory referenced:
  - `project_mvp_dummy_data.md` — wipe-and-reseed is fine
  - `feedback_one_pr_refactors.md` — bundle related work
  - `feedback_no_custom_components.md` — reuse shared components
  - `feedback_design_process.md` — Paper-first, ClickUp-match, context7-verified, frontend-design polish
