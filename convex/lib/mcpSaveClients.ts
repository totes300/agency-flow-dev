import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver, type RefResolver } from "./mcpRefs";
import { runItem } from "./mcpWrites";
import type { SaveClientsResult } from "./mcpWriteResults";
import { CURRENCIES, type Currency } from "./constants";
import { clientPrefixKey, effectiveClientPrefix, referenceClientPrefix } from "./helpers";
import {
  archiveClientForAuth,
  createClientForAuth,
  restoreClientForAuth,
  updateClientForAuth,
  type UpdateClientInput,
} from "../clients";

/**
 * MCP `save_clients` (docs/prd-mcp.md §6): a batch of client creates and
 * edits in ONE mutation, all-or-nothing (I5), through the app's client
 * paths (convex/clients.ts `*ForAuth`) with the fields the client form
 * edits. Admins only, as in the app (the cores assert it too).
 *
 * - Create: `name` required; the currency defaults to the org's, the
 *   prefix is generated from the name when not given (made unique), a typed
 *   prefix must be A–Z/0–9, at most 10, and free (case-insensitive).
 * - Edit: only fields that differ are sent (the form's diff); the currency
 *   never changes after creation and the prefix cannot be cleared, as in the
 *   app. `null` or "" clears a billing field.
 * - `archived: true | false` archives / restores (the app's buttons; no
 *   cascade, as in the app).
 * - The logo is a file: not part of this tool.
 *
 * Items run in order and see what earlier items wrote: after a client write
 * the resolver forgets the org's clients, so a later item finds a new or
 * renamed `client:PREFIX`, and every edit works on the client as stored now.
 *
 * Read budget per item (at most MCP_BATCH_MAX = 25): the client ref (one
 * bounded org range for `client:` prefixes, read again after a write), then
 * the core — one name range, and for a new or changed prefix one org clients
 * range. Clients are tens per org, so a batch stays far under the limits.
 */

/** Billing fields the client form edits, all plain text. */
export const CLIENT_TEXT_FIELDS = [
  "billingName",
  "billingEmail",
  "billingCountry",
  "billingCity",
  "billingZip",
  "billingStreet",
  "billingStreet2",
  "taxId",
  "notes",
] as const;
type ClientTextField = (typeof CLIENT_TEXT_FIELDS)[number];

export type SaveClientItem = {
  /** The client to edit: `client:KONV`, ID or link. Omit to create. */
  ref?: string;
  name?: string;
  /** Create only: an ISO code from the app's list. */
  currency?: string;
  prefix?: string;
  /** Show the prefix instead of the name in task lists. */
  usePrefix?: boolean;
  archived?: boolean;
} & Partial<Record<ClientTextField, string | null>>;

type Row = SaveClientsResult["items"][number];

export const ADMIN_ONLY_CLIENTS = "Clients are created and edited by admins only, as in the app.";

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

function row(client: Doc<"clients">, action: Row["action"]): Row {
  return {
    clientId: client._id,
    name: client.name,
    prefix: referenceClientPrefix(client),
    archived: client.archivedAt !== undefined,
    action,
  };
}

/** A billing field as the core stores it: trimmed, empty = absent. */
function stored(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

async function createItem(ctx: MutationCtx, auth: McpAuthContext, item: SaveClientItem): Promise<Row> {
  if (item.archived === true) {
    throw new ConvexError("archived applies to existing clients: create the client first, then archive it by ref.");
  }
  if (item.name === undefined) {
    throw new ConvexError("name is required to create a client. To edit one, pass its ref (client:KEY, ID or link).");
  }
  let currency: Currency | undefined;
  if (item.currency !== undefined) {
    const code = item.currency.trim().toUpperCase();
    if (!isCurrency(code)) throw new ConvexError(`Unsupported currency "${item.currency}". Use one of ${CURRENCIES.join(", ")}.`);
    currency = code;
  }
  const clientId: Id<"clients"> = await createClientForAuth(ctx, auth, {
    name: item.name,
    currency,
    prefix: item.prefix,
    usePrefix: item.usePrefix,
    ...Object.fromEntries(CLIENT_TEXT_FIELDS.map((f) => [f, stored(item[f])])),
  });
  return row((await ctx.db.get(clientId))!, "created");
}

async function editItem(
  ctx: MutationCtx,
  auth: McpAuthContext,
  resolver: RefResolver,
  item: SaveClientItem & { ref: string },
): Promise<Row> {
  const resolved = await resolver.require(item.ref, "client");
  if (resolved.type !== "client") throw new Error(`Expected a client, resolved a ${resolved.type}`);
  // As stored now: an earlier item of this call may have changed it.
  let client = (await ctx.db.get(resolved.client._id))!;
  if (item.currency !== undefined && item.currency.trim().toUpperCase() !== client.currency) {
    throw new ConvexError(`A client's currency cannot change after creation (as in the app); ${client.name} bills in ${client.currency}.`);
  }

  let changed = false;
  if (item.archived === false && client.archivedAt !== undefined) {
    await restoreClientForAuth(ctx, auth, { id: client._id });
    changed = true;
  }

  // The form's diff: only what changes is sent.
  const update: UpdateClientInput = { id: client._id };
  if (item.name !== undefined && item.name.trim() !== client.name) update.name = item.name;
  if (item.prefix !== undefined) {
    const current = effectiveClientPrefix(client);
    if (current === null || clientPrefixKey(current) !== clientPrefixKey(item.prefix)) update.prefix = item.prefix;
  }
  if (item.usePrefix !== undefined && item.usePrefix !== (client.usePrefix ?? false)) update.usePrefix = item.usePrefix;
  for (const field of CLIENT_TEXT_FIELDS) {
    const value = item[field];
    if (value === undefined) continue;
    if (stored(value) !== client[field]) update[field] = value ?? "";
  }
  if (Object.keys(update).length > 1) {
    await updateClientForAuth(ctx, auth, update);
    changed = true;
  }

  client = (await ctx.db.get(client._id))!;
  if (item.archived === true && client.archivedAt === undefined) {
    await archiveClientForAuth(ctx, auth, { id: client._id });
    client = (await ctx.db.get(client._id))!;
    changed = true;
  }
  return row(client, changed ? "updated" : "unchanged");
}

/** Runs every item in order; the first failing item aborts the whole call (I5). */
export async function saveClients(
  ctx: MutationCtx,
  auth: McpAuthContext,
  items: readonly SaveClientItem[],
): Promise<SaveClientsResult> {
  if (!auth.isAdmin) throw new ConvexError(ADMIN_ONLY_CLIENTS);
  const resolver = createRefResolver(ctx, auth);
  const results: Row[] = [];
  for (const [index, item] of items.entries()) {
    const label = item.ref ?? (item.name ? item.name.slice(0, 40) : null);
    results.push(
      await runItem(index, label, () =>
        item.ref !== undefined ? editItem(ctx, auth, resolver, { ...item, ref: item.ref }) : createItem(ctx, auth, item),
      ),
    );
    if (results[results.length - 1].action !== "unchanged") resolver.invalidateClients();
  }
  return { tool: "save_clients", items: results };
}
