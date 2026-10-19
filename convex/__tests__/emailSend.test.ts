// @vitest-environment edge-runtime
//
// Email triage B5 (docs/prd-email-triage.md §5.4, §6.7, D8, D9, D35, I2,
// I4, I8, I9, I12, §5.5, §8 sending scenarios): drafts, approve → queued
// (15 s undo) → dispatching → sent / failed / unknown, against a FAKE Gmail
// transport (`send.setGmailTransportForTesting`). Real token path: the
// connectors hold encrypted test grants (fixed KEK), so `getGmailAccessToken`
// runs for real; only the HTTP calls to Gmail are faked.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { MockLanguageModelV3 } from "ai/test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { __resetSecretCryptoCacheForTests, encryptSecret } from "../lib/secretCrypto";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { insertProposalsForThread } from "../agentProposals";
import {
  failSentEffectsForTesting,
  MAILBOX_CHANGED_MESSAGE,
  setGmailTransportForTesting,
  UNKNOWN_CONFIRM_WINDOW_MS,
  UNKNOWN_NOT_FOUND_MESSAGE,
} from "../email/send";
import { SUBJECT_LOCKED_MESSAGE } from "../email/drafts";
import { fromBase64Url } from "../email/mime";
import type { ClassifyInboundOutput, ExtractPromisesOutput } from "../email/jobs";

// ─── Fake model (B4 classify for the stale wiring, extractPromises) ──────────

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

/* eslint-disable @typescript-eslint/no-explicit-any -- the prompt is the job's JSON input */
type Handlers = {
  classify?: (input: any) => ClassifyInboundOutput;
  promises?: (input: any) => ExtractPromisesOutput | Error;
};
/* eslint-enable @typescript-eslint/no-explicit-any */
const promiseInputs: unknown[] = [];

function setModel(h: Handlers) {
  modelSlot.current = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const system = options.prompt.find((m) => m.role === "system");
      const systemText = typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
      const user = options.prompt.find((m) => m.role === "user");
      const input = JSON.parse(user && Array.isArray(user.content) && user.content[0]?.type === "text" ? user.content[0].text : "{}");
      let result: unknown;
      if (systemText.includes("You extract the dated commitments")) {
        promiseInputs.push(input);
        result = (h.promises ?? (() => ({ promises: [] })))(input);
      } else if (systemText.includes("You classify ONE inbound client email")) {
        result = (h.classify ?? (() => ({ intents: ["add"], requests: [], approveHasAction: { hasAction: false, action: null }, reasons: ["r"], urgent: false })))(input);
      } else if (systemText.includes("You double-check a request ledger")) {
        result = { missing: [] };
      } else {
        result = { possibleClient: true, reason: "x" };
      }
      if (result instanceof Error) throw result;
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        warnings: [],
      };
    },
  });
}

// ─── Fake Gmail ──────────────────────────────────────────────────────────────

type Step = "ok" | "network" | "acceptThenNetwork" | { status: number; body?: unknown };
type FakeGmail = {
  sends: Array<{ raw: string; threadId?: string; messageId: string; message: string }>;
  searches: string[];
  plan: Step[];
  /** What Gmail actually holds: Message-ID → ids. */
  mailbox: Map<string, { id: string; threadId: string }>;
  searchFails: boolean;
};
let gmail: FakeGmail;
let gmailSeq = 0;

function installFakeGmail() {
  gmail = { sends: [], searches: [], plan: [], mailbox: new Map(), searchFails: false };
  setGmailTransportForTesting(async (url, init) => {
    if (url.endsWith("/users/me/messages/send")) {
      const body = JSON.parse(String(init.body)) as { raw: string; threadId?: string };
      const message = fromBase64Url(body.raw);
      const messageId = /^Message-ID: (<[^>]+>)/m.exec(message)![1];
      gmail.sends.push({ ...body, messageId, message });
      const step = gmail.plan.shift() ?? "ok";
      if (step === "network") throw new TypeError("fetch failed");
      if (step === "ok" || step === "acceptThenNetwork") {
        const ref = { id: `gm-${++gmailSeq}`, threadId: body.threadId ?? `gt-new-${gmailSeq}` };
        gmail.mailbox.set(messageId, ref);
        if (step === "acceptThenNetwork") throw new TypeError("socket hang up");
        return Response.json(ref);
      }
      return Response.json(step.body ?? { error: { code: step.status, message: "error" } }, { status: step.status });
    }
    if (url.includes("/users/me/messages?q=")) {
      const q = decodeURIComponent(new URL(url).searchParams.get("q") ?? "");
      gmail.searches.push(q);
      if (gmail.searchFails) return Response.json({ error: { code: 500 } }, { status: 500 });
      const id = `<${q.replace(/^rfc822msgid:/, "")}>`;
      const hit = gmail.mailbox.get(id);
      return Response.json(hit ? { messages: [hit], resultSizeEstimate: 1 } : { resultSizeEstimate: 0 });
    }
    return Response.json({ error: { code: 404 } }, { status: 404 });
  });
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");
const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

const ORG = "org_b5";
const OFF = "org_b5_off";
const ADAM = { subject: "clerk_adam", orgId: ORG, orgRole: "org:admin" };
const BENCE = { subject: "clerk_bence", orgId: ORG, orgRole: "org:admin" };
const MARI = { subject: "clerk_mari", orgId: ORG, orgRole: "org:member" };
const CAROL = { subject: "clerk_carol", orgId: OFF, orgRole: "org:admin" };
const KEK = (() => {
  let s = "";
  for (let i = 0; i < 32; i++) s += String.fromCharCode((i * 11 + 3) % 256);
  return btoa(s);
})();
// Friday 2026-10-16 10:00 Budapest (08:00 UTC).
const FRIDAY_10 = Date.UTC(2026, 9, 16, 8, 0, 0);

let savedKek: string | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FRIDAY_10);
  savedKek = process.env.AI_KEY_ENCRYPTION_KEK;
  process.env.AI_KEY_ENCRYPTION_KEK = KEK;
  __resetSecretCryptoCacheForTests();
  modelSlot.current = null;
  promiseInputs.length = 0;
  installFakeGmail();
});
afterEach(() => {
  setGmailTransportForTesting(null);
  failSentEffectsForTesting([]);
  if (savedKek === undefined) delete process.env.AI_KEY_ENCRYPTION_KEK;
  else process.env.AI_KEY_ENCRYPTION_KEK = savedKek;
  __resetSecretCryptoCacheForTests();
  vi.useRealTimers();
});

