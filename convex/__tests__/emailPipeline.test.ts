// @vitest-environment edge-runtime
//
// Email triage B4 (docs/prd-email-triage.md I5, §5.2–§5.3, §6.1, §6.3,
// D24–D28, D32, I13, I14): the inbound stage machine, classification (the
// deterministic shortcut and the llm_step jobs against a fake model), the
// request ledger, dispatch into agentItems / the Inbox, the item actions and
// the Filtered retention cron.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { MockLanguageModelV3 } from "ai/test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { stripQuoted } from "../email/model";
import { EMAIL_TRIAGE_DISABLED_MESSAGE } from "../email/gate";
import type { CheckCompletenessOutput, ClassifyInboundOutput, ScreenSenderOutput } from "../email/jobs";
import { FILTERED_RETENTION_MS, PURGE_MESSAGE_BUDGET } from "../email/triage";
import { MAX_STAGE_ATTEMPTS } from "../email/pipeline";

// resolveModel → the routed fake model below (the real resolver is not used).
const modelSlot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../lib/worksheetAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/worksheetAi")>();
  return {
    ...actual,
    resolveModel: () => {
      if (!modelSlot.current) throw new actual.WorksheetAiUnavailableError("no mock model set");
      return modelSlot.current;
    },
  };
});

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");

const ORG = "org_b4";
const OFF = "org_b4_off";
const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

const ADMIN = { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" };
const MEMBER = { subject: "clerk_member", orgId: ORG, orgRole: "org:member" };

// ─── The fake model: one MockLanguageModelV3 routed by job ───────────────────

type Job = "classify" | "completeness" | "screen";
/* eslint-disable @typescript-eslint/no-explicit-any -- the prompt is the job's JSON input */
type Handlers = {
  classify?: (input: any) => ClassifyInboundOutput | Error;
  completeness?: (input: any) => CheckCompletenessOutput | Error;
  screen?: (input: any) => ScreenSenderOutput | Error;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

const calls: Record<Job, number> = { classify: 0, completeness: 0, screen: 0 };

function out(partial: Partial<ClassifyInboundOutput>): ClassifyInboundOutput {
  return {
    intents: [],
    requests: [],
    approveHasAction: { hasAction: false, action: null },
    reasons: ["test reason"],
    urgent: false,
    ...partial,
  };
}

const req = (text: string, extra: Partial<ClassifyInboundOutput["requests"][number]> = {}) => ({
  text,
  constraints: [],
  intent: "add" as const,
  refersToRequestId: null,
  ...extra,
});

function routedModel(h: Handlers) {
  return new MockLanguageModelV3({
    doGenerate: async (options) => {
      const system = options.prompt.find((m) => m.role === "system");
      const systemText = typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
      const user = options.prompt.find((m) => m.role === "user");
      const userText =
        user && Array.isArray(user.content) && user.content[0]?.type === "text" ? user.content[0].text : "{}";
      const job: Job = systemText.includes("You classify ONE inbound client email")
        ? "classify"
        : systemText.includes("You double-check a request ledger")
          ? "completeness"
          : "screen";
      calls[job]++;
      const input = JSON.parse(userText);
      const result =
        job === "classify"
          ? (h.classify ?? (() => out({ intents: ["add"], requests: [req(input.message.text.split("\n")[0])] })))(input)
          : job === "completeness"
            ? (h.completeness ?? (() => ({ missing: [] })))(input)
            : (h.screen ?? (() => ({ possibleClient: true, reason: "Looks like a brief" })))(input);
      if (result instanceof Error) throw result;
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

function setModel(h: Handlers = {}) {
  modelSlot.current = routedModel(h);
}

beforeEach(() => {
  vi.useFakeTimers();
  modelSlot.current = null;
  calls.classify = 0;
  calls.completeness = 0;
  calls.screen = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Fixture ─────────────────────────────────────────────────────────────────

type Fixture = {
  admin: Id<"users">;
  admin2: Id<"users">;
  member: Id<"users">;
  client: Id<"clients">;
  task: Id<"tasks">;
  adminMailbox: Id<"connectors">;
  memberMailbox: Id<"connectors">;
  statuses: Record<string, Id<"statuses">>;
};

async function setup(t: T, opts: { enabled?: boolean } = {}): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string, externalId: string, email: string) =>
      ctx.db.insert("users", { name, externalId, email, createdAt: now, updatedAt: now });
    const admin = await mkUser("Tóth Ádám", "clerk_admin", "adam@agency.test");
    const admin2 = await mkUser("Second Admin", "clerk_admin2", "admin2@agency.test");
    const member = await mkUser("Member", "clerk_member", "member@agency.test");
    for (const [userId, clerkUserId, role] of [
      [admin, "clerk_admin", "admin"],
      [admin2, "clerk_admin2", "admin"],
      [member, "clerk_member", "member"],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, enabled] of [[ORG, opts.enabled ?? true], [OFF, false]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: "Europe/Budapest", roundingMinutes: 15,
        emailTriageEnabled: enabled, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const statuses: Record<string, Id<"statuses">> = {};
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      statuses[s.name] = await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, workflowRole: s.workflowRole, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico", currency: "HUF", emailDomains: ["pragmatico.hu"],
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const adminAuth: AuthContext = {
      userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))!,
    };
    const task = await createTask(ctx, adminAuth, { title: "Black Friday bannerek", projectId }, { notify: false });
    const mailbox = (userId: Id<"users">) =>
      ctx.db.insert("connectors", {
        orgId: ORG, userId, type: "gmail", status: "connected", scopes: [], connectedAt: now, updatedAt: now,
      });
    return {
      admin, admin2, member, client, task, statuses,
      adminMailbox: await mailbox(admin),
      memberMailbox: await mailbox(member),
    };
  });
}

let threadSeq = 0;
async function newThread(
  t: T,
  f: Fixture,
  opts: { client?: boolean; mailbox?: Id<"connectors">; subject?: string; linkTask?: Id<"tasks">; orgId?: string } = {},
): Promise<Id<"emailThreads">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const orgId = opts.orgId ?? ORG;
    const threadId = await ctx.db.insert("emailThreads", {
      orgId,
      connectorId: opts.mailbox ?? f.adminMailbox,
      gmailThreadId: `thread-${++threadSeq}`,
      subject: opts.subject ?? "Black Friday",
      clientId: opts.client === false ? undefined : f.client,
      participants: [],
      lastMessageAt: now,
      waitingOn: "us",
      createdAt: now,
      updatedAt: now,
    });
    if (opts.linkTask) {
      await ctx.db.insert("emailThreadTasks", { orgId, threadId, taskId: opts.linkTask, role: "created", createdAt: now });
    }
    return threadId;
  });
}

let messageSeq = 0;
async function addMessage(
  t: T,
  threadId: Id<"emailThreads">,
  body: string,
  opts: {
    from?: string;
    attachments?: Doc<"emailMessages">["attachments"];
    rfc?: string;
    direction?: "inbound" | "outbound";
  } = {},
): Promise<Id<"emailMessages">> {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(threadId))!;
    const seq = ++messageSeq;
    return await ctx.db.insert("emailMessages", {
      orgId: thread.orgId,
      threadId,
      connectorId: thread.connectorId,
      gmailMessageId: `msg-${seq}`,
      rfcMessageId: opts.rfc ?? `<msg-${seq}@test>`,
      direction: opts.direction ?? "inbound",
      from: { name: "Kovács Réka", email: opts.from ?? "reka@pragmatico.hu" },
      to: [{ email: "adam@agency.test" }],
      cc: [],
      subject: thread.subject,
      bodyText: stripQuoted(body).text,
      attachments: opts.attachments ?? [],
      sentAt: Date.now() + seq, // strictly increasing within a test
      stage: "received",
      createdAt: Date.now(),
    });
  });
}

