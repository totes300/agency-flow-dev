import * as React from "react"

/**
 * The in-house Linear-style nav/toolbar icon set (docs/prd-tasks-refactor.md
 * U1, approved in prototype v4). 16×16 grid, 1.4 stroke, round caps — drawn
 * to sit next to each other in the sidebar, the view toolbar and menus.
 * Colour is always `currentColor`, so icons follow the surrounding token.
 */

export type NavIconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  size?: number
}

function createNavIcon(displayName: string, paths: React.ReactNode) {
  function NavIcon({ size = 16, strokeWidth = 1.4, ...rest }: NavIconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    )
  }
  NavIcon.displayName = displayName
  return NavIcon
}

export const SearchNavIcon = createNavIcon("SearchNavIcon", <>
  <circle cx="7" cy="7" r="4.6" /><path d="m10.4 10.4 3 3" />
</>)

export const ComposeIcon = createNavIcon("ComposeIcon", <>
  <path d="M8 2.75H4.25a1.5 1.5 0 0 0-1.5 1.5v7.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V8" />
  <path d="M11.9 2.1a1.27 1.27 0 0 1 1.8 1.8L8.3 9.3l-2.3.6.6-2.3z" />
</>)

export const InboxNavIcon = createNavIcon("InboxNavIcon", <>
  <path d="M2.25 9h3l1 1.75h3.5l1-1.75h3" />
  <path d="M3.9 3.6 2.25 9v3.25a1.25 1.25 0 0 0 1.25 1.25h9a1.25 1.25 0 0 0 1.25-1.25V9L12.1 3.6a1 1 0 0 0-.95-.6h-6.3a1 1 0 0 0-.95.6z" />
</>)

export const MyTasksNavIcon = createNavIcon("MyTasksNavIcon", <>
  <circle cx="8" cy="8" r="5.6" strokeDasharray="2.2 1.6" /><circle cx="8" cy="8" r="2" />
</>)

export const TasksNavIcon = createNavIcon("TasksNavIcon", <>
  <rect x="2.5" y="2.5" width="11" height="11" rx="3" /><path d="m5.6 8.1 1.7 1.7 3.2-3.6" />
</>)

export const ProjectsNavIcon = createNavIcon("ProjectsNavIcon", <>
  <path d="M8 1.9 13.4 5v6L8 14.1 2.6 11V5z" /><path d="M2.6 5 8 8.1 13.4 5M8 8.1v6" />
</>)

export const ClientsNavIcon = createNavIcon("ClientsNavIcon", <>
  <circle cx="6" cy="5.5" r="2.25" />
  <path d="M2 13c.4-2.2 2-3.4 4-3.4s3.6 1.2 4 3.4" />
  <path d="M10.5 3.4a2.25 2.25 0 0 1 0 4.2M11.8 9.9c1.2.4 2 1.4 2.2 3.1" />
</>)

export const CalendarNavIcon = createNavIcon("CalendarNavIcon", <>
  <rect x="2.5" y="3.25" width="11" height="10.25" rx="2" /><path d="M2.5 6.5h11M5.5 1.75v2.5M10.5 1.75v2.5" />
</>)

export const ClockNavIcon = createNavIcon("ClockNavIcon", <>
  <circle cx="8" cy="8" r="5.75" /><path d="M8 5v3.2l2 1.3" />
</>)

export const BillingNavIcon = createNavIcon("BillingNavIcon", <>
  <path d="M3.5 1.75v12.5l1.5-1 1.5 1 1.5-1 1.5 1 1.5-1 1.5 1V1.75l-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1z" />
  <path d="M6 6h4M6 8.75h3" />
</>)

export const ViewsIcon = createNavIcon("ViewsIcon", <>
  <path d="m8 2 6 3.25-6 3.25-6-3.25z" /><path d="m2 8 6 3.25L14 8" /><path d="m2 10.75 6 3.25 6-3.25" />
</>)

export const NewViewIcon = createNavIcon("NewViewIcon", <>
  <path d="m7 2 5.5 3-5.5 3-5.5-3z" /><path d="m1.5 8 5.5 3 1.2-.65M1.5 10.75l5.5 3 1-.55" />
  <path d="M12.25 9.25v4.5M10 11.5h4.5" />
</>)

export const FilterNavIcon = createNavIcon("FilterNavIcon", <>
  <path d="M2.5 4.25h11M4.5 8h7M6.5 11.75h3" />
</>)

export const DisplayNavIcon = createNavIcon("DisplayNavIcon", <>
  <path d="M2.5 4.5h5M10.5 4.5h3M2.5 11.5h2M7.5 11.5h6" /><circle cx="9" cy="4.5" r="1.5" /><circle cx="6" cy="11.5" r="1.5" />
</>)