type Fixture = {
  adam: Id<"users">;
  bence: Id<"users">;
  mari: Id<"users">;
  client: Id<"clients">;
  task: Id<"tasks">;
  otherTask: Id<"tasks">;
  statuses: Record<string, Id<"statuses">>;
  adamBox: Id<"connectors">;
  benceBox: Id<"connectors">;
  mariBox: Id<"connectors">;
  seedBox: Id<"connectors">;
  thread: Id<"emailThreads">;
  item: Id<"agentItems">;
  r1: Id<"clientRequests">;
  r2: Id<"clientRequests">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string, email: string, orgId: string, role: "admin" | "member") => {
      const id = await ctx.db.insert("users", { name, externalId, email, createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId, clerkUserId: externalId, userId: id, role, joinedAt: now });
      return id;
    };
    const adam = await mkUser("Tóth Ádám", "clerk_adam", "adam@agency.test", ORG, "admin");
    const bence = await mkUser("Kiss Bence", "clerk_bence", "bence@agency.test", ORG, "admin");
    const mari = await mkUser("Varga Mari", "clerk_mari", "mari@agency.test", ORG, "member");
    const carol = await mkUser("Carol", "clerk_carol", "carol@other.test", OFF, "admin");
    for (const [orgId, enabled, by] of [[ORG, true, adam], [OFF, false, carol]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: "Europe/Budapest", roundingMinutes: 15,
        emailTriageEnabled: enabled, agentActorUserId: orgId === ORG ? adam : undefined,
        createdAt: now, updatedAt: now, createdBy: by,
      });
    }
    const statuses: Record<string, Id<"statuses">> = {};
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      statuses[s.name] = await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, workflowRole: s.workflowRole, createdAt: now, updatedAt: now, createdBy: adam,
      });
    }
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico", currency: "HUF", emailDomains: ["pragmatico.hu"],
      replyCcEmails: ["gabor@pragmatico.hu"], createdAt: now, updatedAt: now, createdBy: adam,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
      createdAt: now, updatedAt: now, createdBy: adam,
    });
    const adminAuth: AuthContext = { userId: adam, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(adam))! };
    const task = await createTask(
      ctx, adminAuth,
      { title: "Black Friday bannerek", projectId, assigneeIds: [mari], statusId: statuses["Admin review"] },
      { notify: false },
    );
    const otherTask = await createTask(ctx, adminAuth, { title: "Other", projectId, assigneeIds: [bence] }, { notify: false });

    const grant = await encryptSecret(
      JSON.stringify({ accessToken: "tok-test", refreshToken: "refresh", expiresAt: now + 10 * 365 * 86_400_000, scope: "gmail.send" }),
    );
    const mailbox = (userId: Id<"users">, email: string) =>
      ctx.db.insert("connectors", {
        orgId: ORG, userId, type: "gmail", status: "connected", credentialsCiphertext: grant, credentialMask: email,
        scopes: ["gmail.send"], connectedAt: now, updatedAt: now,
      });
    const adamBox = await mailbox(adam, "adam@agency.test");
    const benceBox = await mailbox(bence, "bence@agency.test");
    const mariBox = await mailbox(mari, "mari@agency.test");
    const seedBox = await ctx.db.insert("connectors", {
      orgId: ORG, userId: adam, type: "gmail", status: "revoked", devSeed: true, scopes: [], connectedAt: now, updatedAt: now,
    });

    const thread = await ctx.db.insert("emailThreads", {
      orgId: ORG, connectorId: adamBox, gmailThreadId: "gt-adam-1", subject: "Black Friday", clientId: client,
      participants: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }], lastMessageAt: now - 60_000,
      lastInboundAt: now - 60_000, waitingOn: "us", createdAt: now, updatedAt: now,
    });
    const m1 = await ctx.db.insert("emailMessages", {
      orgId: ORG, threadId: thread, connectorId: adamBox, gmailMessageId: "g-in-1", rfcMessageId: "<m1@pragmatico.hu>",
      direction: "inbound", from: { name: "Kovács Réka", email: "reka@pragmatico.hu" }, to: [{ email: "adam@agency.test" }],
      cc: [], subject: "Black Friday", bodyText: "Kérnénk két bannert. A 20% kedvezményt is írjátok rá.", attachments: [],
      sentAt: now - 60_000, stage: "handled", createdAt: now,
    });
    await ctx.db.insert("emailThreadTasks", { orgId: ORG, threadId: thread, taskId: task, role: "created", createdAt: now });
    const row = (text: string) =>
      ctx.db.insert("clientRequests", {
        orgId: ORG, clientId: client, threadId: thread, messageId: m1, text, intent: "add",
        disposition: "open", createdAt: now, updatedAt: now,
      });
    const r1 = await row("Két banner 1200×628");
    const r2 = await row("A 20% kedvezményt is írjátok rá.");
    const item = await ctx.db.insert("agentItems", {
      orgId: ORG, source: "email", anchor: { type: "emailThread", id: thread }, kind: "request", status: "open",
      messageIds: [m1], taskId: task, createdAt: now, updatedAt: now,
    });
    return { adam, bence, mari, client, task, otherTask, statuses, adamBox, benceBox, mariBox, seedBox, thread, item, r1, r2 };
  });
}

/** Drain scheduled functions in time order (each action finishes before the clock moves on). */
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

type DraftArgs = Partial<{
  kind: Doc<"emailDrafts">["kind"];
  threadId: Id<"emailThreads">;
  taskId: Id<"tasks">;
  bodyText: string;
  answersRequestIds: Id<"clientRequests">[];
  followUp: NonNullable<Doc<"emailDrafts">["followUp"]>;
  promiseCandidates: Array<{ text: string; dueDate?: string }>;
  cc: Array<{ email: string }>;
  fromConnectorId: Id<"connectors">;
}>;

/** An agent-written draft (createDraftInternal). Defaults: kickoff on the fixture thread. */
async function agentDraft(t: T, f: Fixture, args: DraftArgs = {}): Promise<Id<"emailDrafts">> {
  return await t.mutation(internal.email.drafts.createDraftInternal, {
    orgId: ORG,
    kind: args.kind ?? "kickoff",
    threadId: args.threadId ?? f.thread,
    taskId: args.taskId ?? f.task,
    bodyText: args.bodyText ?? "Szia Réka!\n\nKöszönjük, elkezdtük. 2 munkanapon belül jelentkezünk.\n\nÁdám",
    sourceSummary: "test",
    answersRequestIds: args.answersRequestIds,
    followUp: args.followUp,
    promiseCandidates: args.promiseCandidates,
    cc: args.cc,
    fromConnectorId: args.fromConnectorId,
  });
}

const getDraft = (t: T, id: Id<"emailDrafts">) => t.run((ctx) => ctx.db.get(id));

/** The warnings the gate shows now (what the email component lists before Send). */
async function shownWarnings(t: T, draftId: Id<"emailDrafts">, who = ADAM): Promise<string[]> {
  const draft = (await getDraft(t, draftId))!;
  const preview = await t.withIdentity(who).query(api.email.send.previewSendGate, { draftId, version: draft.version });
  return (preview?.warnings ?? []).map((w) => w.key);
}

/** Approve the current version, acknowledging every warning shown (as the UI does). */
async function approve(t: T, draftId: Id<"emailDrafts">, who = ADAM) {
  const draft = (await getDraft(t, draftId))!;
  return await t.withIdentity(who).mutation(api.email.send.approveAndSend, {
    draftId, version: draft.version, acknowledgedWarnings: await shownWarnings(t, draftId, who),
  });
}

async function retry(t: T, draftId: Id<"emailDrafts">, who = ADAM) {
  const draft = (await getDraft(t, draftId))!;
  return await t.withIdentity(who).mutation(api.email.send.retrySend, {
    draftId, version: draft.version, acknowledgedWarnings: await shownWarnings(t, draftId, who),
  });
}

async function approveAndDrain(t: T, draftId: Id<"emailDrafts">) {
  const result = await approve(t, draftId);
  expect(result.ok).toBe(true);
  await settle(t);
  return (await getDraft(t, draftId))!;
}

// ─── Approve → undo / edit ───────────────────────────────────────────────────

describe("approve → queued → undo / edit (D9)", () => {
  it("undo before sendAt returns the draft and nothing is sent", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    const result = await approve(t, draftId);
    expect(result).toMatchObject({ ok: true, sendAt: FRIDAY_10 + 15_000 });
    let draft = (await getDraft(t, draftId))!;
    expect(draft).toMatchObject({ status: "queued", sendAt: FRIDAY_10 + 15_000, approval: { version: 1, userId: f.adam } });
    expect(draft.messageIdHeader).toMatch(/^<[0-9a-f-]{36}@agency\.test>$/); // adam@agency.test's domain

    await vi.advanceTimersByTimeAsync(10_000);
    // "Undo after a reload": the client reads the countdown from sendAt.
    const view = await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId });
    expect(view?.sendAt).toBe(FRIDAY_10 + 15_000);
    await t.withIdentity(ADAM).mutation(api.email.send.undoSend, { draftId });
    draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("draft");
    expect(draft.approval).toBeUndefined();
    expect(draft.sendAt).toBeUndefined();
    await settle(t);
    expect(gmail.sends).toHaveLength(0);
    expect((await getDraft(t, draftId))!.status).toBe("draft");
  });

  it("an edit during the countdown voids the approval — nothing is sent", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    await vi.advanceTimersByTimeAsync(5_000);
    const { version } = await t.withIdentity(ADAM).mutation(api.email.drafts.updateDraft, {
      draftId, version: 1, bodyText: "Szia Réka!\n\nMódosított szöveg.\n\nÁdám",
    });
    expect(version).toBe(2);
    const draft = (await getDraft(t, draftId))!;
    expect(draft).toMatchObject({ status: "draft", version: 2 });
    expect(draft.approval).toBeUndefined();
    await settle(t);
    expect(gmail.sends).toHaveLength(0);
    // Approving the version that was shown before the edit is refused.
    const stale = await t.withIdentity(ADAM).mutation(api.email.send.approveAndSend, {
      draftId, version: 1, acknowledgedWarnings: [],
    });
    expect(stale).toMatchObject({ ok: false, blocks: [{ key: "review_again" }] });
  });

  it("undo after sendAt is refused; the subject of a reply is locked", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    expect((await getDraft(t, draftId))!).toMatchObject({ subject: "Re: Black Friday", subjectLocked: true });
    await expect(
      t.withIdentity(ADAM).mutation(api.email.drafts.updateDraft, { draftId, version: 1, subject: "Új tárgy" }),
    ).rejects.toThrow(SUBJECT_LOCKED_MESSAGE);
    await approve(t, draftId);
    vi.setSystemTime(FRIDAY_10 + 16_000);
    await expect(t.withIdentity(ADAM).mutation(api.email.send.undoSend, { draftId })).rejects.toThrow(/Too late/);
  });
});

// ─── Claim exactly once (I4) ─────────────────────────────────────────────────