/**
 * Run every scheduled function in time order, letting each one (the model
 * action included) finish before the clock moves on to the next — so a
 * 10-minute watchdog never overtakes an action that is still running, as
 * `vi.runAllTimers` would.
 */
async function settle(t: T, opts: { horizonMs?: number } = {}): Promise<void> {
  const horizon = opts.horizonMs === undefined ? Infinity : Date.now() + opts.horizonMs;
  for (let i = 0; i < 200; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await t.finishInProgressScheduledFunctions();
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.state.kind === "pending"),
    );
    if (pending.length === 0) return;
    const next = Math.min(...pending.map((p) => p.scheduledTime));
    if (next > horizon) return;
    await vi.advanceTimersByTimeAsync(Math.max(0, next - Date.now()) + 1);
  }
  throw new Error("settle: scheduled functions did not drain");
}

async function processMessage(t: T, messageId: Id<"emailMessages">) {
  await t.mutation(internal.email.pipeline.processInboundMessage, { messageId });
  await settle(t);
}

async function snapshot(t: T, threadId?: Id<"emailThreads">) {
  return await t.run(async (ctx) => {
    const items = (await ctx.db.query("agentItems").collect()).filter((i) => !threadId || i.anchor.id === threadId);
    const requests = (await ctx.db.query("clientRequests").collect()).filter((r) => !threadId || r.threadId === threadId);
    const notifications = (await ctx.db.query("notifications").collect()).filter(
      (n) => n.type === "email_event" && (!threadId || n.threadId === threadId),
    );
    const thread = threadId ? await ctx.db.get(threadId) : null;
    const jobRuns = await ctx.db.query("agentJobRuns").collect();
    return { items, requests, notifications, thread, jobRuns };
  });
}

const getMessage = (t: T, id: Id<"emailMessages">) => t.run((ctx) => ctx.db.get(id));

// ─── Stage machine ───────────────────────────────────────────────────────────

describe("stage machine (I5)", () => {
  it("happy path: received → extracted → classified → handled, ledger + request item", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({
      classify: () =>
        out({
          intents: ["add"],
          requests: [
            req("Kérnénk két bannert: 1200×628 és 1080×1080.", {
              constraints: [{ kind: "size", value: "1200×628" }, { kind: "size", value: "1080×1080" }],
            }),
            req("A 20% kedvezményt is írjátok rá.", { constraints: [{ kind: "discount", value: "20%" }] }),
          ],
          reasons: ["2 requests: banners, 20% note"],
        }),
    });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Szia!\n\nKérnénk két bannert: 1200×628 és 1080×1080.\nA 20% kedvezményt is írjátok rá.\n\nRéka");
    await processMessage(t, msg);

    const message = await getMessage(t, msg);
    expect(message?.stage).toBe("handled");
    expect(message?.stageError).toBeUndefined();
    expect(message?.classification).toMatchObject({
      intents: ["add"],
      reasons: ["2 requests: banners, 20% note"],
      urgent: false,
      source: "model",
    });
    expect(message?.classification?.triggers).toEqual(expect.arrayContaining(["word:kérnénk"]));
    const s = await snapshot(t, thread);
    expect(s.requests.map((r) => [r.text, r.disposition, r.intent, r.warnings])).toEqual([
      ["Kérnénk két bannert: 1200×628 és 1080×1080.", "open", "add", undefined],
      ["A 20% kedvezményt is írjátok rá.", "open", "add", undefined],
    ]);
    expect(s.requests[0]).toMatchObject({ orgId: ORG, clientId: f.client, messageId: msg });
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      source: "email", anchor: { type: "emailThread", id: thread }, kind: "request", status: "open", messageIds: [msg],
    });
    expect(s.notifications).toHaveLength(0);
    expect(calls).toEqual({ classify: 1, completeness: 1, screen: 0 });
    // One light audit row per llm_step call.
    expect(s.jobRuns.map((r) => [r.job, r.status]).sort()).toEqual([
      ["checkCompleteness", "succeeded"], ["classifyInbound", "succeeded"],
    ]);
  });

  it("waits for attachment extraction with a scheduled re-check, then advances", async () => {
    const t = createT();
    const f = await setup(t);
    setModel();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["brief"], { type: "text/plain" })));
    await t.run(async (ctx) => {
      await ctx.db.insert("attachmentContents", {
        orgId: ORG, storageId, mimeType: "text/plain", status: "pending", attempts: 1,
        queuedAt: Date.now(), createdAt: Date.now(),
      });
    });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy bannert, a brief csatolva.", {
      attachments: [{ name: "brief.txt", mime: "text/plain", size: 5, storageId }],
    });

    const first = await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: msg });
    expect(first.stage).toBe("received");
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(
      pending.filter((s) => s.state.kind === "pending" && s.name.includes("processInboundMessage")).map((s) => s.args[0]),
    ).toEqual([expect.objectContaining({ messageId: msg, poll: 1 })]);

    await t.run(async (ctx) => {
      const row = (await ctx.db.query("attachmentContents").collect())[0];
      await ctx.db.patch(row._id, { status: "done", text: "Brief: 1200×628 banner", extractedAt: Date.now() });
    });
    let classifyInput: { message: { attachments: unknown[] } } | null = null;
    setModel({
      classify: (input) => {
        classifyInput = input;
        return out({ intents: ["add"], requests: [req("Kérnénk egy bannert")] });
      },
    });
    await settle(t);
    expect((await getMessage(t, msg))?.stage).toBe("handled");
    expect(classifyInput!.message.attachments).toEqual([
      { name: "brief.txt", mime: "text/plain", summary: null, text: "Brief: 1200×628 banner" },
    ]);
  });

  it("a failing stage retries, then becomes failed with an attention item; Retry recovers", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => new Error("provider down") });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy új bannert.");
    await processMessage(t, msg);

    expect(calls.classify).toBe(MAX_STAGE_ATTEMPTS);
    const failed = await getMessage(t, msg);
    expect(failed).toMatchObject({ stage: "failed", stageError: { stage: "extracted", attempts: 3 } });
    expect(failed?.stageError?.message).toContain("provider down");
    let s = await snapshot(t, thread);
    expect(s.requests).toHaveLength(0);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      kind: "attention", status: "open", messageIds: [msg],
      attentions: [expect.objectContaining({ messageId: msg, stage: "extracted", attempts: 3 })],
    });
    expect(s.jobRuns.filter((r) => r.job === "classifyInbound").map((r) => r.status)).toEqual(["failed", "failed", "failed"]);

    // A message that is not failed is not "retried".
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy új bannert.")] }) });
    const retried = await t.mutation(internal.email.pipeline.retryStage, { messageId: msg });
    expect(retried).toEqual({ retried: true, stage: "extracted" });
    await settle(t);
    const recovered = await getMessage(t, msg);
    expect([recovered?.stage, recovered?.stageError]).toEqual(["handled", undefined]);
    s = await snapshot(t, thread);
    expect(s.requests).toHaveLength(1);
    // The attention item becomes the real item (I13: still one per conversation).
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "request", status: "open", messageIds: [msg] });
    expect(s.items[0].attentions).toBeUndefined();
    expect(await t.mutation(internal.email.pipeline.retryStage, { messageId: msg })).toEqual({
      retried: false, stage: "handled",
    });
  });

  it("re-running any stage after it finished duplicates nothing", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert.")] }) });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy bannert.");
    await processMessage(t, msg);
    const before = await snapshot(t, thread);

    await processMessage(t, msg);
    for (const stage of ["received", "extracted", "classified"] as const) {
      await t.mutation(internal.email.pipeline.runStage, { messageId: msg, stage });
    }
    expect(
      await t.mutation(internal.email.pipeline.applyClassification, {
        messageId: msg,
        result: { intents: ["add"], reasons: [], urgent: false, source: "model", requests: [{ text: "x", constraints: [], intent: "add" }] },
      }),
    ).toEqual({ applied: false });
    await t.action(internal.email.classify.classifyMessage, { messageId: msg, attempt: 1 });
    await settle(t);

    const after = await snapshot(t, thread);
    expect(after.requests).toHaveLength(before.requests.length);
    expect(after.items).toEqual(before.items);
    expect(calls.classify).toBe(1);
  });

  it("an outbound message is history: handled without classification", async () => {
    const t = createT();
    const f = await setup(t);
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Szia Réka, csatolom.", { direction: "outbound" });
    await processMessage(t, msg);
    const outbound = await getMessage(t, msg);
    expect([outbound?.stage, outbound?.classification]).toEqual(["handled", undefined]);
    expect((await snapshot(t, thread)).items).toHaveLength(0);
  });

  it("the same email in two mailboxes (same rfcMessageId) makes one item and one set of rows (I1)", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert.")] }) });
    const a = await newThread(t, f, { mailbox: f.adminMailbox });
    const b = await newThread(t, f, { mailbox: f.memberMailbox });
    const m1 = await addMessage(t, a, "Kérnénk egy bannert.", { rfc: "<same@pragmatico.hu>" });
    await processMessage(t, m1);
    const m2 = await addMessage(t, b, "Kérnénk egy bannert.", { rfc: "<same@pragmatico.hu>" });
    await processMessage(t, m2);
    const s = await snapshot(t);
    expect(s.items).toHaveLength(1);
    expect(s.requests).toHaveLength(1);
    expect((await getMessage(t, m2))?.classification?.duplicateOf).toBe(m1);
    expect(calls.classify).toBe(1);
  });
});

