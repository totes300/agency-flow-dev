# Phase 5 — Tasks Core Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the main task list — the most-used screen in the app. Table with 10 columns, inline editing, grouping, filtering, bulk operations, and mobile card view.

**Architecture:** Split query architecture (tasks.counts + tasks.list as separate Convex subscriptions). Single grouped list query with one-off "Load more" fetches. Denormalized `statusType` on tasks for index-driven tab filtering. Stripe-style filter pills with two-step operators. ClickUp-style task creation modal with basic Tiptap editor.

**Tech Stack:** Next.js 16 (App Router), Convex 1.33.1, Clerk 7.0.4, shadcn/ui 4.0.7, Tailwind CSS v4, Tiptap (new dependency), Lucide React 0.577.0

**Design spec:** `docs/superpowers/specs/2026-03-16-phase-5-tasks-core-design.md`

---

## File Structure

### Convex Backend (new files)
- `convex/tasks.ts` — CRUD mutations + queries (create, update, archive, restore, remove, duplicate, bulkUpdate, list, listMore, counts)
- `convex/lib/taskHelpers.ts` — shared helpers: `resolveStatusType()`, `applyTaskFilters()`, `buildGroupedResult()`

### Convex Backend (modified files)
- `convex/schema.ts` — add `tasks` table + `systemRole` to statuses
- `convex/lib/constants.ts` — update `DEFAULT_STATUSES` to include `systemRole`
- `convex/lib/validators.ts` — add `statusTypeValidator` reuse, `filterOpValidator`
- `convex/statuses.ts` — update seed to set `systemRole`, add migration mutation

### Frontend — Page & Layout
- `app/(dashboard)/tasks/page.tsx` — thin orchestrator (replace placeholder)
- `app/(dashboard)/tasks/loading.tsx` — content-aware skeleton

### Frontend — Task Components (all new, under `components/tasks/`)
- `components/tasks/tasks-header.tsx` — title + search + "New task" button
- `components/tasks/tasks-tabs.tsx` — 6 tabs with count badges
- `components/tasks/tasks-toolbar.tsx` — Filter + Group by buttons (right of tabs)
- `components/tasks/tasks-filter-bar.tsx` — Stripe-style filter pill row
- `components/tasks/filter-pill.tsx` — individual filter pill with operator dropdown
- `components/tasks/tasks-table.tsx` — desktop table (10 columns)
- `components/tasks/task-row.tsx` — single row with inline editing cells
- `components/tasks/task-group.tsx` — group header (colored dot, name, chevron, count)
- `components/tasks/inline-add-task.tsx` — "+ Add task..." row with rapid entry
- `components/tasks/task-card.tsx` — mobile card view
- `components/tasks/task-form-modal.tsx` — ClickUp-style creation modal
- `components/tasks/bulk-toolbar.tsx` — floating bottom toolbar for bulk ops
- `components/tasks/tasks-empty-state.tsx` — per-tab empty states
- `components/tasks/tasks-list-skeleton.tsx` — loading skeleton
- `components/tasks/project-picker.tsx` — grouped client → project dropdown (reused in table + modal + filters)

### Frontend — Shared Components (new)
- `components/tiptap-editor.tsx` — basic Tiptap editor (shared between creation modal + Phase 6 detail)
- `components/user-avatar.tsx` — user avatar with initials fallback (for assignee column)

### Frontend — Hooks (new)
- `lib/hooks/use-task-filters.ts` — URL state management for tab, filters, groupBy, search
- `lib/hooks/use-group-collapse.ts` — localStorage persistence for collapsed groups

### Frontend (modified files)
- `lib/navigation.ts` — no changes needed (Tasks already listed)

---

## Chunk 1: Schema + Backend Foundation

### Task 1: Install Tiptap dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Tiptap packages**

```bash
npm install @tiptap/react @tiptap/starter-kit @tiptap/pm
```

- [ ] **Step 2: Verify install**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install tiptap dependencies for task description editor"
```

---

### Task 2: Add `systemRole` to statuses schema + migration

**Files:**
- Modify: `convex/schema.ts:37-57` (statuses table)
- Modify: `convex/lib/constants.ts:72-86` (DEFAULT_STATUSES)
- Modify: `convex/statuses.ts:223-250` (seed function)

- [ ] **Step 1: Add `systemRole` field to statuses table in schema**

In `convex/schema.ts`, add `systemRole` to the statuses table definition:

```typescript
// In the statuses table, after the `type` field:
systemRole: v.optional(v.union(v.literal("today"))),
```

- [ ] **Step 2: Update DEFAULT_STATUSES in constants to include systemRole**

In `convex/lib/constants.ts`, update the `DEFAULT_STATUSES` array and type:

```typescript
export const DEFAULT_STATUSES: Array<{
  name: string;
  type: StatusType;
  color: StatusColorName;
  sortOrder: number;
  systemRole?: "today";
}> = [
  { name: "Inbox", type: "backlog", color: "gray", sortOrder: 0 },
  { name: "Today", type: "backlog", color: "blue", sortOrder: 1, systemRole: "today" },
  { name: "Next up", type: "in_progress", color: "blue", sortOrder: 2 },
  { name: "In progress", type: "in_progress", color: "amber", sortOrder: 3 },
  { name: "Admin review", type: "review", color: "purple", sortOrder: 4 },
  { name: "Client review", type: "review", color: "coral", sortOrder: 5 },
  { name: "Stuck", type: "blocked", color: "red", sortOrder: 6 },
  { name: "Done", type: "done", color: "green", sortOrder: 7 },
];
```

- [ ] **Step 3: Update seed function to include systemRole**

In `convex/statuses.ts`, update the seed handler to include `systemRole` when inserting:

```typescript
// In the seed handler, update the insert call:
for (const status of DEFAULT_STATUSES) {
  await ctx.db.insert("statuses", {
    orgId: args.orgId,
    name: status.name,
    color: status.color,
    type: status.type,
    sortOrder: status.sortOrder,
    ...(status.systemRole ? { systemRole: status.systemRole } : {}),
    createdAt: now,
    updatedAt: now,
    createdBy: args.createdBy,
  });
}
```

- [ ] **Step 4: Add backfill migration mutation**

Add to `convex/statuses.ts`:

```typescript
/**
 * One-time migration: backfill systemRole on existing "Today" statuses.
 * Run once after deploying the schema change.
 */
export const backfillSystemRole = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find all statuses named "Today" with type "backlog" that don't have systemRole set
    const allStatuses = await ctx.db.query("statuses").collect();
    let updated = 0;
    for (const status of allStatuses) {
      if (
        status.name === "Today" &&
        status.type === "backlog" &&
        !status.systemRole
      ) {
        await ctx.db.patch(status._id, { systemRole: "today" as const });
        updated++;
      }
    }
    console.log(`Backfilled systemRole on ${updated} statuses`);
  },
});
```

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add convex/schema.ts convex/lib/constants.ts convex/statuses.ts
git commit -m "feat: add systemRole to statuses schema with Today backfill migration"
```

---

### Task 3: Add `tasks` table to schema

**Files:**
- Modify: `convex/schema.ts` (add tasks table at the end, before closing `});`)
- Modify: `convex/lib/validators.ts` (add filter operator validator)

- [ ] **Step 1: Add tasks table to schema**

In `convex/schema.ts`, add before the closing `});`:

```typescript
// ─── Tasks ──────────────────────────────────────────────────────────────────
tasks: defineTable({
  orgId: v.string(),
  title: v.string(),
  description: v.optional(v.string()), // Tiptap JSON string
  statusId: v.id("statuses"),
  statusType: v.union(
    v.literal("backlog"),
    v.literal("in_progress"),
    v.literal("review"),
    v.literal("blocked"),
    v.literal("done"),
  ),
  projectId: v.optional(v.id("projects")),
  assigneeIds: v.array(v.id("users")),
  workCategoryId: v.optional(v.id("workCategories")),
  estimate: v.optional(v.number()),   // in minutes
  billable: v.boolean(),
  dueDate: v.optional(v.string()),    // YYYY-MM-DD
  parentTaskId: v.optional(v.id("tasks")),
  archivedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: v.id("users"),
})
  .index("by_orgId", ["orgId"])
  .index("by_orgId_statusType", ["orgId", "statusType"])
  .index("by_projectId", ["projectId"])
  .index("by_parentTaskId", ["parentTaskId"])
  .index("by_statusId", ["statusId"])
  .searchIndex("search_title", {
    searchField: "title",
    filterFields: ["orgId"],
  }),
```

- [ ] **Step 2: Add filter operator validator**

In `convex/lib/validators.ts`, add:

```typescript
export const filterOpValidator = v.union(
  v.literal("is"),
  v.literal("isNot"),
  v.literal("anyOf"),
  v.literal("noneOf"),
);
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts convex/lib/validators.ts
git commit -m "feat: add tasks table schema with denormalized statusType and search index"
```