describe("dispatch claim (I4)", () => {
  it("two dispatch attempts → one Gmail call", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    const { approval, scheduledFnId } = (await getDraft(t, draftId))!;
    // Only the two runs below compete (the scheduled one is taken out of the race).
    await t.run((ctx) => ctx.scheduler.cancel(scheduledFnId!));
    vi.setSystemTime(FRIDAY_10 + 16_000);
    const args = { draftId, approvedAt: approval!.at, hash: approval!.hash, mode: "scheduled" as const };
    const results = await Promise.all([
      t.action(internal.email.send.dispatchDraft, args),
      t.action(internal.email.send.dispatchDraft, args),
    ]);
    await settle(t);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(gmail.sends).toHaveLength(1);
    expect((await getDraft(t, draftId))!.status).toBe("sent");
  });

  it("a run scheduled for an older approval claims nothing", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    const old = (await getDraft(t, draftId))!.approval!;
    await t.withIdentity(ADAM).mutation(api.email.send.undoSend, { draftId });
    vi.setSystemTime(FRIDAY_10 + 20_000);
    const res = await t.action(internal.email.send.dispatchDraft, { draftId, approvedAt: old.at, hash: old.hash, mode: "scheduled" });
    expect(res.claimed).toBe(false);
    expect(gmail.sends).toHaveLength(0);
  });
});

// ─── Success ─────────────────────────────────────────────────────────────────

describe("sent (§5.4)", () => {
  it("completion: outbound row, ledger answered, waitingOn, client_review, item closed, follow-up, activity", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f, {
      kind: "completion",
      bodyText: "Szia Réka!\n\nCsatoltuk a bannereket, a 20% is rajta van.\n\nÁdám",
      answersRequestIds: [f.r1, f.r2],
      followUp: { title: "Follow-up: FB verzió", assigneeIds: [f.mari], dueDate: "2026-10-23", subtaskIds: [] },
    });
    await t.run((ctx) => ctx.db.patch(f.item, { draftId }));
    const draft = await approveAndDrain(t, draftId);

    expect(gmail.sends).toHaveLength(1);
    const sent = gmail.sends[0];
    expect(sent.threadId).toBe("gt-adam-1");
    expect(sent.message).toMatch(/^In-Reply-To: <m1@pragmatico\.hu>$/m);
    expect(sent.message).toMatch(/^References: <m1@pragmatico\.hu>$/m);
    expect(sent.message).toMatch(/^Subject: Re: Black Friday$/m);
    expect(sent.message).toMatch(/^To: =\?UTF-8\?B\?.+\?= <reka@pragmatico\.hu>$/m); // "Kovács Réka", encoded
    expect(sent.message).toMatch(/^Cc: gabor@pragmatico\.hu$/m); // replyCcEmails (I2)
    expect(sent.messageId).toBe(draft.messageIdHeader);

    expect(draft).toMatchObject({ status: "sent", sentAt: FRIDAY_10 + 15_001 });
    const state = await t.run(async (ctx) => ({
      message: await ctx.db.get(draft.sentMessageId!),
      thread: await ctx.db.get(f.thread),
      requests: await Promise.all([ctx.db.get(f.r1), ctx.db.get(f.r2)]),
      task: await ctx.db.get(f.task),
      item: await ctx.db.get(f.item),
      followUps: (await ctx.db.query("tasks").collect()).filter((x) => x.title === "Follow-up: FB verzió"),
      activity: (await ctx.db.query("activityLog").collect()).filter((a) => a.type === "email_sent"),
    }));
    expect(state.message).toMatchObject({
      direction: "outbound", stage: "handled", threadId: f.thread, connectorId: f.adamBox,
      rfcMessageId: draft.messageIdHeader, gmailMessageId: expect.stringMatching(/^gm-/),
      from: { name: "Tóth Ádám", email: "adam@agency.test" }, subject: "Re: Black Friday",
    });
    expect(state.thread).toMatchObject({ waitingOn: "client", lastOutboundAt: draft.sentAt });
    expect(state.requests.map((r) => r?.disposition)).toEqual(["answered", "answered"]);
    expect(state.task?.statusId).toBe(f.statuses["Client review"]);
    expect(state.item).toMatchObject({ status: "done", outcome: "replied", decidedBy: f.adam });
    expect(state.followUps).toHaveLength(1);
    expect(state.followUps[0]).toMatchObject({ assigneeIds: [f.mari], dueDate: "2026-10-23" });
    expect(state.activity).toHaveLength(1);
    expect(state.activity[0]).toMatchObject({
      taskId: f.task, userId: f.adam, metadata: { draftId, kind: "completion", to: "Kovács Réka +1" },
    });
    expect(draft.postSendErrors).toBeUndefined();
  });

  it("a throwing side effect never undoes the send: draft stays sent, the effect's own writes roll back", async () => {
    const t = createT();
    const f = await setup(t);
    failSentEffectsForTesting(["thread", "ledger"]); // they write, then throw
    const draftId = await agentDraft(t, f, { kind: "completion", answersRequestIds: [f.r1, f.r2] });
    const draft = await approveAndDrain(t, draftId);
    expect(draft.status).toBe("sent");
    expect(draft.postSendErrors).toEqual(["thread: test: effect thread failed", "ledger: test: effect ledger failed"]);
    const state = await t.run(async (ctx) => ({
      message: await ctx.db.get(draft.sentMessageId!),
      thread: await ctx.db.get(f.thread),
      requests: await Promise.all([ctx.db.get(f.r1), ctx.db.get(f.r2)]),
      task: await ctx.db.get(f.task),
      activity: (await ctx.db.query("activityLog").collect()).filter((a) => a.type === "email_sent"),
    }));
    expect(state.message?.direction).toBe("outbound");
    // Rolled back (the nested subtransaction's writes are gone)…
    expect(state.thread?.waitingOn).toBe("us");
    expect(state.requests.map((r) => r?.disposition)).toEqual(["open", "open"]);
    // …while the other effects still applied.
    expect(state.task?.statusId).toBe(f.statuses["Client review"]);
    expect(state.activity).toHaveLength(1);
  });

  it("agent-conversation ledger rows the email answers are closed too", async () => {
    const t = createT();
    const f = await setup(t);
    const { agentThreadId, row } = await t.run(async (ctx) => {
      const now = Date.now();
      const agentId = await ctx.db.insert("agents", {
        orgId: ORG, name: "Copilot", description: "", instructions: "", tools: [], runPermission: "admins",
        trigger: "manual", createdBy: f.adam, createdAt: now, updatedAt: now,
      });
      const agentThreadId = await ctx.db.insert("agentThreads", {
        orgId: ORG, componentThreadId: "ct-call", agentId, userId: f.adam, title: "call", status: "idle",
        lastActivityAt: now, createdAt: now,
      });
      const row = await ctx.db.insert("clientRequests", {
        orgId: ORG, clientId: f.client, agentThreadId, text: "Küldjétek át a hívás összefoglalóját", intent: "ask",
        disposition: "open", createdAt: now, updatedAt: now,
      });
      return { agentThreadId, row };
    });
    const draftId = await t.mutation(internal.email.drafts.createDraftInternal, {
      orgId: ORG, kind: "recap", taskId: f.task, agentThreadId, subject: "Összefoglaló",
      to: [{ email: "reka@pragmatico.hu" }], bodyText: "Szia Réka!\n\nAz összefoglaló.", sourceSummary: "call",
      answersRequestIds: [row],
    });
    expect((await approveAndDrain(t, draftId)).status).toBe("sent");
    expect((await t.run((ctx) => ctx.db.get(row)))?.disposition).toBe("answered");
  });

  it("D8: Undo before Gmail accepts creates no follow-up", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f, {
      followUp: { title: "Follow-up: never", assigneeIds: [f.mari], subtaskIds: [] },
    });
    await approve(t, draftId);
    await t.withIdentity(ADAM).mutation(api.email.send.undoSend, { draftId });
    await settle(t);
    const followUps = await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).filter((x) => x.title === "Follow-up: never"));
    expect(followUps).toHaveLength(0);
    expect(gmail.sends).toHaveLength(0);
  });

  it("a recap (new conversation) creates its thread only when Gmail accepts", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await t.withIdentity(ADAM).mutation(api.email.drafts.createDraft, {
      kind: "recap", taskId: f.task, subject: "Összefoglaló — mai hívás", to: [{ email: "reka@pragmatico.hu" }],
      bodyText: "Szia Réka!\n\nA mai hívás összefoglalója.", sourceSummary: "call",
    });
    const before = (await getDraft(t, draftId))!;
    expect(before).toMatchObject({ subjectLocked: false, fromConnectorId: f.adamBox });
    expect(before.threadId).toBeUndefined();
    const draft = await approveAndDrain(t, draftId);
    expect(gmail.sends[0].threadId).toBeUndefined();
    expect(gmail.sends[0].message).not.toMatch(/^In-Reply-To:/m);
    const state = await t.run(async (ctx) => ({
      thread: draft.threadId ? await ctx.db.get(draft.threadId) : null,
      link: (await ctx.db.query("emailThreadTasks").collect()).filter((l) => l.threadId === draft.threadId),
    }));
    expect(state.thread).toMatchObject({ connectorId: f.adamBox, gmailThreadId: expect.stringMatching(/^gt-new-/), waitingOn: "client" });
    expect(state.link).toHaveLength(1);
  });
});

// ─── Errors ──────────────────────────────────────────────────────────────────

