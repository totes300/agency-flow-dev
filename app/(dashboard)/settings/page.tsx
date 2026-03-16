"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SettingsGeneral } from "@/components/settings/settings-general"

// ─── Content-aware loading skeletons ────────────────────────────────────────────

function TeamSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton className="size-8 rounded-full" />
            <div className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusesSkeleton() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i}>
          <div className="flex items-center justify-between border-b pb-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-4" />
          </div>
          <div className="space-y-1 pt-2">
            <div className="flex items-center gap-2 py-2">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex items-center gap-2 py-2">
              <Skeleton className="size-2.5 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function WorkCategoriesSkeleton() {
  return (
    <div>
      {/* Table header */}
      <div className="flex items-center border-b py-2">
        <div className="w-8" />
        <Skeleton className="h-3 w-12 flex-1" />
        <Skeleton className="h-3 w-8 mx-4" />
        <Skeleton className="h-3 w-6 mx-4" />
        <Skeleton className="h-3 w-16 mx-4" />
        <div className="w-16" />
      </div>
      {/* Table rows */}
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center border-b border-border/40 py-2.5">
          <div className="w-8 flex justify-center">
            <Skeleton className="size-3.5" />
          </div>
          <div className="flex-1">
            <Skeleton className="h-5 w-20 rounded-sm" />
          </div>
          <Skeleton className="h-4 w-6 mx-4" />
          <Skeleton className="h-4 w-6 mx-4" />
          <Skeleton className="h-4 w-8 mx-4" />
          <div className="w-16" />
        </div>
      ))}
    </div>
  )
}

// ─── Dynamic imports with content-aware fallbacks ───────────────────────────────

const SettingsTeam = dynamic(
  () =>
    import("@/components/settings/settings-team").then((m) => ({
      default: m.SettingsTeam,
    })),
  { loading: () => <TeamSkeleton /> },
)

const SettingsStatuses = dynamic(
  () =>
    import("@/components/settings/settings-statuses").then((m) => ({
      default: m.SettingsStatuses,
    })),
  { loading: () => <StatusesSkeleton /> },
)

const SettingsWorkCategories = dynamic(
  () =>
    import("@/components/settings/settings-work-categories").then((m) => ({
      default: m.SettingsWorkCategories,
    })),
  { loading: () => <WorkCategoriesSkeleton /> },
)

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your organization settings.
        </p>
      </div>

      <Tabs defaultValue="general" className="flex-1">
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="statuses">Statuses</TabsTrigger>
          <TabsTrigger value="work-categories">Work Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <SettingsGeneral />
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          <SettingsTeam />
        </TabsContent>

        <TabsContent value="statuses" className="mt-6">
          <SettingsStatuses />
        </TabsContent>

        <TabsContent value="work-categories" className="mt-6">
          <SettingsWorkCategories />
        </TabsContent>
      </Tabs>
    </div>
  )
}