// ─── Deterministic layer ─────────────────────────────────────────────────────

describe("deterministic acknowledge (§6.3)", () => {
  it("a short Köszönjük! never calls the model and lands in the Inbox as no_action", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => new Error("the model must not be called") });
    const thread = await newThread(t, f, { linkTask: f.task });
    const msg = await addMessage(t, thread, "Köszönjük!\n\nRéka");
    await processMessage(t, msg);

    expect(calls).toEqual({ classify: 0, completeness: 0, screen: 0 });
    expect((await getMessage(t, msg))?.classification).toMatchObject({
      intents: ["acknowledge"], triggers: [], source: "rules",
    });
    const s = await snapshot(t, thread);
    expect(s.items).toHaveLength(0);
    expect(s.requests).toHaveLength(0);
    expect(s.jobRuns).toHaveLength(0);
    expect(s.thread?.waitingOn).toBe("none");
    // One email Inbox row per admin, linking to the conversation (no item).
    expect(s.notifications.map((n) => n.recipientId).sort()).toEqual([f.admin, f.admin2].sort());
    expect(s.notifications[0]).toMatchObject({
      kind: "email", subtype: "no_action", messageId: msg, threadId: thread,
      subject: { type: "emailThread", id: thread }, previewText: "Köszönjük! Réka",
    });
    const rows = await t.withIdentity(ADMIN).query(api.email.inbox.listEmailEvents, {});
    expect(rows).toEqual([
      expect.objectContaining({
        subtype: "no_action", senderName: "Kovács Réka", subject: "Black Friday",
        href: `/triage?thread=${thread}`, reasonText: expect.stringContaining("thank-you"),
      }),
    ]);
    // The task Inbox is untouched.
    expect(await t.withIdentity(ADMIN).query(api.notifications.listInbox, {})).toEqual([]);
  });
});

// ─── Ledger ──────────────────────────────────────────────────────────────────

describe("request ledger (§6.3 intents)", () => {
  it("add, clarify, replace (supersedes), cancel (dismisses), ask; a cross-thread reference is ignored", async () => {
    const t = createT();
    const f = await setup(t);
    const thread = await newThread(t, f);
    const other = await newThread(t, f, { subject: "Más téma" });
    const foreign = await t.run((ctx) =>
      ctx.db.insert("clientRequests", {
        orgId: ORG, threadId: other, text: "Másik szál kérése", disposition: "open", createdAt: Date.now(), updatedAt: Date.now(),
      }),
    );

    setModel({
      classify: () =>
        out({
          intents: ["add"],
          requests: [
            req("Kérnénk egy bannert 20% kedvezménnyel.", { constraints: [{ kind: "discount", value: "20%" }] }),
            req("Kérnénk egy hírlevelet is."),
          ],
        }),
    });
    const m1 = await addMessage(t, thread, "Kérnénk egy bannert 20% kedvezménnyel. Kérnénk egy hírlevelet is.");
    await processMessage(t, m1);
    const rows1 = (await snapshot(t, thread)).requests;
    const banner = rows1.find((r) => r.text.includes("bannert"))!;
    const newsletter = rows1.find((r) => r.text.includes("hírlevelet"))!;

    let seenLedger: Array<{ id: string; text: string }> = [];
    setModel({
      classify: (input) => {
        seenLedger = input.ledger;
        const id = (needle: string) => input.ledger.find((r: { text: string }) => r.text.includes(needle)).id;
        return out({
          intents: ["clarify", "replace", "cancel", "ask"],
          requests: [
            req("A 20% csak a webshopra vonatkozik.", {
              intent: "clarify", refersToRequestId: id("bannert"),
              constraints: [{ kind: "scope", value: "csak a webshopra" }],
            }),
            req("Mégis 15% legyen.", {
              intent: "replace", refersToRequestId: id("bannert"), constraints: [{ kind: "discount", value: "15%" }],
            }),
            req("A hírlevél mégsem kell.", { intent: "cancel", refersToRequestId: id("hírlevelet") }),
            req("Mikorra lesz kész?", { intent: "ask" }),
            req("A másik szál is legyen sárga.", { intent: "clarify", refersToRequestId: foreign }),
            req("És a másikat is töröljétek.", { intent: "cancel", refersToRequestId: foreign }),
          ],
        });
      },
    });
    const m2 = await addMessage(
      t, thread,
      "A 20% csak a webshopra vonatkozik. Mégis 15% legyen. A hírlevél mégsem kell. Mikorra lesz kész? A másik szál is legyen sárga. És a másikat is töröljétek.",
    );
    await processMessage(t, m2);

    // The model saw only this conversation's live rows, with their ids.
    expect(seenLedger.map((r) => r.id).sort()).toEqual([banner._id, newsletter._id].sort());
    const rows = (await snapshot(t, thread)).requests;
    const byText = (needle: string) => rows.find((r) => r.text.includes(needle))!;
    const replacement = byText("Mégis 15%");
    expect(byText("bannert")).toMatchObject({
      disposition: "superseded",
      supersededBy: replacement._id,
      constraints: [{ kind: "discount", value: "20%" }, { kind: "scope", value: "csak a webshopra" }],
    });
    expect(replacement).toMatchObject({ disposition: "open", intent: "replace", messageId: m2 });
    expect(byText("hírlevelet")).toMatchObject({ disposition: "dismissed", dismissedReason: "client cancelled" });
    expect(byText("Mikorra")).toMatchObject({ disposition: "open", intent: "ask" });
    // The cross-thread clarify is kept as its own row; the cross-thread cancel does nothing.
    expect(byText("másik szál")).toMatchObject({ disposition: "open", intent: "clarify", threadId: thread });
    expect(rows.some((r) => r.text.includes("töröljétek"))).toBe(false);
    expect(await t.run((ctx) => ctx.db.get(foreign))).toMatchObject({ disposition: "open", text: "Másik szál kérése" });
    // The second message joined the open item (I13).
    const items = (await snapshot(t, thread)).items;
    expect(items).toHaveLength(1);
    expect(items[0].messageIds).toEqual([m1, m2]);
  });

  it("the completeness pass adds a missing row", async () => {
    const t = createT();
    const f = await setup(t);
    let extracted: unknown[] = [];
    setModel({
      classify: () => out({ intents: ["add"], requests: [req("Kérnénk két bannert.")] }),
      completeness: (input) => {
        extracted = input.extracted;
        return { missing: [req("És még egy story méret is kellene.")] };
      },
    });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk két bannert. És még egy story méret is kellene.");
    await processMessage(t, msg);
    expect(extracted).toEqual([{ text: "Kérnénk két bannert.", constraints: [], intent: "add" }]);
    expect((await snapshot(t, thread)).requests.map((r) => r.text)).toEqual([
      "Kérnénk két bannert.",
      "És még egy story méret is kellene.",
    ]);
  });

  it("a constraint not found verbatim is flagged on the row, never dropped", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({
      classify: () =>
        out({
          intents: ["add"],
          requests: [
            req("Banner 1200×628 méretben", {
              constraints: [
                { kind: "size", value: "1200x628" }, // model normalised × → x
                { kind: "discount", value: "20 %" },
                { kind: "deadline", value: "jövő   szerdáig" }, // whitespace differs only
              ],
            }),
          ],
        }),
    });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy bannert 1200×628 méretben, 20% kedvezménnyel, jövő szerdáig.");
    await processMessage(t, msg);
    const [row] = (await snapshot(t, thread)).requests;
    expect(row.constraints).toHaveLength(3);
    expect(row.warnings).toEqual([
      { kind: "constraint_not_verbatim", detail: "size: 1200x628" },
      { kind: "constraint_not_verbatim", detail: "discount: 20 %" },
    ]);
  });
});

