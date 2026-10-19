import { ConvexError } from "convex/values";
import { MutationCtx, QueryCtx } from "../_generated/server";
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
 * Ensure the client prefix is unique within the org.
 * If "ACME" already exists, tries "ACME2", "ACME3", etc.
 */
export async function ensureUniquePrefix(
  ctx: MutationCtx,
  orgId: string,
  prefix: string,
  excludeClientId?: string,
): Promise<string> {
  const clients = await ctx.db
    .query("clients")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  const existingPrefixes = new Set(
    clients
      .filter((c) => !excludeClientId || c._id.toString() !== excludeClientId)
      .map((c) => c.prefix),
  );

  if (!existingPrefixes.has(prefix)) return prefix;

  let counter = 2;
  while (existingPrefixes.has(`${prefix}${counter}`)) {
    counter++;
  }
  return `${prefix}${counter}`;
}
