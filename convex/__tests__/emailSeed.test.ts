// @vitest-environment edge-runtime
//
// Email triage B2 (docs/prd-email-triage.md §4, §9): the schema accepts the
// canvas seed, the seed is idempotent and its reset removes only seed rows,
// the I14 gate, and task-less notifications never break the Inbox queries.

import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import {
  EMAIL_TRIAGE_DISABLED_MESSAGE,
  isEmailTriageEnabled,
  requireEmailTriageEnabled,
} from "../email/gate";
import { hardTriggers, isAcknowledgeCandidate, matchClientByDomain } from "../email/model";

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");

const ORG = "org_email";
const OTHER = "org_email_other";
const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

const ADMIN = { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" };

type Fixture = {
  admin: Id<"users">;
  member: Id<"users">;
  pragmatico: Id<"clients">;
  arlo: Id<"clients">;
  arloTask: Id<"tasks">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", {
      name: "Tóth Ádám", email: "adam@konverted.io", externalId: "clerk_admin", createdAt: now, updatedAt: now,
    });
    const member = await ctx.db.insert("users", {
      name: "Member", email: "member@konverted.io", externalId: "clerk_member", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_admin", userId: admin, role: "admin", joinedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_member", userId: member, role: "member", joinedAt: now });
    for (const orgId of [ORG, OTHER]) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: "Europe/Budapest", roundingMinutes: 15,
        createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    // Pragmatico exists in dev data (matched by name); Arlo has a project + task.
    const pragmatico = await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico Kft.", currency: "HUF", createdAt: now, updatedAt: now, createdBy: admin,
    });
    // A near-miss name is never adopted (exact matching only).
    await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico Holding", currency: "HUF", createdAt: now, updatedAt: now, createdBy: admin,
    });
    const arlo = await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlow", currency: "HUF", emailDomains: ["arlow.example"], createdAt: now, updatedAt: now, createdBy: admin,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG, clientId: arlo, name: "Arlow monthly retainer", code: "ARLO", billingType: "retainer",
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const adminAuth: AuthContext = {
      userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))!,
    };
    const arloTask = await createTask(
      ctx, adminAuth, { title: "Őszi kampány aloldal", projectId, assigneeIds: [admin] }, { notify: false },
    );
    return { admin, member, pragmatico, arlo, arloTask };
  });
}

/** Row counts of every email table for one org. */
async function emailCounts(t: T, orgId = ORG) {
  return await t.run(async (ctx) => {
    const count = async (table: "emailThreads" | "emailMessages" | "emailThreadTasks" | "agentItems" | "clientRequests" | "emailPromises" | "connectors") =>
      (await ctx.db.query(table).collect()).filter((r) => r.orgId === orgId).length;
    return {
      connectors: await count("connectors"),
      emailThreads: await count("emailThreads"),
      emailMessages: await count("emailMessages"),
      emailThreadTasks: await count("emailThreadTasks"),
      agentItems: await count("agentItems"),
      clientRequests: await count("clientRequests"),
      emailPromises: await count("emailPromises"),
    };
  });
}

// ─── Seed ────────────────────────────────────────────────────────────────────

