"use client"

import { useUser } from "@clerk/nextjs"
import { useOrganization } from "@clerk/nextjs"
import { Authenticated, AuthLoading } from "convex/react"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"

function DashboardContent() {
  const { user } = useUser()
  const { organization } = useOrganization()

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