// ─── Dispatch (§5.3) ─────────────────────────────────────────────────────────

type DispatchCase = {
  name: string;
  thread: "unlinked" | "linked" | "linked_client_review" | "unknown_admin" | "unknown_member";
  body: string;
  model?: Handlers;
  expectItem: { kind: Doc<"agentItems">["kind"]; status: "open" | "filtered"; withTask?: boolean } | null;
  expectNoAction?: boolean;
};

const DISPATCH_CASES: DispatchCase[] = [
  {
    name: "unlinked · add → request",
    thread: "unlinked",
    body: "Kérnénk egy bannert.",
    expectItem: { kind: "request", status: "open" },
  },
  {
    name: "unlinked · no clear intent, no trigger → request",
    thread: "unlinked",
    body: "Itt vannak a jövő heti tervek.",
    model: { classify: () => out({ intents: [] }) },
    expectItem: { kind: "request", status: "open" },
  },
  {
    name: "unlinked · no clear intent + hard trigger → needs_look",
    thread: "unlinked",
    body: "Ezt nézzétek meg kérlek.",
    model: { classify: () => out({ intents: [] }) },
    expectItem: { kind: "needs_look", status: "open" },
  },
  {
    name: "unlinked · ask only → question",
    thread: "unlinked",
    body: "Mennyibe kerülne egy landing oldal?",
    model: { classify: () => out({ intents: ["ask"], requests: [req("Mennyibe kerülne egy landing oldal?", { intent: "ask" })] }) },
    expectItem: { kind: "question", status: "open" },
  },
  {
    name: "unlinked · acknowledge only, no trigger → Inbox no_action",
    thread: "unlinked",
    body: "Rendben, köszönjük.",
    model: { classify: () => out({ intents: ["acknowledge"] }) },
    expectItem: null,
    expectNoAction: true,
  },
  {
    name: "linked · add → change on the task",
    thread: "linked",
    body: "És kérnénk egy story méretet is.",
    expectItem: { kind: "change", status: "open", withTask: true },
  },
  {
    name: "linked · approve with an action → change",
    thread: "linked",
    body: "Mehet élesbe!",
    model: {
      classify: () =>
        out({ intents: ["approve"], approveHasAction: { hasAction: true, action: "Élesítés" } }),
    },
    expectItem: { kind: "change", status: "open", withTask: true },
  },
  {
    name: "linked · ask only → question on the task",
    thread: "linked",
    body: "Mikorra lesz kész?",
    model: { classify: () => out({ intents: ["ask"], requests: [req("Mikorra lesz kész?", { intent: "ask" })] }) },
    expectItem: { kind: "question", status: "open", withTask: true },
  },
  {
    name: "linked, task in client_review · approve without action → approval (D32)",
    thread: "linked_client_review",
    body: "Így jó, köszönjük.",
    model: { classify: () => out({ intents: ["approve"] }) },
    expectItem: { kind: "approval", status: "open", withTask: true },
  },
  {
    name: "linked, task elsewhere · approve without action, no trigger → Inbox no_action",
    thread: "linked",
    body: "Így jó, köszönjük.",
    model: { classify: () => out({ intents: ["approve"] }) },
    expectItem: null,
    expectNoAction: true,
  },
  {
    name: "linked · acknowledge (model), no trigger → Inbox no_action",
    thread: "linked",
    body: "Rendben, köszi.",
    model: { classify: () => out({ intents: ["acknowledge"] }) },
    expectItem: null,
    expectNoAction: true,
  },
  {
    name: "any · hard trigger, nothing recognised → needs_look",
    thread: "linked",
    body: "Köszi, de még nézzük.",
    model: { classify: () => out({ intents: ["acknowledge"] }) },
    expectItem: { kind: "needs_look", status: "open", withTask: true },
  },
  {
    name: "unlinked · hard trigger, nothing recognised → needs_look",
    thread: "unlinked",
    body: "Köszi! https://figma.com/file/abc",
    model: { classify: () => out({ intents: ["acknowledge"] }) },
    expectItem: { kind: "needs_look", status: "open" },
  },
  {
    name: "unknown sender, admin mailbox · possible client → new_sender",
    thread: "unknown_admin",
    body: "Webshop arculatfrissítést szeretnénk kiszervezni.",
    model: { screen: () => ({ possibleClient: true, reason: "A brief" }) },
    expectItem: { kind: "new_sender", status: "open" },
  },
  {
    name: "unknown sender, admin mailbox · not a work request → filtered",
    thread: "unknown_admin",
    body: "Exkluzív SEO ajánlat ügynökségeknek, csak most!",
    model: { screen: () => ({ possibleClient: false, reason: "Sales pitch to the agency" }) },
    expectItem: { kind: "new_sender", status: "filtered" },
  },
  {
    name: "unknown sender, member mailbox → nothing",
    thread: "unknown_member",
    body: "Webshop arculatfrissítést szeretnénk kiszervezni.",
    expectItem: null,
  },
];

