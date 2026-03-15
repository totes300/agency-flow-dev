import {
  LayoutDashboardIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react"

export type NavItem = {
  title: string
  url: string
  icon: LucideIcon
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
  // ── Add module groups below ────────────────────────────────────────────────
  // {
  //   label: "CRM",
  //   items: [
  //     { title: "Clients", url: "/dashboard/clients", icon: UsersIcon },
  //     { title: "Contacts", url: "/dashboard/contacts", icon: ContactIcon },
  //     { title: "Leads", url: "/dashboard/leads", icon: TargetIcon },
  //   ],
  // },
  // {
  //   label: "Projects",
  //   items: [
  //     { title: "Projects", url: "/dashboard/projects", icon: FolderIcon },
  //     { title: "Tasks", url: "/dashboard/tasks", icon: CheckSquareIcon },
  //   ],
  // },
  // {
  //   label: "Finance",
  //   items: [
  //     { title: "Invoices", url: "/dashboard/invoices", icon: ReceiptIcon },
  //     { title: "Expenses", url: "/dashboard/expenses", icon: WalletIcon },
  //   ],
  // },
  {
    label: "System",
    items: [
      { title: "Settings", url: "/dashboard/settings", icon: SettingsIcon },
    ],
  },
]

// Derived from navigation — used by breadcrumbs in dashboard layout
export const routeLabels: Record<string, string> = Object.fromEntries(
  navigation.flatMap((group) =>
    group.items.map((item) => [item.url, item.title])
  )
)
