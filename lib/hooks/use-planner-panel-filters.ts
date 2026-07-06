"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  EMPTY_PANEL_FILTERS,
  type PlannerDueFilter,
  type PlannerPanelFilters,
  type PlannerScheduleFilter,
} from "@/lib/planner"

const PROJECTS_PARAM = "projects"
const CLIENTS_PARAM = "clients"
const CATEGORIES_PARAM = "cats"
const DUE_PARAM = "due"
const SCHEDULE_PARAM = "sched"

/** The panel's DEFAULT view is the to-plan inbox (a pre-applied, fully
 *  regular Schedule chip) — so "unscheduled" is what a clean URL means,
 *  while Clear resets to the truly-empty "all". */
const DEFAULT_SCHEDULE: PlannerScheduleFilter = "unscheduled"

/** Convex ids, plus the literal "none" allowed for the category chip. */
const KEY_PATTERN = /^[a-zA-Z0-9]+$/

function parseCsv(token: string | null): string[] {
  if (!token) return []
  return token
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && KEY_PATTERN.test(s))
}

/**
 * The Tasks panel's chip filters ↔ URL search params (hand-rolled
 * useSearchParams convention, defaults dropped). Panel-scoped by design:
 * these params never feed the timeline query — the board always shows the
 * whole team's real plan.
 */
export function usePlannerPanelFilters(): {
  filters: PlannerPanelFilters
  setFilters: (patch: Partial<PlannerPanelFilters>) => void
  clearFilters: () => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const dueToken = searchParams.get(DUE_PARAM)
  const scheduleToken = searchParams.get(SCHEDULE_PARAM)
  const filters = useMemo<PlannerPanelFilters>(
    () => ({
      projectIds: parseCsv(searchParams.get(PROJECTS_PARAM)),
      clientIds: parseCsv(searchParams.get(CLIENTS_PARAM)),
      categoryKeys: parseCsv(searchParams.get(CATEGORIES_PARAM)),
      due:
        dueToken === "overdue" || dueToken === "week" || dueToken === "none"
          ? (dueToken as PlannerDueFilter)
          : "all",
      schedule:
        scheduleToken === "all" || scheduleToken === "planned"
          ? (scheduleToken as PlannerScheduleFilter)
          : DEFAULT_SCHEDULE,
    }),
    [searchParams, dueToken, scheduleToken],
  )

  const write = useCallback(
    (next: PlannerPanelFilters) => {
      const params = new URLSearchParams(searchParams.toString())
      const setOrDrop = (key: string, value: string | null) => {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      setOrDrop(PROJECTS_PARAM, next.projectIds.join(",") || null)
      setOrDrop(CLIENTS_PARAM, next.clientIds.join(",") || null)
      setOrDrop(CATEGORIES_PARAM, next.categoryKeys.join(",") || null)
      setOrDrop(DUE_PARAM, next.due === "all" ? null : next.due)
      setOrDrop(
        SCHEDULE_PARAM,
        next.schedule === DEFAULT_SCHEDULE ? null : next.schedule,
      )
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    },
    [searchParams, router, pathname],
  )

  const setFilters = useCallback(
    (patch: Partial<PlannerPanelFilters>) => write({ ...filters, ...patch }),
    [filters, write],
  )

  const clearFilters = useCallback(
    () => write(EMPTY_PANEL_FILTERS),
    [write],
  )

  return { filters, setFilters, clearFilters }
}
