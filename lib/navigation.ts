import type { ComponentType } from "react"
import {
  BillingNavIcon,
  CalendarNavIcon,
  ClientsNavIcon,
  ClockNavIcon,
  DashboardNavIcon,
  MyTasksNavIcon,
  ProjectsNavIcon,
  SettingsNavIcon,
  TasksNavIcon,
  WorkdayNavIcon,
} from "@/components/icons/nav-icons"

export type NavItem = {
  title: string
  url: string
  /** The in-house Linear-style set (U1); any `currentColor` SVG component fits. */
  icon: ComponentType<{ className?: string }>
  adminOnly?: boolean
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

// ─── Single source of truth for sidebar navigation & breadcrumbs ─────────────
// When adding a new module:
//   1. Add a NavGroup here (or add to an existing group)
//   2. Create the page at app/(dashboard)/<url>/page.tsx
//   3. That's it — sidebar, breadcrumbs, and active states all update automatically.

export const navigation: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: DashboardNavIcon },
    ],
  },
  {
    label: "Work",
    items: [
      { title: "My Tasks", url: "/my-tasks", icon: MyTasksNavIcon },
      { title: "Tasks", url: "/tasks", icon: TasksNavIcon },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Clients", url: "/clients", icon: ClientsNavIcon, adminOnly: true },
      { title: "Projects", url: "/projects", icon: ProjectsNavIcon, adminOnly: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Workday", url: "/workday", icon: WorkdayNavIcon },
      { title: "Planner", url: "/planner", icon: CalendarNavIcon },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Billing", url: "/billing", icon: BillingNavIcon, adminOnly: true },
      { title: "My Time", url: "/my-time", icon: ClockNavIcon },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Settings", url: "/settings", icon: SettingsNavIcon, adminOnly: true },
    ],
  },
]

// Re-export admin route patterns — canonical list lives in lib/route-access.ts
export { adminRoutePatterns as adminOnlyPatterns } from "@/lib/route-access"

// Pages outside the sidebar (reached from the user menu).
const userMenuRouteLabels: Record<string, string> = {
  "/connected-apps": "Connected apps",
}

// Derived from navigation — used by breadcrumbs in dashboard layout
export const routeLabels: Record<string, string> = {
  ...Object.fromEntries(
    navigation.flatMap((group) =>
      group.items.map((item) => [item.url, item.title])
    )
  ),
  ...userMenuRouteLabels,
}