describe("dispatch (§5.3 table)", () => {
  it.each(DISPATCH_CASES)("$name", async (c) => {
    const t = createT();
    const f = await setup(t);
    setModel(c.model);
    if (c.thread === "linked_client_review") {
      await t.run((ctx) => ctx.db.patch(f.task, { statusId: f.statuses["Client review"] }));
    }
    const unknown = c.thread === "unknown_admin" || c.thread === "unknown_member";
    const thread = await newThread(t, f, {
      client: !unknown,
      mailbox: c.thread === "unknown_member" ? f.memberMailbox : f.adminMailbox,
      linkTask: c.thread.startsWith("linked") ? f.task : undefined,
    });
    const msg = await addMessage(t, thread, c.body, unknown ? { from: "judit@zoldkert.hu" } : {});
    await processMessage(t, msg);

    expect((await getMessage(t, msg))?.stage).toBe("handled");
    const s = await snapshot(t, thread);
    if (c.expectItem) {
      expect(s.items).toHaveLength(1);
      expect(s.items[0]).toMatchObject({ kind: c.expectItem.kind, status: c.expectItem.status, messageIds: [msg] });
      expect(s.items[0].taskId).toBe(c.expectItem.withTask ? f.task : undefined);
    } else {
      expect(s.items).toHaveLength(0);
    }
    // Inbox: `no_action` rows, and a `change` row linking to its item (§5.3 "Inbox informs").
    const expectedSubtype = c.expectNoAction ? "no_action" : c.expectItem?.kind === "change" ? "change" : null;
    expect([...new Set(s.notifications.map((n) => n.subtype))]).toEqual(expectedSubtype ? [expectedSubtype] : []);
    if (expectedSubtype === "change") {
      expect(s.notifications).toHaveLength(2); // both admins
      expect(s.notifications[0].subject).toEqual({ type: "agentItem", id: s.items[0]._id });
      const rows = await t.withIdentity(ADMIN).query(api.email.inbox.listEmailEvents, {});
      expect(rows[0]).toMatchObject({ subtype: "change", href: `/triage?item=${s.items[0]._id}` });
    }
    if (c.expectNoAction) {
      expect(s.notifications[0]).toMatchObject({ subtype: "no_action" });
      expect(s.thread?.waitingOn).toBe("none");
    }
    // The screen runs only for an unknown sender in an admin's mailbox.
    expect(calls.screen).toBe(c.thread === "unknown_admin" ? 1 : 0);
    if (c.thread === "unknown_admin" && c.expectItem?.status === "filtered") expect(calls.classify).toBe(0);
  });

  it("a subject identifier of the same client links the thread (§5.2 step 6)", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["ask"], requests: [req("Mikorra lesz kész?", { intent: "ask" })] }) });
    const identifier = (await t.run((ctx) => ctx.db.get(f.task)))!.identifier;
    const thread = await newThread(t, f, { subject: `Re: [${identifier}] Black Friday bannerek` });
    const msg = await addMessage(t, thread, "Mikorra lesz kész?");
    await processMessage(t, msg);
    expect((await snapshot(t, thread)).items[0]).toMatchObject({ kind: "question", taskId: f.task });
  });

  it("I13: a new message joins the open item, wakes it from snooze and marks it for re-plan (D25, D27)", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["ask"], requests: [req("Mikorra lesz kész?", { intent: "ask" })] }) });
    const thread = await newThread(t, f);
    const m1 = await addMessage(t, thread, "Mikorra lesz kész?");
    await processMessage(t, m1);
    const [item] = (await snapshot(t, thread)).items;
    expect(item).toMatchObject({ kind: "question", status: "open" });
    expect(item.needsReplanSince).toBeUndefined();

    const { snoozedUntil } = await t.withIdentity(ADMIN).mutation(api.agentItems.snoozeItem, {
      itemId: item._id, preset: "next_monday",
    });
    expect(snoozedUntil).toBeGreaterThan(Date.now());
    expect(await t.run((ctx) => ctx.db.get(item._id))).toMatchObject({ status: "snoozed", snoozedUntil });

    setModel({ classify: () => out({ intents: ["add"], requests: [req("És kérnénk egy bannert is.")] }) });
    const m2 = await addMessage(t, thread, "És kérnénk egy bannert is.");
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: m2 });
    // Run only the pipeline (not the scheduled wake): the message itself wakes the item.
    await settle(t, { horizonMs: 5 * 60_000 });
    const s = await snapshot(t, thread);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({
      _id: item._id, status: "open", kind: "request", messageIds: [m1, m2],
    });
    expect(s.items[0].snoozedUntil).toBeUndefined();
    expect(s.items[0].needsReplanSince).toEqual(expect.any(Number));
    // The stale scheduled wake is a no-op.
    await settle(t);
    expect(await t.run((ctx) => ctx.db.get(item._id))).toMatchObject({ status: "open" });
  });

  it.each([
    ["rules thank-you → quiet join", "Köszönjük!", undefined, true],
    ["model acknowledge → normal join", "Rendben, köszi.", { classify: () => out({ intents: ["acknowledge"] }) }, false],
  ] as const)("acknowledge joining a snoozed item: %s", async (_name, body, model, quiet) => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["ask"], requests: [req("Mikorra lesz kész?", { intent: "ask" })] }) });
    const thread = await newThread(t, f);
    const m1 = await addMessage(t, thread, "Mikorra lesz kész?");
    await processMessage(t, m1);
    const [item] = (await snapshot(t, thread)).items;
    const { snoozedUntil } = await t.withIdentity(ADMIN).mutation(api.agentItems.snoozeItem, {
      itemId: item._id, preset: "next_monday",
    });

    setModel(model as Handlers | undefined);
    const m2 = await addMessage(t, thread, body);
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: m2 });
    await settle(t, { horizonMs: 5 * 60_000 });
    const s = await snapshot(t, thread);
    expect((await getMessage(t, m2))?.classification?.source).toBe(quiet ? "rules" : "model");
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ messageIds: [m1, m2], messageCount: 2, kind: "question" });
    if (quiet) {
      // Rules-decided thank-you: appended only — still snoozed, no re-plan.
      expect(s.items[0]).toMatchObject({ status: "snoozed", snoozedUntil });
      expect(s.items[0].needsReplanSince).toBeUndefined();
    } else {
      // A model "acknowledge" is a judgement call: wake + re-plan like any message.
      expect(s.items[0].status).toBe("open");
      expect(s.items[0].needsReplanSince).toEqual(expect.any(Number));
    }
    expect(s.notifications).toHaveLength(0); // joined: no separate Inbox row
  });

  it("decline dismisses the open ledger rows; a later email opens a new item (D28)", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert."), req("Kérnénk egy hírlevelet.")] }) });
    const thread = await newThread(t, f);
    const m1 = await addMessage(t, thread, "Kérnénk egy bannert. Kérnénk egy hírlevelet.");
    await processMessage(t, m1);
    const [item] = (await snapshot(t, thread)).items;

    await expect(t.withIdentity(MEMBER).mutation(api.email.triage.declineItem, { itemId: item._id })).rejects.toThrow(
      "Admin access required",
    );
    expect(await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: item._id })).toEqual({ dismissed: 2 });
    let s = await snapshot(t, thread);
    expect(s.items[0]).toMatchObject({ status: "done", outcome: "declined", decidedBy: f.admin });
    expect(s.requests.map((r) => [r.disposition, r.dismissedReason])).toEqual([
      ["dismissed", "declined"], ["dismissed", "declined"],
    ]);

    const m2 = await addMessage(t, thread, "Kérnénk egy bannert.");
    await processMessage(t, m2);
    s = await snapshot(t, thread);
    expect(s.items.map((i) => i.status).sort()).toEqual(["done", "open"]);
  });
});

// ─── Item actions ────────────────────────────────────────────────────────────

describe("item actions (admin-only, org-checked)", () => {
  async function openRequestItem(t: T, f: Fixture) {
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert.")] }) });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy bannert.");
    await processMessage(t, msg);
    return (await snapshot(t, thread)).items[0];
  }

  it("snooze presets, manual wake, mark done; members and other orgs are refused", async () => {
    const t = createT();
    const f = await setup(t);
    const item = await openRequestItem(t, f);

    await expect(
      t.withIdentity(MEMBER).mutation(api.agentItems.snoozeItem, { itemId: item._id, preset: "tomorrow" }),
    ).rejects.toThrow("Admin access required");
    await expect(
      t.withIdentity({ ...ADMIN, orgId: OFF }).mutation(api.agentItems.markItemDone, { itemId: item._id, outcome: "kept" }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity(ADMIN).mutation(api.agentItems.snoozeItem, { itemId: item._id, preset: "date", date: "2020-01-01" }),
    ).rejects.toThrow("Snooze until a time in the future");

    await t.withIdentity(ADMIN).mutation(api.agentItems.snoozeItem, { itemId: item._id, preset: "tomorrow" });
    await t.withIdentity(ADMIN).mutation(api.agentItems.wakeItem, { itemId: item._id });
    const woken = await t.run((ctx) => ctx.db.get(item._id));
    expect([woken?.status, woken?.snoozedUntil]).toEqual(["open", undefined]);

    await expect(
      t.withIdentity(ADMIN).mutation(api.agentItems.markItemDone, { itemId: item._id, outcome: "declined" }),
    ).rejects.toThrow("Use Decline");
    await t.withIdentity(ADMIN).mutation(api.agentItems.markItemDone, { itemId: item._id, outcome: "marked_done" });
    expect(await t.run((ctx) => ctx.db.get(item._id))).toMatchObject({
      status: "done", outcome: "marked_done", decidedBy: f.admin,
    });
  });

  it("a scheduled snooze wakes the item at its time", async () => {
    const t = createT();
    const f = await setup(t);
    const item = await openRequestItem(t, f);
    await t.withIdentity(ADMIN).mutation(api.agentItems.snoozeItem, { itemId: item._id, preset: "tomorrow" });
    await settle(t);
    const woken = await t.run((ctx) => ctx.db.get(item._id));
    expect([woken?.status, woken?.snoozedUntil]).toEqual(["open", undefined]);
  });
});

