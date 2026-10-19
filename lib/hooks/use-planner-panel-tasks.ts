"use client"

import { useMemo } from "react"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { TaskPlanStats } from "@/convex/planner"
import type { TaskRowDTO } from "@/convex/tasks/read"
import type { TaskPanelItem } from "@/lib/planner"

type WorkspaceRefs = FunctionReturnType<typeof api.workspaceRefs.get>

/**
 * Resolves the Planner panel's cards: `listView` rows (the `planner` preset,
 * §10) + names from `workspaceRefs` + plan totals, newest first. Pure.
 */
export function buildPanelItems(
  rows: readonly TaskRowDTO[],
  refs: Pick<WorkspaceRefs, "projects" | "clients" | "workCategories">,
  stats: readonly TaskPlanStats[],
): TaskPanelItem[] {
  const projectById = new Map(refs.projects.map((p) => [p._id, p]))
  const clientById = new Map(refs.clients.map((c) => [c._id, c]))
  const categoryById = new Map(refs.workCategories.map((c) => [c._id, c]))
  const statsById = new Map(stats.map((s) => [s.taskId, s]))
  return rows
    .map((row): TaskPanelItem => {
      const project = row.projectId ? projectById.get(row.projectId) : undefined
      const client = row.clientId ? clientById.get(row.clientId) : undefined
      const category = row.workCategoryId ? categoryById.get(row.workCategoryId) : undefined
      const plan = statsById.get(row._id)
      return {
        _id: row._id,
        title: row.title,
        projectId: project?._id ?? null,
        projectName: project?.name ?? null,
        clientId: client?._id ?? null,
        clientName: client?.name ?? null,
        categoryId: category?._id ?? null,
        categoryName: category?.name ?? null,
        categoryColor: category?.color ?? null,
        statusCategory: row.statusCategory ?? "backlog",
        dueDate: row.dueDate,
        estimateMinutes: row.estimateMinutes,
        plannedDays: plan?.plannedDays ?? 0,
        segmentCount: plan?.segmentCount ?? 0,
        createdAt: row.createdAt,
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * The Planner's Tasks panel: the caller's readable, non-archived, top-level
 * tasks (open + the most recently closed) from `tasks.queries.listView`
 * surface `planner`, with their plan totals. Undefined while loading.
 */
export function usePlannerPanelTasks(enabled: boolean, today: string): TaskPanelItem[] | undefined {
  const list = useQuery(api.tasks.queries.listView, enabled ? { surface: "planner", today } : "skip")
  const refs = useQuery(api.workspaceRefs.get, enabled ? {} : "skip")
  const stats = useQuery(api.planner.planStats, enabled ? {} : "skip")
  return useMemo(
    () => (list && refs && stats ? buildPanelItems(list.rows, refs, stats) : undefined),
    [list, refs, stats],
  )
}
