import type { Id } from "@/convex/_generated/dataModel"

/**
 * The list a task was opened from, so the full page (`/tasks/[identifier]`)
 * can step with J/K and link back (U9). The list writes it when it opens a
 * task as a page; it lives in `sessionStorage` so a reload keeps it. Pure
 * apart from the storage access, which is wrapped (private mode, previews).
 */

export type DetailNavEntry = { id: Id<"tasks">; identifier: string | null }

export type DetailNavList = {
  /** Where "back" goes: the list's label and URL (with its view/filter params). */
  from: { label: string; href: string }
  entries: DetailNavEntry[]
}

const STORAGE_KEY = "task-detail-nav"

let memory: DetailNavList | null = null

export function setDetailNavList(list: DetailNavList): void {
  memory = list
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Storage unavailable: stepping still works for this navigation.
  }
}

export function readDetailNavList(): DetailNavList | null {
  if (memory) return memory
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DetailNavList
    if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.from?.href !== "string") return null
    memory = parsed
    return parsed
  } catch {
    return null
  }
}

/** Position of a task in the list and its neighbours (no wrap-around), or null when it is not in the list. */
export function navPosition(
  entries: readonly DetailNavEntry[],
  taskId: Id<"tasks">,
): { index: number; total: number; prev: DetailNavEntry | null; next: DetailNavEntry | null } | null {
  const index = entries.findIndex((e) => e.id === taskId)
  if (index === -1) return null
  return {
    index,
    total: entries.length,
    prev: index > 0 ? entries[index - 1] : null,
    next: index < entries.length - 1 ? entries[index + 1] : null,
  }
}

const NAV_LABELS: ReadonlyArray<[prefix: string, label: string]> = [
  ["/my-tasks", "My Tasks"],
  ["/tasks", "Tasks"],
  ["/planner", "Planner"],
  ["/workday", "Workday"],
  ["/projects", "Project"],
  ["/billing", "Billing"],
  ["/dashboard", "Dashboard"],
  ["/inbox", "Inbox"],
]

/** The "back" label for a list route (the full page's breadcrumb). */
export function navLabelFor(pathname: string): string {
  return NAV_LABELS.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? "Back"
}