// ─── Ledger helpers for B6 ───────────────────────────────────────────────────

describe("ledger dispositions (internal, for B6)", () => {
  it("cover / answer / dismiss (reason required) / supersede — same org and conversation only", async () => {
    const t = createT();
    const f = await setup(t);
    const thread = await newThread(t, f);
    const other = await newThread(t, f, { subject: "Other" });
    const [a, b, c, d, x] = await t.run(async (ctx) => {
      const mk = (threadId: Id<"emailThreads">, text: string) =>
        ctx.db.insert("clientRequests", {
          orgId: ORG, threadId, text, disposition: "open", createdAt: Date.now(), updatedAt: Date.now(),
        });
      return [await mk(thread, "a"), await mk(thread, "b"), await mk(thread, "c"), await mk(thread, "d"), await mk(other, "x")];
    });

    await t.mutation(internal.email.requests.cover, { orgId: ORG, requestIds: [a], taskId: f.task });
    await t.mutation(internal.email.requests.answer, { orgId: ORG, requestIds: [b] });
    await expect(t.mutation(internal.email.requests.dismiss, { orgId: ORG, requestId: c, reason: "  " })).rejects.toThrow(
      "needs a reason",
    );
    await t.mutation(internal.email.requests.dismiss, { orgId: ORG, requestId: c, reason: "duplicate" });
    await expect(
      t.mutation(internal.email.requests.supersede, { orgId: ORG, requestId: d, supersededBy: x }),
    ).rejects.toThrow("same conversation");
    await t.mutation(internal.email.requests.supersede, { orgId: ORG, requestId: d, supersededBy: b });
    await expect(t.mutation(internal.email.requests.answer, { orgId: OFF, requestIds: [b] })).rejects.toThrow(
      "Request not found",
    );
    await expect(t.mutation(internal.email.requests.answer, { orgId: ORG, requestIds: [c] })).rejects.toThrow(
      "already dismissed",
    );

    const rows = await t.run(async (ctx) => Promise.all([a, b, c, d].map((id) => ctx.db.get(id))));
    expect(rows.map((r) => r?.disposition)).toEqual(["covered", "answered", "dismissed", "superseded"]);
    expect(rows[0]).toMatchObject({ taskId: f.task });
    expect(rows[2]).toMatchObject({ dismissedReason: "duplicate" });
    expect(rows[3]).toMatchObject({ supersededBy: b });
  });
});

// ─── I14 ─────────────────────────────────────────────────────────────────────

describe("I14: an org without emailTriageEnabled", () => {
  it("processes nothing and sees nothing", async () => {
    const t = createT();
    const f = await setup(t, { enabled: false });
    setModel();
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy bannert.");
    await expect(t.mutation(internal.email.pipeline.processInboundMessage, { messageId: msg })).rejects.toThrow(
      EMAIL_TRIAGE_DISABLED_MESSAGE,
    );
    await expect(t.mutation(internal.email.pipeline.retryStage, { messageId: msg })).rejects.toThrow(
      EMAIL_TRIAGE_DISABLED_MESSAGE,
    );
    await t.action(internal.email.classify.classifyMessage, { messageId: msg, attempt: 1 });
    await settle(t);
    const untouched = await getMessage(t, msg);
    expect([untouched?.stage, untouched?.classification]).toEqual(["received", undefined]);
    const s = await snapshot(t);
    expect([s.items.length, s.requests.length, s.notifications.length, calls.classify]).toEqual([0, 0, 0, 0]);
    expect(await t.withIdentity(ADMIN).query(api.email.inbox.listEmailEvents, {})).toEqual([]);
  });
});

// ─── Stuck-stage sweep (cron) ────────────────────────────────────────────────

describe("sweepStuckMessages (every 10 min)", () => {
  it("re-kicks stuck inbound messages once; stuck outbound → handled; seed rows stamped; flag-off untouched", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert.")] }) });
    const old = Date.now() - 31 * 60_000;
    const stuckExtracted = await addMessage(t, await newThread(t, f), "Kérnénk egy bannert.");
    const legacyReceived = await addMessage(t, await newThread(t, f), "Kérnénk egy bannert.");
    const recent = await addMessage(t, await newThread(t, f), "Kérnénk egy bannert.");
    const failed = await addMessage(t, await newThread(t, f), "Kérnénk egy bannert.");
    const outbound = await addMessage(t, await newThread(t, f), "Szia Réka, csatolom.", { direction: "outbound" });
    const offOrg = await addMessage(t, await newThread(t, f, { orgId: OFF }), "Kérnénk egy bannert.");
    const seedMailbox = await t.run((ctx) =>
      ctx.db.insert("connectors", {
        orgId: ORG, userId: f.admin2, type: "gmail", status: "revoked", devSeed: true, scopes: [], connectedAt: 0, updatedAt: 0,
      }),
    );
    const seeded = await addMessage(t, await newThread(t, f, { mailbox: seedMailbox }), "Kérnénk egy bannert.");
    await t.run(async (ctx) => {
      await ctx.db.patch(stuckExtracted, { stage: "extracted", stageAt: old });
      await ctx.db.patch(legacyReceived, { createdAt: old }); // no stageAt: judged by createdAt
      await ctx.db.patch(recent, { stage: "extracted", stageAt: Date.now() - 60_000 });
      await ctx.db.patch(failed, { stage: "failed", stageAt: old });
      await ctx.db.patch(outbound, { stageAt: old });
      await ctx.db.patch(offOrg, { stageAt: old });
      await ctx.db.patch(seeded, { stageAt: old });
    });

    expect(await t.mutation(internal.email.pipeline.sweepStuckMessages, {})).toEqual({ touched: 4, rescheduled: 2 });
    // Every touched row left the window (stamped / handled): the next sweep finds nothing.
    expect(await t.mutation(internal.email.pipeline.sweepStuckMessages, {})).toEqual({ touched: 0, rescheduled: 0 });
    await settle(t, { horizonMs: 5 * 60_000 });

    const rows = await t.run(async (ctx) =>
      Promise.all([stuckExtracted, legacyReceived, recent, failed, outbound, offOrg, seeded].map((id) => ctx.db.get(id))),
    );
    expect(rows.map((m) => m?.stage)).toEqual(["handled", "handled", "extracted", "failed", "handled", "received", "received"]);
    expect(rows[6]!.stageAt).toBeGreaterThan(old); // seed row stamped, not processed
    expect(rows[5]!.stageAt).toBe(old); // flag-off org never read
    expect((await snapshot(t)).items).toHaveLength(2);
  });
});

// ─── Gate review (B4) ────────────────────────────────────────────────────────

