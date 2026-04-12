"use client"

import { createContext, useContext } from "react"
import type { Doc, Id } from "@/convex/_generated/dataModel"

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

const TaskReferenceDataContext = createContext<TaskReferenceData>({
  statuses: undefined,
  categories: undefined,
  projects: undefined,
  orgMembers: undefined,
})

export function TaskReferenceDataProvider({
  value,
  children,
}: {
  value: TaskReferenceData
  children: React.ReactNode
}) {
  return (
    <TaskReferenceDataContext.Provider value={value}>
      {children}
    </TaskReferenceDataContext.Provider>
  )
}

export function useTaskReferenceData() {
  return useContext(TaskReferenceDataContext)
}
