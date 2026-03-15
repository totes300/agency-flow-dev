"use client"

import { useUser } from "@clerk/nextjs"
import { useOrganization } from "@clerk/nextjs"
import { useQuery } from "convex/react"
import { Authenticated, AuthLoading } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Skeleton } from "@/components/ui/skeleton"

function DashboardContent() {
  const { user } = useUser()
  const { organization } = useOrganization()
  const convexUser = useQuery(api.users.current)

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

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border p-6">
          <h2 className="mb-2 font-medium">Convex User Record</h2>
          {convexUser ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Name: {convexUser.name}</p>
              <p>ID: {convexUser._id}</p>
              <p>External ID: {convexUser.externalId}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading...</p>
          )}
        </div>

        <div className="rounded-xl border p-6">
          <h2 className="mb-2 font-medium">Getting Started</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">convex/schema.ts</code>{" "}
              — Add your data tables
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">convex/</code>{" "}
              — Write queries &amp; mutations
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">app/(dashboard)/</code>{" "}
              — Add protected pages
            </li>
            <li>
              <code className="rounded bg-muted px-1 py-0.5 text-xs">components/app-sidebar.tsx</code>{" "}
              — Update navigation
            </li>
          </ul>
        </div>
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
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </div>
      </AuthLoading>
      <Authenticated>
        <DashboardContent />
      </Authenticated>
    </>
  )
}
