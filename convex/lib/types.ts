import type { Doc } from "../_generated/dataModel";
import type { SettledReason } from "./settleEntries";

/**
 * Phase 8 — the four settlement fields that ride along with a time entry
 * from the listProjectEntries Row, through the project Time-tab table,
 * into the entry-edit modal. Defined once here so adding a field (or
 * tightening a type) propagates without three coordinated edits.
 *
 * `undefined` not `null` — matches Convex's `v.optional` storage shape so
 * a row with no settlement reads `{ settledAt: undefined, ... }` without
 * a per-field nullish coalesce.
 */
export type EntrySettlementSnapshot = {
  settledAt: number | undefined;
  settledReason: SettledReason | undefined;
  settledPeriodStart: string | undefined;
  settledPeriodEnd: string | undefined;
};

/**
 * A `projects` document with denormalized client fields resolved at query
 * time. Currency lives on the client (schema invariant D1, see
 * `convex/schema.ts` above `timeEntries`) — these queries resolve it onto
 * the returned shape so consumers don't have to look up the client
 * themselves.
 *
 * Used as the explicit return type of `api.projects.list` so new
 * project-fetching queries that forget to spread `currency` fail type
 * checking instead of silently shipping `undefined` to the UI.
 */
export type ResolvedProjectListItem = Doc<"projects"> & {
  clientName: string;
  clientPrefix: string;
  clientUsePrefix: boolean | undefined;
  currency: string;
};

/**
 * Single-project variant of {@link ResolvedProjectListItem}. `api.projects.get`
 * returns the minimum set needed by the project detail header; the list
 * variant carries the extra denormalized fields consumed by task surfaces.
 */
export type ResolvedProjectDetail = Doc<"projects"> & {
  clientName: string;
  currency: string;
};