---

### Task 4: Create task helpers

**Files:**
- Create: `convex/lib/taskHelpers.ts`

- [ ] **Step 1: Create the helpers file**

```typescript
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { StatusType } from "./constants";

/**
 * Look up the status type for a given statusId.
 * Used to sync the denormalized `statusType` field on tasks.
 */
export async function resolveStatusType(
  ctx: QueryCtx | MutationCtx,
  statusId: Id<"statuses">
): Promise<StatusType> {
  const status = await ctx.db.get(statusId);
  if (!status) throw new Error("Status not found");
  return status.type as StatusType;
}

/**
 * Look up the "today" statusId for an org via systemRole.
 * Returns null if no status has systemRole: "today".
 */
export async function getTodayStatusId(
  ctx: QueryCtx | MutationCtx,
  orgId: string
): Promise<Id<"statuses"> | null> {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const todayStatus = statuses.find((s) => s.systemRole === "today");
  return todayStatus?._id ?? null;
}

/**
 * Get the default inbox statusId for an org (first backlog-type by sortOrder).
 */
export async function getDefaultStatusId(
  ctx: QueryCtx | MutationCtx,
  orgId: string
): Promise<{ statusId: Id<"statuses">; statusType: StatusType }> {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const backlogStatuses = statuses
    .filter((s) => s.type === "backlog" && !s.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (backlogStatuses.length === 0) {
    throw new Error("No backlog status found for org");
  }
  return {
    statusId: backlogStatuses[0]._id,
    statusType: backlogStatuses[0].type as StatusType,
  };
}

/** Tab name → which statusType values it includes */
export const TAB_STATUS_TYPES: Record<string, StatusType[]> = {
  active: ["in_progress", "review", "blocked"],
  backlog: ["backlog"],
  today: [], // special: handled by systemRole lookup
  review: ["review"],
  blocked: ["blocked"],
  done: ["done"],
};

/**
 * Filter tasks by permission: admin sees all, member sees only assigned.
 */
export function filterByPermission(
  tasks: Doc<"tasks">[],
  isAdmin: boolean,
  userId: Id<"users">
): Doc<"tasks">[] {
  if (isAdmin) return tasks;
  return tasks.filter((t) => t.assigneeIds.includes(userId));
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add convex/lib/taskHelpers.ts
git commit -m "feat: add task helper functions (resolveStatusType, getTodayStatusId, filterByPermission)"
```

---

### Task 5: Create tasks.counts query

**Files:**
- Create: `convex/tasks.ts`

- [ ] **Step 1: Create convex/tasks.ts with the counts query**

```typescript
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthContext, requireAdmin, validateStringLength } from "./lib/auth";
import { StatusType } from "./lib/constants";
import { statusTypeValidator } from "./lib/validators";
import {
  resolveStatusType,
  getTodayStatusId,
  getDefaultStatusId,
  TAB_STATUS_TYPES,
  filterByPermission,
} from "./lib/taskHelpers";

// ─── Queries ────────────────────────────────────────────────────────────────

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);

    // Fetch all non-archived tasks for the org
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    const tasks = allTasks.filter((t) => !t.archivedAt);

    // Apply permission filter
    const visible = filterByPermission(tasks, isAdmin, userId);

    // Get the "today" statusId via systemRole
    const todayStatusId = await getTodayStatusId(ctx, orgId);

    // Count per tab
    const inProgress = visible.filter((t) => t.statusType === "in_progress").length;
    const review = visible.filter((t) => t.statusType === "review").length;
    const blocked = visible.filter((t) => t.statusType === "blocked").length;

    return {
      active: inProgress + review + blocked,
      backlog: visible.filter((t) => t.statusType === "backlog").length,
      today: todayStatusId
        ? visible.filter((t) => t.statusId === todayStatusId).length
        : 0,
      review,
      blocked,
      done: visible.filter((t) => t.statusType === "done").length,
    };
  },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add convex/tasks.ts
git commit -m "feat: add tasks.counts query with per-tab counts and permission filtering"
```

---

### Task 6: Create tasks.list query

**Files:**
- Modify: `convex/tasks.ts` (add list query)

- [ ] **Step 1: Add the list query to convex/tasks.ts**

