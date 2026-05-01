"use client"

import { useCallback, useMemo } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import type { Id } from "@/convex/_generated/dataModel"
import { startOfTodayInTimezone } from "@/lib/workday"
import {
  formatIsoWeek,
  parseIsoWeek,
  startOfWeek,
  weekRange,
} from "./use-week-picker"

const WEEK_PARAM = "week"
const USERS_PARAM = "users"
const WEEKEND_PARAM = "weekend"

const ID_PATTERN = /^[a-zA-Z0-9]+$/

export type WorkdayQueryArgs = {
  startDate: string
  endDate: string
  userIds?: Id<"users">[]
}

export type UseWorkdayQueryArgsResult = {
  queryArgs: WorkdayQueryArgs
  selectedWeek: Date
  selectedIsoWeek: string
  days: string[]
  selectedUserIds: Id<"users">[]
  showWeekend: boolean
  setWeek: (next: Date | null) => void
  shiftWeek: (deltaWeeks: number) => void
  setUserIds: (ids: Id<"users">[]) => void
  setShowWeekend: (next: boolean) => void
}

export function useWorkdayQueryArgs(
  options: { orgTimezone?: string } = {},
): UseWorkdayQueryArgsResult {
  const { orgTimezone } = options
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const weekToken = searchParams.get(WEEK_PARAM)
  const usersToken = searchParams.get(USERS_PARAM)
  const showWeekend = searchParams.get(WEEKEND_PARAM) === "1"

  const selectedWeek = useMemo(() => {
    if (weekToken) {
      const parsed = parseIsoWeek(weekToken)
      if (parsed) return parsed
    }
    return startOfWeek(startOfTodayInTimezone(orgTimezone))
  }, [weekToken, orgTimezone])

  const selectedIsoWeek = useMemo(() => formatIsoWeek(selectedWeek), [selectedWeek])

  const range = useMemo(
    () => weekRange(selectedWeek, showWeekend),
    [selectedWeek, showWeekend],
  )

  const selectedUserIds = useMemo<Id<"users">[]>(() => {
    if (!usersToken) return []
    return usersToken
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && ID_PATTERN.test(s)) as Id<"users">[]
  }, [usersToken])

  const writeParam = useCallback(
    (key: string, value: string | null, mode: "push" | "replace" = "push") => {
      const next = new URLSearchParams(searchParams.toString())
      if (value) next.set(key, value)
      else next.delete(key)
      const qs = next.toString()
      const url = qs ? `${pathname}?${qs}` : pathname
      if (mode === "replace") router.replace(url)
      else router.push(url)
    },
    [pathname, router, searchParams],
  )

  const setWeek = useCallback(
    (date: Date | null) => {
      if (!date) {
        writeParam(WEEK_PARAM, null)
        return
      }
      const monday = startOfWeek(date)
      // Drop the param when landing on the current week — keeps the URL clean.
      // "Current" is org-tz to stay consistent with the page's "today" column.
      const currentMonday = startOfWeek(startOfTodayInTimezone(orgTimezone))
      const isCurrent = monday.getTime() === currentMonday.getTime()
      writeParam(WEEK_PARAM, isCurrent ? null : formatIsoWeek(monday))
    },
    [writeParam, orgTimezone],
  )

  const shiftWeek = useCallback(
    (deltaWeeks: number) => {
      const next = new Date(selectedWeek)
      next.setDate(next.getDate() + deltaWeeks * 7)
      setWeek(next)
    },
    [selectedWeek, setWeek],
  )

  // Filter toggles use `replace` so checkbox ticks don't pile up in history.
  const setUserIds = useCallback(
    (ids: Id<"users">[]) => {
      writeParam(USERS_PARAM, ids.length > 0 ? ids.join(",") : null, "replace")
    },
    [writeParam],
  )

  const setShowWeekend = useCallback(
    (next: boolean) => {
      writeParam(WEEKEND_PARAM, next ? "1" : null, "replace")
    },
    [writeParam],
  )

  const queryArgs = useMemo<WorkdayQueryArgs>(
    () => ({
      startDate: range.startDate,
      endDate: range.endDate,
      ...(selectedUserIds.length > 0 ? { userIds: selectedUserIds } : {}),
    }),
    [range.startDate, range.endDate, selectedUserIds],
  )

  return {
    queryArgs,
    selectedWeek,
    selectedIsoWeek,
    days: range.days,
    selectedUserIds,
    showWeekend,
    setWeek,
    shiftWeek,
    setUserIds,
    setShowWeekend,
  }
}
