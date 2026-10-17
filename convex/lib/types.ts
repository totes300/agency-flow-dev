import type { EntryCloseStatus } from "./entryStatus";
import type { Doc } from "../_generated/dataModel";

/**
 * What a ledger row knows about the live close settling its entry
 * (docs/prd-billing-refactor.md §5). Rides along from `listProjectEntries`
 * and the Close workspace through the Time-tab table into the edit modal and
 * tooltips. All unset = the entry is open.
 */
export type EntryCloseSnapshot = {
  closeStatus?: EntryCloseStatus;
  closeKind?: "retainer" | "t_and_m";
  /** The close's period (YYYY-MM-DD bounds). */
  closePeriodStart?: string;
  closePeriodEnd?: string;
  /** When the close was committed (epoch ms). */
  closedAt?: number;
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