describe("failed (§5.4 error kinds)", () => {
  const cases: Array<{ name: string; plan: Step[]; kind: string; connector?: string; sends: number }> = [
    { name: "recipient", plan: [{ status: 400, body: { error: { code: 400, message: "Invalid To header" } } }], kind: "recipient", sends: 1 },
    { name: "disconnected (401) flips the connector to expired", plan: [{ status: 401 }], kind: "disconnected", connector: "expired", sends: 1 },
    {
      name: "permission (403 scope) flips the connector to error",
      plan: [{ status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } }],
      kind: "permission", connector: "error", sends: 1,
    },
    {
      name: "quota twice → failed after ONE automatic retry",
      plan: [{ status: 429 }, { status: 403, body: { error: { errors: [{ reason: "rateLimitExceeded" }] } } }],
      kind: "quota", sends: 2,
    },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const t = createT();
      const f = await setup(t);
      const draftId = await agentDraft(t, f);
      gmail.plan = [...c.plan];
      const draft = await approveAndDrain(t, draftId);
      expect(draft.status).toBe("failed");
      expect(draft.failure?.kind).toBe(c.kind);
      expect(draft.autoRetryAt).toBeUndefined();
      expect(draft.approval).toBeDefined(); // kept for Retry
      expect(gmail.sends).toHaveLength(c.sends);
      const connector = await t.run((ctx) => ctx.db.get(f.adamBox));
      expect(connector?.status).toBe(c.connector ?? "connected");
    });
  }

  it("a 5xx on send is unknown — confirmed by search, never resent automatically", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    gmail.plan = [{ status: 503 }];
    const draft = await approveAndDrain(t, draftId);
    expect(draft).toMatchObject({ status: "unknown", failure: { kind: "unknown" } });
    expect(draft.autoRetryAt).toBeUndefined();
    expect(gmail.sends).toHaveLength(1);
    await t.mutation(internal.email.send.sweepSendStates, {});
    await settle(t);
    expect(gmail.sends).toHaveLength(1); // a confirm only searches
    expect(gmail.searches).toHaveLength(1);
  });

  it("a transient error BEFORE the send request retries once by itself: search first, then send", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    // The token step fails (no encryption key) — nothing reached Gmail.
    delete process.env.AI_KEY_ENCRYPTION_KEK;
    __resetSecretCryptoCacheForTests();
    await settle(t, { horizonMs: 20_000 });
    const failed = (await getDraft(t, draftId))!;
    expect(failed).toMatchObject({ status: "failed", failure: { kind: "transient" } });
    expect(failed.autoRetryAt).toBeGreaterThanOrEqual(FRIDAY_10 + 15_000 + 60_000);
    expect(gmail.sends).toHaveLength(0);
    process.env.AI_KEY_ENCRYPTION_KEK = KEK;
    __resetSecretCryptoCacheForTests();
    await settle(t);
    expect((await getDraft(t, draftId))!.status).toBe("sent");
    expect(gmail.sends).toHaveLength(1);
    expect(gmail.searches).toEqual([`rfc822msgid:${failed.messageIdHeader!.slice(1, -1)}`]);
  });

  it("the sending mailbox changing during the countdown (address or reconnect) stops the send", async () => {
    const t = createT();
    const f = await setup(t);
    for (const change of [{ credentialMask: "adam@other.test" }, { connectedAt: Date.now() + 1 }]) {
      const draftId = await agentDraft(t, f);
      await approve(t, draftId);
      await t.run((ctx) => ctx.db.patch(f.adamBox, change));
      await settle(t);
      const draft = (await getDraft(t, draftId))!;
      expect(draft).toMatchObject({ status: "draft", stale: { reason: MAILBOX_CHANGED_MESSAGE } });
      expect(draft.approval).toBeUndefined();
      expect(await approve(t, draftId)).toMatchObject({
        ok: false, blocks: [{ key: "review_again", text: `${MAILBOX_CHANGED_MESSAGE}.` }],
      });
    }
    expect(gmail.sends).toHaveLength(0);
  });

  it("the seed mailbox (revoked) is blocked with Reconnect — nothing is queued", async () => {
    const t = createT();
    const f = await setup(t);
    const seedThread = await t.run(async (ctx) => {
      const id = await ctx.db.insert("emailThreads", {
        orgId: ORG, connectorId: f.seedBox, gmailThreadId: "seed-t", subject: "Seed", clientId: f.client,
        participants: [{ email: "reka@pragmatico.hu" }], lastMessageAt: Date.now(), waitingOn: "us",
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      await ctx.db.insert("emailThreadTasks", { orgId: ORG, threadId: id, taskId: f.task, role: "created", createdAt: Date.now() });
      return id;
    });
    const draftId = await agentDraft(t, f, { threadId: seedThread });
    expect((await getDraft(t, draftId))!.fromConnectorId).toBe(f.seedBox);
    const result = await approve(t, draftId);
    expect(result).toMatchObject({ ok: false, blocks: [{ key: "reconnect" }] });
    expect((await getDraft(t, draftId))!.status).toBe("draft");
    expect(gmail.sends).toHaveLength(0);
  });

  it("a mailbox disconnected during the countdown fails the send as disconnected; Retry needs Reconnect", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    await t.run((ctx) => ctx.db.patch(f.adamBox, { status: "expired" }));
    await settle(t);
    const draft = (await getDraft(t, draftId))!;
    expect(draft).toMatchObject({ status: "failed", failure: { kind: "disconnected" } });
    expect(gmail.sends).toHaveLength(0);
    const retried = await retry(t, draftId);
    expect(retried).toMatchObject({ ok: false, blocks: [{ key: "reconnect" }] });
  });
});

// ─── B8a: re-approve a failed send without an edit ───────────────────────────

describe("B8a: a failed send whose approval no longer binds is approved afresh", () => {
  async function failDisconnected(t: T, f: Fixture) {
    const draftId = await agentDraft(t, f);
    gmail.plan = [{ status: 401 }]; // the token was revoked: Gmail refuses, nothing is accepted
    await approveAndDrain(t, draftId);
    const failed = (await getDraft(t, draftId))!;
    expect(failed).toMatchObject({ status: "failed", failure: { kind: "disconnected" } });
    expect(failed.priorMessageIds).toContain(failed.messageIdHeader);
    // Reconnect: a new grant generation — the old approval no longer binds.
    await t.run((ctx) => ctx.db.patch(f.adamBox, { status: "connected", connectedAt: Date.now() + 1 }));
    return { draftId, firstId: failed.messageIdHeader! };
  }

  it("failed → reconnect → Retry refused → approveAndSend → searches the earlier Message-ID first → sends once", async () => {
    const t = createT();
    const f = await setup(t);
    const { draftId, firstId } = await failDisconnected(t, f);
    expect((await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId }))!.retryable).toBe(false);
    expect(await retry(t, draftId)).toMatchObject({ ok: false, blocks: [{ key: "approve_again" }] });

    const result = await approve(t, draftId); // no edit
    expect(result.ok).toBe(true);
    let draft = (await getDraft(t, draftId))!;
    expect(draft).toMatchObject({ status: "queued", version: 1, approval: { fromAddress: "adam@agency.test" } });
    const box = await t.run((ctx) => ctx.db.get(f.adamBox));
    expect(draft.approval!.fromConnectedAt).toBe(box!.connectedAt); // bound to the NEW grant
    expect(draft.messageIdHeader).not.toBe(firstId);
    expect(draft.priorMessageIds).toContain(firstId);

    gmail.searches.length = 0;
    await settle(t);
    draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("sent");
    expect(gmail.searches).toEqual([`rfc822msgid:${firstId.slice(1, -1)}`]); // the earlier attempt, before sending
    expect(gmail.sends).toHaveLength(2); // the refused 401 + the one that went out
    expect(gmail.mailbox.size).toBe(1);
  });

  it("an earlier attempt that did reach the mailbox is recorded as sent — nothing is sent again", async () => {
    const t = createT();
    const f = await setup(t);
    const { draftId, firstId } = await failDisconnected(t, f);
    gmail.mailbox.set(firstId, { id: "gm-early", threadId: "gt-adam-1" });
    expect((await approve(t, draftId)).ok).toBe(true);
    await settle(t);
    const draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("sent");
    expect(gmail.sends).toHaveLength(1); // only the refused first attempt
  });

  it("the same gates hold: a stale failed draft is not re-approved until reviewed", async () => {
    const t = createT();
    const f = await setup(t);
    const { draftId } = await failDisconnected(t, f);
    await t.run((ctx) => ctx.db.patch(draftId, { stale: { reason: "Kovács Réka wrote at 14:05", at: Date.now() } }));
    expect(await approve(t, draftId)).toMatchObject({ ok: false, blocks: [{ key: "review_again" }] });
    expect((await getDraft(t, draftId))!.status).toBe("failed");
  });

  it("a failed draft whose approval still binds stays retryable", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    gmail.plan = [{ status: 400, body: { error: { code: 400, message: "Invalid To header", status: "INVALID_ARGUMENT" } } }];
    await approveAndDrain(t, draftId);
    const view = await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId });
    expect(view).toMatchObject({ status: "failed", retryable: true });
  });
});