describe("devSeedEmail.seed", () => {
  it("loads the canvas scenarios into the schema", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });

    expect(result).toMatchObject({
      orgId: ORG,
      clientsCreated: [],
      contactsCreated: ["Kovács Réka", "Nagy Gábor", "Szabó Péter", "Kiss Anna"],
      threadsCreated: 5,
      messagesCreated: 8,
      linkedTaskId: f.arloTask,
    });
    expect(await emailCounts(t)).toEqual({
      // B4: items, ledger rows and Inbox rows come from the pipeline (`process`).
      connectors: 1, emailThreads: 5, emailMessages: 8, emailThreadTasks: 1, agentItems: 0,
      clientRequests: 0, emailPromises: 0,
    });

    const data = await t.run(async (ctx) => {
      const settings = await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).first();
      const mailbox = await ctx.db.get(result.mailboxId);
      const threads = await ctx.db.query("emailThreads").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect();
      const messages = await ctx.db.query("emailMessages").collect();
      const items = await ctx.db
        .query("agentItems")
        .withIndex("by_orgId_status_updatedAt", (q) => q.eq("orgId", ORG).eq("status", "open"))
        .order("desc")
        .collect();
      const links = await ctx.db.query("emailThreadTasks").collect();
      const clients = await ctx.db.query("clients").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect();
      const contacts = await ctx.db.query("clientContacts").withIndex("by_orgId_email", (q) => q.eq("orgId", ORG)).collect();
      return { settings, mailbox, threads, messages, items, links, clients, contacts };
    });

    // Feature on; the mailbox is a clearly-marked seed, never connected.
    expect(data.settings?.emailTriageEnabled).toBe(true);
    expect(data.mailbox).toMatchObject({
      type: "gmail", status: "revoked", devSeed: true, userId: f.admin,
      credentialMask: "Seed mailbox · not connected to Google",
    });
    expect(data.mailbox?.credentialsCiphertext).toBeUndefined();

    const bySubject = (needle: string) => data.threads.find((th) => th.subject.includes(needle))!;
    const messagesOf = (threadId: Id<"emailThreads">) =>
      data.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt - b.sentAt);

    // Réka: Pragmatico (existing client, domain added), 5 requests, a PDF, Friday 15:12, quote stripped.
    const reka = bySubject("Black Friday");
    expect(reka).toMatchObject({ clientId: f.pragmatico, waitingOn: "us", subject: "Black Friday kampány – anyagok" });
    const [rekaMsg] = messagesOf(reka._id);
    expect(rekaMsg).toMatchObject({
      stage: "received", direction: "inbound", from: { email: "reka@pragmatico.hu" },
      cc: [{ name: "Nagy Gábor", email: "gabor@pragmatico.hu" }],
      attachments: [{ name: "brand-szinek.pdf", mime: "application/pdf", size: 248_312 }],
    });
    expect(rekaMsg.bodyText).toContain("1200×628 és 1080×1920");
    expect(rekaMsg.bodyText).toContain("5. És még egy story méret");
    expect(rekaMsg.bodyText).not.toContain("ezt írta");
    expect(rekaMsg.bodyText).not.toContain("Marketing manager");
    expect(rekaMsg.bodyHtml).toContain("ezt írta");
    const friday = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Budapest", weekday: "long", hour: "2-digit", minute: "2-digit",
    }).format(new Date(rekaMsg.sentAt));
    expect(friday).toBe("Friday 15:12");
    expect(hardTriggers(rekaMsg.bodyText, { hasAttachment: true })).toEqual(
      expect.arrayContaining(["word:kérnénk", "word:kellene", "word:még", "attachment"]),
    );

    // Gábor: urgent price bug, mobile footer stripped.
    const gabor = messagesOf(bySubject("rossz ár")._id)[0];
    expect(gabor.bodyText).toContain("Élesben hibás az ár");
    expect(gabor.bodyText).not.toContain("iPhone");

    // Péter: a question on a thread linked to the Arlo task (history handled).
    const peter = bySubject("landing oldal");
    // A fixed, realistic subject — never the linked dev task's title ("Őszi kampány aloldal").
    expect(peter.subject).toBe("Őszi kampány – landing oldal");
    expect(messagesOf(peter._id).map((m) => m.subject)).toEqual([
      "Őszi kampány – landing oldal", "Re: Őszi kampány – landing oldal", "Re: Őszi kampány – landing oldal",
    ]);
    expect(peter.clientId).toBe(f.arlo);
    expect(messagesOf(peter._id).map((m) => [m.direction, m.stage])).toEqual([
      ["inbound", "handled"], ["outbound", "handled"], ["inbound", "received"],
    ]);
    expect(messagesOf(peter._id)[2].bodyText).toMatch(/^Szia Ádám!\n\nMikorra lesz kész\?/);
    expect(data.links).toEqual([expect.objectContaining({ threadId: peter._id, taskId: f.arloTask, role: "created" })]);

    // Judit: unknown domain → no client, no contact.
    const judit = bySubject("Bemutatkozás");
    expect(judit.clientId).toBeUndefined();
    expect(matchClientByDomain("judit@zoldkert.hu", data.clients.map((c) => ({ ...c, contactEmails: [] })))).toBeNull();

    // Anna: a pure thank-you → acknowledge candidate, and NO Triage item.
    const anna = bySubject("Szeptemberi riport");
    const annaThanks = messagesOf(anna._id)[1];
    expect(annaThanks.bodyText).toBe("Köszönöm szépen! 🙏\n\nAnna");
    expect(isAcknowledgeCandidate(annaThanks.bodyText, hardTriggers(annaThanks.bodyText))).toBe(true);

    // The seed opens no Triage item itself (B4 owns item creation).
    expect(data.items).toEqual([]);

    // The near-miss client got nothing.
    expect(data.clients.find((c) => c.name === "Pragmatico Holding")?.emailDomains).toBeUndefined();
    // Clients: Pragmatico got its domain; Arlo kept its own and got arlo.hu; contacts exist.
    expect(data.clients.find((c) => c._id === f.pragmatico)?.emailDomains).toEqual(["pragmatico.hu"]);
    expect(data.clients.find((c) => c._id === f.arlo)?.emailDomains).toEqual(["arlow.example", "arlo.hu"]);
    expect(data.contacts.map((c) => c.email).sort()).toEqual(
      ["anna@arlo.hu", "gabor@pragmatico.hu", "peter@arlo.hu", "reka@pragmatico.hu"],
    );
  });

  it("is idempotent: a second run creates nothing", async () => {
    const t = createT();
    await setup(t);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    const before = await emailCounts(t);
    const again = await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    expect(again).toMatchObject({
      clientsCreated: [], contactsCreated: [], threadsCreated: 0, messagesCreated: 0,
    });
    expect(await emailCounts(t)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("clientContacts").collect())).toHaveLength(4);
  });

  it("creates Pragmatico / Arlo when the org has neither, and resolves the only org", async () => {
    const t = createT();
    await t.run(async (ctx) => {
      const now = Date.now();
      const admin = await ctx.db.insert("users", { name: "Solo", externalId: "clerk_solo", createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId: "org_solo", clerkUserId: "clerk_solo", userId: admin, role: "admin", joinedAt: now });
      await ctx.db.insert("orgSettings", {
        orgId: "org_solo", defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy: admin,
      });
    });
    const result = await t.mutation(internal.devSeedEmail.seed, {});
    expect(result).toMatchObject({ orgId: "org_solo", clientsCreated: ["Pragmatico", "Arlo"], linkedTaskId: null });
    expect(await t.run((ctx) => ctx.db.query("emailThreadTasks").collect())).toEqual([]);
  });

  it("adopts a client by an exact name passed in clientNames", async () => {
    const t = createT();
    await setup(t);
    const renamed = await t.run(async (ctx) =>
      await ctx.db.insert("clients", {
        orgId: ORG, name: "ARLO Digital", currency: "HUF", createdAt: Date.now(), updatedAt: Date.now(),
        createdBy: (await ctx.db.query("users").first())!._id,
      }),
    );
    const result = await t.mutation(internal.devSeedEmail.seed, { orgId: ORG, clientNames: { arlo: "arlo digital" } });
    expect(result.clientsCreated).toEqual([]);
    expect(result.linkedTaskId).toBeNull(); // the renamed client has no project
    const client = await t.run((ctx) => ctx.db.get(renamed));
    expect(client?.emailDomains).toEqual(["arlo.hu"]);
  });

  it("never writes into a real Gmail connection", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("connectors", {
        orgId: ORG, userId: f.admin, type: "gmail", status: "connected", credentialsCiphertext: "v1:x",
        scopes: [], connectedAt: Date.now(), updatedAt: Date.now(),
      });
    });
    await expect(t.mutation(internal.devSeedEmail.seed, { orgId: ORG })).rejects.toThrow(/real Gmail connection/);
    expect((await emailCounts(t)).emailThreads).toBe(0);
  });

  it("lists Gmail only behind the flag, and shows the seed mailbox as a demo (B1)", async () => {
    const t = createT();
    await setup(t);
    const before = await t.withIdentity(ADMIN).query(api.connectors.list, {});
    expect(before.map((c) => c.type)).toEqual(["echo"]);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    const list = await t.withIdentity(ADMIN).query(api.connectors.list, {});
    expect(list.map((c) => c.type)).toEqual(["echo", "gmail"]);
    expect(list.find((c) => c.type === "gmail")).toMatchObject({ isDemo: true, status: "revoked" });
    // The demo mailbox can never be adopted by a real connect (B1 guard) …
    await expect(
      t.withIdentity(ADMIN).mutation(api.connectors.connect, { type: "gmail", token: "a-long-enough-token" }),
    ).rejects.toThrow("Remove the demo mailbox first (devSeedEmail:reset)");
    // … and after the reset, Gmail is still not a token connector.
    await t.mutation(internal.devSeedEmail.reset, { orgId: ORG });
    await expect(
      t.withIdentity(ADMIN).mutation(api.connectors.connect, { type: "gmail", token: "a-long-enough-token" }),
    ).rejects.toThrow(/sign-in flow/);
  });
});

