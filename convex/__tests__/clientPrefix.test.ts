// @vitest-environment edge-runtime
//
// Client prefixes are unique references per org (docs/prd-mcp.md §7, §11):
// the UI save mutations refuse a typed prefix another client already uses,
// case-insensitively; generated prefixes still dedupe with a suffix; data
// that already holds a duplicate never blocks editing other fields.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_prefix";
const OTHER = "org_prefix_other";
const ADMIN = { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" };

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

async function setup(t: T): Promise<{ admin: Id<"users"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "Admin", externalId: "clerk_admin", email: "admin@x.test", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_admin", userId: admin, role: "admin", joinedAt: now });
    // Another org's prefix never collides.
    await ctx.db.insert("clients", {
      orgId: OTHER, name: "Elsewhere", currency: "EUR", prefix: "KONV", createdAt: now, updatedAt: now, createdBy: admin,
    });
    return { admin };
  });
}

const prefixOf = (t: T, id: Id<"clients">) => t.run(async (ctx) => (await ctx.db.get(id))?.prefix);

describe("client prefix uniqueness", () => {
  it("create refuses a typed prefix another client uses, case-insensitively", async () => {
    const t = createT();
    await setup(t);
    const admin = t.withIdentity(ADMIN);
    const konv = await admin.mutation(api.clients.create, { name: "Konverted", prefix: "KONV" });
    expect(await prefixOf(t, konv)).toBe("KONV");

    await expect(admin.mutation(api.clients.create, { name: "Konvoy", prefix: "konv" })).rejects.toThrow(
      'Prefix "konv" is already used by client "Konverted". Choose a different prefix.',
    );
    await expect(admin.mutation(api.clients.create, { name: "Konvoy", prefix: " KONV " })).rejects.toThrow(
      /already used by client "Konverted"/,
    );
  });

  it("a generated prefix still dedupes with a suffix, case-insensitively", async () => {
    const t = createT();
    await setup(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.clients.create, { name: "Somebody", prefix: "acme" });
    const generated = await admin.mutation(api.clients.create, { name: "Acme Corp" });
    expect(await prefixOf(t, generated)).toBe("ACME2");
  });

  it("update refuses a prefix another client uses, case-insensitively", async () => {
    const t = createT();
    await setup(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.clients.create, { name: "Konverted", prefix: "KONV" });
    const arlo = await admin.mutation(api.clients.create, { name: "Arlo", prefix: "ARLO" });

    await expect(admin.mutation(api.clients.update, { id: arlo, prefix: "Konv" })).rejects.toThrow(
      'Prefix "Konv" is already used by client "Konverted". Choose a different prefix.',
    );
    expect(await prefixOf(t, arlo)).toBe("ARLO");

    // The client's own prefix (any case) and a free one save fine.
    await admin.mutation(api.clients.update, { id: arlo, prefix: "arlo" });
    expect(await prefixOf(t, arlo)).toBe("arlo");
    await admin.mutation(api.clients.update, { id: arlo, prefix: "ARL" });
    expect(await prefixOf(t, arlo)).toBe("ARL");
  });

  it("a duplicate already in the data never blocks editing other fields", async () => {
    const t = createT();
    const { admin: adminId } = await setup(t);
    const admin = t.withIdentity(ADMIN);
    const [first, second] = await t.run(async (ctx) => {
      const now = Date.now();
      const mk = (name: string, prefix: string) =>
        ctx.db.insert("clients", { orgId: ORG, name, currency: "EUR", prefix, createdAt: now, updatedAt: now, createdBy: adminId });
      return [await mk("Dup One", "DUP"), await mk("Dup Two", "dup")];
    });
    // The edit form re-sends the unchanged prefix with every save.
    await admin.mutation(api.clients.update, { id: second, prefix: "dup", notes: "still editable" });
    expect(await t.run(async (ctx) => (await ctx.db.get(second))?.notes)).toBe("still editable");
    // Moving onto the other duplicate's prefix is still refused.
    const third = await admin.mutation(api.clients.create, { name: "Third", prefix: "THREE" });
    await expect(admin.mutation(api.clients.update, { id: third, prefix: "DUP" })).rejects.toThrow(/already used/);
    expect(await prefixOf(t, first)).toBe("DUP");
  });

  it("the deprecated invoicePrefix counts as the client's prefix", async () => {
    const t = createT();
    const { admin: adminId } = await setup(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("clients", {
        orgId: ORG, name: "Legacy", currency: "EUR", invoicePrefix: "LEG", createdAt: now, updatedAt: now, createdBy: adminId,
      });
    });
    await expect(
      t.withIdentity(ADMIN).mutation(api.clients.create, { name: "Legend", prefix: "leg" }),
    ).rejects.toThrow(/already used by client "Legacy"/);
  });
});
