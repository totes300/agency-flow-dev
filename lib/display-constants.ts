import type { StatusType, CategoryColor } from "@/convex/lib/constants"

// ─── Shared display constants (used by onboarding + settings) ─────────────────

export const CATEGORY_COLOR_LABELS: Record<CategoryColor, string> = {
  default: "Default",
  gray:    "Gray",
  brown:   "Brown",
  orange:  "Orange",
  yellow:  "Yellow",
  green:   "Green",
  blue:    "Blue",
  purple:  "Purple",
  pink:    "Pink",
  red:     "Red",
}

export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Budapest",
  "Europe/Bucharest",
  "Europe/Warsaw",
  "Europe/Prague",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Zurich",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Canada/Eastern",
  "Canada/Pacific",
] as const

export const ROUNDING_LABELS: Record<number, string> = {
  1: "1 minute (exact)",
  5: "5 minutes",
  6: "6 minutes (1/10 hour)",
  15: "15 minutes (1/4 hour)",
}

export const TYPE_LABELS: Record<StatusType, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
}