// ─── Process (B4): the canvas scenarios through the real pipeline ─────────────

describe("devSeedEmail.process (fake model)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drain the pipeline in time order (each action finishes before the clock moves). */
  async function settle(t: T): Promise<void> {
    for (let i = 0; i < 200; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await t.finishInProgressScheduledFunctions();
      const pending = await t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.state.kind === "pending"),
      );
      if (pending.length === 0) return;
      const next = Math.min(...pending.map((p) => p.scheduledTime));
      await vi.advanceTimersByTimeAsync(Math.max(0, next - Date.now()) + 1);
    }
    throw new Error("pipeline did not drain");
  }

  it("ends in the canvas outcomes: Réka, Gábor, Péter, Judit items; Anna in the Inbox", async () => {
    vi.useFakeTimers();
    const t = createT();
    const f = await setup(t);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    expect(await t.mutation(internal.devSeedEmail.process, { orgId: ORG, fakeModel: true })).toEqual({
      orgId: ORG, scheduled: 5, retried: 0,
    });
    await settle(t);

    const data = await t.run(async (ctx) => ({
      threads: await ctx.db.query("emailThreads").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect(),
      messages: await ctx.db.query("emailMessages").collect(),
      items: await ctx.db.query("agentItems").collect(),
      requests: await ctx.db.query("clientRequests").collect(),
      notifications: (await ctx.db.query("notifications").collect()).filter((n) => n.type === "email_event"),
      jobRuns: await ctx.db.query("agentJobRuns").collect(),
    }));
    const thread = (needle: string) => data.threads.find((th) => th.subject.includes(needle))!;
    const itemOf = (needle: string) => data.items.filter((i) => i.anchor.id === thread(needle)._id);
    const rowsOf = (needle: string) => data.requests.filter((r) => r.threadId === thread(needle)._id);

    expect(data.messages.every((m) => m.stage === "handled")).toBe(true);
    expect(data.jobRuns).toEqual([]); // no model call with the fake model

    // Réka: request item, 5 ledger rows with the sizes and the 20% verbatim.
    expect(itemOf("Black Friday")).toEqual([expect.objectContaining({ kind: "request", status: "open" })]);
    const reka = rowsOf("Black Friday");
    expect(reka).toHaveLength(5);
    const values = reka.flatMap((r) => (r.constraints ?? []).map((c) => c.value));
    expect(values).toEqual(expect.arrayContaining(["1200×628", "1080×1920", "20%"]));
    expect(reka.every((r) => r.disposition === "open" && r.warnings === undefined && r.clientId)).toBe(true);

    // Gábor: urgent request.
    expect(itemOf("rossz ár")).toEqual([expect.objectContaining({ kind: "request", status: "open", urgent: true })]);
    // Péter: a question on the linked task.
    expect(itemOf("landing oldal")).toEqual([
      expect.objectContaining({ kind: "question", status: "open", taskId: f.arloTask }),
    ]);
    expect(rowsOf("landing oldal").map((r) => r.intent)).toEqual(["ask"]);
    // Judit: new sender.
    expect(itemOf("Bemutatkozás")).toEqual([expect.objectContaining({ kind: "new_sender", status: "open" })]);
    // Anna: no item, an Inbox no_action row for the admin.
    expect(itemOf("Szeptemberi riport")).toEqual([]);
    expect(data.notifications).toEqual([
      expect.objectContaining({
        recipientId: f.admin, kind: "email", subtype: "no_action", threadId: thread("Szeptemberi riport")._id,
      }),
    ]);
    const anna = data.messages.find((m) => m.threadId === thread("Szeptemberi riport")._id && m.direction === "inbound")!;
    expect(anna.classification).toMatchObject({ intents: ["acknowledge"], source: "rules" });

    // Re-running process touches nothing (every message is handled).
    expect(await t.mutation(internal.devSeedEmail.process, { orgId: ORG, fakeModel: true })).toMatchObject({
      scheduled: 0, retried: 0,
    });
    // Reset removes the pipeline's rows too.
    const reset = await t.mutation(internal.devSeedEmail.reset, { orgId: ORG });
    expect(reset.deleted).toMatchObject({ agentItems: 4, clientRequests: 9, notifications: 1 });
  });
});

