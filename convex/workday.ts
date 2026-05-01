import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { assertValidDateString } from "./lib/dateValidation";

/** Cap one weekGrid call well below Convex's 16k-doc read limit. v1 team
 *  sizes are ~700 docs/week for 10 users; switch to per-user paging past 5k. */
const MAX_ENTRIES_PER_WEEK = 10_000;

export type WorkdayBoxEntry = {
  _id: Id<"timeEntries">;
  startedAt: number;
  durationMinutes: number;
  note?: string;
  isBillable: boolean;
};

export type WorkdayBox = {
  taskId: Id<"tasks">;
  taskTitle: string;
  projectId: Id<"projects"> | null;
  projectName: string | null;
  clientName: string | null;
  categoryId: Id<"workCategories"> | null;
  categoryName: string | null;
  categoryColor: string | null;
  totalMinutes: number;
  firstStart: number;
  entries: WorkdayBoxEntry[];
};

export type WorkdayDay = {
  date: string;
  totalMinutes: number;
  boxes: WorkdayBox[];
};

export type WorkdayUserRow = {
  user: {
    _id: Id<"users">;
    name: string;
    imageUrl: string | undefined;
    role: "admin" | "member";
  };
  totalMinutes: number;
  days: WorkdayDay[];
};

export type WorkdayGridData = {
  users: WorkdayUserRow[];
};

function* eachDate(startDate: string, endDate: string) {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    yield `${y}-${m}-${day}`;
  }
}