export const PanelNavIcon = createNavIcon("PanelNavIcon", <>
  <rect x="2" y="2.75" width="12" height="10.5" rx="2" /><path d="M10 2.75v10.5" />
</>)

export const PlusNavIcon = createNavIcon("PlusNavIcon", <path d="M8 3v10M3 8h10" />)
export const ChevronDownNavIcon = createNavIcon("ChevronDownNavIcon", <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />)
export const ChevronRightNavIcon = createNavIcon("ChevronRightNavIcon", <path d="m6.25 4.5 3.5 3.5-3.5 3.5" />)
export const ChevronLeftNavIcon = createNavIcon("ChevronLeftNavIcon", <path d="m9.75 4.5-3.5 3.5 3.5 3.5" />)
export const ChevronUpNavIcon = createNavIcon("ChevronUpNavIcon", <path d="m4.5 9.75 3.5-3.5 3.5 3.5" />)
export const SortNavIcon = createNavIcon("SortNavIcon", <path d="m5 6.5 3-3 3 3M5 9.5l3 3 3-3" />)

export const MoreNavIcon = createNavIcon("MoreNavIcon", <>
  <circle cx="3.5" cy="8" r=".6" /><circle cx="8" cy="8" r=".6" /><circle cx="12.5" cy="8" r=".6" />
</>)

