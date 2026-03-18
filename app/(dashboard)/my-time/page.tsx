"use client"

import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { TodaySummary } from "@/components/my-time/today-summary"
import { ActiveTimerBanner, TodayEntries } from "@/components/my-time/today-entries"
import MyTimeLoading from "./loading"

export default function MyTimePage() {
  const { isAuthenticated } = useConvexAuth()
  const entries = useQuery(api.timeEntries.listToday, isAuthenticated ? {} : "skip")

  if (entries === undefined) {
    return <MyTimeLoading />
  }

  const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0)

  return (
    <div className="mx-auto w-full max-w-2xl">
      <TodaySummary totalMinutes={totalMinutes} />
      <div className="mt-6 flex flex-col gap-4">
        <ActiveTimerBanner />
        <TodayEntries entries={entries} />
      </div>
    </div>
  )
}
