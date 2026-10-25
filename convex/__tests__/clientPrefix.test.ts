// @vitest-environment edge-runtime
//
// Client prefixes are unique references per org (docs/prd-mcp.md §7, §11):
// the UI save mutations accept only A–Z/0–9 up to 10 characters (saved
// uppercase) and refuse a typed prefix another client already uses,
// case-insensitively; generated prefixes still dedupe with a suffix; data
// that already holds a duplicate or a legacy format never blocks editing
// other fields.

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
      'Prefix "KONV" is already used by client "Konverted". Choose a different prefix.',
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
      'Prefix "KONV" is already used by client "Konverted". Choose a different prefix.',
    );
    expect(await prefixOf(t, arlo)).toBe("ARLO");

    // The client's own prefix (any case) is unchanged; a free one saves uppercase.
    await admin.mutation(api.clients.update, { id: arlo, prefix: "arlo" });
    expect(await prefixOf(t, arlo)).toBe("ARLO");
    await admin.mutation(api.clients.update, { id: arlo, prefix: "arl" });
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

  it("a save that re-sends the unchanged legacy invoicePrefix heals it onto prefix", async () => {
    const t = createT();
    const { admin: adminId } = await setup(t);
    const legacy = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("clients", {
        orgId: ORG, name: "Legacy", currency: "EUR", invoicePrefix: "LEG", createdAt: now, updatedAt: now, createdBy: adminId,
      });
    });
    // The edit form sends the effective prefix with an unrelated change.
    await t.withIdentity(ADMIN).mutation(api.clients.update, { id: legacy, prefix: "leg", notes: "unrelated edit" });
    const healed = await t.run(async (ctx) => (await ctx.db.get(legacy))!);
    expect(healed).toMatchObject({ prefix: "LEG", invoicePrefix: "LEG", notes: "unrelated edit" });
  });

  it("accepts only A–Z/0–9 up to 10 characters, saved uppercase", async () => {
    const t = createT();
    const { admin: adminId } = await setup(t);
    const admin = t.withIdentity(ADMIN);
    const invalid = (prefix: string) => `Client prefix "${prefix}" is not valid: use 1–10 letters (A–Z) or digits, e.g. KONV.`;
    for (const prefix of ["A&B", "AB CD", "AB-1", "MÜLL", "ABCDEFGHIJK"]) {
      await expect(admin.mutation(api.clients.create, { name: `Client ${prefix}`, prefix })).rejects.toThrow(invalid(prefix));
    }
    const ok = await admin.mutation(api.clients.create, { name: "Acme", prefix: "acme7" });
    expect(await prefixOf(t, ok)).toBe("ACME7");
    await expect(admin.mutation(api.clients.update, { id: ok, prefix: "a.b" })).rejects.toThrow(invalid("a.b"));

    // A legacy prefix in another format stays editable while unchanged.
    const legacy = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("clients", {
        orgId: ORG, name: "Legacy Co", currency: "EUR", prefix: "L&C", createdAt: now, updatedAt: now, createdBy: adminId,
      });
    });
    await admin.mutation(api.clients.update, { id: legacy, prefix: "L&C", notes: "edited" });
    expect(await prefixOf(t, legacy)).toBe("L&C");
  });
});