```typescript
export const list = query({
  args: {
    tab: v.union(
      v.literal("active"),
      v.literal("backlog"),
      v.literal("today"),
      v.literal("review"),
      v.literal("blocked"),
      v.literal("done")
    ),
    filters: v.optional(v.object({
      clientId: v.optional(v.object({ op: v.union(v.literal("is"), v.literal("isNot")), value: v.id("clients") })),
      projectId: v.optional(v.object({ op: v.union(v.literal("is"), v.literal("isNot")), value: v.id("projects") })),
      assigneeIds: v.optional(v.object({ op: v.union(v.literal("is"), v.literal("isNot"), v.literal("anyOf"), v.literal("noneOf")), value: v.array(v.id("users")) })),
      workCategoryId: v.optional(v.object({ op: v.union(v.literal("is"), v.literal("isNot")), value: v.id("workCategories") })),
      dateFrom: v.optional(v.string()),
      dateTo: v.optional(v.string()),
    })),
    groupBy: v.optional(v.union(
      v.literal("project"),
      v.literal("client"),
      v.literal("category"),
      v.literal("assignee"),
      v.literal("status"),
    )),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);
    const limit = args.limit ?? 50;

    // ── Fetch tasks ──
    let tasks;
    if (args.search) {
      // Use search index for title search
      tasks = await ctx.db
        .query("tasks")
        .withSearchIndex("search_title", (q) =>
          q.search("title", args.search!).eq("orgId", orgId)
        )
        .collect();
    } else {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .collect();
    }

    // Filter out archived
    tasks = tasks.filter((t) => !t.archivedAt);

    // Permission filter
    tasks = filterByPermission(tasks, isAdmin, userId);

    // ── Tab filter ──
    if (args.tab === "today") {
      const todayStatusId = await getTodayStatusId(ctx, orgId);
      if (todayStatusId) {
        tasks = tasks.filter((t) => t.statusId === todayStatusId);
      } else {
        tasks = [];
      }
    } else {
      const types = TAB_STATUS_TYPES[args.tab];
      if (types && types.length > 0) {
        tasks = tasks.filter((t) => types.includes(t.statusType as typeof types[number]));
      }
    }

    // ── Apply filters ──
    if (args.filters) {
      const f = args.filters;

      // Project filter (and by extension, client filter since client is derived from project)
      if (f.projectId) {
        const { op, value } = f.projectId;
        if (op === "is") tasks = tasks.filter((t) => t.projectId === value);
        else tasks = tasks.filter((t) => t.projectId !== value);
      }

      // Client filter: need to resolve which projects belong to the client
      if (f.clientId) {
        const clientProjects = await ctx.db
          .query("projects")
          .withIndex("by_clientId", (q) => q.eq("clientId", f.clientId!.value))
          .collect();
        // Filter to current org to prevent cross-org data leakage
        const projectIds = new Set(clientProjects.filter((p) => p.orgId === orgId).map((p) => p._id));
        if (f.clientId.op === "is") {
          tasks = tasks.filter((t) => t.projectId && projectIds.has(t.projectId));
        } else {
          tasks = tasks.filter((t) => !t.projectId || !projectIds.has(t.projectId));
        }
      }

      // Assignee filter
      if (f.assigneeIds) {
        const { op, value } = f.assigneeIds;
        if (op === "is" || op === "anyOf") {
          tasks = tasks.filter((t) => t.assigneeIds.some((a) => value.includes(a)));
        } else {
          // isNot / noneOf
          tasks = tasks.filter((t) => !t.assigneeIds.some((a) => value.includes(a)));
        }
      }

      // Category filter
      if (f.workCategoryId) {
        const { op, value } = f.workCategoryId;
        if (op === "is") tasks = tasks.filter((t) => t.workCategoryId === value);
        else tasks = tasks.filter((t) => t.workCategoryId !== value);
      }

      // Date range filter
      if (f.dateFrom) {
        tasks = tasks.filter((t) => t.dueDate && t.dueDate >= f.dateFrom!);
      }
      if (f.dateTo) {
        tasks = tasks.filter((t) => t.dueDate && t.dueDate <= f.dateTo!);
      }
    }

    // ── Sort: createdAt DESC ──
    tasks.sort((a, b) => b.createdAt - a.createdAt);

    // ── Build joined data (batch lookups) ──
    const statusIds = [...new Set(tasks.map((t) => t.statusId))];
    const projectIds = [...new Set(tasks.map((t) => t.projectId).filter(Boolean))] as Id<"projects">[];
    const categoryIds = [...new Set(tasks.map((t) => t.workCategoryId).filter(Boolean))] as Id<"workCategories">[];
    const userIds = [...new Set(tasks.flatMap((t) => t.assigneeIds))];

    const [statuses, projects, categories, users] = await Promise.all([
      Promise.all(statusIds.map((id) => ctx.db.get(id))),
      Promise.all(projectIds.map((id) => ctx.db.get(id))),
      Promise.all(categoryIds.map((id) => ctx.db.get(id))),
      Promise.all(userIds.map((id) => ctx.db.get(id))),
    ]);

    // Build lookup maps
    const statusMap = new Map(statuses.filter(Boolean).map((s) => [s!._id, s!]));
    const projectMap = new Map(projects.filter(Boolean).map((p) => [p!._id, p!]));
    const categoryMap = new Map(categories.filter(Boolean).map((c) => [c!._id, c!]));
    const userMap = new Map(users.filter(Boolean).map((u) => [u!._id, u!]));

    // Resolve client data for projects
    const clientIds = [...new Set(projects.filter(Boolean).map((p) => p!.clientId))];
    const clients = await Promise.all(clientIds.map((id) => ctx.db.get(id)));
    const clientMap = new Map(clients.filter(Boolean).map((c) => [c!._id, c!]));

    // ── Enrich tasks ──
    const enriched = tasks.map((t) => {
      const status = statusMap.get(t.statusId);
      const project = t.projectId ? projectMap.get(t.projectId) : null;
      const client = project ? clientMap.get(project.clientId) : null;
      const category = t.workCategoryId ? categoryMap.get(t.workCategoryId) : null;
      const assignees = t.assigneeIds
        .map((id) => userMap.get(id))
        .filter(Boolean)
        .map((u) => ({ _id: u!._id, name: u!.name, imageUrl: u!.imageUrl }));

      return {
        ...t,
        status: status ? { _id: status._id, name: status.name, color: status.color, type: status.type } : null,
        project: project ? { _id: project._id, name: project.name, code: project.code } : null,
        client: client ? { _id: client._id, name: client.name } : null,
        category: category ? { _id: category._id, name: category.name, color: category.color } : null,
        assignees,
      };
    });

    // ── Group or flat list ──
    if (!args.groupBy) {
      // Flat list
      const paginated = enriched.slice(0, limit);
      return {
        groups: [{
          key: "__all",
          label: "All Tasks",
          color: undefined,
          count: enriched.length,
          tasks: paginated,
          hasMore: enriched.length > limit,
          cursor: paginated.length > 0 ? paginated[paginated.length - 1]._id : undefined,
        }],
        totalCount: enriched.length,
      };
    }

    // ── Grouped result ──
    type GroupKey = string;
    const groupBuckets = new Map<GroupKey, { label: string; color?: string; tasks: typeof enriched }>();

    // Also collect all possible groups (including empty ones)
    if (args.groupBy === "project") {
      // Seed all active projects as groups (so empty ones show)
      const allProjects = await ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
      for (const p of allProjects.filter((p) => !p.archivedAt)) {
        const c = clientMap.get(p.clientId) ?? await ctx.db.get(p.clientId);
        groupBuckets.set(p._id, { label: `${c?.name ?? "Unknown"} · ${p.name}`, tasks: [] });
      }
      // Also add "No project" group
      groupBuckets.set("__none", { label: "No project", tasks: [] });
      for (const t of enriched) {
        const key = t.projectId ?? "__none";
        const bucket = groupBuckets.get(key);
        if (bucket) bucket.tasks.push(t);
        else groupBuckets.set(key, { label: "Unknown", tasks: [t] });
      }
    } else if (args.groupBy === "client") {
      const allClients = await ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
      for (const c of allClients.filter((c) => !c.archivedAt)) {
        groupBuckets.set(c._id, { label: c.name, tasks: [] });
      }
      groupBuckets.set("__none", { label: "No client", tasks: [] });
      for (const t of enriched) {
        const key = t.client?._id ?? "__none";
        const bucket = groupBuckets.get(key);
        if (bucket) bucket.tasks.push(t);
        else groupBuckets.set(key, { label: "Unknown", tasks: [t] });
      }
    } else if (args.groupBy === "category") {
      const allCategories = await ctx.db.query("workCategories").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
      for (const c of allCategories.filter((c) => !c.archivedAt)) {
        groupBuckets.set(c._id, { label: c.name, color: c.color, tasks: [] });
      }
      groupBuckets.set("__none", { label: "No category", tasks: [] });
      for (const t of enriched) {
        const key = t.workCategoryId ?? "__none";
        const bucket = groupBuckets.get(key);
        if (bucket) bucket.tasks.push(t);
        else groupBuckets.set(key, { label: "Unknown", tasks: [t] });
      }
    } else if (args.groupBy === "assignee") {
      const allUsers = await ctx.db.query("users").collect();
      for (const u of allUsers.filter((u) => !u.deletedAt)) {
        groupBuckets.set(u._id, { label: u.name, tasks: [] });
      }
      groupBuckets.set("__none", { label: "Unassigned", tasks: [] });
      for (const t of enriched) {
        if (t.assigneeIds.length === 0) {
          groupBuckets.get("__none")!.tasks.push(t);
        } else {
          // Task appears in each assignee's group
          for (const assigneeId of t.assigneeIds) {
            const bucket = groupBuckets.get(assigneeId);
            if (bucket) bucket.tasks.push(t);
          }
        }
      }
    } else if (args.groupBy === "status") {
      // Pipeline order
      const allStatuses = await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
      for (const s of allStatuses.filter((s) => !s.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder)) {
        groupBuckets.set(s._id, { label: s.name, color: s.color, tasks: [] });
      }
      for (const t of enriched) {
        const bucket = groupBuckets.get(t.statusId);
        if (bucket) bucket.tasks.push(t);
      }
    }

    // Build groups array with pagination per group
    const groups = [...groupBuckets.entries()]
      .filter(([, bucket]) => bucket.tasks.length > 0 || args.groupBy !== "status") // empty groups shown (except status)
      .map(([key, bucket]) => {
        const paginated = bucket.tasks.slice(0, limit);
        return {
          key,
          label: bucket.label,
          color: bucket.color,
          count: bucket.tasks.length,
          tasks: paginated,
          hasMore: bucket.tasks.length > limit,
          cursor: paginated.length > 0 ? paginated[paginated.length - 1]._id : undefined,
        };
      });

    // Sort groups alphabetically (except status which is already pipeline-ordered)
    if (args.groupBy !== "status") {
      groups.sort((a, b) => {
        // Keep "__none" at the end
        if (a.key === "__none") return 1;
        if (b.key === "__none") return -1;
        return a.label.localeCompare(b.label);
      });
    }

    return {
      groups,
      totalCount: enriched.length,
    };
  },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add convex/tasks.ts
git commit -m "feat: add tasks.list query with filtering, grouping, and joined data"
```

---

### Task 7: Create tasks.listMore query

**Files:**
- Modify: `convex/tasks.ts` (add listMore query)

- [ ] **Step 1: Add listMore query**

```typescript
export const listMore = query({
  args: {
    tab: v.union(
      v.literal("active"),
      v.literal("backlog"),
      v.literal("today"),
      v.literal("review"),
      v.literal("blocked"),
      v.literal("done")
    ),
    groupKey: v.string(),
    groupBy: v.union(
      v.literal("project"),
      v.literal("client"),
      v.literal("category"),
      v.literal("assignee"),
      v.literal("status"),
    ),
    cursor: v.id("tasks"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);
    const limit = args.limit ?? 50;

    // Fetch all tasks, filter, then paginate from cursor
    let tasks = await ctx.db
      .query("tasks")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    tasks = tasks.filter((t) => !t.archivedAt);
    tasks = filterByPermission(tasks, isAdmin, userId);

    // Tab filter
    if (args.tab === "today") {
      const todayStatusId = await getTodayStatusId(ctx, orgId);
      if (todayStatusId) tasks = tasks.filter((t) => t.statusId === todayStatusId);
      else tasks = [];
    } else {
      const types = TAB_STATUS_TYPES[args.tab];
      if (types?.length) tasks = tasks.filter((t) => types.includes(t.statusType as typeof types[number]));
    }

    // Sort
    tasks.sort((a, b) => b.createdAt - a.createdAt);

    // Filter to group
    // (simplified: the group key tells us which tasks belong)
    if (args.groupKey === "__none") {
      if (args.groupBy === "project") tasks = tasks.filter((t) => !t.projectId);
      else if (args.groupBy === "category") tasks = tasks.filter((t) => !t.workCategoryId);
      else if (args.groupBy === "assignee") tasks = tasks.filter((t) => t.assigneeIds.length === 0);
    } else {
      if (args.groupBy === "project") tasks = tasks.filter((t) => t.projectId === args.groupKey);
      else if (args.groupBy === "status") tasks = tasks.filter((t) => t.statusId === args.groupKey);
      else if (args.groupBy === "category") tasks = tasks.filter((t) => t.workCategoryId === args.groupKey);
      else if (args.groupBy === "assignee") tasks = tasks.filter((t) => t.assigneeIds.includes(args.groupKey as any));
      else if (args.groupBy === "client") {
        const clientProjects = await ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", args.groupKey as any)).collect();
        const projIds = new Set(clientProjects.map((p) => p._id));
        tasks = tasks.filter((t) => t.projectId && projIds.has(t.projectId));
      }
    }

    // Find cursor position and paginate
    const cursorIdx = tasks.findIndex((t) => t._id === args.cursor);
    const startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
    const page = tasks.slice(startIdx, startIdx + limit);

    return {
      tasks: page, // Note: enrichment should match tasks.list — reuse same pattern
      hasMore: startIdx + limit < tasks.length,
      cursor: page.length > 0 ? page[page.length - 1]._id : undefined,
    };
  },
});
```