// ─── Unknown ─────────────────────────────────────────────────────────────────

describe("unknown → confirmed by Message-ID, never sent twice", () => {
  it("timeout after Gmail accepted → unknown → the cron finds it → sent (one send)", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f, { answersRequestIds: [f.r1] });
    gmail.plan = ["acceptThenNetwork"];
    let draft = await approveAndDrain(t, draftId);
    expect(draft.status).toBe("unknown");
    expect(draft.unknownSince).toBeGreaterThanOrEqual(FRIDAY_10 + 15_000);
    expect(gmail.sends).toHaveLength(1);

    const sweep = await t.mutation(internal.email.send.sweepSendStates, {});
    expect(sweep.confirming).toBe(1);
    await settle(t);
    draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("sent");
    expect(gmail.sends).toHaveLength(1);
    expect(gmail.searches).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(f.r1)))?.disposition).toBe("answered");
  });

  it("not found: waits, then failed after 10 min; Retry searches first and sends once", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    gmail.plan = ["network"]; // never reached Gmail
    let draft = await approveAndDrain(t, draftId);
    expect(draft.status).toBe("unknown");

    expect(await t.action(internal.email.send.confirmUnknownSend, { draftId })).toEqual({ result: "waiting" });
    expect((await getDraft(t, draftId))!.status).toBe("unknown");

    vi.setSystemTime(draft.unknownSince! + UNKNOWN_CONFIRM_WINDOW_MS + 1);
    expect(await t.action(internal.email.send.confirmUnknownSend, { draftId })).toEqual({ result: "failed" });
    draft = (await getDraft(t, draftId))!;
    expect(draft).toMatchObject({ status: "failed", failure: { kind: "unknown", message: UNKNOWN_NOT_FOUND_MESSAGE } });

    const retried = await retry(t, draftId);
    expect(retried.ok).toBe(true);
    await settle(t);
    expect((await getDraft(t, draftId))!.status).toBe("sent");
    expect(gmail.searches).toHaveLength(3); // two confirms + the retry's pre-send search
    expect(gmail.sends).toHaveLength(2);
    expect(gmail.mailbox.size).toBe(1); // exactly one email reached the mailbox
    expect(gmail.sends[1].messageId).toBe(gmail.sends[0].messageId); // same Message-ID across retries
  });

  it("Retry after an unknown that DID go out finds it and never resends", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    gmail.plan = ["acceptThenNetwork"];
    let draft = await approveAndDrain(t, draftId);
    // The search is down during the whole window → failed.
    gmail.searchFails = true;
    vi.setSystemTime(draft.unknownSince! + UNKNOWN_CONFIRM_WINDOW_MS + 1);
    await t.action(internal.email.send.confirmUnknownSend, { draftId });
    draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("failed");
    gmail.searchFails = false;
    await retry(t, draftId);
    await settle(t);
    expect((await getDraft(t, draftId))!.status).toBe("sent");
    expect(gmail.sends).toHaveLength(1);
  });

  it("re-approval after an uncertain send searches the earlier Message-ID first — no second Gmail call", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    gmail.plan = ["acceptThenNetwork"]; // it DID go out, but we never heard
    let draft = await approveAndDrain(t, draftId);
    const firstId = draft.messageIdHeader!;
    gmail.searchFails = true; // the confirm can't search during the window
    vi.setSystemTime(draft.unknownSince! + UNKNOWN_CONFIRM_WINDOW_MS + 1);
    await t.action(internal.email.send.confirmUnknownSend, { draftId });
    expect((await getDraft(t, draftId))!.status).toBe("failed");
    gmail.searchFails = false;

    // The admin edits and approves again: a NEW approval with a NEW Message-ID…
    await t.withIdentity(ADAM).mutation(api.email.drafts.updateDraft, { draftId, version: 1, bodyText: "Szia Réka!\n\nÚj szöveg." });
    draft = (await getDraft(t, draftId))!;
    expect(draft.priorMessageIds).toEqual([firstId]); // kept through the edit
    expect((await approve(t, draftId)).ok).toBe(true);
    expect((await getDraft(t, draftId))!.messageIdHeader).not.toBe(firstId);
    await settle(t);

    // …but its first attempt searched for the earlier id, found it, and sent nothing.
    draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("sent");
    expect(draft.messageIdHeader).toBe(firstId); // the one that actually went out
    expect(gmail.sends).toHaveLength(1);
    expect(gmail.searches.at(-1)).toBe(`rfc822msgid:${firstId.slice(1, -1)}`);
    const message = await t.run((ctx) => ctx.db.get(draft.sentMessageId!));
    expect(message?.rfcMessageId).toBe(firstId);
  });

  it("an in-flight send settles even after the org flag is switched off — confirm only, never send", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    gmail.plan = ["acceptThenNetwork"];
    await approveAndDrain(t, draftId);
    await t.run(async (ctx) => {
      const settings = (await ctx.db.query("orgSettings").collect()).find((s) => s.orgId === ORG)!;
      await ctx.db.patch(settings._id, { emailTriageEnabled: false });
    });
    expect((await t.mutation(internal.email.send.sweepSendStates, {})).confirming).toBe(1);
    await settle(t);
    expect((await getDraft(t, draftId))!.status).toBe("sent");
    expect(gmail.sends).toHaveLength(1);
  });

  it("a failed draft whose due automatic retry was lost is retried by the sweep — only when one was due", async () => {
    const t = createT();
    const f = await setup(t);
    const lost = await agentDraft(t, f);
    const plain = await agentDraft(t, f);
    gmail.plan = [{ status: 429 }, { status: 400, body: { error: { message: "Invalid To header" } } }];
    await approve(t, lost);
    await approve(t, plain);
    await settle(t, { horizonMs: 20_000 });
    const failed = (await getDraft(t, lost))!;
    expect(failed).toMatchObject({ status: "failed", failure: { kind: "quota" } });
    expect((await getDraft(t, plain))!).toMatchObject({ status: "failed", failure: { kind: "recipient" } });
    // The retry job is lost.
    await t.run((ctx) => ctx.scheduler.cancel(failed.scheduledFnId!));
    vi.setSystemTime(failed.autoRetryAt! + 5 * 60_000 + 1);
    expect((await t.mutation(internal.email.send.sweepSendStates, {})).retried).toBe(1);
    await settle(t);
    expect((await getDraft(t, lost))!.status).toBe("sent");
    expect((await getDraft(t, plain))!.status).toBe("failed");
  });

  it("a dispatching draft whose action died becomes unknown after 5 min", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await t.run((ctx) => ctx.db.patch(draftId, { status: "dispatching", dispatchingAt: Date.now() - 6 * 60_000, messageIdHeader: "<x@agency.test>" }));
    const sweep = await t.mutation(internal.email.send.sweepSendStates, {});
    expect(sweep.markedUnknown).toBe(1);
    expect((await getDraft(t, draftId))!).toMatchObject({ status: "unknown", unknownSince: Date.now() - 6 * 60_000 });
  });
});

// ─── I9 / I12 gates in the real flow ─────────────────────────────────────────

