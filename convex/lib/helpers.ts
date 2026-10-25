import { ConvexError } from "convex/values";
import { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { CLIENT_PREFIX_MAX_LENGTH, isValidClientPrefix } from "./clientPrefix";
import {
  IDENTIFIER_KEY_MAX_LENGTH,
  isValidIdentifierKey,
  suggestProjectCode,
} from "../tasks/model";

/** Every key a new project code must not reuse: other projects' codes + the org task key. */
async function usedIdentifierKeys(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  excludeProjectId?: string,
): Promise<Set<string>> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const used = new Set(
    projects.filter((p) => p._id.toString() !== excludeProjectId).map((p) => p.code.toUpperCase()),
  );
  const settings = await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  if (settings?.taskKey) used.add(settings.taskKey);
  return used;
}

/**
 * Suggest a project code. The code is the task identifier key (D2,
 * `ARLO-21`), so it must satisfy `isValidIdentifierKey` — the old `PRJ-042`
 * format does not. With hints: the client prefix, else a key derived from
 * the client or project name ("Arlow" → "ARLO"); without: "PRJ", "PRJ2", …
 * Always unique against the org's other codes and its task key.
 */
export async function generateNextProjectCode(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  hints: { clientPrefix?: string; clientName?: string; projectName?: string } = {},
): Promise<string> {
  const used = await usedIdentifierKeys(ctx, orgId);
  return suggestProjectCode(hints, used);
}

/**
 * Normalize and validate a user-entered project code: uppercased, and a valid
 * identifier key (letter first, letters/digits, ≤ 10, no hyphen).
 */
export function normalizeProjectCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!code) throw new ConvexError("Project code is required");
  if (!isValidIdentifierKey(code)) {
    throw new ConvexError(
      `Project code "${code}" is not valid: use 1–${IDENTIFIER_KEY_MAX_LENGTH} letters or digits starting with a letter (e.g. ARLO). It prefixes task IDs like ARLO-21.`,
    );
  }
  return code;
}

/**
 * Ensure a project code is unique within an org — against other projects
 * and the org task key (both prefix task identifiers).
 * Throws if the code is already taken (excluding a specific project for updates).
 */
export async function ensureUniqueProjectCode(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  code: string,
  excludeProjectId?: string,
): Promise<void> {
  const used = await usedIdentifierKeys(ctx, orgId, excludeProjectId);
  if (used.has(code.toUpperCase())) {
    throw new ConvexError(`Project code "${code}" is already in use`);
  }
}

/**
 * Generate a client prefix from a client name.
 * Strips diacritics, takes first 4 alphanumeric chars, uppercased.
 *
 * "Acme Corp" → "ACME"
 * "Müller & Co" → "MULL"
 * "AB" → "AB"
 * "---" → "CLIE" (fallback)
 */
export function generateClientPrefix(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-zA-Z0-9]/g, "")   // keep only alphanumeric
    .toUpperCase();

  if (stripped.length === 0) return "CLIE"; // fallback for all-symbol names
  return stripped.slice(0, 4);
}

/**
 * A client's prefix as shown and referenced (task lists, `fetch("workspace")`,
 * MCP refs): `prefix`, else the deprecated `invoicePrefix`. Null when unset.
 */
export function effectiveClientPrefix(
  client: Pick<Doc<"clients">, "prefix" | "invoicePrefix">,
): string | null {
  return client.prefix ?? client.invoicePrefix ?? null;
}

/**
 * The prefix MCP shows and resolves (`client:KONV`): the effective prefix
 * when it has the valid format, else null — a client with a legacy prefix
 * outside A–Z/0–9 is referenced by ID or link only.
 */
export function referenceClientPrefix(
  client: Pick<Doc<"clients">, "prefix" | "invoicePrefix">,
): string | null {
  const prefix = effectiveClientPrefix(client);
  return prefix !== null && isValidClientPrefix(prefix) ? prefix : null;
}

/**
 * Normalizes a prefix the user typed: trimmed, uppercased, and refused unless
 * it is 1–10 letters (A–Z) or digits.
 */
export function normalizeClientPrefix(raw: string): string {
  const prefix = raw.trim().toUpperCase();
  if (!isValidClientPrefix(prefix)) {
    throw new ConvexError(
      `Client prefix "${raw.trim()}" is not valid: use 1–${CLIENT_PREFIX_MAX_LENGTH} letters (A–Z) or digits, e.g. KONV.`,
    );
  }
  return prefix;
}

/** Prefixes compare case-insensitively: `KONV` and `konv` are the same reference. */
export function clientPrefixKey(prefix: string): string {
  return prefix.trim().toLowerCase();
}

/**
 * The org's other clients by prefix key (docs/prd-mcp.md §7, §11). Reads
 * the whole org's clients: uniqueness must see every row, and an org has
 * tens of clients, not thousands.
 */
async function clientsByPrefixKey(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  excludeClientId?: Id<"clients">,
): Promise<Map<string, Doc<"clients">>> {
  const clients = await ctx.db
    .query("clients")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();
  const byKey = new Map<string, Doc<"clients">>();
  for (const client of clients) {
    if (client._id === excludeClientId) continue;
    const prefix = effectiveClientPrefix(client);
    if (prefix) byKey.set(clientPrefixKey(prefix), client);
  }
  return byKey;
}

/**
 * A free prefix for a GENERATED prefix (no prefix typed by the user): if
 * "ACME" is taken (case-insensitively), tries "ACME2", "ACME3", etc.
 */
export async function ensureUniquePrefix(
  ctx: MutationCtx,
  orgId: string,
  prefix: string,
): Promise<string> {
  const used = await clientsByPrefixKey(ctx, orgId);
  if (!used.has(clientPrefixKey(prefix))) return prefix;

  let counter = 2;
  while (used.has(clientPrefixKey(`${prefix}${counter}`))) {
    counter++;
  }
  return `${prefix}${counter}`;
}

/**
 * Refuses a prefix the user chose when another client of the org already
 * uses it, case-insensitively (docs/prd-mcp.md §7: a prefix is a unique
 * reference). Never rewritten silently: the user picks another one.
 */
export async function assertClientPrefixAvailable(
  ctx: MutationCtx,
  orgId: string,
  prefix: string,
  excludeClientId?: Id<"clients">,
): Promise<void> {
  const owner = (await clientsByPrefixKey(ctx, orgId, excludeClientId)).get(clientPrefixKey(prefix));
  if (owner) {
    throw new ConvexError(
      `Prefix "${prefix}" is already used by client "${owner.name}". Choose a different prefix.`,
    );
  }
}
