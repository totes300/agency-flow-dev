import {
  LayoutDashboardIcon,
  SettingsIcon,
  CheckSquareIcon,
  UsersIcon,
  FolderIcon,
  FileTextIcon,
  ClockIcon,
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
    label: "Finance",
    items: [
      { title: "Reports", url: "/reports", icon: FileTextIcon, adminOnly: true },
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

// Admin-only URLs derived from navigation (used by admin guard)
export const adminOnlyUrls = navigation
  .flatMap((group) => group.items)
  .filter((item) => item.adminOnly)
  .map((item) => item.url)

// Derived from navigation — used by breadcrumbs in dashboard layout
export const routeLabels: Record<string, string> = Object.fromEntries(
  navigation.flatMap((group) =>
    group.items.map((item) => [item.url, item.title])
  )
)
