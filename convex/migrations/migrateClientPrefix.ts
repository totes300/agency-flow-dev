/**
 * One-off migration: copy `invoicePrefix` → `prefix` on all clients.
 * Run via Convex dashboard or `npx convex run migrations/migrateClientPrefix:run`.
 * Safe to run multiple times (idempotent).
 */
import { mutation } from "../_generated/server";

export const run = mutation({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db.query("clients").collect();
    let migrated = 0;

    for (const client of clients) {
      // Skip if already migrated
      if (client.prefix) continue;

      // Copy invoicePrefix to prefix (or generate fallback)
      const prefix = client.invoicePrefix ?? client.name.slice(0, 4).toUpperCase();

      await ctx.db.patch(client._id, {
        prefix,
        invoicePrefix: undefined, // clear old field
      });
      migrated++;
    }

    return { total: clients.length, migrated };
  },
});
