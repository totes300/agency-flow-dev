import { ConvexError } from "convex/values";
import { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Generate the next project code for an org.
 * Finds the max numeric suffix among existing PRJ-XXX codes and returns PRJ-{max+1}.
 * Zero-padded to 3 digits.
 */
export async function generateNextProjectCode(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<string> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  let maxNum = 0;
  for (const p of projects) {
    const match = p.code.match(/^PRJ-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  return `PRJ-${String(maxNum + 1).padStart(3, "0")}`;
}

/**
 * Ensure a project code is unique within an org.
 * Throws if the code is already taken (excluding a specific project for updates).
 */
export async function ensureUniqueProjectCode(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  code: string,
  excludeProjectId?: string,
): Promise<void> {
  const existing = await ctx.db
    .query("projects")
    .withIndex("by_orgId_code", (q) => q.eq("orgId", orgId).eq("code", code))
    .first();

  if (existing && (!excludeProjectId || existing._id.toString() !== excludeProjectId)) {
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
