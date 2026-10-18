"use client"

import { createContext, useContext, useMemo } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

type StatusType = "backlog" | "in_progress" | "review" | "blocked" | "done"

type StatusOption = {
  _id: Id<"statuses">
  name: string
  color: string
  type: StatusType
  icon?: string
  sortOrder: number
}

type CategoryOption = {
  _id: Id<"workCategories">
  name: string
  color: string
}

type ProjectOption = {
  _id: Id<"projects">
  name: string
  code: string
  clientId: Id<"clients">
  clientName: string
  clientPrefix: string
  clientUsePrefix?: boolean
  defaultAssignees?: Array<{ workCategoryId: Id<"workCategories">; userId: Id<"users"> }>
}

type OrgMember = {
  _id: Id<"users">
  name: string
  email: string | undefined
  imageUrl: string | undefined
  role: "admin" | "member"
}

export type TaskReferenceData = {
  statuses: StatusOption[] | undefined
  categories: CategoryOption[] | undefined
  projects: ProjectOption[] | undefined
  orgMembers: OrgMember[] | undefined
}

/** `provided: false` = no provider above (the default context value). */
const TaskReferenceDataContext = createContext<TaskReferenceData & { provided: boolean }>({
  statuses: undefined,
  categories: undefined,
  projects: undefined,
  orgMembers: undefined,
  provided: false,
})

export function TaskReferenceDataProvider({
  value,
  children,
}: {
  value: TaskReferenceData
  children: React.ReactNode
}) {
  return (
    <TaskReferenceDataContext.Provider value={{ ...value, provided: true }}>
      {children}
    </TaskReferenceDataContext.Provider>
  )
}

export function useTaskReferenceData(): TaskReferenceData {
  return useContext(TaskReferenceDataContext)
}

/**
 * The legacy reference-data block (statuses, categories, projects, members)
 * the old pickers read. One copy for the surfaces that still need it; slice 7
 * replaces the pickers and drops it (§10). `enabled: false` skips the queries.
 */
export function useTaskReferenceDataValue(enabled = true): TaskReferenceData {
  const { isAuthenticated } = useConvexAuth()
  const on = enabled && isAuthenticated
  const statuses = useQuery(api.statuses.list, on ? {} : "skip")
  const categories = useQuery(api.workCategories.list, on ? {} : "skip")
  const projects = useQuery(api.projects.list, on ? {} : "skip")
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, on ? undefined : "skip")
  return useMemo(
    () => ({ statuses, categories, projects, orgMembers }),
    [statuses, categories, projects, orgMembers],
  )
}

/**
 * Provides the reference data only when no provider exists above (the task
 * detail is mounted on pages that never set one up, e.g. billing close).
 */
export function EnsureTaskReferenceData({ children }: { children: React.ReactNode }) {
  const { provided } = useContext(TaskReferenceDataContext)
  const value = useTaskReferenceDataValue(!provided)
  if (provided) return <>{children}</>
  return <TaskReferenceDataProvider value={value}>{children}</TaskReferenceDataProvider>
}