// ─── Reset ───────────────────────────────────────────────────────────────────

describe("devSeedEmail.reset", () => {
  it("removes only the seed mailbox and its email rows", async () => {
    const t = createT();
    const f = await setup(t);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });

    // Non-seed rows that must survive: another member's (real) mailbox with a
    // thread + item, a ledger row on it, and an other-org thread.
    const survivors = await t.run(async (ctx) => {
      const now = Date.now();
      const real = await ctx.db.insert("connectors", {
        orgId: ORG, userId: f.member, type: "gmail", status: "connected", scopes: [], connectedAt: now, updatedAt: now,
      });
      const thread = await ctx.db.insert("emailThreads", {
        orgId: ORG, connectorId: real, gmailThreadId: "real-1", subject: "Real", participants: [],
        lastMessageAt: now, waitingOn: "us", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("agentItems", {
        orgId: ORG, source: "email", anchor: { type: "emailThread", id: thread }, kind: "request", status: "open",
        createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("clientRequests", {
        orgId: ORG, threadId: thread, text: "Kérnénk egy bannert", disposition: "open", createdAt: now, updatedAt: now,
      });
      const otherMailbox = await ctx.db.insert("connectors", {
        orgId: OTHER, userId: f.admin, type: "gmail", status: "revoked", devSeed: true, scopes: [], connectedAt: now, updatedAt: now,
      });
      await ctx.db.insert("emailThreads", {
        orgId: OTHER, connectorId: otherMailbox, gmailThreadId: "seed-x", subject: "Other org", participants: [],
        lastMessageAt: now, waitingOn: "us", createdAt: now, updatedAt: now,
      });
      return { real, thread };
    });

    const result = await t.mutation(internal.devSeedEmail.reset, { orgId: ORG });
    expect(result.deleted).toEqual({
      connectors: 1, emailThreads: 5, emailMessages: 8, emailThreadTasks: 1, agentItems: 0, clientRequests: 0, emailPromises: 0,
      emailDrafts: 0, notifications: 0, agentThreads: 0, agentProposals: 0, agentQuestions: 0, agentRuns: 0, agentJobRuns: 0,
    });
    expect(await emailCounts(t)).toEqual({
      connectors: 1, emailThreads: 1, emailMessages: 0, emailThreadTasks: 0, agentItems: 1, clientRequests: 1, emailPromises: 0,
    });
    expect((await emailCounts(t, OTHER)).emailThreads).toBe(1);
    // Clients, contacts, the task and the feature flag stay.
    const kept = await t.run(async (ctx) => ({
      contacts: (await ctx.db.query("clientContacts").collect()).length,
      task: await ctx.db.get(f.arloTask),
      enabled: (await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).first())?.emailTriageEnabled,
      realThread: await ctx.db.get(survivors.thread),
    }));
    expect(kept).toMatchObject({ contacts: 4, enabled: true });
    expect(kept.task).not.toBeNull();
    expect(kept.realThread).not.toBeNull();

    // A reset is repeatable, and the seed loads again afterwards.
    expect((await t.mutation(internal.devSeedEmail.reset, { orgId: ORG })).deleted.connectors).toBe(0);
    // The latest open Arlo task is a dev scratch task ("hello"): the reseeded
    // conversation still links to it, but keeps its own realistic subject.
    await t.run((ctx) => ctx.db.patch(f.arloTask, { title: "hello" }));
    expect((await t.mutation(internal.devSeedEmail.seed, { orgId: ORG })).threadsCreated).toBe(5);
    const reseeded = await t.run(async (ctx) => {
      const peter = (await ctx.db.query("emailThreads").collect()).find((th) => th.gmailThreadId.endsWith("peter-question"))!;
      const links = await ctx.db.query("emailThreadTasks").collect();
      return { subject: peter.subject, linked: links.filter((l) => l.threadId === peter._id).map((l) => l.taskId) };
    });
    expect(reseeded).toEqual({ subject: "Őszi kampány – landing oldal", linked: [f.arloTask] });
  });
});

// ─── I14 gate ────────────────────────────────────────────────────────────────

describe("requireEmailTriageEnabled (I14)", () => {
  it("is off when unset, false, or the org has no settings row", async () => {
    const t = createT();
    await setup(t);
    await t.run(async (ctx) => {
      expect(await isEmailTriageEnabled(ctx, ORG)).toBe(false);
      await expect(requireEmailTriageEnabled(ctx, ORG)).rejects.toThrow(EMAIL_TRIAGE_DISABLED_MESSAGE);
      await expect(requireEmailTriageEnabled(ctx, "org_missing")).rejects.toThrow(EMAIL_TRIAGE_DISABLED_MESSAGE);
    });
    await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: false });
    await t.run(async (ctx) => {
      await expect(requireEmailTriageEnabled(ctx, ORG)).rejects.toThrow(EMAIL_TRIAGE_DISABLED_MESSAGE);
    });
  });

  it("the internal switch turns it on for one org only, and back off", async () => {
    const t = createT();
    await setup(t);
    expect(await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: true })).toEqual({
      orgId: ORG, enabled: true,
    });
    await t.run(async (ctx) => {
      await expect(requireEmailTriageEnabled(ctx, ORG)).resolves.toBeUndefined();
      expect(await isEmailTriageEnabled(ctx, ORG)).toBe(true);
      expect(await isEmailTriageEnabled(ctx, OTHER)).toBe(false);
    });
    await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: false });
    await t.run(async (ctx) => {
      expect(await isEmailTriageEnabled(ctx, ORG)).toBe(false);
    });
  });

  it("refuses an org that has never signed in", async () => {
    const t = createT();
    await expect(
      t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: "org_missing", enabled: true }),
    ).rejects.toThrow(/No orgSettings row/);
  });
});