export const CloseNavIcon = createNavIcon("CloseNavIcon", <path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5" />)

export const SunNavIcon = createNavIcon("SunNavIcon", <>
  <circle cx="8" cy="8" r="2.6" />
  <path d="M8 1.75v1.3M8 12.95v1.3M3.6 3.6l.9.9M11.5 11.5l.9.9M1.75 8h1.3M12.95 8h1.3M3.6 12.4l.9-.9M11.5 4.5l.9-.9" />
</>)

export const ListLayoutIcon = createNavIcon("ListLayoutIcon", <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />)

export const BoardLayoutIcon = createNavIcon("BoardLayoutIcon", <>
  <rect x="2" y="2.5" width="5" height="11" rx="1.25" /><rect x="9" y="2.5" width="5" height="7" rx="1.25" />
</>)

export const StarNavIcon = createNavIcon("StarNavIcon", <path d="m8 2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2l-3.6 1.9.7-4-2.9-2.8 4-.6z" />)

export const LabelNavIcon = createNavIcon("LabelNavIcon", <>
  <path d="M8.4 2.2H3.2a1 1 0 0 0-1 1v5.2l5.6 5.6a1.2 1.2 0 0 0 1.7 0l4.1-4.1a1.2 1.2 0 0 0 0-1.7z" />
  <circle cx="5.25" cy="5.25" r=".75" />
</>)

export const GripNavIcon = createNavIcon("GripNavIcon", <>
  <circle cx="6" cy="4" r=".7" /><circle cx="10" cy="4" r=".7" /><circle cx="6" cy="8" r=".7" />
  <circle cx="10" cy="8" r=".7" /><circle cx="6" cy="12" r=".7" /><circle cx="10" cy="12" r=".7" />
</>)

export const FullPageNavIcon = createNavIcon("FullPageNavIcon", <path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />)

export const CollapsePanelNavIcon = createNavIcon("CollapsePanelNavIcon", <path d="m3.5 4 4 4-4 4M8.5 4l4 4-4 4" />)

export const ArchiveNavIcon = createNavIcon("ArchiveNavIcon", <>
  <rect x="1.75" y="2.5" width="12.5" height="3.25" rx="1" />
  <path d="M3 5.75v6.5a1.25 1.25 0 0 0 1.25 1.25h7.5A1.25 1.25 0 0 0 13 12.25v-6.5M6.5 8.5h3" />
</>)

export const EstimateNavIcon = createNavIcon("EstimateNavIcon", <path d="M4 1.75h8M4 14.25h8M5 1.75v2.5a3 3 0 0 0 6 0v-2.5M5 14.25v-2.5a3 3 0 0 1 6 0v2.5" />)

export const LinkNavIcon = createNavIcon("LinkNavIcon", <>
  <path d="M6.75 9.25a2.8 2.8 0 0 0 4 .2l2-2a2.8 2.8 0 0 0-4-4l-1 1" />
  <path d="M9.25 6.75a2.8 2.8 0 0 0-4-.2l-2 2a2.8 2.8 0 0 0 4 4l1-1" />
</>)

export const BellNavIcon = createNavIcon("BellNavIcon", <>
  <path d="M4 6.5a4 4 0 0 1 8 0c0 4.25 1.75 5.5 1.75 5.5H2.25S4 10.75 4 6.5" /><path d="M6.75 14a1.4 1.4 0 0 0 2.5 0" />
</>)

export const MenuNavIcon = createNavIcon("MenuNavIcon", <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />)
export const CheckNavIcon = createNavIcon("CheckNavIcon", <path d="m3.5 8.25 3 3 6-6.5" />)

export const LockNavIcon = createNavIcon("LockNavIcon", <>
  <rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" />
</>)

export const GlobeNavIcon = createNavIcon("GlobeNavIcon", <>
  <circle cx="8" cy="8" r="5.75" /><path d="M2.25 8h11.5M8 2.25a8.8 8.8 0 0 1 0 11.5M8 2.25a8.8 8.8 0 0 0 0 11.5" />
</>)

export const SubtaskNavIcon = createNavIcon("SubtaskNavIcon", <>
  <path d="M4 2.5v6.25a2.5 2.5 0 0 0 2.5 2.5H13" /><path d="m10.5 8.75 2.5 2.5-2.5 2.5" />
</>)

export const BillableNavIcon = createNavIcon("BillableNavIcon", <>
  <circle cx="8" cy="8" r="5.75" />
  <path d="M10 6.25c-.4-.7-1.1-1-2-1-1.1 0-2 .5-2 1.35S6.9 7.7 8 7.9s2 .6 2 1.45-.9 1.4-2 1.4c-.9 0-1.6-.35-2-1M8 4.25v1M8 10.75v1" />
</>)

export const CommentNavIcon = createNavIcon("CommentNavIcon", <path d="M2.75 7.6c0-2.8 2.35-4.85 5.25-4.85s5.25 2.05 5.25 4.85S10.9 12.45 8 12.45c-.75 0-1.45-.13-2.1-.37L3 13.25l.9-2.4a4.5 4.5 0 0 1-1.15-3.25z" />)

export const DocumentNavIcon = createNavIcon("DocumentNavIcon", <>
  <path d="M4.25 1.75h5l3 3v8.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-10.5a1 1 0 0 1 1-1z" />
  <path d="M9 1.75v3.25h3.25M5.75 8.25h4.5M5.75 10.75h3" />
</>)

export const UserNavIcon = createNavIcon("UserNavIcon", <>
  <circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.5-2.5 2.5-3.75 5-3.75s4.5 1.25 5 3.75" />
</>)

/** Dashed-ring person: the "no assignee" placeholder in rows and menus. */
export const NoAssigneeNavIcon = createNavIcon("NoAssigneeNavIcon", <>
  <circle cx="8" cy="8" r="6.6" strokeDasharray="1.6 1.5" />
  <circle cx="8" cy="6.6" r="1.7" />
  <path d="M5 11.4c.6-1.3 1.7-2 3-2s2.4.7 3 2" />
</>)

export const CalendarPlusNavIcon = createNavIcon("CalendarPlusNavIcon", <>
  <rect x="2.5" y="3.25" width="11" height="10.25" rx="2" />
  <path d="M2.5 6.5h11M5.5 1.75v2.5M10.5 1.75v2.5M8 8.25v3.5M6.25 10h3.5" />
</>)

export const TimerNavIcon = createNavIcon("TimerNavIcon", <>
  <circle cx="8" cy="9" r="5" /><path d="M8 6.5V9l1.5 1M6.5 1.75h3M12.25 4.25l1 -1" />
</>)

export const CopyNavIcon = createNavIcon("CopyNavIcon", <>
  <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="1.5" />
  <path d="M10.75 5.25V3.75a1.5 1.5 0 0 0-1.5-1.5h-5.5a1.5 1.5 0 0 0-1.5 1.5v5.5a1.5 1.5 0 0 0 1.5 1.5h1.5" />
</>)

// ─── Sidebar items beyond the prototype set (same grid / stroke) ────────────

export const DashboardNavIcon = createNavIcon("DashboardNavIcon", <>
  <rect x="2.5" y="2.5" width="4.75" height="6" rx="1.25" />
  <rect x="8.75" y="2.5" width="4.75" height="3.5" rx="1.25" />
  <rect x="8.75" y="7.5" width="4.75" height="6" rx="1.25" />
  <rect x="2.5" y="10" width="4.75" height="3.5" rx="1.25" />
</>)

export const WorkdayNavIcon = createNavIcon("WorkdayNavIcon", <>
  <rect x="2.5" y="3.25" width="11" height="10.25" rx="2" />
  <path d="M2.5 6.5h11M5.5 1.75v2.5M10.5 1.75v2.5" />
  <path d="M5.5 9.25h2M5.5 11.25h4.5" />
</>)

export const SettingsNavIcon = createNavIcon("SettingsNavIcon", <>
  <circle cx="8" cy="8" r="2" />
  <path d="M8 1.75v1.5M8 12.75v1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M1.75 8h1.5M12.75 8h1.5M3.58 12.42l1.06-1.06M11.36 4.64l1.06-1.06" />
  <circle cx="8" cy="8" r="4.25" />
</>)