export const weekGrid = query({
  args: {
    startDate: v.string(), // YYYY-MM-DD inclusive
    endDate: v.string(),   // YYYY-MM-DD inclusive
    userIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (ctx, args): Promise<WorkdayGridData> => {
    assertValidDateString(args.startDate, "startDate");
    assertValidDateString(args.endDate, "endDate");
    if (args.startDate > args.endDate) {
      throw new ConvexError("startDate must be on or before endDate");
    }

    const { orgId, userId, isAdmin } = await getAuthContext(ctx);

    // Member auto-scope: non-admins only ever see their own row.
    const scopedUserIds: Id<"users">[] | undefined = isAdmin
      ? args.userIds
      : [userId];

    // 1. Membership list — defines the rows even when there are zero entries.
    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    type RowUser = {
      _id: Id<"users">;
      name: string;
      imageUrl: string | undefined;
      role: "admin" | "member";
    };
    // Single round-trip: hydrate every member's user doc in parallel.
    const linkedMemberships = memberships.flatMap((m) =>
      m.userId ? [{ userId: m.userId, role: m.role }] : [],
    );
    const userDocs = await Promise.all(
      linkedMemberships.map((m) => ctx.db.get(m.userId)),
    );
    const rowUserById = new Map<string, RowUser>();
    linkedMemberships.forEach((m, i) => {
      const u = userDocs[i];
      if (!u || u.deletedAt) return;
      rowUserById.set(u._id.toString(), {
        _id: u._id,
        name: u.name,
        imageUrl: u.imageUrl,
        role: m.role,
      });
    });

    // Apply scopedUserIds filter to the row list.
    let rowUsers = [...rowUserById.values()];
    if (scopedUserIds && scopedUserIds.length > 0) {
      const allow = new Set(scopedUserIds.map((id) => id.toString()));
      rowUsers = rowUsers.filter((u) => allow.has(u._id.toString()));
    }
    rowUsers.sort((a, b) => a.name.localeCompare(b.name));

    // 2. Time entries in the range, scoped by orgId via the org-date index.
    //    `take` rather than `collect` so a runaway week never silently strands
    //    the page on Convex's read-doc ceiling. The cap is well above v1
    //    expected volume (~700 docs/week for 10 users).
    const entriesRaw = await ctx.db
      .query("timeEntries")
      .withIndex("by_orgId_date", (q) =>
        q.eq("orgId", orgId).gte("date", args.startDate).lte("date", args.endDate),
      )
      .take(MAX_ENTRIES_PER_WEEK + 1);
    if (entriesRaw.length > MAX_ENTRIES_PER_WEEK) {
      throw new ConvexError(
        `Workday week exceeded ${MAX_ENTRIES_PER_WEEK} entries — switch to per-user paged queries.`,
      );
    }

    const allowed = new Set(rowUsers.map((u) => u._id.toString()));
    const entries = entriesRaw.filter((e) => allowed.has(e.userId.toString()));

    // 3. Single-round-trip hydration — tasks → projects/categories → clients.
    const taskIds = [...new Set(entries.map((e) => e.taskId.toString()))];
    const tasks = await Promise.all(
      taskIds.map((id) => ctx.db.get(id as Id<"tasks">)),
    );
    const taskMap = new Map<string, Doc<"tasks">>();
    for (const t of tasks) {
      if (t && t.orgId === orgId) taskMap.set(t._id.toString(), t);
    }

    const projectIds = [
      ...new Set(
        [...taskMap.values()]
          .map((t) => t.projectId)
          .filter((id): id is Id<"projects"> => Boolean(id))
          .map((id) => id.toString()),
      ),
    ];
    const projects = await Promise.all(
      projectIds.map((id) => ctx.db.get(id as Id<"projects">)),
    );
    const projectMap = new Map<string, Doc<"projects">>();
    for (const p of projects) {
      if (p && p.orgId === orgId) projectMap.set(p._id.toString(), p);
    }

    const clientIds = [
      ...new Set(
        [...projectMap.values()].map((p) => p.clientId.toString()),
      ),
    ];
    const clients = await Promise.all(
      clientIds.map((id) => ctx.db.get(id as Id<"clients">)),
    );
    const clientMap = new Map<string, Doc<"clients">>();
    for (const c of clients) {
      if (c && c.orgId === orgId) clientMap.set(c._id.toString(), c);
    }

    const categoryIds = [
      ...new Set(
        [...taskMap.values()]
          .map((t) => t.workCategoryId)
          .filter((id): id is Id<"workCategories"> => Boolean(id))
          .map((id) => id.toString()),
      ),
    ];
    const categories = await Promise.all(
      categoryIds.map((id) => ctx.db.get(id as Id<"workCategories">)),
    );
    const categoryMap = new Map<string, Doc<"workCategories">>();
    for (const c of categories) {
      if (c && c.orgId === orgId) categoryMap.set(c._id.toString(), c);
    }

    // 4. Aggregate entries into (user, day, task) boxes.
    type BoxKey = string; // userId|date|taskId
    type Acc = {
      userId: string;
      date: string;
      taskId: Id<"tasks">;
      totalMinutes: number;
      firstStart: number;
      entries: WorkdayBoxEntry[];
    };
    const acc = new Map<BoxKey, Acc>();
    for (const e of entries) {
      const key = `${e.userId.toString()}|${e.date}|${e.taskId.toString()}`;
      const existing = acc.get(key);
      const entry: WorkdayBoxEntry = {
        _id: e._id,
        startedAt: e.startedAt,
        durationMinutes: e.durationMinutes,
        note: e.note,
        isBillable: e.isBillable,
      };
      if (existing) {
        existing.totalMinutes += e.durationMinutes;
        existing.firstStart = Math.min(existing.firstStart, e.startedAt);
        existing.entries.push(entry);
      } else {
        acc.set(key, {
          userId: e.userId.toString(),
          date: e.date,
          taskId: e.taskId,
          totalMinutes: e.durationMinutes,
          firstStart: e.startedAt,
          entries: [entry],
        });
      }
    }

    // 5. Build nested user → day → boxes shape.
    const dateRange = [...eachDate(args.startDate, args.endDate)];

    const accByUser = new Map<string, Acc[]>();
    for (const a of acc.values()) {
      const list = accByUser.get(a.userId) ?? [];
      list.push(a);
      accByUser.set(a.userId, list);
    }

    const result: WorkdayUserRow[] = rowUsers.map((u) => {
      const userAccs = accByUser.get(u._id.toString()) ?? [];
      const accsByDate = new Map<string, Acc[]>();
      for (const a of userAccs) {
        const list = accsByDate.get(a.date) ?? [];
        list.push(a);
        accsByDate.set(a.date, list);
      }

      let userTotal = 0;
      const days: WorkdayDay[] = dateRange.map((date) => {
        const dayAccs = (accsByDate.get(date) ?? []).slice();
        dayAccs.sort((a, b) => a.firstStart - b.firstStart);

        const boxes: WorkdayBox[] = dayAccs.map((a) => {
          const task = taskMap.get(a.taskId.toString());
          const project =
            task?.projectId ? projectMap.get(task.projectId.toString()) ?? null : null;
          const client = project ? clientMap.get(project.clientId.toString()) ?? null : null;
          const category =
            task?.workCategoryId
              ? categoryMap.get(task.workCategoryId.toString()) ?? null
              : null;

          a.entries.sort((x, y) => x.startedAt - y.startedAt);

          return {
            taskId: a.taskId,
            taskTitle: task?.title ?? "Unknown task",
            projectId: project?._id ?? null,
            projectName: project?.name ?? null,
            clientName: client?.name ?? null,
            categoryId: category?._id ?? null,
            categoryName: category?.name ?? null,
            categoryColor: category?.color ?? null,
            totalMinutes: a.totalMinutes,
            firstStart: a.firstStart,
            entries: a.entries,
          };
        });

        const dayTotal = boxes.reduce((s, b) => s + b.totalMinutes, 0);
        userTotal += dayTotal;
        return { date, totalMinutes: dayTotal, boxes };
      });

      return { user: u, totalMinutes: userTotal, days };
    });

    return { users: result };
  },
});
