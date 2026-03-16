import { MutationCtx } from "../_generated/server";

/**
 * Generate an invoice prefix from a client name.
 * Strips diacritics, takes first 4 alphanumeric chars, uppercased.
 *
 * "Acme Corp" → "ACME"
 * "Müller & Co" → "MULL"
 * "AB" → "AB"
 * "---" → "CLIE" (fallback)
 */
export function generateInvoicePrefix(name: string): string {
  const stripped = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove diacritics
    .replace(/[^a-zA-Z0-9]/g, "")   // keep only alphanumeric
    .toUpperCase();

  if (stripped.length === 0) return "CLIE"; // fallback for all-symbol names
  return stripped.slice(0, 4);
}

/**
 * Ensure the invoice prefix is unique within the org.
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
      .map((c) => c.invoicePrefix),
  );

  if (!existingPrefixes.has(prefix)) return prefix;

  let counter = 2;
  while (existingPrefixes.has(`${prefix}${counter}`)) {
    counter++;
  }
  return `${prefix}${counter}`;
}