describe("gates in the flow", () => {
  async function pendingProposal(t: T, f: Fixture) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const agentId = await ctx.db.insert("agents", {
        orgId: ORG, name: "Email assistant", description: "", instructions: "", tools: [], runPermission: "admins",
        trigger: "manual", createdBy: f.adam, createdAt: now, updatedAt: now,
      });
      const threadId = await ctx.db.insert("agentThreads", {
        orgId: ORG, componentThreadId: `ct-${now}`, agentId, userId: f.adam, title: "t", status: "idle",
        lastActivityAt: now, createdAt: now, visibility: "admins",
      });
      const thread = (await ctx.db.get(threadId))!;
      const auth: AuthContext = { userId: f.adam, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(f.adam))! };
      const [id] = await insertProposalsForThread(ctx, thread, [{ kind: "updateTask", taskId: f.task, changes: { title: "Új cím" } }], auth);
      return (await ctx.db.get(id as Id<"agentProposals">))!;
    });
  }

  it("I9: a pending updateTask proposal blocks Approve & send (taskId indexed at insert)", async () => {
    const t = createT();
    const f = await setup(t);
    const proposal = await pendingProposal(t, f);
    expect(proposal.taskId).toBe(f.task);
    const draftId = await agentDraft(t, f);
    const task = await t.run((ctx) => ctx.db.get(f.task));
    expect(await approve(t, draftId)).toMatchObject({
      ok: false,
      blocks: [{ key: "pending_change", text: `Discard or retry the pending change on ${task!.identifier} Black Friday bannerek.` }],
    });
  });

  it("I9: a change proposal arriving during the countdown stops the send", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    await pendingProposal(t, f);
    await settle(t);
    const draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("draft");
    expect(draft.approval).toBeUndefined();
    expect(draft.stale?.reason).toMatch(/^Not sent: Discard or retry the pending change on /);
    expect(gmail.sends).toHaveLength(0);
  });

  it("I12: an unanswered request blocks a completion; a kickoff only warns (recorded)", async () => {
    const t = createT();
    const f = await setup(t);
    const completion = await agentDraft(t, f, { kind: "completion", answersRequestIds: [f.r1] });
    expect(await approve(t, completion)).toMatchObject({ ok: false, blocks: [{ key: "open_requests" }] });
    const kickoff = await agentDraft(t, f, { cc: [{ email: "boss@pragmatico.hu" }] });
    const r = await approve(t, kickoff);
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.key)).toEqual(["open_requests", "new_recipient"]);
    const approval = (await getDraft(t, kickoff))!.approval!;
    expect(approval.warningsAcknowledged).toEqual([
      expect.stringMatching(/^open_requests: Not answered yet/),
      "new_recipient: Not on this conversation before: boss@pragmatico.hu",
    ]);
  });

  it("every warning must be acknowledged — none or only some refuses, all approves", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f, { cc: [{ email: "boss@pragmatico.hu" }] });
    expect(await shownWarnings(t, draftId)).toEqual(["open_requests", "new_recipient"]);
    const send = (acknowledgedWarnings: string[]) =>
      t.withIdentity(ADAM).mutation(api.email.send.approveAndSend, { draftId, version: 1, acknowledgedWarnings });
    expect(await send([])).toMatchObject({ ok: false, blocks: [{ key: "acknowledge_warnings" }] });
    expect(await send(["new_recipient"])).toMatchObject({ ok: false, blocks: [{ key: "acknowledge_warnings" }] });
    expect((await getDraft(t, draftId))!.status).toBe("draft");
    expect((await send(["open_requests", "new_recipient"])).ok).toBe(true);
  });
});

// ─── Stale after an inbound message (B4 wiring) ──────────────────────────────

describe("stale drafts (D9) — wired into the B4 dispatch", () => {
  async function inbound(t: T, f: Fixture, body: string) {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("emailMessages", {
        orgId: ORG, threadId: f.thread, connectorId: f.adamBox, gmailMessageId: `g-in-${Date.now()}`,
        rfcMessageId: `<in-${Date.now()}@pragmatico.hu>`, direction: "inbound",
        from: { name: "Kovács Réka", email: "reka@pragmatico.hu" }, to: [{ email: "adam@agency.test" }], cc: [],
        subject: "Re: Black Friday", bodyText: body, attachments: [], sentAt: Date.now(), stage: "received", createdAt: Date.now(),
      }),
    );
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: id });
  }

  it("a client message during the countdown stales the draft and stops the send", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({});
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    await inbound(t, f, "Még egy kérés: legyen egy 1080×1080-as verzió is.");
    await settle(t);
    const draft = (await getDraft(t, draftId))!;
    expect(draft.status).toBe("draft");
    expect(draft.stale?.reason).toBe("Kovács Réka wrote at 10:00");
    expect(gmail.sends).toHaveLength(0);
    expect(await approve(t, draftId)).toMatchObject({ ok: false, blocks: [{ key: "review_again" }] });
    await t.withIdentity(ADAM).mutation(api.email.drafts.markDraftReviewed, { draftId, version: draft.version });
    expect((await approve(t, draftId)).ok).toBe(true);
  });

  it("a pure thank-you (quiet acknowledge) does not stale it", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await inbound(t, f, "Köszi!");
    await settle(t);
    expect((await getDraft(t, draftId))!.stale).toBeUndefined();
  });

  it("markThreadDraftsStale (B3, D33) stales the conversation's open drafts", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    const r = await t.mutation(internal.email.drafts.markThreadDraftsStale, { threadId: f.thread, reason: "You replied in Gmail at 14:05" });
    expect(r.marked).toBe(1);
    expect((await getDraft(t, draftId))!.stale?.reason).toBe("You replied in Gmail at 14:05");
  });
});

// ─── D35 sending mailbox ─────────────────────────────────────────────────────

describe("D35 sending mailbox", () => {
  /** The same conversation in Mari's and Bence's mailboxes (not Ádám's). */
  async function sharedConversation(t: T, f: Fixture) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const copy = async (connectorId: Id<"connectors">, gmailThreadId: string) => {
        const threadId = await ctx.db.insert("emailThreads", {
          orgId: ORG, connectorId, gmailThreadId, subject: "Árajánlat", clientId: f.client,
          participants: [{ email: "reka@pragmatico.hu" }], lastMessageAt: now, waitingOn: "us", createdAt: now, updatedAt: now,
        });
        await ctx.db.insert("emailMessages", {
          orgId: ORG, threadId, connectorId, gmailMessageId: `${gmailThreadId}-m`, rfcMessageId: "<shared@pragmatico.hu>",
          direction: "inbound", from: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
          to: [{ email: "mari@agency.test" }, { email: "bence@agency.test" }], cc: [], subject: "Árajánlat",
          bodyText: "Kérnénk árajánlatot.", attachments: [], sentAt: now - 1000, stage: "handled", createdAt: now,
        });
        await ctx.db.insert("emailThreadTasks", { orgId: ORG, threadId, taskId: f.task, role: "created", createdAt: now });
        return threadId;
      };
      return { mariThread: await copy(f.mariBox, "gt-mari"), benceThread: await copy(f.benceBox, "gt-bence") };
    });
  }

  it("own mailbox when it holds the conversation, else the one the client wrote to; only holders", async () => {
    const t = createT();
    const f = await setup(t);
    const { mariThread } = await sharedConversation(t, f);
    const byBence = await t.withIdentity(BENCE).mutation(api.email.drafts.createDraft, {
      kind: "reply", threadId: mariThread, taskId: f.task, bodyText: "Szia!", sourceSummary: "x",
    });
    expect((await getDraft(t, byBence))!.fromConnectorId).toBe(f.benceBox);
    const byAdam = await t.withIdentity(ADAM).mutation(api.email.drafts.createDraft, {
      kind: "reply", threadId: mariThread, taskId: f.task, bodyText: "Szia!", sourceSummary: "x",
    });
    const draft = (await getDraft(t, byAdam))!;
    expect(draft.fromConnectorId).toBe(f.mariBox); // Ádám's mailbox doesn't hold it
    // Reply-all defaults never include our own mailboxes.
    expect(draft.to).toEqual([{ name: "Kovács Réka", email: "reka@pragmatico.hu" }]);
    expect(draft.cc).toEqual([{ email: "gabor@pragmatico.hu" }]);
    await expect(
      t.withIdentity(ADAM).mutation(api.email.drafts.setFromMailbox, { draftId: byAdam, version: 1, connectorId: f.adamBox }),
    ).rejects.toThrow(/does not hold this conversation/);
    const { version } = await t.withIdentity(ADAM).mutation(api.email.drafts.setFromMailbox, {
      draftId: byAdam, version: 1, connectorId: f.benceBox,
    });
    expect(version).toBe(2);
  });

  it("a spoofed Message-ID from another sender (or far apart in time) does not link a mailbox", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const [from, sentAt] of [["attacker@evil.test", now - 60_000], ["reka@pragmatico.hu", now - 60 * 60_000]] as const) {
        const threadId = await ctx.db.insert("emailThreads", {
          orgId: ORG, connectorId: f.benceBox, gmailThreadId: `gt-spoof-${from}`, subject: "Black Friday",
          participants: [], lastMessageAt: now, waitingOn: "us", createdAt: now, updatedAt: now,
        });
        await ctx.db.insert("emailMessages", {
          orgId: ORG, threadId, connectorId: f.benceBox, gmailMessageId: `spoof-${from}`,
          rfcMessageId: "<m1@pragmatico.hu>", // the fixture thread's id, reused
          direction: "inbound", from: { email: from }, to: [{ email: "bence@agency.test" }], cc: [],
          subject: "Re: Black Friday", bodyText: "x", attachments: [], sentAt, stage: "handled", createdAt: now,
        });
      }
    });
    const draftId = await t.withIdentity(BENCE).mutation(api.email.drafts.createDraft, {
      kind: "reply", threadId: f.thread, taskId: f.task, bodyText: "Szia!", sourceSummary: "x",
    });
    expect((await getDraft(t, draftId))!.fromConnectorId).toBe(f.adamBox); // Bence's mailbox does not hold it
    await expect(
      t.withIdentity(BENCE).mutation(api.email.drafts.setFromMailbox, { draftId, version: 1, connectorId: f.benceBox }),
    ).rejects.toThrow(/does not hold this conversation/);
  });

  it("sending from a colleague's mailbox uses their Gmail thread and leaves them an Inbox note", async () => {
    const t = createT();
    const f = await setup(t);
    const { mariThread } = await sharedConversation(t, f);
    // Mari's mailbox lives on its own domain: the Message-ID takes the SENDING mailbox's domain.
    await t.run((ctx) => ctx.db.patch(f.mariBox, { credentialMask: "mari@studio.test" }));
    const draftId = await t.withIdentity(ADAM).mutation(api.email.drafts.createDraft, {
      kind: "reply", threadId: mariThread, taskId: f.task, bodyText: "Szia Réka!\n\nHétfőn küldjük.", sourceSummary: "x",
    });
    const draft = await approveAndDrain(t, draftId);
    expect(gmail.sends[0].threadId).toBe("gt-mari");
    expect(gmail.sends[0].message).toMatch(/^From: "Varga Mari" <mari@studio\.test>$/m);
    expect(draft.messageIdHeader).toMatch(/^<[0-9a-f-]{36}@studio\.test>$/);
    expect(gmail.sends[0].messageId).toBe(draft.messageIdHeader);
    const state = await t.run(async (ctx) => ({
      message: await ctx.db.get(draft.sentMessageId!),
      notes: (await ctx.db.query("notifications").collect()).filter((n) => n.subtype === "sent_from_your_mailbox"),
    }));
    expect(state.message).toMatchObject({ threadId: mariThread, connectorId: f.mariBox });
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0]).toMatchObject({ recipientId: f.mari, actorId: f.adam, kind: "email", type: "email_event", previewText: "" });

    // Mari (a member) sees exactly this note in her Inbox: who, which mailbox, the subject — no body.
    const rows = await t.withIdentity(MARI).query(api.email.inbox.listEmailEvents, {});
    expect(rows).toEqual([
      expect.objectContaining({
        subtype: "sent_from_your_mailbox", senderName: "Tóth Ádám", mailbox: "mari@studio.test",
        subject: "Re: Árajánlat", previewText: "", href: null,
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("Hétfőn küldjük");
  });

  it("a member's Inbox shows only their own colleague notes — never other email rows", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const message = (await ctx.db.query("emailMessages").first())!;
      const base = {
        orgId: ORG, actorId: f.adam, type: "email_event" as const, kind: "email" as const, threadId: f.thread,
        messageId: message._id, previewText: "Kérnénk két bannert.", inboxState: "unread" as const,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await ctx.db.insert("notifications", { ...base, recipientId: f.mari, subtype: "no_action" });
      await ctx.db.insert("notifications", { ...base, recipientId: f.mari, subtype: "change" });
      await ctx.db.insert("notifications", { ...base, recipientId: f.bence, subtype: "sent_from_your_mailbox", previewText: "" });
    });
    expect(await t.withIdentity(MARI).query(api.email.inbox.listEmailEvents, {})).toEqual([]);
    // An admin still gets every email row addressed to them.
    expect(await t.withIdentity(BENCE).query(api.email.inbox.listEmailEvents, {})).toHaveLength(1);
  });
});