**IMPORTANT for implementing agent:** The `listMore` query above returns raw tasks. You MUST add server-side enrichment matching `tasks.list`'s output shape (with `status`, `project`, `client`, `category`, `assignees` fields). Extract the enrichment logic from `tasks.list` into a shared `enrichTasks()` helper in `convex/lib/taskHelpers.ts` and call it from both `list` and `listMore`. Do NOT rely on client-side enrichment — the lookup maps from the initial query may not cover entities in later pages.

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add convex/tasks.ts
git commit -m "feat: add tasks.listMore query for per-group pagination"
```

---

### Task 8: Create task mutations (create, update, archive, restore, remove, duplicate)

**Files:**
- Modify: `convex/tasks.ts` (add mutations)

- [ ] **Step 1: Add create mutation**

```typescript
// ─── Mutations ──────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    statusId: v.optional(v.id("statuses")),
    projectId: v.optional(v.id("projects")),
    assigneeIds: v.optional(v.array(v.id("users"))),
    workCategoryId: v.optional(v.id("workCategories")),
    estimate: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    const trimmedTitle = args.title.trim();
    if (!trimmedTitle) throw new Error("Title is required");
    validateStringLength(trimmedTitle, 500, "Task title");

    // Resolve status (use helper to ensure correct StatusType union type)
    let statusId: Id<"statuses">;
    let statusType: StatusType;
    if (args.statusId) {
      statusId = args.statusId;
      statusType = await resolveStatusType(ctx, args.statusId);
    } else {
      const defaults = await getDefaultStatusId(ctx, orgId);
      statusId = defaults.statusId;
      statusType = defaults.statusType;
    }

    // Validate project belongs to org
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.orgId !== orgId) throw new Error("Project not found");
    }

    // Validate work category belongs to org
    if (args.workCategoryId) {
      const category = await ctx.db.get(args.workCategoryId);
      if (!category || category.orgId !== orgId) throw new Error("Work category not found");
    }

    // Member auto-assign: if creator is member, add them to assignees
    let assigneeIds = args.assigneeIds ?? [];
    if (!isAdmin && !assigneeIds.includes(userId)) {
      assigneeIds = [userId, ...assigneeIds];
    }

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      orgId,
      title: trimmedTitle,
      description: args.description,
      statusId,
      statusType,
      projectId: args.projectId,
      assigneeIds,
      workCategoryId: args.workCategoryId,
      estimate: args.estimate,
      billable: args.billable ?? true,
      dueDate: args.dueDate,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});
```

- [ ] **Step 2: Add update mutation**

```typescript
export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    statusId: v.optional(v.id("statuses")),
    projectId: v.optional(v.id("projects")),
    assigneeIds: v.optional(v.array(v.id("users"))),
    workCategoryId: v.optional(v.id("workCategories")),
    estimate: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    dueDate: v.optional(v.string()),
    // Allow clearing optional fields
    clearProjectId: v.optional(v.boolean()),
    clearWorkCategoryId: v.optional(v.boolean()),
    clearDueDate: v.optional(v.boolean()),
    clearEstimate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);

    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    // Member can only edit assigned tasks
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new Error("Not authorized to edit this task");
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };

    if (args.title !== undefined) {
      const trimmed = args.title.trim();
      if (!trimmed) throw new Error("Title is required");
      validateStringLength(trimmed, 500, "Task title");
      patch.title = trimmed;
    }

    if (args.description !== undefined) patch.description = args.description;

    if (args.statusId !== undefined) {
      const status = await ctx.db.get(args.statusId);
      if (!status || status.orgId !== orgId) throw new Error("Status not found");
      // Member cannot set done-type status
      if (!isAdmin && status.type === "done") {
        throw new Error("Only admins can mark tasks as done");
      }
      patch.statusId = args.statusId;
      patch.statusType = status.type;
    }

    if (args.projectId !== undefined) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.orgId !== orgId) throw new Error("Project not found");
      // TODO(Phase 7): Check for time entries before allowing project change
      patch.projectId = args.projectId;
    }
    if (args.clearProjectId) patch.projectId = undefined;

    if (args.assigneeIds !== undefined) patch.assigneeIds = args.assigneeIds;

    if (args.workCategoryId !== undefined) {
      const cat = await ctx.db.get(args.workCategoryId);
      if (!cat || cat.orgId !== orgId) throw new Error("Work category not found");
      patch.workCategoryId = args.workCategoryId;
    }
    if (args.clearWorkCategoryId) patch.workCategoryId = undefined;

    if (args.estimate !== undefined) patch.estimate = args.estimate;
    if (args.clearEstimate) patch.estimate = undefined;

    if (args.billable !== undefined) patch.billable = args.billable;

    if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
    if (args.clearDueDate) patch.dueDate = undefined;

    await ctx.db.patch(args.id, patch);
  },
});
```

- [ ] **Step 3: Add archive, restore, remove, duplicate mutations**

```typescript
export const archive = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new Error("Not authorized");
    }

    const now = Date.now();
    await ctx.db.patch(args.id, { archivedAt: now, updatedAt: now });

    // Cascade to subtasks
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      if (!sub.archivedAt) {
        await ctx.db.patch(sub._id, { archivedAt: now, updatedAt: now });
      }
    }

    // TODO(Phase 7): Stop active timers on this task
  },
});