describe("attentions: several failed messages on one conversation", () => {
  it("each failure is its own entry; Retry clears only its own; Done and Decline wait for all", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => new Error("provider down") });
    const thread = await newThread(t, f);
    const m1 = await addMessage(t, thread, "Kérnénk egy bannert.");
    await processMessage(t, m1);
    const m2 = await addMessage(t, thread, "Kérnénk egy hírlevelet.");
    await processMessage(t, m2);
    let [item] = (await snapshot(t, thread)).items;
    expect(item.kind).toBe("attention");
    expect(item.attentions?.map((a) => a.messageId)).toEqual([m1, m2]);

    for (const call of [
      () => t.withIdentity(ADMIN).mutation(api.agentItems.markItemDone, { itemId: item._id, outcome: "marked_done" }),
      () => t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: item._id }),
    ]) {
      await expect(call()).rejects.toThrow("could not be processed — Retry it first");
    }

    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert.")] }) });
    await t.mutation(internal.email.pipeline.retryStage, { messageId: m1 });
    await settle(t);
    [item] = (await snapshot(t, thread)).items;
    expect(item.attentions?.map((a) => a.messageId)).toEqual([m2]); // m2 still open
    expect(item.kind).toBe("request"); // m1's real decision; m2's failure still blocks closing
    await expect(
      t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: item._id }),
    ).rejects.toThrow("Retry it first");

    await t.mutation(internal.email.pipeline.retryStage, { messageId: m2 });
    await settle(t);
    [item] = (await snapshot(t, thread)).items;
    expect(item.attentions).toBeUndefined();
    expect(item.kind).toBe("request");
    expect(await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: item._id })).toEqual({ dismissed: 2 });
  });

  it("an attention-only item closes as not_a_change when the retried message needs no action", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => new Error("provider down") });
    const thread = await newThread(t, f, { linkTask: f.task });
    const msg = await addMessage(t, thread, "Rendben, köszi.");
    await processMessage(t, msg);
    setModel({ classify: () => out({ intents: ["acknowledge"], reasons: ["Only thanks"] }) });
    await t.mutation(internal.email.pipeline.retryStage, { messageId: msg });
    await settle(t);
    const s = await snapshot(t, thread);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "attention", status: "done", outcome: "not_a_change" });
    expect(s.items[0].decidedBy).toBeUndefined();
    expect(s.notifications.map((n) => n.subtype)).toEqual(["no_action", "no_action"]); // still informs
  });

  it("an attention-only item closes when the retried message turns out to be a duplicate copy", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => new Error("provider down") });
    const b = await newThread(t, f, { mailbox: f.memberMailbox });
    const copy = await addMessage(t, b, "Kérnénk egy bannert.", { rfc: "<dup@pragmatico.hu>" });
    await processMessage(t, copy);
    // Meanwhile the admin's copy goes through.
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk egy bannert.")] }) });
    const a = await newThread(t, f);
    await processMessage(t, await addMessage(t, a, "Kérnénk egy bannert.", { rfc: "<dup@pragmatico.hu>" }));
    await t.mutation(internal.email.pipeline.retryStage, { messageId: copy });
    await settle(t);
    expect((await snapshot(t, b)).items[0]).toMatchObject({ kind: "attention", status: "done", outcome: "not_a_change" });
    expect((await snapshot(t, a)).items[0]).toMatchObject({ kind: "request", status: "open" });
  });
});

describe("watchdog generations", () => {
  it("a watchdog or late report from before a Retry is ignored", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => new Error("provider down") });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk egy bannert.");
    await processMessage(t, msg);
    expect((await getMessage(t, msg))?.stage).toBe("failed");

    await t.mutation(internal.email.pipeline.retryStage, { messageId: msg });
    // Retry made generation 1; the new attempt 1 is pending (the action is not run yet).
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: msg });
    expect(await getMessage(t, msg)).toMatchObject({ stage: "extracted", stageGeneration: 1 });
    for (const stale of [
      () => t.mutation(internal.email.pipeline.stageWatchdog, { messageId: msg, stage: "extracted", attempt: 1, generation: 0 }),
      () => t.mutation(internal.email.pipeline.stageWatchdog, { messageId: msg, stage: "extracted", attempt: 1 }),
      () => t.mutation(internal.email.pipeline.recordStageFailure, { messageId: msg, stage: "extracted", attempt: 1, generation: 0, error: "late" }),
    ]) {
      await stale();
    }
    const after = await getMessage(t, msg);
    expect(after?.stageError).toBeUndefined(); // nothing counted
    const late = await t.mutation(internal.email.pipeline.applyClassification, {
      messageId: msg, generation: 0,
      result: { intents: ["add"], reasons: [], urgent: false, source: "model", requests: [{ text: "x", constraints: [], intent: "add" }] },
    });
    expect(late).toEqual({ applied: false });
    // The current generation's report counts.
    await t.mutation(internal.email.pipeline.recordStageFailure, { messageId: msg, stage: "extracted", attempt: 1, generation: 1, error: "now" });
    expect((await getMessage(t, msg))?.stageError).toMatchObject({ attempts: 1, message: "now" });
  });
});

describe("filtered mail on a live conversation (D25)", () => {
  it("joins the live item instead of opening a Filtered item", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ screen: () => ({ possibleClient: true, reason: "A brief" }) });
    const thread = await newThread(t, f, { client: false });
    const m1 = await addMessage(t, thread, "Webshop arculatfrissítést szeretnénk.", { from: "judit@zoldkert.hu" });
    await processMessage(t, m1);
    setModel({ screen: () => ({ possibleClient: false, reason: "Out of office" }) });
    const m2 = await addMessage(t, thread, "Szabadságon vagyok jövő hétig.", { from: "judit@zoldkert.hu" });
    await processMessage(t, m2);
    const s = await snapshot(t, thread);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "new_sender", status: "open", messageIds: [m1, m2] });
  });
});

describe("ledger snapshot within one message", () => {
  it("replace then cancel on the same row, and two replaces, stay consistent", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk 20% kedvezményt.")] }) });
    const thread = await newThread(t, f);
    await processMessage(t, await addMessage(t, thread, "Kérnénk 20% kedvezményt."));
    setModel({
      classify: (input) => {
        const id = input.ledger[0].id;
        return out({
          intents: ["replace", "cancel"],
          requests: [
            req("Mégis 15% legyen.", { intent: "replace", refersToRequestId: id }),
            req("Mégis 10% legyen.", { intent: "replace", refersToRequestId: id }),
            req("Az egész mégsem kell.", { intent: "cancel", refersToRequestId: id }),
          ],
        });
      },
    });
    await processMessage(t, await addMessage(t, thread, "Mégis 15% legyen. Mégis 10% legyen. Az egész mégsem kell."));
    const rows = (await snapshot(t, thread)).requests;
    const byText = (n: string) => rows.find((r) => r.text.includes(n))!;
    // The first replace wins the original; the second replace and the cancel
    // see it superseded and do not transition it again.
    expect(byText("20%")).toMatchObject({ disposition: "superseded", supersededBy: byText("15%")._id });
    expect(byText("20%").dismissedReason).toBeUndefined();
    expect(byText("15%").disposition).toBe("open");
    expect(byText("10%").disposition).toBe("open");
  });
});