// ─── Promises (I8) ───────────────────────────────────────────────────────────

describe("emailPromises (I8)", () => {
  it("extracted from the SENT body only, dated with working days from the send time", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({
      promises: (input) => ({
        promises: input.email.includes("2 munkanapon belül")
          ? [{ quote: "2 munkanapon belül jelentkezünk.", workingDays: 2, calendarDays: null, date: null }]
          : [],
      }),
    });
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    // Nothing from the draft while it waits in the undo window.
    expect(await t.run((ctx) => ctx.db.query("emailPromises").collect())).toHaveLength(0);
    await settle(t);
    const draft = (await getDraft(t, draftId))!;
    const promises = await t.run((ctx) => ctx.db.query("emailPromises").collect());
    expect(promises).toEqual([
      expect.objectContaining({
        threadId: f.thread, messageId: draft.sentMessageId, taskId: f.task, status: "open",
        text: "2 munkanapon belül jelentkezünk.", dueDate: "2026-10-20", // Friday + 2 working days → Tuesday
      }),
    ]);
    expect(promiseInputs).toHaveLength(1);
    expect(promiseInputs[0]).toMatchObject({ today: "2026-10-16", weekday: "Friday" });
  });

  it("a model failure never affects the send; a sent hint still counts, an edited-out one doesn't", async () => {
    const t = createT();
    const f = await setup(t);
    setModel({ promises: () => new Error("provider down") });
    const draftId = await agentDraft(t, f, {
      promiseCandidates: [
        { text: "2 munkanapon belül jelentkezünk", dueDate: "2026-10-20" },
        { text: "Pénteken átadjuk.", dueDate: "2026-10-23" },
      ],
    });
    const draft = await approveAndDrain(t, draftId);
    expect(draft.status).toBe("sent");
    const promises = await t.run((ctx) => ctx.db.query("emailPromises").collect());
    expect(promises.map((p) => [p.text, p.dueDate])).toEqual([["2 munkanapon belül jelentkezünk", "2026-10-20"]]);
  });

  it("never from inbound mail or a draft that was not sent", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    const m = await t.run(async (ctx) => (await ctx.db.query("emailMessages").first())!._id);
    expect(await t.action(internal.email.promises.extractPromisesForMessage, { draftId, messageId: m })).toEqual({ written: 0 });
    expect(await t.run((ctx) => ctx.db.query("emailPromises").collect())).toHaveLength(0);
  });
});

// ─── Access (§5.5) ───────────────────────────────────────────────────────────

describe("access (§5.5, I6)", () => {
  it("a member saves a draft for their own task — never approves or sends it", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await t.withIdentity(MARI).mutation(api.email.drafts.createDraft, {
      kind: "reply", threadId: f.thread, taskId: f.task, bodyText: "Szia Réka!", sourceSummary: "mari",
    });
    const draft = (await getDraft(t, draftId))!;
    expect(draft).toMatchObject({ createdBy: f.mari, fromConnectorId: f.adamBox }); // "for Ádám" (agent actor)
    const refused = await approve(t, draftId, MARI);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.blocks.map((b) => b.key)).toContain("not_admin");
    await expect(t.withIdentity(MARI).mutation(api.email.send.undoSend, { draftId })).rejects.toThrow(/Admin/);
    expect(await t.withIdentity(MARI).query(api.email.drafts.getDraft, { draftId })).not.toBeNull();
    // An admin can approve it (here: once the open requests are answered).
    await t.withIdentity(ADAM).mutation(api.email.drafts.updateDraft, { draftId, version: 1, answersRequestIds: [f.r1, f.r2] });
    expect((await approve(t, draftId, ADAM)).ok).toBe(true);
  });

  it("a member can't draft for a task they don't have, nor touch an admin's draft", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(
      t.withIdentity(MARI).mutation(api.email.drafts.createDraft, {
        kind: "recap", taskId: f.otherTask, subject: "x", to: [{ email: "reka@pragmatico.hu" }], bodyText: "x", sourceSummary: "x",
      }),
    ).rejects.toThrow(/Task not found/);
    const adminDraft = await agentDraft(t, f);
    expect(await t.withIdentity(MARI).query(api.email.drafts.getDraft, { draftId: adminDraft })).toBeNull();
    await expect(approve(t, adminDraft, MARI)).rejects.toThrow(/Draft not found/);
    await expect(
      t.withIdentity(MARI).mutation(api.email.drafts.updateDraft, { draftId: adminDraft, version: 1, bodyText: "x" }),
    ).rejects.toThrow(/Draft not found/);
  });

  it("a draft id from another org is refused everywhere", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await expect(approve(t, draftId, CAROL)).rejects.toThrow(/Draft not found/);
    await expect(t.withIdentity(CAROL).mutation(api.email.send.retrySend, { draftId, version: 1, acknowledgedWarnings: [] })).rejects.toThrow(/Draft not found/);
    await expect(t.withIdentity(CAROL).mutation(api.email.drafts.discardDraft, { draftId })).rejects.toThrow(/Draft not found/);
    expect(await t.withIdentity(CAROL).query(api.email.drafts.getDraft, { draftId })).toBeNull();
  });

  it("discard and restore; a discarded draft can't be approved", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    await approve(t, draftId);
    await t.withIdentity(ADAM).mutation(api.email.drafts.discardDraft, { draftId });
    expect((await getDraft(t, draftId))!.status).toBe("discarded");
    await expect(approve(t, draftId)).rejects.toThrow(/discarded/);
    await settle(t);
    expect(gmail.sends).toHaveLength(0);
    await t.withIdentity(ADAM).mutation(api.email.drafts.restoreDraft, { draftId });
    expect((await getDraft(t, draftId))!.status).toBe("draft");
  });
});

// ─── B8a: the email component's view + the live widgets ─────────────────────

