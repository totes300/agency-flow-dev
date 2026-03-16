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

// ─── Work Category color palette (Notion-style) ────────────────────────────────

export const CATEGORY_COLORS = {
  default: { bg: "#FFFFFF", text: "#373530" },
  gray:    { bg: "#F1F1EF", text: "#787774" },
  brown:   { bg: "#F3EEEE", text: "#976D57" },
  orange:  { bg: "#F8ECDF", text: "#CC782F" },
  yellow:  { bg: "#FAF3DD", text: "#C29343" },
  green:   { bg: "#EEF3ED", text: "#548164" },
  blue:    { bg: "#E9F3F7", text: "#487CA5" },
  purple:  { bg: "#F6F3F8", text: "#8A67AB" },
  pink:    { bg: "#F9F2F5", text: "#B35488" },
  red:     { bg: "#FAECEC", text: "#C4554D" },
} as const;

export const CATEGORY_COLOR_NAMES = Object.keys(CATEGORY_COLORS) as (keyof typeof CATEGORY_COLORS)[];

export type CategoryColor = keyof typeof CATEGORY_COLORS;

export const DEFAULT_CATEGORIES: Array<{
  name: string;
  color: CategoryColor;
}> = [
  { name: "Copywriting", color: "brown" },
  { name: "Design", color: "blue" },
  { name: "Development", color: "purple" },
  { name: "PM", color: "orange" },
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