// ─── Notifications: task inbox vs email / agent rows ────────────────────────

describe("notifications kind (task inbox vs email_event / agent_signal / daily_digest)", () => {
  async function seedRows(t: T, f: Fixture, emailRows = 0) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const base = { orgId: ORG, recipientId: f.admin, actorId: f.member, inboxState: "unread" as const };
      // A row from before `kind` existed (unset → counts as task) …
      const legacy = await ctx.db.insert("notifications", {
        ...base, type: "assigned", taskId: f.arloTask, previewText: "Assigned you", createdAt: now, updatedAt: now,
      });
      // … and a stamped one.
      const stamped = await ctx.db.insert("notifications", {
        ...base, kind: "task", type: "comment", taskId: f.arloTask, previewText: "New comment",
        createdAt: now + 1, updatedAt: now + 1,
      });
      const emailEvent = await ctx.db.insert("notifications", {
        ...base, kind: "email", type: "email_event", subtype: "no_action", subject: { type: "emailThread", id: "seed-thread" },
        reasonText: "Checked for requests, questions and attachments — none.", previewText: "Köszönöm szépen!",
        createdAt: now + 2, updatedAt: now + 2,
      });
      // An email row that names a task still stays out of the task inbox.
      const reopened = await ctx.db.insert("notifications", {
        ...base, kind: "email", type: "email_event", subtype: "reopened", taskId: f.arloTask,
        previewText: "Reopened from email", createdAt: now + 3, updatedAt: now + 3,
      });
      await ctx.db.insert("notifications", {
        ...base, kind: "agent", type: "agent_signal", signal: "stuck", previewText: "Stuck for 3 days",
        createdAt: now + 4, updatedAt: now + 4,
      });
      await ctx.db.insert("notifications", {
        ...base, kind: "agent", inboxState: "archived", type: "daily_digest", previewText: "Your morning digest",
        createdAt: now + 5, updatedAt: now + 5, archivedAt: now + 5,
      });
      for (let i = 0; i < emailRows; i++) {
        await ctx.db.insert("notifications", {
          ...base, kind: "email", type: "email_event", subtype: "unlinked", previewText: `Email ${i}`,
          createdAt: now + 10 + i, updatedAt: now + 10 + i,
        });
      }
      return { legacy, stamped, emailEvent, reopened };
    });
  }

  it("the Inbox list, archive and badge read task rows only — and agree", async () => {
    const t = createT();
    const f = await setup(t);
    const ids = await seedRows(t, f);
    const asAdmin = t.withIdentity(ADMIN);
    const inbox = await asAdmin.query(api.notifications.listInbox, {});
    expect(inbox.map((r) => r._id)).toEqual([ids.stamped, ids.legacy]);
    expect(inbox[0]).toMatchObject({ taskId: f.arloTask, taskTitle: "Őszi kampány aloldal" });
    expect(await asAdmin.query(api.notifications.listArchived, {})).toEqual([]);
    expect(await asAdmin.query(api.notifications.unreadCount, {})).toEqual({ count: 2, isCapped: false });
  });

  it("email rows never crowd task rows out of the bounded slice", async () => {
    const t = createT();
    const f = await setup(t);
    const ids = await seedRows(t, f, 150);
    const asAdmin = t.withIdentity(ADMIN);
    expect((await asAdmin.query(api.notifications.listInbox, {})).map((r) => r._id)).toEqual([ids.stamped, ids.legacy]);
    expect(await asAdmin.query(api.notifications.unreadCount, {})).toEqual({ count: 2, isCapped: false });
  });

  it("markAllRead and opening the task touch task rows only; row mutations accept any own row", async () => {
    const t = createT();
    const f = await setup(t);
    const ids = await seedRows(t, f);
    const asAdmin = t.withIdentity(ADMIN);
    const stateOf = (id: Id<"notifications">) => t.run(async (ctx) => (await ctx.db.get(id))?.inboxState);

    await asAdmin.mutation(api.notifications.markAllRead, {});
    expect(await stateOf(ids.legacy)).toBe("read");
    expect(await stateOf(ids.stamped)).toBe("read");
    expect(await stateOf(ids.emailEvent)).toBe("unread");
    expect(await stateOf(ids.reopened)).toBe("unread");

    // Opening the task (markViewed → markTaskNotificationsRead) leaves the email row alone.
    await t.run(async (ctx) => {
      const { markTaskNotificationsRead } = await import("../notifications");
      await ctx.db.patch(ids.legacy, { inboxState: "unread" });
      await markTaskNotificationsRead(ctx, { userId: f.admin, orgId: ORG, taskId: f.arloTask });
    });
    expect(await stateOf(ids.legacy)).toBe("read");
    expect(await stateOf(ids.reopened)).toBe("unread");

    await asAdmin.mutation(api.notifications.markRead, { ids: [ids.emailEvent] });
    await asAdmin.mutation(api.notifications.archive, { ids: [ids.emailEvent] });
    expect(await stateOf(ids.emailEvent)).toBe("archived");
  });

  it("every writer stamps kind: the task fan-out writes task", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const adminAuth: AuthContext = {
        userId: f.admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(f.admin))!,
      };
      await createTask(ctx, adminAuth, { title: "Assigned to the member", assigneeIds: [f.member] });
    });
    const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(rows.map((r) => [r.type, r.kind])).toEqual([["assigned", "task"]]);
  });
});