describe("B8a: getDraft view (version label, From menu, viewer) and live widgets", () => {
  it("getDraft says who made the version shown and what the viewer may do", async () => {
    const t = createT();
    const f = await setup(t);
    const draftId = await agentDraft(t, f);
    let view = await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId });
    expect(view).toMatchObject({ version: 1, lastEdit: null, viewerIsAdmin: true, viewerCanEdit: true });
    expect(view!.mailboxOptions.map((m) => m.connectorId)).toEqual([f.adamBox]);
    expect(view!.mailboxOptions[0]).toMatchObject({ email: "adam@agency.test", ownerName: "Tóth Ádám", connected: true });

    // The agent's rewrite (D20) → "rewritten".
    await t.mutation(internal.email.drafts.reviseDraftInternal, { orgId: ORG, draftId, bodyText: "Szia Réka!\n\nRövidebben." });
    view = await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId });
    expect(view).toMatchObject({ version: 2, lastEdit: { by: "agent" } });

    // A person's edit → "edited by you" for them, the name for another admin.
    await t.withIdentity(ADAM).mutation(api.email.drafts.updateDraft, { draftId, version: 2, bodyText: "Szia Réka!\n\nKézzel." });
    expect((await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId }))!.lastEdit).toEqual({
      by: "user", isViewer: true, name: "Tóth Ádám",
    });
    expect((await t.withIdentity(BENCE).query(api.email.drafts.getDraft, { draftId }))!.lastEdit).toEqual({
      by: "user", isViewer: false, name: "Tóth Ádám",
    });

    // Queued: an admin can no longer edit it in place; a sent draft neither.
    await approve(t, draftId);
    view = await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId });
    expect(view).toMatchObject({ status: "queued", viewerCanEdit: true }); // edit during the window voids the approval (D9)
    await settle(t);
    view = await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId });
    expect(view).toMatchObject({ status: "sent", viewerCanEdit: false });
  });

  it("the From menu: admins see the mailboxes that hold the conversation; a member only the current address", async () => {
    const t = createT();
    const f = await setup(t);
    // Bence's mailbox holds a copy of Réka's email → a second holder (D35).
    await t.run(async (ctx) => {
      const now = Date.now();
      const copy = await ctx.db.insert("emailThreads", {
        orgId: ORG, connectorId: f.benceBox, gmailThreadId: "gt-bence-1", subject: "Black Friday", clientId: f.client,
        participants: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }], lastMessageAt: now - 60_000,
        lastInboundAt: now - 60_000, waitingOn: "us", createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("emailMessages", {
        orgId: ORG, threadId: copy, connectorId: f.benceBox, gmailMessageId: "g-in-1-b", rfcMessageId: "<m1@pragmatico.hu>",
        direction: "inbound", from: { name: "Kovács Réka", email: "reka@pragmatico.hu" }, to: [{ email: "bence@agency.test" }],
        cc: [], subject: "Black Friday", bodyText: "Kérnénk két bannert.", attachments: [],
        sentAt: now - 60_000, stage: "handled", createdAt: now,
      });
    });
    const draftId = await t.withIdentity(MARI).mutation(api.email.drafts.createDraft, {
      kind: "reply", threadId: f.thread, taskId: f.task, bodyText: "Szia Réka!", sourceSummary: "mari",
    });

    const admin = (await t.withIdentity(ADAM).query(api.email.drafts.getDraft, { draftId }))!;
    expect(admin.mailboxOptions.map((m) => [m.email, m.ownerName])).toEqual([
      ["adam@agency.test", "Tóth Ádám"],
      ["bence@agency.test", "Kiss Bence"],
    ]);

    const member = (await t.withIdentity(MARI).query(api.email.drafts.getDraft, { draftId }))!;
    expect(member.viewerIsAdmin).toBe(false);
    expect(member.mailboxOptions).toEqual([{ connectorId: f.adamBox, email: "adam@agency.test", ownerName: null, connected: true }]);
    expect(member.fromMailbox).toEqual({ email: "adam@agency.test", ownerName: null, connected: true });

    // A member never switches the sending mailbox; an admin can.
    await expect(
      t.withIdentity(MARI).mutation(api.email.drafts.setFromMailbox, { draftId, version: member.version, connectorId: f.benceBox }),
    ).rejects.toThrow(/Admin access required/);
    expect((await getDraft(t, draftId))!.fromConnectorId).toBe(f.adamBox);
    await t.withIdentity(ADAM).mutation(api.email.drafts.setFromMailbox, { draftId, version: admin.version, connectorId: f.benceBox });
    expect((await getDraft(t, draftId))!.fromConnectorId).toBe(f.benceBox);
  });

  it("requestChecklist: the ledger live, by conversation — admins of an enabled org only", async () => {
    const t = createT();
    const f = await setup(t);
    const view = await t.withIdentity(ADAM).query(api.agentWidgets.requestChecklist, { threadId: f.thread });
    expect(view).toMatchObject({ askedBy: "Kovács Réka", total: 2, open: 2, truncated: false });
    expect(view!.rows.map((r) => [r.text, r.state])).toEqual([
      ["Két banner 1200×628", "open"],
      ["A 20% kedvezményt is írjátok rá.", "open"],
    ]);

    // Live: covering the row flips its state, with the covering task linked.
    await t.run((ctx) => ctx.db.patch(f.r1, { disposition: "covered", taskId: f.task }));
    const after = await t.withIdentity(ADAM).query(api.agentWidgets.requestChecklist, { threadId: f.thread });
    expect(after!.rows[0]).toMatchObject({ state: "covered", covering: { taskId: f.task } });
    expect(after!.open).toBe(1);

    expect(await t.withIdentity(MARI).query(api.agentWidgets.requestChecklist, { threadId: f.thread })).toBeNull();
    expect(await t.withIdentity(CAROL).query(api.agentWidgets.requestChecklist, { threadId: f.thread })).toBeNull();
    expect(await t.withIdentity(ADAM).query(api.agentWidgets.requestChecklist, { threadId: "garbage" })).toBeNull();
  });

  it("taskCard: the task live with the viewer's access; gone or unreadable → null", async () => {
    const t = createT();
    const f = await setup(t);
    const card = await t.withIdentity(ADAM).query(api.agentWidgets.taskCard, { taskId: f.task });
    expect(card).toMatchObject({
      id: f.task,
      title: "Black Friday bannerek",
      status: { name: "Admin review" },
      subtaskCount: 0,
      owners: [{ id: f.mari, name: "Varga Mari" }],
      openQuestions: 0,
    });
    expect(card!.identifier).toMatch(/^PRG-\d+$/);

    // A member reads her own task (no ledger figures), never another one.
    expect(await t.withIdentity(MARI).query(api.agentWidgets.taskCard, { taskId: f.task })).toMatchObject({ openQuestions: null });
    expect(await t.withIdentity(MARI).query(api.agentWidgets.taskCard, { taskId: f.otherTask })).toBeNull();
    expect(await t.withIdentity(CAROL).query(api.agentWidgets.taskCard, { taskId: f.task })).toBeNull();

    // Live: a pending client question on the task shows; an archived task is gone.
    await t.run((ctx) => ctx.db.patch(f.r2, { disposition: "question_pending", taskId: f.task }));
    expect((await t.withIdentity(ADAM).query(api.agentWidgets.taskCard, { taskId: f.task }))!.openQuestions).toBe(1);
    await t.run((ctx) => ctx.db.patch(f.task, { archivedAt: Date.now() }));
    expect(await t.withIdentity(ADAM).query(api.agentWidgets.taskCard, { taskId: f.task })).toBeNull();
  });

  it("planGaps: the gaps the item's CURRENT plan was stored with, for admins", async () => {
    const t = createT();
    const f = await setup(t);
    const proposalId = await t.run(async (ctx) => {
      const now = Date.now();
      const agentId = await ctx.db.insert("agents", {
        orgId: ORG, name: "Email assistant", description: "", instructions: "", tools: [], runPermission: "admins",
        trigger: "manual", createdBy: f.adam, createdAt: now, updatedAt: now,
      });
      const threadId = await ctx.db.insert("agentThreads", {
        orgId: ORG, componentThreadId: "ct-plan", agentId, userId: f.adam, title: "t", status: "idle",
        lastActivityAt: now, createdAt: now, visibility: "admins", anchor: { type: "emailThread", id: f.thread },
      });
      const thread = (await ctx.db.get(threadId))!;
      const auth: AuthContext = { userId: f.adam, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(f.adam))! };
      const [id] = await insertProposalsForThread(ctx, thread, [{ kind: "createTask", title: "Bannerek" }], auth);
      await ctx.db.patch(f.item, {
        plan: {
          planId: "plan-1", proposalIds: [id as Id<"agentProposals">], revision: 1,
          grouping: { mode: "one", suggested: "one" },
          gaps: [{ kind: "missing_disposition", requestId: f.r2, detail: 'Not covered: "A 20% kedvezményt"' }],
          submittedAt: now,
        },
      });
      return id;
    });
    expect(await t.withIdentity(ADAM).query(api.agentWidgets.planGaps, { proposalIds: [proposalId] })).toEqual({
      gaps: ['Not covered: "A 20% kedvezményt"'],
    });
    expect(await t.withIdentity(MARI).query(api.agentWidgets.planGaps, { proposalIds: [proposalId] })).toEqual({ gaps: [] });
    expect(await t.withIdentity(ADAM).query(api.agentWidgets.planGaps, { proposalIds: ["nope"] })).toEqual({ gaps: [] });
  });
});