export const restore = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");
    // Check permissions at restore time (undo edge case)
    if (!isAdmin && !task.assigneeIds.includes(userId)) {
      throw new Error("Not authorized — you may have been unassigned from this task");
    }
    await ctx.db.patch(args.id, { archivedAt: undefined, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");
    // TODO(Phase 7): Check for time entries, suggest archive instead

    // Delete subtasks first
    const subtasks = await ctx.db
      .query("tasks")
      .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", args.id))
      .collect();
    for (const sub of subtasks) {
      await ctx.db.delete(sub._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const duplicate = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const { orgId, userId } = await getAuthContext(ctx);
    const task = await ctx.db.get(args.id);
    if (!task || task.orgId !== orgId) throw new Error("Task not found");

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      orgId,
      title: `${task.title} (copy)`,
      description: task.description,
      statusId: task.statusId,
      statusType: task.statusType,
      projectId: task.projectId,
      assigneeIds: task.assigneeIds,
      workCategoryId: task.workCategoryId,
      estimate: task.estimate,
      billable: task.billable,
      dueDate: undefined, // Don't copy due date
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
  },
});
```

- [ ] **Step 4: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add convex/tasks.ts
git commit -m "feat: add task mutations (create, update, archive, restore, remove, duplicate)"
```

---

### Task 9: Create bulkUpdate mutation

**Files:**
- Modify: `convex/tasks.ts`

- [ ] **Step 1: Add bulkUpdate mutation**

```typescript
export const bulkUpdate = mutation({
  args: {
    taskIds: v.array(v.id("tasks")),
    action: v.union(
      v.object({ type: v.literal("status"), statusId: v.id("statuses") }),
      v.object({ type: v.literal("addAssignee"), userId: v.id("users") }),
      v.object({ type: v.literal("removeAssignee"), userId: v.id("users") }),
      v.object({ type: v.literal("category"), workCategoryId: v.id("workCategories") }),
      v.object({ type: v.literal("project"), projectId: v.id("projects") }),
      v.object({ type: v.literal("archive") }),
    ),
  },
  handler: async (ctx, args) => {
    const { orgId, isAdmin, userId } = await getAuthContext(ctx);

    if (args.taskIds.length > 50) {
      throw new Error("Maximum 50 tasks per bulk operation");
    }

    const now = Date.now();
    let updated = 0;
    const skipped: Array<{ taskId: string; title: string; reason: string }> = [];

    // Pre-validate action
    if (args.action.type === "status") {
      const status = await ctx.db.get(args.action.statusId);
      if (!status || status.orgId !== orgId) throw new Error("Status not found");
      if (!isAdmin && status.type === "done") throw new Error("Only admins can mark tasks as done");
    }

    for (const taskId of args.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task || task.orgId !== orgId) {
        skipped.push({ taskId, title: "Unknown", reason: "Task not found" });
        continue;
      }
      if (!isAdmin && !task.assigneeIds.includes(userId)) {
        skipped.push({ taskId, title: task.title, reason: "Not authorized" });
        continue;
      }

      if (args.action.type === "status") {
        const status = await ctx.db.get(args.action.statusId);
        await ctx.db.patch(taskId, {
          statusId: args.action.statusId,
          statusType: status!.type,
          updatedAt: now,
        });
        updated++;
      } else if (args.action.type === "addAssignee") {
        if (!task.assigneeIds.includes(args.action.userId)) {
          await ctx.db.patch(taskId, {
            assigneeIds: [...task.assigneeIds, args.action.userId],
            updatedAt: now,
          });
        }
        updated++;
      } else if (args.action.type === "removeAssignee") {
        await ctx.db.patch(taskId, {
          assigneeIds: task.assigneeIds.filter((id) => id !== args.action.userId),
          updatedAt: now,
        });
        updated++;
      } else if (args.action.type === "category") {
        await ctx.db.patch(taskId, {
          workCategoryId: args.action.workCategoryId,
          updatedAt: now,
        });
        updated++;
      } else if (args.action.type === "project") {
        // TODO(Phase 7): Skip if task has time entries
        await ctx.db.patch(taskId, {
          projectId: args.action.projectId,
          updatedAt: now,
        });
        updated++;
      } else if (args.action.type === "archive") {
        await ctx.db.patch(taskId, { archivedAt: now, updatedAt: now });
        // Cascade to subtasks
        const subtasks = await ctx.db
          .query("tasks")
          .withIndex("by_parentTaskId", (q) => q.eq("parentTaskId", taskId))
          .collect();
        for (const sub of subtasks) {
          if (!sub.archivedAt) {
            await ctx.db.patch(sub._id, { archivedAt: now, updatedAt: now });
          }
        }
        updated++;
      }
    }

    return { updated, skipped };
  },
});
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add convex/tasks.ts
git commit -m "feat: add tasks.bulkUpdate mutation with atomic execution and skip reporting"
```

---

## Chunk 2: Frontend — URL State Hooks & Shared Components

### Task 10: Create URL state hook for task filters

**Files:**
- Create: `lib/hooks/use-task-filters.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo } from "react";
import { Id } from "@/convex/_generated/dataModel";

export type TabName = "active" | "backlog" | "today" | "review" | "blocked" | "done";
export type GroupByOption = "project" | "client" | "category" | "assignee" | "status" | null;
export type FilterOp = "is" | "isNot" | "anyOf" | "noneOf";

export type FilterValue = {
  op: FilterOp;
  value: string | string[]; // IDs
};

export type TaskFilters = {
  clientId?: FilterValue;
  projectId?: FilterValue;
  assigneeIds?: FilterValue;
  workCategoryId?: FilterValue;
  dateFrom?: string;
  dateTo?: string;
};

export function useTaskFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab: TabName = (searchParams.get("tab") as TabName) || "active";
  const groupBy: GroupByOption = (searchParams.get("groupBy") as GroupByOption) || null;
  const search: string = searchParams.get("search") || "";

  const filters: TaskFilters = useMemo(() => {
    const f: TaskFilters = {};
    const parseFilter = (key: string): FilterValue | undefined => {
      const raw = searchParams.get(key);
      if (!raw) return undefined;
      const colonIdx = raw.indexOf(":");
      if (colonIdx === -1) return undefined;
      const op = raw.slice(0, colonIdx) as FilterOp;
      const valStr = raw.slice(colonIdx + 1);
      const value = valStr.includes(",") ? valStr.split(",") : valStr;
      return { op, value };
    };
    f.clientId = parseFilter("client");
    f.projectId = parseFilter("project");
    f.assigneeIds = parseFilter("assignee");
    f.workCategoryId = parseFilter("category");
    f.dateFrom = searchParams.get("dateFrom") || undefined;
    f.dateTo = searchParams.get("dateTo") || undefined;
    return f;
  }, [searchParams]);

  const hasActiveFilters = useMemo(() => {
    return !!(filters.clientId || filters.projectId || filters.assigneeIds || filters.workCategoryId || filters.dateFrom || filters.dateTo);
  }, [filters]);

  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }, [searchParams, router, pathname]);

  const setTab = useCallback((t: TabName) => updateParams({ tab: t }), [updateParams]);
  const setGroupBy = useCallback((g: GroupByOption) => updateParams({ groupBy: g }), [updateParams]);
  const setSearch = useCallback((s: string) => updateParams({ search: s || null }), [updateParams]);

  const setFilter = useCallback((key: string, op: FilterOp, value: string | string[]) => {
    const serialized = `${op}:${Array.isArray(value) ? value.join(",") : value}`;
    updateParams({ [key]: serialized });
  }, [updateParams]);

  const removeFilter = useCallback((key: string) => {
    updateParams({ [key]: null });
  }, [updateParams]);

  const clearAllFilters = useCallback(() => {
    updateParams({
      client: null,
      project: null,
      assignee: null,
      category: null,
      dateFrom: null,
      dateTo: null,
    });
  }, [updateParams]);

  return {
    tab, groupBy, search, filters, hasActiveFilters,
    setTab, setGroupBy, setSearch, setFilter, removeFilter, clearAllFilters,
  };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-task-filters.ts
git commit -m "feat: add useTaskFilters hook for URL-driven filter state"
```

---

### Task 11: Create group collapse hook

**Files:**
- Create: `lib/hooks/use-group-collapse.ts`

- [ ] **Step 1: Create the hook**

```typescript
"use client";

import { useState, useCallback, useEffect } from "react";

function getStorageKey(orgId: string, groupBy: string): string {
  return `tasks-collapsed:${orgId}:${groupBy}`;
}

export function useGroupCollapse(orgId: string | undefined, groupBy: string | null) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Load from localStorage on mount / when groupBy changes
  useEffect(() => {
    if (!orgId || !groupBy) {
      setCollapsed(new Set());
      return;
    }
    try {
      const stored = localStorage.getItem(getStorageKey(orgId, groupBy));
      if (stored) setCollapsed(new Set(JSON.parse(stored)));
      else setCollapsed(new Set());
    } catch {
      setCollapsed(new Set());
    }
  }, [orgId, groupBy]);

  const toggle = useCallback((groupKey: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      // Persist
      if (orgId && groupBy) {
        try {
          localStorage.setItem(getStorageKey(orgId, groupBy), JSON.stringify([...next]));
        } catch { /* ignore quota errors */ }
      }
      return next;
    });
  }, [orgId, groupBy]);

  const isCollapsed = useCallback((groupKey: string) => collapsed.has(groupKey), [collapsed]);

  return { isCollapsed, toggle };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-group-collapse.ts
git commit -m "feat: add useGroupCollapse hook with localStorage persistence"
```

---

### Task 12: Create UserAvatar shared component

**Files:**
- Create: `components/user-avatar.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { cn } from "@/lib/utils";

type UserAvatarProps = {
  name: string;
  imageUrl?: string;
  size?: "sm" | "md";
  className?: string;
};

const COLORS = [
  "bg-indigo-500", "bg-amber-500", "bg-emerald-500", "bg-rose-500",
  "bg-sky-500", "bg-violet-500", "bg-orange-500", "bg-teal-500",
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UserAvatar({ name, imageUrl, size = "sm", className }: UserAvatarProps) {
  const sizeClass = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={cn("rounded-full object-cover", sizeClass, className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-medium text-white",
        sizeClass,
        getColorFromName(name),
        className
      )}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
}

export function StackedAvatars({
  users,
  max = 3,
}: {
  users: Array<{ name: string; imageUrl?: string }>;
  max?: number;
}) {
  const visible = users.slice(0, max);
  const overflow = users.length - max;

  return (
    <div className="flex items-center -space-x-1.5">
      {visible.map((u, i) => (
        <UserAvatar key={i} name={u.name} imageUrl={u.imageUrl} size="sm" className="ring-2 ring-white" />
      ))}
      {overflow > 0 && (
        <span className="ml-1 text-xs text-muted-foreground">+{overflow}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/user-avatar.tsx
git commit -m "feat: add UserAvatar and StackedAvatars shared components"
```

---

### Task 13: Create basic Tiptap editor component

**Files:**
- Create: `components/tiptap-editor.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cn } from "@/lib/utils";

type TiptapEditorProps = {
  content?: string;
  onChange?: (json: string) => void;
  placeholder?: string;
  className?: string;
  editable?: boolean;
};

export function TiptapEditor({
  content,
  onChange,
  placeholder = "Write a description...",
  className,
  editable = true,
}: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: content ? JSON.parse(content) : undefined,
    editable,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none min-h-[120px] px-3 py-2",
          "text-foreground placeholder:text-muted-foreground"
        ),
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(JSON.stringify(editor.getJSON()));
    },
  });

  return (
    <div className={cn("relative rounded-md border border-input bg-background", className)}>
      {editor?.isEmpty && editable && (
        <div className="pointer-events-none absolute px-3 py-2 text-sm text-muted-foreground">
          {placeholder}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
```

Note to implementing agent: This is a basic Tiptap v1 setup. Phase 6 will enhance it with mentions, slash commands, and richer block types. The placeholder implementation may need adjustment — test visually and fix positioning if needed. The `prose` classes may need `@tailwindcss/typography` plugin. If not already installed, add it.

- [ ] **Step 2: Check if @tailwindcss/typography is needed**

```bash
grep -r "typography" package.json tailwind.config.* app/globals.css 2>/dev/null || echo "Not found"
```

If not found, install:
```bash
npm install @tailwindcss/typography
```

And add to Tailwind config (if using tailwind.config.ts) or import in CSS (Tailwind v4 style).

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add components/tiptap-editor.tsx
git commit -m "feat: add basic Tiptap editor component (shared for task creation and Phase 6 detail)"
```

---

### Task 14: Create ProjectPicker shared component

**Files:**
- Create: `components/tasks/project-picker.tsx`

- [ ] **Step 1: Create the Toggl-style grouped project picker**

```tsx
"use client";

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { FolderIcon, LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ProjectPickerProps = {
  value?: Id<"projects">;
  onChange: (projectId: Id<"projects"> | undefined) => void;
  filterByClientId?: string; // Pre-filter to a specific client's projects
  disabled?: boolean;
  locked?: boolean; // Has time entries
  trigger: React.ReactNode;
};

export function ProjectPicker({
  value,
  onChange,
  filterByClientId,
  disabled,
  locked,
  trigger,
}: ProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const projects = useQuery(api.projects.list, {});
  const clients = useQuery(api.clients.list, {});

  const grouped = useMemo(() => {
    if (!projects || !clients) return [];
    const clientMap = new Map(clients.map((c) => [c._id, c]));

    // Filter if needed
    let filteredProjects = projects.filter((p) => !p.archivedAt);
    if (filterByClientId) {
      filteredProjects = filteredProjects.filter((p) => p.clientId === filterByClientId);
    }

    // Search filter
    if (search) {
      const lower = search.toLowerCase();
      filteredProjects = filteredProjects.filter(
        (p) =>
          p.name.toLowerCase().includes(lower) ||
          clientMap.get(p.clientId)?.name.toLowerCase().includes(lower)
      );
    }

    // Group by client
    const groups = new Map<string, { clientName: string; projects: typeof filteredProjects }>();
    for (const p of filteredProjects) {
      const client = clientMap.get(p.clientId);
      const clientName = client?.name ?? "Unknown";
      if (!groups.has(p.clientId)) {
        groups.set(p.clientId, { clientName, projects: [] });
      }
      groups.get(p.clientId)!.projects.push(p);
    }

    return [...groups.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [projects, clients, search, filterByClientId]);

  if (locked) {
    return (
      <div className="flex items-center gap-1 text-muted-foreground" title="Has time entries — project cannot be changed">
        {trigger}
        <LockIcon className="h-3 w-3" />
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {/* Clear option */}
          <button
            className={cn(
              "w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent",
              !value && "bg-accent"
            )}
            onClick={() => { onChange(undefined); setOpen(false); }}
          >
            No project
          </button>
          {grouped.map((group) => (
            <div key={group.clientName}>
              <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {group.clientName}
              </div>
              {group.projects.map((p) => (
                <button
                  key={p._id}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2",
                    value === p._id && "bg-accent font-medium"
                  )}
                  onClick={() => { onChange(p._id); setOpen(false); setSearch(""); }}
                >
                  <FolderIcon className="h-3 w-3 text-muted-foreground" />
                  {p.name}
                </button>
              ))}
            </div>
          ))}
          {grouped.length === 0 && (
            <div className="px-3 py-4 text-xs text-center text-muted-foreground">
              {search ? "No projects match" : "No projects available"}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/project-picker.tsx
git commit -m "feat: add ProjectPicker with Toggl-style client-grouped dropdown"
```

---

## Chunk 3: Frontend — Task List Components

### Task 15: Create tasks page skeleton (loading.tsx)

**Files:**
- Create: `app/(dashboard)/tasks/loading.tsx`

- [ ] **Step 1: Create the content-aware loading skeleton**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

export default function TasksLoading() {
  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5">
        <Skeleton className="h-7 w-16" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>
      {/* Tabs */}
      <div className="flex items-center gap-0 border-b px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16 mx-3 my-3" />
        ))}
      </div>
      {/* Table header */}
      <div className="flex items-center gap-4 px-6 py-2 border-b">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-16 ml-auto" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-12" />
      </div>
      {/* Rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-6 py-3 border-b">
          <Skeleton className="h-4 w-4" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add app/\(dashboard\)/tasks/loading.tsx
git commit -m "feat: add content-aware loading skeleton for tasks page"
```

---

### Task 16: Create TasksHeader component

**Files:**
- Create: `components/tasks/tasks-header.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState, useDeferredValue, useEffect } from "react";
import { PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TasksHeaderProps = {
  totalCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  onNewTask: () => void;
};

export function TasksHeader({ totalCount, search, onSearchChange, onNewTask }: TasksHeaderProps) {
  const [localSearch, setLocalSearch] = useState(search);
  const deferredSearch = useDeferredValue(localSearch);

  useEffect(() => {
    onSearchChange(deferredSearch);
  }, [deferredSearch, onSearchChange]);

  // Sync external changes
  useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  return (
    <div className="flex items-center justify-between px-6 py-5">
      <div>
        <h1 className="text-xl font-bold">Tasks</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="h-9 w-52 pl-8 text-sm"
          />
        </div>
        <Button size="sm" onClick={onNewTask}>
          <PlusIcon className="h-4 w-4 mr-1" />
          New task
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/tasks-header.tsx
git commit -m "feat: add TasksHeader component with search and new task button"
```

---

### Task 17: Create TasksTabs component

**Files:**
- Create: `components/tasks/tasks-tabs.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { TabName } from "@/lib/hooks/use-task-filters";

type TabConfig = {
  key: TabName;
  label: string;
};

const TABS: TabConfig[] = [
  { key: "active", label: "Active" },
  { key: "backlog", label: "Backlog" },
  { key: "today", label: "Today" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
];

type TasksTabsProps = {
  activeTab: TabName;
  counts: Record<TabName, number> | undefined;
  onTabChange: (tab: TabName) => void;
  rightContent?: React.ReactNode; // Filter + Group by buttons
};

export function TasksTabs({ activeTab, counts, onTabChange, rightContent }: TasksTabsProps) {
  return (
    <div className="flex items-center border-b px-6">
      <div className="flex items-center gap-0">
        {TABS.map((tab) => {
          const count = counts?.[tab.key];
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "px-4 py-2.5 text-sm transition-colors relative",
                isActive
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <span
                  className={cn(
                    "ml-1.5 text-xs tabular-nums",
                    isActive
                      ? "inline-flex items-center justify-center rounded-full bg-foreground/10 px-1.5 py-0.5 font-medium"
                      : "text-muted-foreground/60"
                  )}
                >
                  {count}
                </span>
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
              )}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {rightContent}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/tasks-tabs.tsx
git commit -m "feat: add TasksTabs component with count badges and right-aligned slot"
```

---

### Task 18: Create TasksToolbar (Filter + Group by buttons)

**Files:**
- Create: `components/tasks/tasks-toolbar.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";
import { FilterIcon, Rows3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { GroupByOption } from "@/lib/hooks/use-task-filters";

type TasksToolbarProps = {
  isFilterOpen: boolean;
  onToggleFilter: () => void;
  hasActiveFilters: boolean;
  groupBy: GroupByOption;
  onGroupByChange: (value: GroupByOption) => void;
  isAdmin: boolean;
};

const GROUP_OPTIONS: Array<{ value: GroupByOption; label: string; adminOnly?: boolean }> = [
  { value: null, label: "None" },
  { value: "project", label: "Project" },
  { value: "client", label: "Client", adminOnly: true },
  { value: "category", label: "Category" },
  { value: "assignee", label: "Assignee" },
  { value: "status", label: "Status" },
];

export function TasksToolbar({
  isFilterOpen,
  onToggleFilter,
  hasActiveFilters,
  groupBy,
  onGroupByChange,
  isAdmin,
}: TasksToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onToggleFilter}
        className={cn(
          "h-8 text-xs",
          (isFilterOpen || hasActiveFilters) && "bg-primary/5 border-primary/30 text-primary"
        )}
      >
        <FilterIcon className="h-3.5 w-3.5 mr-1.5" />
        Filter
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs">
            <Rows3Icon className="h-3.5 w-3.5 mr-1.5" />
            {groupBy ? `Group: ${GROUP_OPTIONS.find((o) => o.value === groupBy)?.label}` : "Group by"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {GROUP_OPTIONS.filter((o) => !o.adminOnly || isAdmin).map((option) => (
            <DropdownMenuItem
              key={option.value ?? "none"}
              onClick={() => onGroupByChange(option.value)}
              className={cn(groupBy === option.value && "font-medium")}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/tasks-toolbar.tsx
git commit -m "feat: add TasksToolbar with Filter and Group by buttons"
```

---

### Task 19: Create TasksFilterBar component (Stripe-style pills)

**Files:**
- Create: `components/tasks/tasks-filter-bar.tsx`

This is a larger component. The implementing agent should create the filter bar with:
- Inactive pills: `+ Client`, `+ Project`, `+ Assignee`, `+ Category`, `+ Due date`
- Two-step dropdown on click: operator selection (is/is not/any of/none of) → value selection
- Active pills: blue for inclusion, red for exclusion, with ✕ to remove
- "Clear all" link on the right
- Admin-only: Client pill hidden for members
- Due date pill opens date range popover with presets

This is a complex component. The implementing agent should:
1. Build the basic pill rendering first (active/inactive states)
2. Then add the two-step operator dropdown interaction
3. Then add the value selection popovers for each filter type
4. Use the existing `Popover` and `DropdownMenu` shadcn components

- [ ] **Step 1: Create the component with pill rendering and operator flow**

The implementing agent should reference the design spec Section 4 (Filter System) for exact behavior. Key patterns:
- Use `Popover` for each pill's dropdown
- Step 1 dropdown: list of operators (is, is not, any of, none of)
- Step 2 dropdown: searchable value list (checkboxes for multi-select)
- Use `useQuery(api.clients.list)`, `useQuery(api.projects.list)`, etc. for value lists
- Call `setFilter(key, op, value)` from `useTaskFilters` when a filter is applied

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/tasks-filter-bar.tsx
git commit -m "feat: add Stripe-style filter bar with two-step operator pills"
```

---

### Task 20: Create TaskGroup component

**Files:**
- Create: `components/tasks/task-group.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type TaskGroupProps = {
  label: string;
  count: number;
  color?: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

export function TaskGroup({ label, count, color, isCollapsed, onToggle, children }: TaskGroupProps) {
  return (
    <div>
      {/* Group header */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-6 py-2.5 bg-muted/40 border-b hover:bg-muted/60 transition-colors"
      >
        {color && (
          <div
            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        {isCollapsed ? (
          <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="font-semibold text-sm">{label}</span>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5 tabular-nums">
          {count}
        </span>
      </button>

      {/* Group content (indented) */}
      {!isCollapsed && (
        <div className="pl-4">
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/task-group.tsx
git commit -m "feat: add TaskGroup component with collapsible indented sections"
```

---

### Task 21: Create TaskRow component (desktop table row with inline editing)

**Files:**
- Create: `components/tasks/task-row.tsx`

This is the core row component with 10 columns and inline editing. The implementing agent should build:

1. Checkbox (green when done)
2. Task title (bold) + subtitle mock ("Created · 2m ago" placeholder) + strikethrough for done
3. Activity mock (placeholder: "—" or static mock counts)
4. Status badge — click opens dropdown with all org statuses, done-type disabled for members
5. Category badge — click opens dropdown with work categories
6. Client / Project — click opens `ProjectPicker` component
7. Assignee — click opens multi-select with user avatars
8. Due date — display only, red "Overdue" if past
9. Time — mock play button + "0h 0m"
10. Menu ⋮ — `RowActionMenu` with Edit, Duplicate, Archive, Delete

The implementing agent should:
- Use `useMutation(api.tasks.update)` for inline edits
- Each editable cell wraps in a `Popover` or uses the existing dropdown pattern
- Reference `components/clients/clients-table.tsx` for the row action menu pattern
- Use `StatusBadge` and `CategoryBadge` shared components
- Column header icons: use Lucide icons matching each column

- [ ] **Step 1: Build the row with all 10 columns and static rendering**
- [ ] **Step 2: Add inline editing for status (click → dropdown)**
- [ ] **Step 3: Add inline editing for category**
- [ ] **Step 4: Add inline editing for client/project (use ProjectPicker)**
- [ ] **Step 5: Add inline editing for assignee (multi-select)**
- [ ] **Step 6: Add row action menu (Edit, Duplicate, Archive, Delete)**
- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add components/tasks/task-row.tsx
git commit -m "feat: add TaskRow with 10 columns and inline editing for status, category, project, assignee"
```

---

### Task 22: Create TasksTable component (desktop table wrapper)

**Files:**
- Create: `components/tasks/tasks-table.tsx`

- [ ] **Step 1: Create the table wrapper with column headers**

The table component should:
- Render column headers with icons (CheckSquare, Type, Activity, Circle, Tag, Folder, Users, Calendar, Clock, MoreHorizontal)
- Map over groups from `tasks.list` result
- Render `TaskGroup` for each group (when groupBy is set), or flat rows
- Include `TaskRow` for each task
- Include `InlineAddTask` at the bottom of each group
- Show "Load more" button per group when `hasMore` is true

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/tasks-table.tsx
git commit -m "feat: add TasksTable with column headers, grouping, and Load more"
```

---

### Task 23: Create InlineAddTask component

**Files:**
- Create: `components/tasks/inline-add-task.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { PlusIcon } from "lucide-react";
import { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

type InlineAddTaskProps = {
  groupBy?: string;
  groupKey?: string;
  // Pre-fill values based on the current group context
  defaultProjectId?: Id<"projects">;
  defaultStatusId?: Id<"statuses">;
  defaultWorkCategoryId?: Id<"workCategories">;
  defaultAssigneeId?: Id<"users">;
  filterByClientId?: string; // For client group: show project picker
};

export function InlineAddTask({
  defaultProjectId,
  defaultStatusId,
  defaultWorkCategoryId,
  defaultAssigneeId,
  filterByClientId,
}: InlineAddTaskProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useMutation(api.tasks.create);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) return;

    try {
      await createTask({
        title: trimmed,
        projectId: defaultProjectId,
        statusId: defaultStatusId,
        workCategoryId: defaultWorkCategoryId,
        assigneeIds: defaultAssigneeId ? [defaultAssigneeId] : undefined,
      });
      setTitle(""); // Clear for rapid entry — input stays open
      inputRef.current?.focus();
    } catch (e) {
      toast.error("Failed to create task");
    }
  }, [title, createTask, defaultProjectId, defaultStatusId, defaultWorkCategoryId, defaultAssigneeId]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      setTitle("");
      setIsEditing(false);
    }
  }, [handleSubmit]);

  if (!isEditing) {
    return (
      <button
        onClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex items-center gap-2 w-full px-6 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
      >
        <PlusIcon className="h-3.5 w-3.5" />
        Add task...
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b">
      <PlusIcon className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!title.trim()) setIsEditing(false); }}
        placeholder="Task title — Enter to create, Escape to cancel"
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add components/tasks/inline-add-task.tsx
git commit -m "feat: add InlineAddTask with rapid entry mode and group value inheritance"
```

---

## Chunk 4: Frontend — Modal, Bulk Toolbar, Mobile, Empty States, and Page Orchestration

### Task 24: Create TaskFormModal (ClickUp-style creation)

**Files:**
- Create: `components/tasks/task-form-modal.tsx`

The implementing agent should build this modal following the design spec Section 5. Key elements:
- `Dialog` from shadcn wrapping the form
- Project dropdown at top (using `ProjectPicker`)
- Large title input (focused on open)
- Tiptap editor for description (basic formatting)
- Pill bar at bottom: Status, Assignee, Due date, Category, `···` overflow (Billable toggle)
- "Create Task" split button with "Create & add another" option
- Use `useMutation(api.tasks.create)`

- [ ] **Step 1: Build the modal layout with all fields**
- [ ] **Step 2: Wire form submission and "Create & add another"**
- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add components/tasks/task-form-modal.tsx
git commit -m "feat: add ClickUp-style task creation modal with Tiptap editor and pill bar"
```

---

### Task 25: Create BulkToolbar component

**Files:**
- Create: `components/tasks/bulk-toolbar.tsx`

The implementing agent should build the floating bottom toolbar:
- Fixed position at the bottom of the viewport
- Shows "X selected" + "Deselect all" link
- Status, Add assignee, Remove assignee, Category, Project dropdown buttons
- Archive button (visually separated with divider, red/destructive style)
- Escape key handler to deselect all
- Uses `useMutation(api.tasks.bulkUpdate)` for all actions
- Confirmation dialog for pre-flight checks (tasks with time entries)
- Undo pattern for bulk archive via `useUndoAction` from `lib/hooks/use-undo-action.ts` (already exists — see signature: `trigger({ key, action, message, delay?, onUndo?, onError? })`). For bulk archive, use a composite key like `"bulk-archive-" + Date.now()`, and pass a `bulkRestore` action that calls `tasks.restore` in a loop for all archived task IDs.

- [ ] **Step 1: Build the toolbar layout and selection state management**
- [ ] **Step 2: Wire bulk actions (status, assignee, category, project, archive)**
- [ ] **Step 3: Add pre-flight confirmation dialog**
- [ ] **Step 4: Add undo support for bulk archive**
- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add components/tasks/bulk-toolbar.tsx
git commit -m "feat: add floating bulk operations toolbar with undo support"
```

---

### Task 26: Create TaskCard (mobile view) and TasksEmptyState

**Files:**
- Create: `components/tasks/task-card.tsx`
- Create: `components/tasks/tasks-empty-state.tsx`

- [ ] **Step 1: Create mobile card component**

```tsx
"use client";

import { StatusBadge } from "@/components/status-badge";
import { CategoryBadge } from "@/components/category-badge";
import { UserAvatar } from "@/components/user-avatar";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Type matches the enriched task from tasks.list query
type TaskCardProps = {
  task: {
    _id: string;
    title: string;
    statusType: string;
    dueDate?: string;
    status: { name: string; color: string; type: string } | null;
    category: { name: string; color: string } | null;
    client: { name: string } | null;
    project: { name: string } | null;
    assignees: Array<{ name: string; imageUrl?: string }>;
  };
  isSelected: boolean;
  onSelect: () => void;
  onTap: () => void;
};

export function TaskCard({ task, isSelected, onSelect, onTap }: TaskCardProps) {
  const isDone = task.statusType === "done";
  const isOverdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && !isDone;

  return (
    <div
      onClick={onTap}
      className={cn(
        "px-4 py-3 border-b transition-colors",
        isSelected && "bg-primary/5",
        isDone && "opacity-60"
      )}
    >
      <div className={cn("text-sm font-medium", isDone && "line-through text-muted-foreground")}>
        {task.title}
      </div>
      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
        {task.status && <StatusBadge name={task.status.name} color={task.status.color} />}
        {task.category && <CategoryBadge name={task.category.name} color={task.category.color} />}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <div className="text-xs text-muted-foreground">
          {task.client && task.project && `${task.client.name} · ${task.project.name}`}
        </div>
        <div className="flex items-center gap-2">
          {task.assignees.length > 0 && (
            <UserAvatar name={task.assignees[0].name} imageUrl={task.assignees[0].imageUrl} size="sm" />
          )}
          {task.dueDate && (
            <span className={cn("text-xs flex items-center gap-1", isOverdue ? "text-destructive font-medium" : "text-muted-foreground")}>
              <CalendarIcon className="h-3 w-3" />
              {isOverdue ? "Overdue" : task.dueDate}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create empty state component**

```tsx
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { CheckSquareIcon, InboxIcon, SunIcon, EyeIcon, AlertTriangleIcon, CheckCircleIcon, PlusIcon } from "lucide-react";
import type { TabName } from "@/lib/hooks/use-task-filters";

const TAB_EMPTY_STATES: Record<TabName, { icon: typeof CheckSquareIcon; title: string; description: string }> = {
  active: { icon: CheckSquareIcon, title: "No active tasks", description: "Create one to get started" },
  backlog: { icon: InboxIcon, title: "Backlog is empty", description: "Tasks waiting to be picked up will appear here" },
  today: { icon: SunIcon, title: "Nothing planned for today", description: "Move tasks to Today to plan your day" },
  review: { icon: EyeIcon, title: "Nothing waiting for review", description: "Tasks in review will appear here" },
  blocked: { icon: AlertTriangleIcon, title: "Nothing blocked — nice!", description: "Blocked tasks will appear here" },
  done: { icon: CheckCircleIcon, title: "No completed tasks yet", description: "Finished tasks will appear here" },
};

type TasksEmptyStateProps = {
  tab: TabName;
  hasFilters: boolean;
  isMember: boolean;
  onClearFilters?: () => void;
  onNewTask?: () => void;
};

// Note: EmptyState's `action` prop is ReactNode — pass a <Button> element, not an object
export function TasksEmptyState({ tab, hasFilters, isMember, onClearFilters, onNewTask }: TasksEmptyStateProps) {
  if (hasFilters) {
    return (
      <EmptyState
        icon={CheckSquareIcon}
        title="No tasks match your filters"
        description="Try adjusting your filters or clearing them"
        action={onClearFilters ? <Button variant="outline" size="sm" onClick={onClearFilters}>Clear all filters</Button> : undefined}
      />
    );
  }

  if (isMember && tab === "active") {
    return (
      <EmptyState
        icon={CheckSquareIcon}
        title="No tasks assigned to you yet"
        description="Tasks assigned to you will appear here"
      />
    );
  }

  const config = TAB_EMPTY_STATES[tab];
  return (
    <EmptyState
      icon={config.icon}
      title={config.title}
      description={config.description}
      action={tab === "active" && onNewTask ? <Button size="sm" onClick={onNewTask}><PlusIcon className="h-4 w-4 mr-1" />New task</Button> : undefined}
    />
  );
}

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add components/tasks/task-card.tsx components/tasks/tasks-empty-state.tsx
git commit -m "feat: add mobile TaskCard and per-tab TasksEmptyState components"
```

---

### Task 27: Wire up the Tasks page orchestrator

**Files:**
- Modify: `app/(dashboard)/tasks/page.tsx` (replace placeholder entirely)

This is the final assembly. The implementing agent should:

1. Replace the current placeholder with a `"use client"` page component
2. Use `useQuery(api.tasks.counts)` for tab badges
3. Use `useQuery(api.tasks.list, { tab, filters, groupBy, search })` for the task list
4. Use `useTaskFilters()` for URL state
5. Use `useGroupCollapse()` for collapse persistence
6. Use `useConvexAuth()` to check if authenticated
7. Use state for: `isFilterOpen`, `isModalOpen`, `selectedTaskIds`
8. Compose: `TasksHeader`, `TasksTabs` (with `TasksToolbar` as rightContent), `TasksFilterBar` (conditional), `TasksTable` or `TaskCard` grid (responsive), `BulkToolbar` (when selected), `TaskFormModal`
9. Responsive: use `useMediaQuery` or CSS to switch between table and card view at 768px
10. Keep the page file under 200 lines — delegate all logic to child components

- [ ] **Step 1: Build the page orchestrator**
- [ ] **Step 2: Test the full flow locally**

```bash
npm run dev
```

Open http://localhost:3000/tasks and verify:
- Tabs render with counts
- Filter button reveals pill row
- Group by changes grouping
- Search filters by title
- New task button opens modal
- Inline add task works
- Mobile card view at < 768px

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 4: Run lint**

```bash
npm run lint
```
Expected: clean

- [ ] **Step 5: Run build**

```bash
npm run build
```
Expected: success

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/tasks/page.tsx
git commit -m "feat: wire up Tasks page with filters, grouping, inline editing, and mobile view"
```

---

### Task 28: Update backlog documentation

**Files:**
- Modify: `docs/backlog.md`

- [ ] **Step 1: Add Phase 5 section to backlog**

Add a Phase 5 section with checkboxes for all acceptance criteria from the design spec. Mark completed items. Add a "TODOs deferred to later phases" section listing:

- Activity column: mock data → Phase 6 (wire to real subtasks/comments/attachments)
- Task subtitle: mock data → Phase 6 (wire to real activity feed)
- Time column: mock data → Phase 7 (wire to real timer and time entry system)
- Saved views: deferred (URL state covers for now)
- Column-header sorting: v2
- Drag-and-drop reordering: v2
- Arrow-key row navigation: v2
- Rich Tiptap features: Phase 6
- `assigneeIds` junction table migration: ~2,000 tasks/org
- Denormalized counts document: ~10,000 tasks/org
- Project name search: v2

- [ ] **Step 2: Commit**

```bash
git add docs/backlog.md
git commit -m "docs: add Phase 5 to backlog with acceptance criteria and deferred TODOs"
```

---

### Task 29: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: clean

- [ ] **Step 3: Production build**

```bash
npm run build
```
Expected: success

- [ ] **Step 4: Manual smoke test**

With both `npm run dev` and `npx convex dev` running:
1. Navigate to /tasks
2. Create a task via modal
3. Create a task via inline "+ Add task"
4. Change status inline
5. Change category inline
6. Change project inline
7. Add/remove assignee inline
8. Test each tab (Active, Backlog, Today, Review, Blocked, Done)
9. Test grouping (by project, category, assignee, status)
10. Test filter (add a category filter, add an exclusion filter, clear all)
11. Test search
12. Test bulk select + bulk status change
13. Test bulk archive + undo
14. Test mobile view (resize to < 768px)
15. Verify URL state (copy URL, paste in new tab — same view loads)
16. Test as member role (only sees assigned tasks, can't mark done)

- [ ] **Step 5: Final commit if any fixes needed**
