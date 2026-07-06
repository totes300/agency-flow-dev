"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import type { Id } from "@/convex/_generated/dataModel"
import { startOfTodayInTimezone } from "@/lib/workday"
import { addDaysYmd, eachDateYmd, mondayOfYmd, ymdToLocalDate } from "@/lib/planner"
import {
  formatIsoWeek,
  formatYMD,
  parseIsoWeek,
  startOfWeek,
} from "./use-week-picker"

const WEEK_PARAM = "week"
const ZOOM_PARAM = "zoom"
const USERS_PARAM = "users"
const PANEL_PARAM = "panel"

const ID_PATTERN = /^[a-zA-Z0-9]+$/

export type PlannerZoom = "1w" | "2w" | "1m"

/** 2 weeks is the Planner's default zoom; dropped from the URL. */
const DEFAULT_ZOOM: PlannerZoom = "2w"

/** Initial loaded window around the anchor Monday (days). */
const WINDOW_BACK = 28
const WINDOW_FORWARD = 55 // anchor + 8 weeks − 1
/** Each edge extension adds this many days. */
const WINDOW_EXTEND = 28

export type PlannerQueryArgs = {
  startDate: string
  endDate: string
  userIds?: Id<"users">[]
}

export type UsePlannerQueryArgsResult = {
  queryArgs: PlannerQueryArgs
  /** Every loaded day (the scrollable canvas), always Mon-aligned at start. */
  days: string[]
  zoom: PlannerZoom
  /** Monday the view should scroll to on first render (from URL or today). */
  anchorYmd: string
  selectedUserIds: Id<"users">[]
  /** Tasks panel visibility (URL-persisted; open by default). */
  panelOpen: boolean
  /** Grow the loaded window when scrolling near an edge. */
  extendBack: () => void
  extendForward: () => void
  /** Debounced by the caller: persist the leftmost visible week to the URL. */
  commitAnchor: (leftmostYmd: string) => void
  setZoom: (next: PlannerZoom) => void
  setUserIds: (ids: Id<"users">[]) => void
  setPanelOpen: (open: boolean) => void
}

/**
 * Planner timeline state for the continuous (Toggl Plan-style) board.
 *
 * The timeline is one wide scrollable canvas over a loaded window of days
 * (state, grows at the edges as the user pans). Zoom is a density preset —
 * it changes day width, never the loaded range. The URL keeps a `week`
 * anchor (leftmost visible week, replace-mode, current week dropped) so
 * links stay shareable; hand-rolled useSearchParams convention as
 * everywhere (no nuqs).
 */
export function usePlannerQueryArgs(
  options: { orgTimezone?: string } = {},
): UsePlannerQueryArgsResult {
  const { orgTimezone } = options
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const weekToken = searchParams.get(WEEK_PARAM)
  const zoomToken = searchParams.get(ZOOM_PARAM)
  const usersToken = searchParams.get(USERS_PARAM)

  const zoom: PlannerZoom =
    zoomToken === "1w" || zoomToken === "1m" ? zoomToken : DEFAULT_ZOOM

  // Panel default: open — dropped from the URL. (The panel's Unscheduled/
  // All state is a regular filter now, owned by usePlannerPanelFilters.)
  const panelOpen = searchParams.get(PANEL_PARAM) !== "0"

  const currentMonday = useMemo(
    () => formatYMD(startOfWeek(startOfTodayInTimezone(orgTimezone))),
    [orgTimezone],
  )

  const anchorYmd = useMemo(() => {
    if (weekToken) {
      const parsed = parseIsoWeek(weekToken)
      if (parsed) return formatYMD(parsed)
    }
    return currentMonday
  }, [weekToken, currentMonday])

  // Loaded window — initialized around the first-render anchor, then only
  // ever grows. Deliberately NOT reset when the URL anchor changes later:
  // our own scroll-commit writes would otherwise loop back into the state.
  const [window, setWindow] = useState(() => ({
    start: addDaysYmd(anchorYmd, -WINDOW_BACK),
    end: addDaysYmd(anchorYmd, WINDOW_FORWARD),
  }))

  const extendBack = useCallback(() => {
    setWindow((w) => ({ ...w, start: addDaysYmd(w.start, -WINDOW_EXTEND) }))
  }, [])

  const extendForward = useCallback(() => {
    setWindow((w) => ({ ...w, end: addDaysYmd(w.end, WINDOW_EXTEND) }))
  }, [])

  const days = useMemo(
    () => eachDateYmd(window.start, window.end),
    [window.start, window.end],
  )

  const selectedUserIds = useMemo<Id<"users">[]>(() => {
    if (!usersToken) return []
    return usersToken
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && ID_PATTERN.test(s)) as Id<"users">[]
  }, [usersToken])

  const writeParams = useCallback(
    (
      entries: Record<string, string | null>,
      mode: "push" | "replace" = "replace",
    ) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(entries)) {
        if (value) next.set(key, value)
        else next.delete(key)
      }
      const qs = next.toString()
      const url = qs ? `${pathname}?${qs}` : pathname
      if (mode === "replace") router.replace(url)
      else router.push(url)
    },
    [pathname, router, searchParams],
  )

  // Scroll-position commits are replace-mode: panning must not spam history.
  const commitAnchor = useCallback(
    (leftmostYmd: string) => {
      const monday = mondayOfYmd(leftmostYmd)
      writeParams({
        [WEEK_PARAM]:
          monday === currentMonday
            ? null
            : formatIsoWeek(startOfWeek(ymdToLocalDate(monday))),
      })
    },
    [currentMonday, writeParams],
  )

  const setZoom = useCallback(
    (next: PlannerZoom) => {
      // Density only — the grid re-anchors its own scroll position.
      writeParams({ [ZOOM_PARAM]: next === DEFAULT_ZOOM ? null : next })
    },
    [writeParams],
  )

  const setUserIds = useCallback(
    (ids: Id<"users">[]) => {
      writeParams({ [USERS_PARAM]: ids.length > 0 ? ids.join(",") : null })
    },
    [writeParams],
  )

  const setPanelOpen = useCallback(
    (open: boolean) => {
      writeParams({ [PANEL_PARAM]: open ? null : "0" })
    },
    [writeParams],
  )


  const queryArgs = useMemo<PlannerQueryArgs>(
    () => ({
      startDate: window.start,
      endDate: window.end,
      ...(selectedUserIds.length > 0 ? { userIds: selectedUserIds } : {}),
    }),
    [window.start, window.end, selectedUserIds],
  )

  return {
    queryArgs,
    days,
    zoom,
    anchorYmd,
    selectedUserIds,
    panelOpen,
    extendBack,
    extendForward,
    commitAnchor,
    setZoom,
    setUserIds,
    setPanelOpen,
  }
}
