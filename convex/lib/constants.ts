// ─── Shared constants used across all Convex functions ─────────────────────────

export const CURRENCIES = [
  "EUR", "USD", "GBP", "HUF", "CHF", "CZK", "PLN",
  "SEK", "NOK", "DKK", "RON", "CAD", "AUD", "JPY", "BRL",
] as const;

export type Currency = (typeof CURRENCIES)[number];

export const ROUNDING_OPTIONS = [1, 5, 6, 15] as const;

export type RoundingMinutes = (typeof ROUNDING_OPTIONS)[number];

export const STATUS_TYPES = [
  "backlog",
  "in_progress",
  "review",
  "blocked",
  "done",
] as const;

export type StatusType = (typeof STATUS_TYPES)[number];

export const DEFAULT_CURRENCY: Currency = "USD";
export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_ROUNDING: RoundingMinutes = 1;

// ─── Work Category color palette (Tailwind badge style) ─────────────────────

export const CATEGORY_COLORS = {
  gray:    { bg: "#f9fafb", text: "#4b5563", ring: "rgba(107,114,128,0.1)" },
  red:     { bg: "#fef2f2", text: "#b91c1c", ring: "rgba(220,38,38,0.1)" },
  yellow:  { bg: "#fefce8", text: "#854d0e", ring: "rgba(202,138,4,0.2)" },
  green:   { bg: "#f0fdf4", text: "#15803d", ring: "rgba(22,163,74,0.2)" },
  blue:    { bg: "#eff6ff", text: "#1d4ed8", ring: "rgba(29,78,216,0.1)" },
  indigo:  { bg: "#eef2ff", text: "#4338ca", ring: "rgba(67,56,202,0.1)" },
  purple:  { bg: "#faf5ff", text: "#7e22ce", ring: "rgba(126,34,206,0.1)" },
  pink:    { bg: "#fdf2f8", text: "#be185d", ring: "rgba(190,24,93,0.1)" },
} as const;

export const CATEGORY_COLOR_NAMES = Object.keys(CATEGORY_COLORS) as (keyof typeof CATEGORY_COLORS)[];

export type CategoryColor = keyof typeof CATEGORY_COLORS;

/** Resolve a category color config with fallback to `gray`. */
export function getCategoryColor(color: string): (typeof CATEGORY_COLORS)[CategoryColor] {
  return CATEGORY_COLORS[color as CategoryColor] ?? CATEGORY_COLORS.gray;
}

export const DEFAULT_CATEGORIES: Array<{
  name: string;
  color: CategoryColor;
}> = [
  { name: "Copywriting", color: "yellow" },
  { name: "Design", color: "blue" },
  { name: "Development", color: "purple" },
  { name: "PM", color: "green" },
];

// ─── Status color palette ─────────────────────────────────────────────────────

export const STATUS_COLOR_NAMES = [
  "gray", "blue", "amber", "purple", "coral", "red", "green", "teal", "pink", "indigo",
] as const;

export type StatusColorName = (typeof STATUS_COLOR_NAMES)[number];

// ─── Default status seed data ──────────────────────────────────────────────────

export const DEFAULT_STATUSES: Array<{
  name: string;
  type: StatusType;
  color: StatusColorName;
  sortOrder: number;
}> = [
  { name: "Inbox", type: "backlog", color: "gray", sortOrder: 0 },
  { name: "Today", type: "backlog", color: "blue", sortOrder: 1 },
  { name: "Next up", type: "in_progress", color: "blue", sortOrder: 2 },
  { name: "In progress", type: "in_progress", color: "amber", sortOrder: 3 },
  { name: "Admin review", type: "review", color: "purple", sortOrder: 4 },
  { name: "Client review", type: "review", color: "coral", sortOrder: 5 },
  { name: "Stuck", type: "blocked", color: "red", sortOrder: 6 },
  { name: "Done", type: "done", color: "green", sortOrder: 7 },
];