describe("constraint check reads attachment text", () => {
  it("a value found only in an extracted attachment is not flagged", async () => {
    const t = createT();
    const f = await setup(t);
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["brief"], { type: "text/plain" })));
    await t.run((ctx) =>
      ctx.db.insert("attachmentContents", {
        orgId: ORG, storageId, mimeType: "text/plain", status: "done", text: "Méret: 1200×628, határidő: okt. 30.",
        attempts: 1, createdAt: Date.now(), extractedAt: Date.now(),
      }),
    );
    setModel({
      classify: () =>
        out({
          intents: ["add"],
          requests: [req("Banner a csatolt brief szerint", {
            constraints: [{ kind: "size", value: "1200×628" }, { kind: "size", value: "300x250" }],
          })],
        }),
    });
    const thread = await newThread(t, f);
    await processMessage(
      t,
      await addMessage(t, thread, "Kérnénk egy bannert a csatolt brief szerint.", {
        attachments: [{ name: "brief.txt", mime: "text/plain", size: 5, storageId }],
      }),
    );
    const [row] = (await snapshot(t, thread)).requests;
    expect(row.warnings).toEqual([{ kind: "constraint_not_verbatim", detail: "size: 300x250" }]);
  });
});

describe("forwards (deterministic layer)", () => {
  it("\"Köszi!\" above an Outlook forward is never a rules acknowledge; the forwarded request stays", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ classify: () => out({ intents: ["add"], requests: [req("Kérnénk az árlistát frissíteni.")] }) });
    const thread = await newThread(t, f, { subject: "FW: Árlista" });
    const raw = [
      "Köszi!",
      "",
      "________________________________",
      "Feladó: Nagy Gábor <gabor@pragmatico.hu>",
      "Elküldve: 2026. október 15., csütörtök 10:02",
      "Címzett: Kovács Réka <reka@pragmatico.hu>",
      "Tárgy: Árlista",
      "",
      "Kérnénk az árlistát frissíteni.",
    ].join("\n");
    const msg = await t.run(async (ctx) => {
      const thr = (await ctx.db.get(thread))!;
      return await ctx.db.insert("emailMessages", {
        orgId: ORG, threadId: thread, connectorId: thr.connectorId, gmailMessageId: "fw-1", rfcMessageId: "<fw-1@test>",
        direction: "inbound", from: { email: "reka@pragmatico.hu" }, to: [], cc: [], subject: "FW: Árlista",
        bodyText: "", bodyHtml: raw.replace(/\n/g, "<br>"), attachments: [], sentAt: Date.now(), stage: "received",
        createdAt: Date.now(),
      });
    });
    await processMessage(t, msg);
    const m = await getMessage(t, msg);
    expect(m?.bodyText).toContain("Kérnénk az árlistát frissíteni.");
    expect(m?.classification?.source).toBe("model");
    expect(m?.classification?.triggers).toEqual(expect.arrayContaining(["forward", "word:kérnénk"]));
    expect(calls.classify).toBe(1);
  });
});

describe("listEmailEvents", () => {
  it("is empty for a non-admin (orgMembers role), even with rows addressed to them", async () => {
    const t = createT();
    const f = await setup(t);
    const thread = await newThread(t, f, { linkTask: f.task });
    await processMessage(t, await addMessage(t, thread, "Köszönjük!"));
    // A row addressed to the member (e.g. a future subtype) …
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("notifications").collect())[0];
      const { _id, _creationTime, ...rest } = row;
      void _id; void _creationTime;
      await ctx.db.insert("notifications", { ...rest, recipientId: f.member });
    });
    expect(await t.withIdentity(MEMBER).query(api.email.inbox.listEmailEvents, {})).toEqual([]);
    // … and a JWT claiming admin does not help a member either.
    expect(await t.withIdentity({ ...MEMBER, orgRole: "org:admin" }).query(api.email.inbox.listEmailEvents, {})).toEqual([]);
    expect(await t.withIdentity(ADMIN).query(api.email.inbox.listEmailEvents, {})).toHaveLength(1);
  });
});

// ─── Filtered retention (D24) ────────────────────────────────────────────────

describe("purgeFiltered (daily cron)", () => {
  async function seedFiltered(t: T, f: Fixture, orgId: string, updatedAt: number, opts: { client?: boolean } = {}) {
    const thread = await newThread(t, f, { client: opts.client ?? false, orgId });
    const msg = await addMessage(t, thread, "Exkluzív ajánlat!", { from: "sales@spam.test" });
    const item = await t.run((ctx) =>
      ctx.db.insert("agentItems", {
        orgId, source: "email", anchor: { type: "emailThread", id: thread }, kind: "new_sender", status: "filtered",
        messageIds: [msg], createdAt: updatedAt, updatedAt,
      }),
    );
    return { thread, msg, item };
  }
  const drain = async (t: T) => {
    await t.mutation(internal.email.triage.purgeFiltered, {});
    await settle(t);
  };

  it("deletes purely filtered conversations after 30 days, in flagged orgs only", async () => {
    const t = createT();
    const f = await setup(t);
    const old = Date.now() - FILTERED_RETENTION_MS - 60_000;
    const expired = await seedFiltered(t, f, ORG, old);
    const recent = await seedFiltered(t, f, ORG, Date.now());
    const otherOrg = await seedFiltered(t, f, OFF, old);
    await drain(t);
    const gone = await t.run(async (ctx) => ({
      expired: [await ctx.db.get(expired.item), await ctx.db.get(expired.msg), await ctx.db.get(expired.thread)],
      recent: [await ctx.db.get(recent.item), await ctx.db.get(recent.msg)],
      otherOrg: [await ctx.db.get(otherOrg.item), await ctx.db.get(otherOrg.msg)],
    }));
    expect(gone.expired).toEqual([null, null, null]);
    expect(gone.recent.every(Boolean)).toBe(true);
    expect(gone.otherOrg.every(Boolean)).toBe(true);
  });

  it("never deletes a message whose thread has a client or a non-filtered item", async () => {
    const t = createT();
    const f = await setup(t);
    const old = Date.now() - FILTERED_RETENTION_MS - 60_000;
    const known = await seedFiltered(t, f, ORG, old, { client: true });
    const live = await seedFiltered(t, f, ORG, old);
    await t.run((ctx) =>
      ctx.db.insert("agentItems", {
        orgId: ORG, source: "email", anchor: { type: "emailThread", id: live.thread }, kind: "new_sender", status: "open",
        createdAt: Date.now(), updatedAt: Date.now(),
      }),
    );
    await drain(t);
    const rows = await t.run(async (ctx) => ({
      knownMsg: await ctx.db.get(known.msg), knownItem: await ctx.db.get(known.item), knownThread: await ctx.db.get(known.thread),
      liveMsg: await ctx.db.get(live.msg), liveItem: await ctx.db.get(live.item), liveThread: await ctx.db.get(live.thread),
    }));
    // The expired filtered items go; every message and thread stays.
    expect([rows.knownItem, rows.liveItem]).toEqual([null, null]);
    expect([rows.knownMsg, rows.knownThread, rows.liveMsg, rows.liveThread].every(Boolean)).toBe(true);
  });

  it("works one org per run within a message / file budget and continues itself", async () => {
    const t = createT();
    const f = await setup(t);
    const old = Date.now() - FILTERED_RETENTION_MS - 60_000;
    // One conversation with more messages than one run's budget.
    const big = await seedFiltered(t, f, ORG, old);
    await t.run(async (ctx) => {
      const base = (await ctx.db.get(big.msg))!;
      const { _id, _creationTime, ...rest } = base;
      void _id; void _creationTime;
      for (let i = 0; i < PURGE_MESSAGE_BUDGET + 20; i++) {
        await ctx.db.insert("emailMessages", { ...rest, gmailMessageId: `bulk-${i}`, rfcMessageId: `<bulk-${i}@spam.test>` });
      }
    });
    const first = await t.mutation(internal.email.triage.purgeFiltered, {});
    expect(first).toMatchObject({ messages: PURGE_MESSAGE_BUDGET, threads: 0, continued: true });
    await settle(t);
    const left = await t.run(async (ctx) => ({
      messages: (await ctx.db.query("emailMessages").collect()).filter((m) => m.threadId === big.thread).length,
      thread: await ctx.db.get(big.thread),
    }));
    expect(left).toEqual({ messages: 0, thread: null });
  });
});
