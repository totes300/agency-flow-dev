import {
  LayoutDashboardIcon,
  SettingsIcon,
  CheckSquareIcon,
  CircleUserIcon,
  UsersIcon,
  FolderIcon,
  ClockIcon,
  ReceiptIcon,
  CalendarDaysIcon,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  url: string
  icon: LucideIcon
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
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboardIcon },
    ],
  },
  {
    label: "Work",
    items: [
      { title: "My Tasks", url: "/my-tasks", icon: CircleUserIcon },
      { title: "Tasks", url: "/tasks", icon: CheckSquareIcon },
    ],
  },
  {
    label: "Manage",
    items: [
      { title: "Clients", url: "/clients", icon: UsersIcon, adminOnly: true },
      { title: "Projects", url: "/projects", icon: FolderIcon, adminOnly: true },
    ],
  },
  {
    label: "Insights",
    items: [
      { title: "Workday", url: "/workday", icon: CalendarDaysIcon },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Invoices", url: "/invoices", icon: ReceiptIcon, adminOnly: true },
      { title: "My Time", url: "/my-time", icon: ClockIcon },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Settings", url: "/settings", icon: SettingsIcon, adminOnly: true },
    ],
  },
]

// Re-export admin route patterns — canonical list lives in lib/route-access.ts
export { adminRoutePatterns as adminOnlyPatterns } from "@/lib/route-access"

// Derived from navigation — used by breadcrumbs in dashboard layout
export const routeLabels: Record<string, string> = Object.fromEntries(
  navigation.flatMap((group) =>
    group.items.map((item) => [item.url, item.title])
  )
)
