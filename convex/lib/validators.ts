import { v } from "convex/values";
import { CURRENCIES, ROUNDING_OPTIONS, STATUS_TYPES, CATEGORY_COLOR_NAMES, STATUS_COLOR_NAMES } from "./constants";

// ─── Reusable Convex validators ────────────────────────────────────────────────

export const currencyValidator = v.union(
  ...CURRENCIES.map((c) => v.literal(c))
);

export const roundingValidator = v.union(
  ...ROUNDING_OPTIONS.map((r) => v.literal(r))
);

export const statusTypeValidator = v.union(
  ...STATUS_TYPES.map((t) => v.literal(t))
);

export const categoryColorValidator = v.union(
  ...CATEGORY_COLOR_NAMES.map((c) => v.literal(c))
);

export const statusColorValidator = v.union(
  ...STATUS_COLOR_NAMES.map((c) => v.literal(c))
);
