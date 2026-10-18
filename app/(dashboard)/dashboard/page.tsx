"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useUser } from "@clerk/nextjs"
import { useOrganization } from "@clerk/nextjs"
import { Authenticated, AuthLoading, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { formatDuration } from "@/lib/duration"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronRightNavIcon } from "@/components/icons/nav-icons"
import { MyWorkBoard } from "@/components/task-view/my-work-board"

function DashboardContent() {
  const { user } = useUser()
  const { organization } = useOrganization()
  const trackedToday = useQuery(api.timeEntries.sumMyToday, {})

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back{user?.firstName ? `, ${user.firstName}` : ""}
        </h1>
        <p className="text-muted-foreground">
          {organization
            ? `Managing ${organization.name}`
            : "Your personal workspace"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <h2 className="text-xs font-medium text-muted-foreground">Active Tasks</h2>
            <p className="mt-1 text-2xl font-semibold tracking-tight">0</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="text-xs font-medium text-muted-foreground">Hours This Week</h2>
            <p className="mt-1 text-2xl font-semibold tracking-tight">0h</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <h2 className="text-xs font-medium text-muted-foreground">Active Projects</h2>
            <p className="mt-1 text-2xl font-semibold tracking-tight">0</p>
          </CardContent>
        </Card>
      </div>

      {/* My work (§11.8): the caller's In progress / Today / Done this week board. */}
      <section className="flex flex-col gap-3" aria-labelledby="my-work-heading">
        <div className="flex items-baseline gap-3">
          <h2 id="my-work-heading" className="text-sm font-medium">
            My work
          </h2>
          {trackedToday ? (
            <span className="text-xs text-muted-foreground tabular-nums">{formatDuration(trackedToday)} today</span>
          ) : null}
          <Link
            href="/my-tasks"
            className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Open My Tasks
            <ChevronRightNavIcon size={12} />
          </Link>
        </div>
        {/* The board reads ?task= (the drawer): useSearchParams needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <MyWorkBoard />
        </Suspense>
      </section>
    </div>
  )
}

export default function DashboardPage() {
  return (
    <>
      <AuthLoading>
        <div className="flex flex-1 flex-col gap-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-48" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-[76px] rounded-xl" />
            <Skeleton className="h-[76px] rounded-xl" />
            <Skeleton className="h-[76px] rounded-xl" />
          </div>
        </div>
      </AuthLoading>
      <Authenticated>
        <DashboardContent />
      </Authenticated>
    </>
  )
}
