import type { StatusType, CategoryColor } from "@/convex/lib/constants"

// ─── Shared display constants (used by onboarding + settings) ─────────────────

export const CATEGORY_COLOR_LABELS: Record<CategoryColor, string> = {
  gray:    "Gray",
  red:     "Red",
  yellow:  "Yellow",
  green:   "Green",
  blue:    "Blue",
  indigo:  "Indigo",
  purple:  "Purple",
  pink:    "Pink",
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
  1: "Exact — to the minute",
  5: "5 minutes",
  6: "6 minutes (1/10 hour)", // legacy value, no longer offered
  15: "15 minutes (1/4 hour)",
  30: "30 minutes (1/2 hour)",
}

export const TYPE_LABELS: Record<StatusType, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
}
