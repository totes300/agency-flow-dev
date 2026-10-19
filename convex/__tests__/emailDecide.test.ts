// @vitest-environment edge-runtime
//
// Email triage B6b (docs/prd-email-triage.md §6.1, §6.7, D4, D21, D26, D29,
// D30, D32, I2, I3, I9, I12, Q7, Q8): Triage's Create (+ the 10 s Undo), the
// kickoff / reply draft (draftReply, submitDraft), a change on a linked task
// (prepareChange → Apply / Not a change), Merge, client approval, the I9 move
// gate, the generic approve refusal, access, and the seed demo chain.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { backgroundJobPrompts, runAt } from "../../lib/agents/threadRuns";
import { mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask, PENDING_EMAIL_CHANGE_MESSAGE } from "../tasks/write";
import { APPLY_FROM_TRIAGE_MESSAGE, STALE_REVISION_MESSAGE } from "../agentProposals";
import { EMAIL_TRIAGE_DISABLED_MESSAGE } from "../email/gate";
import { KIND_CHANGED_MESSAGE, NOTHING_TO_UNDO_MESSAGE, REPLAN_PENDING_MESSAGE, UNDO_EXPIRED_MESSAGE } from "../email/create";
import { USE_TRIAGE_ACTIONS_MESSAGE } from "../agentItems";
import { loadSendGateContext } from "../email/send";
import { sendGate } from "../email/sendGate";
import { NOT_A_CHANGE_REASON, SAME_CLIENT_MESSAGE } from "../email/changes";
import { returnWording } from "../email/kickoff";
import type { TriagePlanInput } from "../email/plan";
import { localDateOf } from "../lib/workingDays";

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

const ORG = "org_b6b";
const OTHER = "org_b6b_other";
const OFF = "org_b6b_off";
const TZ = "Europe/Budapest";
// Friday 2026-10-16 10:00 Budapest (08:00 UTC).
const FRIDAY_10 = Date.UTC(2026, 9, 16, 8, 0, 0);

const ADMIN = { subject: "clerk_b6b_admin", orgId: ORG, orgRole: "org:admin" };
const MEMBER = { subject: "clerk_b6b_member", orgId: ORG, orgRole: "org:member" };
const OTHER_ADMIN = { subject: "clerk_b6b_other", orgId: OTHER, orgRole: "org:admin" };
const OFF_ADMIN = { subject: "clerk_b6b_off", orgId: OFF, orgRole: "org:admin" };

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

type Fixture = {
  admin: Id<"users">;
  member: Id<"users">;
  client: Id<"clients">;
  otherClient: Id<"clients">;
  project: Id<"projects">;
  otherProject: Id<"projects">;
  mailbox: Id<"connectors">;
  status: Record<string, Id<"statuses">>;
  auth: AuthContext;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string, orgId: string, role: "admin" | "member") => {
      const id = await ctx.db.insert("users", { name, externalId, email: `${externalId}@agency.test`, createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId, clerkUserId: externalId, userId: id, role, joinedAt: now });
      return id;
    };
    const admin = await mkUser("Tóth Ádám", "clerk_b6b_admin", ORG, "admin");
    const member = await mkUser("Frances", "clerk_b6b_member", ORG, "member");
    const otherAdmin = await mkUser("Other Admin", "clerk_b6b_other", OTHER, "admin");
    const offAdmin = await mkUser("Off Admin", "clerk_b6b_off", OFF, "admin");
    for (const [orgId, actor, enabled] of [[ORG, admin, true], [OTHER, otherAdmin, true], [OFF, offAdmin, false]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: TZ, roundingMinutes: 15, emailTriageEnabled: enabled,
        agentActorUserId: actor, createdAt: now, updatedAt: now, createdBy: actor,
      });
    }
    const status: Record<string, Id<"statuses">> = {};
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      status[s.name] = await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, workflowRole: s.workflowRole, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const design = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 1, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico", currency: "HUF", emailDomains: ["pragmatico.hu"], createdAt: now, updatedAt: now, createdBy: admin,
    });
    const otherClient = await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlo", currency: "HUF", emailDomains: ["arlo.hu"], createdAt: now, updatedAt: now, createdBy: admin,
    });
    const project = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
      defaultAssignees: [{ workCategoryId: design, userId: member }], createdAt: now, updatedAt: now, createdBy: admin,
    });
    const otherProject = await ctx.db.insert("projects", {
      orgId: ORG, clientId: otherClient, name: "Arlo", code: "ARLO", billingType: "retainer", createdAt: now, updatedAt: now, createdBy: admin,
    });
    // A seed mailbox: drafts can be made on it; `devFakeModel` items use the canned outputs.
    const mailbox = await ctx.db.insert("connectors", {
      orgId: ORG, userId: admin, type: "gmail", status: "revoked", devSeed: true, credentialMask: "office@agency.test",
      scopes: [], connectedAt: now, updatedAt: now,
    });
    const auth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    return { admin, member, client, otherClient, project, otherProject, mailbox, status, auth };
  });
}

/** Drain scheduled functions in time order; `horizonMs` stops before later work. */
async function settle(t: T, opts: { horizonMs?: number } = {}): Promise<void> {
  const horizon = opts.horizonMs === undefined ? Infinity : Date.now() + opts.horizonMs;
  for (let i = 0; i < 300; i++) {
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
  const left = await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.state.kind === "pending").map((s) => `${s.name}@${s.scheduledTime - Date.now()}`),
  );
  throw new Error(`settle: scheduled functions did not drain: ${left.join(", ")}`);
}

let seq = 0;

type Planned = {
  thread: Id<"emailThreads">;
  msg: Id<"emailMessages">;
  rows: { banner: Id<"clientRequests">; story: Id<"clientRequests">; ask?: Id<"clientRequests"> };
  itemId: Id<"agentItems">;
  agentThread: Doc<"agentThreads">;
  proposalId: Id<"agentProposals">;
  questionId?: Id<"agentQuestions">;
};

/**
 * An email item with a stored plan: one task, two subtasks (banner, story);
 * optionally an ask row (answered in the kickoff), the story waiting on a
 * question, or an unknown sender with `newClient`.
 */
async function planItem(
  t: T,
  f: Fixture,
  opts: { ask?: boolean; question?: boolean; newSender?: boolean; fake?: boolean } = {},
): Promise<Planned> {
  const n = ++seq;
  const sender = opts.newSender ? { name: "Molnár Judit", email: "judit@zoldkert.hu" } : { name: "Kovács Réka", email: "reka@pragmatico.hu" };
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const thread = await ctx.db.insert("emailThreads", {
      orgId: ORG, connectorId: f.mailbox, gmailThreadId: `b6b-${n}`, subject: "Black Friday kampány – anyagok",
      clientId: opts.newSender ? undefined : f.client, participants: [sender], lastMessageAt: now, waitingOn: "us",
      createdAt: now, updatedAt: now,
    });
    const msg = await ctx.db.insert("emailMessages", {
      orgId: ORG, threadId: thread, connectorId: f.mailbox, gmailMessageId: `b6b-m-${n}`, rfcMessageId: `<b6b-${n}@test>`,
      direction: "inbound", from: sender, to: [{ email: "office@agency.test" }], cc: [], subject: "Black Friday kampány – anyagok",
      bodyText: "Sziasztok! Kérnénk bannereket 1200×628 méretben és egy story méretet az Instagramra. Mikorra lesz kész?",
      attachments: [], sentAt: now, stage: "handled", createdAt: now,
    });
    const row = (text: string, intent: "add" | "ask", constraints?: Array<{ kind: string; value: string }>) =>
      ctx.db.insert("clientRequests", {
        orgId: ORG, clientId: opts.newSender ? undefined : f.client, threadId: thread, messageId: msg, text, intent,
        constraints, disposition: "open", createdAt: now, updatedAt: now,
      });
    const banner = await row("Bannerek 1200×628 méretben.", "add", [{ kind: "size", value: "1200×628" }]);
    const story = await row("Story méret az Instagramra.", "add", [{ kind: "platform", value: "Instagramra" }]);
    const ask = opts.ask ? await row("Mikorra lesz kész?", "ask") : undefined;
    const itemId = await ctx.db.insert("agentItems", {
      orgId: ORG, source: "email", anchor: { type: "emailThread", id: thread }, kind: opts.newSender ? "new_sender" : "request",
      status: "open", messageIds: [msg], messageCount: 1, ...(opts.fake ? { devFakeModel: true } : {}), createdAt: now, updatedAt: now,
    });
    return { thread, msg, rows: { banner, story, ...(ask ? { ask } : {}) }, itemId };
  });
  const prepared = await t.mutation(internal.agentJobs.prepareAgentJob, {
    job: "prepareTask", orgId: ORG, anchor: { type: "emailThread", id: base.thread },
  });
  if (!prepared.ok) throw new Error(prepared.error);
  const agentThread = (await t.run((ctx) => ctx.db.get(prepared.threadId)))!;
  const plan: TriagePlanInput = {
    grouping: "one",
    suggestedGrouping: "one",
    tasks: [
      {
        title: "Black Friday kampány anyagok",
        description: { summary: "Réka bannereket és story méretet kér.", doneWhen: ["Minden méret kész"] },
        ...(opts.newSender ? {} : { projectId: f.project, clientId: f.client }),
        assigneeIds: [f.member],
        subtasks: [
          { title: "Bannerek 1200×628 méretben", assigneeIds: [f.member], requestIds: [base.rows.banner] },
          { title: "Story méret az Instagramra", assigneeIds: [f.member], requestIds: [base.rows.story] },
        ],
      },
    ],
    dispositions: [
      { requestId: base.rows.banner, disposition: "covered", subtask: 0 },
      opts.question
        ? { requestId: base.rows.story, disposition: "question_pending", subtask: 1, question: "Which story size?" }
        : { requestId: base.rows.story, disposition: "covered", subtask: 1 },
      ...(base.rows.ask ? [{ requestId: base.rows.ask, disposition: "answered" as const }] : []),
    ],
    ...(opts.newSender
      ? { newClient: { name: "Zöldkert Kft.", domain: "zoldkert.hu", contact: { name: "Molnár Judit", email: "judit@zoldkert.hu" } } }
      : {}),
  };
  const outcome = await t.mutation(internal.agentActorTools.submitTriagePlan, {
    actor: { orgId: ORG, userId: f.admin }, componentThreadId: agentThread.componentThreadId, plan, acceptGaps: false,
  });
  if (outcome.status !== "stored") throw new Error(`plan not stored: ${JSON.stringify(outcome)}`);
  let questionId: Id<"agentQuestions"> | undefined;
  if (opts.question) {
    ({ questionId } = await t.mutation(internal.agentQuestions.ask, {
      actor: { orgId: ORG, userId: f.admin },
      componentThreadId: agentThread.componentThreadId,
      header: "Countdown",
      question: "Which story size?",
      options: [
        { label: "1080×1920", recommended: true, effect: "answer_here" },
        { label: "Ask Réka", effect: "email_client" },
      ],
      multiSelect: false,
      allowOther: true,
      proposalId: outcome.proposalIds[0],
      blocks: { requestId: base.rows.story },
    }));
  }
  return { ...base, agentThread, proposalId: outcome.proposalIds[0], questionId };
}

const create = (t: T, p: Planned, revision = 1, who = ADMIN) =>
  t.withIdentity(who).mutation(api.email.create.createFromTriage, { itemId: p.itemId, proposals: [{ proposalId: p.proposalId, revision }] });

const get = <Tn extends "agentItems" | "clientRequests" | "agentProposals" | "tasks" | "emailDrafts" | "agentQuestions" | "emailThreads">(
  t: T,
  id: Id<Tn>,
) => t.run((ctx) => ctx.db.get(id));

const all = <Tn extends "tasks" | "emailThreadTasks" | "notifications" | "emailDrafts" | "activityLog" | "clients" | "clientContacts" | "agentRuns" | "agentProposals">(
  t: T,
  table: Tn,
) => t.run((ctx) => ctx.db.query(table).collect());

const assignedNotifications = async (t: T) => (await all(t, "notifications")).filter((n) => n.type === "assigned");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FRIDAY_10);
  modelSlot.current = null;
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Create ──────────────────────────────────────────────────────────────────

describe("createFromTriage", () => {
  it("creates the task + subtasks as the admin, links the thread, converts the ledger, keeps the item kickoff-pending", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { ask: true, fake: true });
    const { undoUntil, undoMs } = await create(t, p);
    expect(undoUntil).toBe(FRIDAY_10 + 10_000);
    expect(undoMs).toBe(10_000); // the toast's duration, by the server clock (B8b)

    const tasks = await all(t, "tasks");
    const parent = tasks.find((x) => !x.parentTaskId)!;
    const subs = tasks.filter((x) => x.parentTaskId === parent._id).sort((a, b) => a._creationTime - b._creationTime);
    expect(parent).toMatchObject({ title: "Black Friday kampány anyagok", projectId: f.project, clientId: f.client, createdBy: f.admin });
    expect(subs.map((s) => s.title)).toEqual(["Bannerek 1200×628 méretben", "Story méret az Instagramra"]);
    expect(await all(t, "emailThreadTasks")).toEqual([expect.objectContaining({ threadId: p.thread, taskId: parent._id, role: "created" })]);

    expect(await get(t, p.rows.banner)).toMatchObject({ disposition: "covered", taskId: parent._id, subtaskId: subs[0]._id });
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "covered", subtaskId: subs[1]._id });
    expect(await get(t, p.rows.ask!)).toMatchObject({ disposition: "open", answerInKickoff: true });

    expect(await get(t, p.proposalId)).toMatchObject({ status: "approved", committedRef: parent._id, decidedBy: f.admin });
    const item = (await get(t, p.itemId))!;
    expect(item).toMatchObject({ status: "open", taskId: parent._id, commit: { outcome: "created", taskIds: [parent._id], undoUntil } });
    const activity = (await all(t, "activityLog")).find((a) => a.type === "task_created_from_email")!;
    expect(activity).toMatchObject({ taskId: parent._id, userId: f.admin, via: "agent", agentProposalId: p.proposalId });

    // Notifications wait for the undo window (D30) …
    expect(await assignedNotifications(t)).toEqual([]);
    expect(await all(t, "emailDrafts")).toEqual([]);
    await settle(t);
    // … then the assignee hears, and the kickoff is drafted (seed: the canned draft).
    expect((await assignedNotifications(t)).map((n) => n.recipientId)).toContain(f.member);
    const [draft] = await all(t, "emailDrafts");
    expect(draft).toMatchObject({ kind: "kickoff", threadId: p.thread, taskId: parent._id, status: "draft", subjectLocked: true });
    expect((await get(t, p.itemId))!.draftId).toBe(draft._id);
  });

  it("refuses: plan gaps, an open row without a disposition, an outdated revision, a plan issue, a removed covering subtask", async () => {
    const t = createT();
    const f = await setup(t);

    const gaps = await planItem(t, f);
    const plan = (await get(t, gaps.itemId))!.plan!;
    await t.run((ctx) =>
      ctx.db.patch(gaps.itemId, { plan: { ...plan, gaps: [{ kind: "missing_disposition", requestId: gaps.rows.story, detail: "Not covered: story" }] } }),
    );
    await expect(create(t, gaps)).rejects.toThrow(/Fix the plan first/);

    const open = await planItem(t, f);
    await t.run((ctx) =>
      ctx.db.insert("clientRequests", {
        orgId: ORG, threadId: open.thread, messageId: open.msg, text: "És még egy hírlevél.", intent: "add",
        disposition: "open", createdAt: Date.now(), updatedAt: Date.now(),
      }),
    );
    await expect(create(t, open)).rejects.toThrow(/Not covered: "És még egy hírlevél\."/);

    const stale = await planItem(t, f);
    await expect(create(t, stale, 2)).rejects.toThrow(STALE_REVISION_MESSAGE);

    const issue = await planItem(t, f);
    await t.run((ctx) => ctx.db.patch(issue.itemId, { planIssue: { kind: "run_incomplete", message: "Retry the plan", at: Date.now() } }));
    await expect(create(t, issue)).rejects.toThrow(/Retry the plan/);

    const edited = await planItem(t, f);
    const proposal = (await get(t, edited.proposalId))!;
    const original = proposal.payload;
    if (original.kind !== "createTask") throw new Error("unreachable");
    // The owner removed the story subtask on the card.
    await t.run((ctx) =>
      ctx.db.patch(edited.proposalId, { editedPayload: { ...original, subtasks: original.subtasks!.slice(0, 1) }, revision: 2 }),
    );
    await expect(create(t, edited, 2)).rejects.toThrow(/Not covered any more/);
    expect(await all(t, "tasks")).toEqual([]); // nothing written by any refusal
  });

  it("a pending question blocks only its subtask: created Stuck with a note; the answer unblocks it", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { question: true });
    await create(t, p);
    const tasks = await all(t, "tasks");
    const parent = tasks.find((x) => !x.parentTaskId)!;
    const [banner, story] = tasks.filter((x) => x.parentTaskId === parent._id).sort((a, b) => a._creationTime - b._creationTime);
    expect(banner.statusId).not.toBe(f.status.Stuck);
    expect(story.statusId).toBe(f.status.Stuck);
    expect(story.description).toContain("Kérdésre vár:");
    expect(story.description).toContain("Which story size?");
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "question_pending" });
    expect(await get(t, p.questionId!)).toMatchObject({ blocks: { requestId: p.rows.story, taskId: parent._id, subtaskId: story._id } });

    // The question was asked inside the prepareTask run (A5: the answer continues its job).
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("agentRuns", {
        orgId: ORG, threadId: p.agentThread._id, agentId: p.agentThread.agentId, userId: f.admin, via: "background",
        job: "prepareTask", status: "succeeded", startedAt: Date.now(),
      });
      await ctx.db.patch(p.questionId!, { runId });
    });
    // After the undo window, the answer continues as the kickoff, not a re-plan of a created plan.
    vi.setSystemTime(FRIDAY_10 + 10_001);
    await t.withIdentity(ADMIN).mutation(api.agentQuestions.answer, { questionId: p.questionId!, optionIndexes: [0] });
    const after = (await get(t, story._id))!;
    expect(after.statusId).toBe(f.status["Next up"]);
    expect(after.description).toBeUndefined();
    // M5: its row is covered on the subtask it blocked.
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "covered", subtaskId: story._id, taskId: parent._id });
    const queued = (await all(t, "agentRuns")).filter((r) => r.questionId === p.questionId);
    expect(queued.map((r) => r.job)).toEqual(["draftReply"]);
  });

  it("newClient: creates the client (with its domain) and the contact, and links the conversation; Undo removes them", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { newSender: true });
    await create(t, p);
    const client = (await all(t, "clients")).find((c) => c.name === "Zöldkert Kft.")!;
    expect(client).toMatchObject({ emailDomains: ["zoldkert.hu"], createdBy: f.admin });
    const contact = (await all(t, "clientContacts")).find((c) => c.email === "judit@zoldkert.hu")!;
    expect(contact).toMatchObject({ clientId: client._id, name: "Molnár Judit", isPrimary: true });
    expect(await get(t, p.thread)).toMatchObject({ clientId: client._id, contactId: contact._id });

    await t.withIdentity(ADMIN).mutation(api.email.create.undoCreate, { itemId: p.itemId });
    expect((await all(t, "clients")).some((c) => c.name === "Zöldkert Kft.")).toBe(false);
    expect((await all(t, "clientContacts")).some((c) => c.email === "judit@zoldkert.hu")).toBe(false);
    expect((await get(t, p.thread))!.clientId).toBeUndefined();
  });
});

// ─── Undo ────────────────────────────────────────────────────────────────────

describe("undoCreate (D30)", () => {
  it("within 10 s removes everything, sends no notification, and the kickoff job no-ops", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { ask: true, fake: true });
    await create(t, p);
    const commitAt = (await get(t, p.itemId))!.commit!.at;
    await vi.advanceTimersByTimeAsync(9_000); // inside the window
    await t.withIdentity(ADMIN).mutation(api.email.create.undoCreate, { itemId: p.itemId });
    // The kickoff job is cancelled — and even if it ran, it no-ops (the commit is gone).
    expect(await t.mutation(internal.email.reply.startKickoffAfterCreate, { itemId: p.itemId, commitAt })).toEqual({ started: false });

    expect(await all(t, "tasks")).toEqual([]);
    expect(await all(t, "emailThreadTasks")).toEqual([]);
    for (const id of [p.rows.banner, p.rows.story, p.rows.ask!]) {
      const row = (await get(t, id))!;
      expect(row.disposition).toBe("open");
      expect(row.subtaskId).toBeUndefined();
      expect(row.answerInKickoff).toBeUndefined();
      expect(row.planned).toBeDefined(); // back to its plan
    }
    expect(await get(t, p.proposalId)).toMatchObject({ status: "pending", revision: 2 });
    const item = (await get(t, p.itemId))!;
    expect(item.commit).toBeUndefined();
    expect(item.taskId).toBeUndefined();
    expect(item.plan).toBeDefined();

    await settle(t);
    expect(await assignedNotifications(t)).toEqual([]);
    expect(await all(t, "emailDrafts")).toEqual([]);
    // Back to the plan: Create works again on the new revision.
    await create(t, p, 2);
    expect((await all(t, "tasks")).filter((x) => !x.parentTaskId)).toHaveLength(1);
  });

  it("is refused after the 10 s window, and when nothing was created", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f);
    await expect(t.withIdentity(ADMIN).mutation(api.email.create.undoCreate, { itemId: p.itemId })).rejects.toThrow(NOTHING_TO_UNDO_MESSAGE);
    await create(t, p);
    vi.setSystemTime(FRIDAY_10 + 10_000);
    await expect(t.withIdentity(ADMIN).mutation(api.email.create.undoCreate, { itemId: p.itemId })).rejects.toThrow(UNDO_EXPIRED_MESSAGE);
    expect((await all(t, "tasks")).length).toBe(3);
  });
});

// ─── Kickoff ─────────────────────────────────────────────────────────────────

describe("the kickoff reply (D21)", () => {
  it("says when we get back (from the earliest due), answers the ask row, lists the owner's client questions", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { ask: true, question: true, fake: true });
    // The owner picked "Ask Réka" (email_client) before Create.
    await t.run((ctx) => ctx.db.patch(p.questionId!, { status: "answered", answer: { optionIndexes: [1] }, answeredBy: f.admin, answeredAt: Date.now() }));
    await create(t, p);
    await settle(t);

    const [draft] = await all(t, "emailDrafts");
    const tasks = await all(t, "tasks");
    const earliest = tasks.filter((x) => x.parentTaskId && x.dueDate).map((x) => x.dueDate!).sort()[0];
    const phrase = returnWording({ earliestDue: earliest, nowMs: FRIDAY_10 + 10_001, tz: TZ, language: "hu" }).text;
    expect(phrase).toBe("2 munkanapon belül"); // Friday + default 2 working days = Tuesday
    expect(draft.kind).toBe("kickoff");
    expect(draft.bodyText).toContain("Kedves Réka!");
    expect(draft.bodyText).toContain(phrase);
    expect(draft.bodyText).toMatch(/^1\. /m); // the owner's client question, numbered
    expect(draft.answersRequestIds).toEqual([p.rows.ask]);
    expect(draft.promiseCandidates).toEqual([{ text: phrase, dueDate: earliest }]);
    expect(draft.bodyText).not.toMatch(/PRG-\d+|Frances/);
  });

  it("refuses a draft that breaks the rules (submitDraft code checks)", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { ask: true, fake: true });
    await create(t, p);
    await settle(t);
    const submit = (bodyText: string, answersRequestIds: string[] = [p.rows.ask!]) =>
      t.mutation(internal.agentActorTools.submitDraft, {
        actor: { orgId: ORG, userId: f.admin }, componentThreadId: p.agentThread.componentThreadId,
        bodyText, answersRequestIds, sourceSummary: "test",
      });
    await expect(submit("Kedves Réka! Hamarosan jelentkezünk.")).rejects.toThrow(/"2 munkanapon belül"/);
    await expect(submit("Kedves Réka! 2 munkanapon belül jelentkezünk.", [])).rejects.toThrow(/answersRequestIds/);
    await expect(submit("Kedves Réka! 2 munkanapon belül jelentkezünk, az ára 150 000 Ft.")).rejects.toThrow(/No prices/);
    // A valid revision is a new version of the same draft (D20).
    const ok = await submit("Kedves Réka!\n\nKöszönjük! 2 munkanapon belül jelentkezünk.\n\nÜdvözlettel,\nÁdám");
    expect(ok).toMatchObject({ kind: "kickoff", version: 2, created: false });
    expect(await all(t, "emailDrafts")).toHaveLength(1);
  });

  it("discarding the kickoff closes the item (created, kickoff discarded)", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { fake: true });
    await create(t, p);
    await settle(t);
    const [draft] = await all(t, "emailDrafts");
    await t.withIdentity(ADMIN).mutation(api.email.drafts.discardDraft, { draftId: draft._id });
    expect(await get(t, p.itemId)).toMatchObject({ status: "done", outcome: "created", kickoffOutcome: "discarded", decidedBy: f.admin });
  });

  it("sending the kickoff closes the item (created, kickoff sent)", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { fake: true });
    await create(t, p);
    await settle(t);
    const [draft] = await all(t, "emailDrafts");
    await t.run(async (ctx) => {
      const out = await ctx.db.insert("emailMessages", {
        orgId: ORG, threadId: p.thread, connectorId: f.mailbox, gmailMessageId: "sent-1", rfcMessageId: "<sent-1@test>",
        direction: "outbound", from: { email: "office@agency.test" }, to: draft.to, cc: [], subject: draft.subject,
        bodyText: draft.bodyText, attachments: [], sentAt: Date.now(), stage: "handled", createdAt: Date.now(),
      });
      await ctx.db.patch(draft._id, { status: "sent", sentMessageId: out });
    });
    await t.mutation(internal.email.send.applySentEffect, { draftId: draft._id, effect: "item" });
    expect(await get(t, p.itemId)).toMatchObject({ status: "done", outcome: "created", kickoffOutcome: "sent" });
  });
});

describe("draftReply through a run (submitDraft tool)", () => {
  it("the kickoff job runs on the item's conversation and its submitDraft call stores the draft", async () => {
    vi.useRealTimers();
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f); // not fake: the real job path
    await create(t, p);
    const item = (await get(t, p.itemId))!;
    // The phrase code computes now (real time) from the earliest subtask due.
    const earliest = (await all(t, "tasks")).filter((x) => x.parentTaskId && x.dueDate).map((x) => x.dueDate!).sort()[0];
    const phrase = returnWording({ earliestDue: earliest, nowMs: Date.now(), tz: TZ, language: "hu" }).text;
    modelSlot.current = mockModel({
      contentSteps: [
        [{
          type: "tool-call", toolCallId: "d1", toolName: "submitDraft",
          input: JSON.stringify({ bodyText: `Kedves Réka!\n\nKöszönjük! ${phrase} jelentkezünk.\n\nÁdám`, answersRequestIds: [], sourceSummary: "plan" }),
        }],
        [{ type: "text", text: "Drafted." }],
      ],
    });
    // The end of the undo window, now (the scheduled one is 10 s away in real time).
    await t.run((ctx) => ctx.db.patch(p.itemId, { commit: { ...item.commit!, undoUntil: Date.now() - 1 } }));
    await t.mutation(internal.email.reply.startKickoffAfterCreate, { itemId: p.itemId, commitAt: item.commit!.at });
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await t.finishInProgressScheduledFunctions();
      const runs = await all(t, "agentRuns");
      if (runs.some((r) => r.job === "draftReply" && r.status !== "queued" && r.status !== "running")) break;
    }
    const run = (await all(t, "agentRuns")).find((r) => r.job === "draftReply")!;
    expect(run).toMatchObject({ status: "succeeded", userId: f.admin, threadId: p.agentThread._id });
    const [draft] = await all(t, "emailDrafts");
    expect(draft).toMatchObject({ kind: "kickoff", agentThreadId: p.agentThread._id, createdBy: "agent" });
    expect((await get(t, p.itemId))!.draftId).toBe(draft._id);
  });
});

// ─── A change on a linked task ───────────────────────────────────────────────

type ChangeFixture = {
  task: Id<"tasks">;
  identifier: string;
  thread: Id<"emailThreads">;
  row: Id<"clientRequests">;
  itemId: Id<"agentItems">;
  agentThread: Doc<"agentThreads">;
  draft: Id<"emailDrafts">;
};

async function changeItem(t: T, f: Fixture, statusName: string, opts: { fake?: boolean } = {}): Promise<ChangeFixture> {
  const n = ++seq;
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const task = await createTask(ctx, f.auth, { title: "Black Friday bannerek", projectId: f.project, assigneeIds: [f.member], statusId: f.status[statusName] }, { notify: false });
    const thread = await ctx.db.insert("emailThreads", {
      orgId: ORG, connectorId: f.mailbox, gmailThreadId: `b6b-c-${n}`, subject: "Black Friday", clientId: f.client,
      participants: [{ name: "Kovács Réka", email: "reka@pragmatico.hu" }], lastMessageAt: now, waitingOn: "us", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("emailThreadTasks", { orgId: ORG, threadId: thread, taskId: task, role: "created", createdAt: now });
    const msg = await ctx.db.insert("emailMessages", {
      orgId: ORG, threadId: thread, connectorId: f.mailbox, gmailMessageId: `b6b-cm-${n}`, rfcMessageId: `<b6b-c-${n}@test>`,
      direction: "inbound", from: { name: "Kovács Réka", email: "reka@pragmatico.hu" }, to: [{ email: "office@agency.test" }], cc: [],
      subject: "Re: Black Friday", bodyText: "És kérnénk egy story méretet is a Facebookra.", attachments: [], sentAt: now,
      stage: "handled", createdAt: now,
    });
    const row = await ctx.db.insert("clientRequests", {
      orgId: ORG, clientId: f.client, threadId: thread, messageId: msg, text: "És kérnénk egy story méretet is a Facebookra.",
      intent: "add", constraints: [{ kind: "platform", value: "Facebookra" }], disposition: "open", createdAt: now, updatedAt: now,
    });
    const itemId = await ctx.db.insert("agentItems", {
      orgId: ORG, source: "email", anchor: { type: "emailThread", id: thread }, kind: "change", status: "open", taskId: task,
      messageIds: [msg], ...(opts.fake ? { devFakeModel: true } : {}), createdAt: now, updatedAt: now,
    });
    return { task, identifier: (await ctx.db.get(task))!.identifier!, thread, row, itemId };
  });
  const draft = await t.mutation(internal.email.drafts.createDraftInternal, {
    orgId: ORG, kind: "completion", threadId: base.thread, taskId: base.task, bodyText: "Kész a banner.", sourceSummary: "test",
  });
  const prepared = await t.mutation(internal.agentJobs.prepareAgentJob, {
    job: "prepareChange", orgId: ORG, anchor: { type: "emailThread", id: base.thread },
  });
  if (!prepared.ok) throw new Error(prepared.error);
  const agentThread = (await t.run((ctx) => ctx.db.get(prepared.threadId)))!;
  return { ...base, agentThread, draft };
}

const propose = (t: T, f: Fixture, c: ChangeFixture, withIds = true, acceptGaps = false) =>
  t.mutation(internal.agentActorTools.proposeTaskUpdate, {
    actor: { orgId: ORG, userId: f.admin },
    componentThreadId: c.agentThread.componentThreadId,
    input: {
      task: c.identifier,
      addSubtasks: [{ title: "Story méret a Facebookra is", assigneeIds: [f.member], ...(withIds ? { requestIds: [c.row] } : {}) }],
    },
    acceptGaps,
  });

describe("a change on a linked task (prepareChange → Apply / Not a change)", () => {
  it("the proposal carries a reopen (code) when the task is in review or done; none when open", async () => {
    const t = createT();
    const f = await setup(t);
    for (const [statusName, reopen] of [["Admin review", true], ["Client review", true], ["Done", true], ["In progress", false]] as const) {
      const c = await changeItem(t, f, statusName);
      const outcome = await propose(t, f, c);
      expect(outcome).toMatchObject({ kind: "change", reopen });
      const proposal = (await get(t, outcome.kind === "change" ? (outcome.proposalIds[0] as Id<"agentProposals">) : ("" as Id<"agentProposals">)))!;
      expect(proposal.taskId).toBe(c.task);
      expect(proposal.payload).toMatchObject({
        kind: "updateTask",
        source: { kind: "email", threadId: c.thread, requestIds: [c.row] },
        subtasks: { add: [{ title: "Story méret a Facebookra is", requestIds: [c.row], dueDate: expect.any(String) }] },
      });
      if (reopen) expect(proposal.payload).toMatchObject({ reopen: { statusId: f.status["In progress"] } });
      else expect(proposal.payload).not.toHaveProperty("reopen");
      expect(await get(t, c.row)).toMatchObject({ disposition: "open", planned: { disposition: "covered", proposalId: proposal._id } });
      expect(await get(t, c.itemId)).toMatchObject({ proposalId: proposal._id, changePlan: { proposalId: proposal._id, gaps: [] } });
    }
  });

  it("an uncovered row is refused once, then stored with the gap — and Apply is blocked", async () => {
    const t = createT();
    const f = await setup(t);
    const c = await changeItem(t, f, "In progress");
    expect(await propose(t, f, c, false)).toMatchObject({ kind: "gaps", gaps: [expect.objectContaining({ kind: "missing_disposition" })] });
    const stored = await propose(t, f, c, false, true);
    expect(stored).toMatchObject({ kind: "change", gaps: [expect.objectContaining({ requestId: c.row })] });
    const proposalId = (stored.kind === "change" ? stored.proposalIds[0] : "") as Id<"agentProposals">;
    await expect(
      t.withIdentity(ADMIN).mutation(api.email.changes.applyChange, { itemId: c.itemId, proposalId, revision: 1 }),
    ).rejects.toThrow(/Fix the change first/);
  });

  it("Apply: reopens, adds the subtask, converts the ledger, logs the email activity, stales the drafts, drafts the kickoff", async () => {
    const t = createT();
    const f = await setup(t);
    const c = await changeItem(t, f, "Admin review", { fake: true });
    const outcome = await propose(t, f, c);
    const proposalId = (outcome.kind === "change" ? outcome.proposalIds[0] : "") as Id<"agentProposals">;
    await expect(
      t.withIdentity(ADMIN).mutation(api.email.changes.applyChange, { itemId: c.itemId, proposalId, revision: 9 }),
    ).rejects.toThrow(STALE_REVISION_MESSAGE);
    await t.withIdentity(ADMIN).mutation(api.email.changes.applyChange, { itemId: c.itemId, proposalId, revision: 1 });

    const task = (await get(t, c.task))!;
    expect(task.statusId).toBe(f.status["In progress"]);
    const [sub] = (await all(t, "tasks")).filter((x) => x.parentTaskId === c.task);
    expect(sub).toMatchObject({ title: "Story méret a Facebookra is", assigneeIds: [f.member] });
    expect(await get(t, c.row)).toMatchObject({ disposition: "covered", taskId: c.task, subtaskId: sub._id });
    expect(await get(t, proposalId)).toMatchObject({ status: "approved", committedRef: c.task });
    const types = (await all(t, "activityLog")).filter((a) => a.taskId === c.task).map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["reopened_from_email", "subtasks_added_from_email"]));
    expect((await get(t, c.draft))!.stale).toMatchObject({ reason: expect.stringContaining("The task changed") });
    expect(await get(t, c.itemId)).toMatchObject({ status: "open", commit: { outcome: "applied", taskIds: [c.task] } });

    await settle(t);
    const kickoff = (await all(t, "emailDrafts")).find((d) => d.kind === "kickoff")!;
    expect(kickoff).toMatchObject({ threadId: c.thread, taskId: c.task });
    expect((await get(t, c.itemId))!.draftId).toBe(kickoff._id);
  });

  it("Not a change: the proposal goes, the rows are dismissed, the item closes", async () => {
    const t = createT();
    const f = await setup(t);
    const c = await changeItem(t, f, "In progress");
    const outcome = await propose(t, f, c);
    await t.withIdentity(ADMIN).mutation(api.email.changes.notAChange, { itemId: c.itemId });
    const proposalId = (outcome.kind === "change" ? outcome.proposalIds[0] : "") as Id<"agentProposals">;
    expect(await get(t, proposalId)).toMatchObject({ status: "discarded", decidedBy: f.admin });
    expect(await get(t, c.row)).toMatchObject({ disposition: "dismissed", dismissedReason: NOT_A_CHANGE_REASON });
    expect(await get(t, c.itemId)).toMatchObject({ status: "done", outcome: "not_a_change" });
  });
});

// ─── I9 + the generic approve ────────────────────────────────────────────────

describe("I9: a pending email change holds the task out of Admin review", () => {
  it("blocks tasks.update and bulkUpdate into the admin_review role until it is decided", async () => {
    const t = createT();
    const f = await setup(t);
    const c = await changeItem(t, f, "In progress");
    await propose(t, f, c);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tasks.update, { id: c.task, statusId: f.status["Admin review"] }),
    ).rejects.toThrow(PENDING_EMAIL_CHANGE_MESSAGE);
    const bulk = await t.withIdentity(ADMIN).mutation(api.tasks.bulkUpdate, {
      taskIds: [c.task], action: { type: "status", statusId: f.status["Admin review"] },
    });
    expect(bulk).toMatchObject({ updated: 0, skipped: [{ taskId: c.task, reason: PENDING_EMAIL_CHANGE_MESSAGE }] });
    // Other moves are not gated.
    await t.withIdentity(ADMIN).mutation(api.tasks.update, { id: c.task, statusId: f.status["Next up"] });

    await t.withIdentity(ADMIN).mutation(api.email.changes.notAChange, { itemId: c.itemId });
    await t.withIdentity(ADMIN).mutation(api.tasks.update, { id: c.task, statusId: f.status["Admin review"] });
    expect((await get(t, c.task))!.statusId).toBe(f.status["Admin review"]);
  });

  it("the generic approve refuses an email updateTask: Apply this from Triage", async () => {
    const t = createT();
    const f = await setup(t);
    const c = await changeItem(t, f, "In progress");
    const outcome = await propose(t, f, c);
    const proposalId = outcome.kind === "change" ? outcome.proposalIds[0] : "";
    await expect(t.withIdentity(ADMIN).mutation(api.agentProposals.approve, { proposalId, revision: 1 })).rejects.toThrow(
      APPLY_FROM_TRIAGE_MESSAGE,
    );
    const all2 = await t.withIdentity(ADMIN).mutation(api.agentProposals.approveAll, {
      threadId: c.agentThread._id, items: [{ proposalId, revision: 1 }],
    });
    expect(all2).toEqual([{ proposalId, result: "failed", reason: APPLY_FROM_TRIAGE_MESSAGE }]);
  });
});

// ─── Merge, approval ─────────────────────────────────────────────────────────

describe("mergeInto (D29)", () => {
  it("only into a task of the same client; then the same change flow (merged link, plan withdrawn, change proposal)", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { fake: true });
    const { same, other } = await t.run(async (ctx) => ({
      same: await createTask(ctx, f.auth, { title: "Black Friday", projectId: f.project, assigneeIds: [f.member] }, { notify: false }),
      other: await createTask(ctx, f.auth, { title: "Arlo landing", projectId: f.otherProject }, { notify: false }),
    }));
    await expect(t.withIdentity(ADMIN).mutation(api.email.changes.mergeInto, { itemId: p.itemId, taskId: other })).rejects.toThrow(
      SAME_CLIENT_MESSAGE,
    );
    await t.withIdentity(ADMIN).mutation(api.email.changes.mergeInto, { itemId: p.itemId, taskId: same });
    expect(await all(t, "emailThreadTasks")).toEqual([expect.objectContaining({ threadId: p.thread, taskId: same, role: "merged" })]);
    expect(await get(t, p.proposalId)).toMatchObject({ status: "discarded" });
    expect(await get(t, p.itemId)).toMatchObject({ kind: "change", taskId: same, merge: { taskId: same } });

    await settle(t); // the canned prepareChange (seed mailbox)
    const item = (await get(t, p.itemId))!;
    const change = (await get(t, item.changePlan!.proposalId))!;
    expect(change.payload).toMatchObject({ kind: "updateTask", taskId: same, source: { kind: "email" } });
    await t.withIdentity(ADMIN).mutation(api.email.changes.applyChange, {
      itemId: p.itemId, proposalId: change._id, revision: change.revision ?? 1,
    });
    expect(await get(t, p.itemId)).toMatchObject({ commit: { outcome: "merged", taskIds: [same] } });
    expect((await all(t, "tasks")).filter((x) => x.parentTaskId === same)).toHaveLength(2);
  });
});

describe("client approval (D32)", () => {
  async function approvalItem(t: T, f: Fixture) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const task = await createTask(ctx, f.auth, { title: "Black Friday", projectId: f.project, statusId: f.status["Client review"] }, { notify: false });
      const thread = await ctx.db.insert("emailThreads", {
        orgId: ORG, connectorId: f.mailbox, gmailThreadId: `b6b-a-${++seq}`, subject: "Black Friday", clientId: f.client,
        participants: [], lastMessageAt: now, waitingOn: "us", createdAt: now, updatedAt: now,
      });
      const itemId = await ctx.db.insert("agentItems", {
        orgId: ORG, source: "email", anchor: { type: "emailThread", id: thread }, kind: "approval", status: "open", taskId: task,
        createdAt: now, updatedAt: now,
      });
      return { task, itemId };
    });
  }

  it("Mark done moves the task to the default done status; Keep leaves it", async () => {
    const t = createT();
    const f = await setup(t);
    const done = await approvalItem(t, f);
    await t.withIdentity(ADMIN).mutation(api.email.decisions.markApprovalDone, { itemId: done.itemId });
    expect(await get(t, done.task)).toMatchObject({ statusId: f.status.Done, statusCategory: "completed" });
    expect(await get(t, done.itemId)).toMatchObject({ status: "done", outcome: "marked_done" });

    const kept = await approvalItem(t, f);
    await t.withIdentity(ADMIN).mutation(api.email.decisions.keepInClientReview, { itemId: kept.itemId });
    expect(await get(t, kept.task)).toMatchObject({ statusId: f.status["Client review"] });
    expect(await get(t, kept.itemId)).toMatchObject({ status: "done", outcome: "kept" });
  });
});

// ─── Access ──────────────────────────────────────────────────────────────────

describe("access (I6, I14)", () => {
  it("members, other orgs and flag-off orgs are refused by every decision", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f);
    const { task } = await t.run(async (ctx) => ({
      task: await createTask(ctx, f.auth, { title: "x", projectId: f.project }, { notify: false }),
    }));
    const calls = (who: typeof ADMIN) => [
      () => create(t, p, 1, who),
      () => t.withIdentity(who).mutation(api.email.create.undoCreate, { itemId: p.itemId }),
      () => t.withIdentity(who).mutation(api.email.changes.applyChange, { itemId: p.itemId, proposalId: p.proposalId, revision: 1 }),
      () => t.withIdentity(who).mutation(api.email.changes.notAChange, { itemId: p.itemId }),
      () => t.withIdentity(who).mutation(api.email.changes.mergeInto, { itemId: p.itemId, taskId: task }),
      () => t.withIdentity(who).mutation(api.email.decisions.markApprovalDone, { itemId: p.itemId }),
      () => t.withIdentity(who).mutation(api.email.decisions.keepInClientReview, { itemId: p.itemId }),
      () => t.withIdentity(who).mutation(api.email.decisions.convertQuestionToTask, { itemId: p.itemId }),
    ];
    for (const call of calls(MEMBER)) await expect(call()).rejects.toThrow("Admin access required");
    for (const call of calls(OTHER_ADMIN)) await expect(call()).rejects.toThrow("Item not found");
    for (const call of calls(OFF_ADMIN)) await expect(call()).rejects.toThrow(EMAIL_TRIAGE_DISABLED_MESSAGE);
    expect(await all(t, "tasks")).toHaveLength(1);
    expect(await get(t, p.itemId)).toMatchObject({ status: "open", kind: "request" });
  });
});

// ─── The seed demo chain (fakeModel) ─────────────────────────────────────────

describe("the seed demo: Réka end to end, Péter's reply", () => {
  const SEED_ADMIN = { subject: "clerk_seed_admin", orgId: ORG, orgRole: "org:admin" };

  async function seedFixture(t: T) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const admin = await ctx.db.insert("users", { name: "Tóth Ádám", email: "adam@agency.test", externalId: "clerk_seed_admin", createdAt: now, updatedAt: now });
      const designer = await ctx.db.insert("users", { name: "Frances", email: "frances@agency.test", externalId: "clerk_seed_fr", createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_seed_admin", userId: admin, role: "admin", joinedAt: now });
      await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_seed_fr", userId: designer, role: "member", joinedAt: now });
      await ctx.db.insert("orgSettings", {
        orgId: ORG, defaultCurrency: "HUF", timezone: TZ, roundingMinutes: 15, agentActorUserId: admin,
        createdAt: now, updatedAt: now, createdBy: admin,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, workflowRole: s.workflowRole, createdAt: now, updatedAt: now, createdBy: admin,
        });
      }
      const design = await ctx.db.insert("workCategories", { orgId: ORG, name: "Design", color: "blue", sortOrder: 1, createdAt: now, updatedAt: now, createdBy: admin });
      const pragmatico = await ctx.db.insert("clients", { orgId: ORG, name: "Pragmatico", currency: "HUF", createdAt: now, updatedAt: now, createdBy: admin });
      await ctx.db.insert("projects", {
        orgId: ORG, clientId: pragmatico, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
        defaultAssignees: [{ workCategoryId: design, userId: designer }], createdAt: now, updatedAt: now, createdBy: admin,
      });
      const arlo = await ctx.db.insert("clients", { orgId: ORG, name: "Arlo", currency: "HUF", createdAt: now, updatedAt: now, createdBy: admin });
      const arloProject = await ctx.db.insert("projects", { orgId: ORG, clientId: arlo, name: "Arlo", code: "ARLO", billingType: "retainer", createdAt: now, updatedAt: now, createdBy: admin });
      const auth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
      await createTask(ctx, auth, { title: "Őszi kampány aloldal", projectId: arloProject, assigneeIds: [admin], dueDate: "2026-10-21" }, { notify: false });
      return { admin, designer };
    });
  }

  const itemFor = async (t: T, needle: string) =>
    t.run(async (ctx) => {
      const thread = (await ctx.db.query("emailThreads").collect()).find((th) => th.subject.includes(needle))!;
      return (await ctx.db.query("agentItems").collect()).find((i) => i.anchor.id === thread._id && (i.status === "open" || i.status === "snoozed"))!;
    });

  it("seed → process → Create → kickoff → follow-up → change → Apply → kickoff again", async () => {
    const t = createT();
    await seedFixture(t);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    await t.mutation(internal.devSeedEmail.process, { orgId: ORG, fakeModel: true });
    await settle(t);

    // Create (as the designated actor), then the kickoff after the undo window.
    const created = await t.mutation(internal.devSeedEmail.create, { orgId: ORG });
    expect(created.taskIds).toHaveLength(1);
    await settle(t);
    let reka = await itemFor(t, "Black Friday");
    expect(reka).toMatchObject({ status: "open", commit: { outcome: "created" } });
    const kickoff = (await get(t, reka.draftId!))!;
    expect(kickoff).toMatchObject({ kind: "kickoff", version: 1, status: "draft" });
    expect(kickoff.bodyText).toContain("Kedves Réka!");
    expect(kickoff.bodyText).toContain("jelentkezünk");
    expect(kickoff.to.map((r) => r.email)).toEqual(["reka@pragmatico.hu"]);
    const parent = created.taskIds[0];
    const subsBefore = (await all(t, "tasks")).filter((x) => x.parentTaskId === parent);
    expect(subsBefore).toHaveLength(5);

    // Réka writes again: "és kérnénk egy story méretet is" → a change on the created task.
    const follow = await t.mutation(internal.devSeedEmail.followUp, { orgId: ORG, fakeModel: true });
    expect(follow.created).toBe(true);
    await settle(t);
    reka = await itemFor(t, "Black Friday");
    expect(reka).toMatchObject({ kind: "change", taskId: parent, changePlan: { gaps: [] } });
    expect((await get(t, kickoff._id))!.stale).toBeDefined(); // Réka wrote again
    const change = (await get(t, reka.changePlan!.proposalId))!;
    expect(change.payload).toMatchObject({
      kind: "updateTask",
      taskId: parent,
      subtasks: { add: [{ title: "Story méret a Facebookra is, a Black Friday bannerek vizuáljával" }] },
    });

    // Apply → the subtask, the ledger, and the kickoff drafted again (a new version).
    await t.mutation(internal.devSeedEmail.applyChange, { orgId: ORG });
    await settle(t);
    const subsAfter = (await all(t, "tasks")).filter((x) => x.parentTaskId === parent);
    expect(subsAfter).toHaveLength(6);
    const newRow = (await t.run((ctx) => ctx.db.query("clientRequests").collect())).find((r) => r.text.includes("Facebookra"))!;
    expect(newRow).toMatchObject({ disposition: "covered", taskId: parent });
    reka = await itemFor(t, "Black Friday");
    expect(reka).toMatchObject({ commit: { outcome: "applied" }, draftId: kickoff._id });
    const revised = (await get(t, kickoff._id))!;
    expect(revised.version).toBe(2);
    expect(revised.stale).toBeUndefined();

    // B8a: every canned turn (plan, kickoff, change, kickoff again) is recorded
    // like a background job run, so its machine prompt never renders as a user
    // turn and its messages fall inside the run's window (the run line).
    const threadId = reka.agentThreadId!;
    const runs = await t.withIdentity(SEED_ADMIN).query(api.agentThreads.listRuns, { threadId });
    expect(runs.map((r) => [r.job, r.via, r.status])).toEqual(
      expect.arrayContaining([
        ["prepareTask", "background", "succeeded"],
        ["draftReply", "background", "succeeded"],
        ["prepareChange", "background", "succeeded"],
      ]),
    );
    const page = await t.withIdentity(SEED_ADMIN).query(api.agentThreads.listMessages, {
      threadId,
      paginationOpts: { numItems: 100, cursor: null },
    });
    const stamps = page.page.map((m) => ({ key: m.key, role: m.role, at: m._creationTime }));
    const windows = runs.map((r) => ({ id: r._id, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, job: r.job, via: r.via, answersQuestion: r.answersQuestion, started: r.started }));
    const hidden = backgroundJobPrompts(stamps, windows);
    const userTurns = stamps.filter((m) => m.role === "user");
    expect(userTurns.length).toBeGreaterThanOrEqual(4);
    expect(userTurns.filter((m) => !hidden.has(m.key))).toEqual([]);
    for (const m of stamps.filter((x) => x.role === "assistant")) {
      expect(runAt(windows, m.at)?.job).toBeTruthy();
    }
  });

  it("Péter's question gets a reply draft; Make it a task instead re-plans as a task", async () => {
    const t = createT();
    await seedFixture(t);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    await t.mutation(internal.devSeedEmail.process, { orgId: ORG, fakeModel: true });
    await settle(t);
    let peter = await itemFor(t, "Őszi kampány");
    const reply = (await get(t, peter.draftId!))!;
    expect(reply).toMatchObject({ kind: "reply", status: "draft" });
    expect(reply.bodyText).toContain("Szia Péter!");
    expect(reply.bodyText).toContain("Az első verzió szerdáig elkészül.");
    expect(reply.answersRequestIds).toHaveLength(1);

    await t.withIdentity(SEED_ADMIN).mutation(api.email.decisions.convertQuestionToTask, { itemId: peter._id });
    await settle(t);
    expect((await get(t, reply._id))!.status).toBe("discarded");
    peter = await itemFor(t, "Őszi kampány");
    expect(peter.forbidReply).toBe(true);
    expect(peter.plan?.reply).toBeUndefined();
    expect(peter.plan?.proposalIds).toHaveLength(1);
    expect(localDateOf(Date.now(), TZ)).toBe("2026-10-16");
  });
});

// ─── Gate review (B6b) ───────────────────────────────────────────────────────

/** A classified client follow-up on the conversation with one new open ledger row, dispatched. */
async function followUp(t: T, f: Fixture, thread: Id<"emailThreads">, text = "És kérnénk egy story méretet is a Facebookra.") {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const th = (await ctx.db.get(thread))!;
    const n = ++seq;
    const msg = await ctx.db.insert("emailMessages", {
      orgId: ORG, threadId: thread, connectorId: f.mailbox, gmailMessageId: `b6b-fu-${n}`, rfcMessageId: `<b6b-fu-${n}@test>`,
      direction: "inbound", from: th.participants[0], to: [{ email: "office@agency.test" }], cc: [], subject: "Re: Black Friday",
      bodyText: text, attachments: [], sentAt: now,
      classification: { intents: ["add"], triggers: [], reasons: ["One more request"], urgent: false, source: "model" },
      stage: "classified", createdAt: now,
    });
    const row = await ctx.db.insert("clientRequests", {
      orgId: ORG, clientId: th.clientId, threadId: thread, messageId: msg, text, intent: "add",
      constraints: [{ kind: "platform", value: "Facebookra" }], disposition: "open", createdAt: now, updatedAt: now,
    });
    return { msg, row };
  });
  await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: ids.msg });
  return ids;
}

/** Create, then let the undo window pass (the canned kickoff is drafted). */
async function createdWithKickoff(t: T, f: Fixture, opts: Parameters<typeof planItem>[2] = {}) {
  const p = await planItem(t, f, { fake: true, ...opts });
  const created = await create(t, p);
  await settle(t);
  const parent = (await all(t, "tasks")).find((x) => !x.parentTaskId && x.title === "Black Friday kampány anyagok" && x._creationTime >= 0)!;
  return { p, parent, undoUntil: created.undoUntil };
}

const answerAfterWindow = async (t: T, p: Planned, optionIndexes: number[]) => {
  await t.run(async (ctx) => {
    const runId = await ctx.db.insert("agentRuns", {
      orgId: ORG, threadId: p.agentThread._id, agentId: p.agentThread.agentId, userId: (await ctx.db.query("users").first())!._id,
      via: "background", job: "prepareTask", status: "succeeded", startedAt: Date.now(),
    });
    await ctx.db.patch(p.questionId!, { runId });
  });
  return await t.withIdentity(ADMIN).mutation(api.agentQuestions.answer, { questionId: p.questionId!, optionIndexes });
};

describe("gate review: clients (H1)", () => {
  it("Judit: the task gets the new client; her follow-up becomes a change that applies", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { newSender: true, fake: true });
    await create(t, p);
    await settle(t);
    const client = (await all(t, "clients")).find((c) => c.name === "Zöldkert Kft.")!;
    const tasks = await all(t, "tasks");
    expect(tasks.every((x) => x.clientId === client._id)).toBe(true); // parent + subtasks

    const { row } = await followUp(t, f, p.thread);
    await settle(t);
    const item = (await get(t, p.itemId))!;
    expect(item).toMatchObject({ kind: "change", changePlan: { gaps: [] } });
    const proposal = (await get(t, item.changePlan!.proposalId))!;
    expect(proposal.payload).toMatchObject({ source: { kind: "email", requestIds: [row] } });
    await t.withIdentity(ADMIN).mutation(api.email.changes.applyChange, { itemId: p.itemId, proposalId: proposal._id, revision: proposal.revision ?? 1 });
    expect(await get(t, row)).toMatchObject({ disposition: "covered" });
    expect(await get(t, p.itemId)).toMatchObject({ commit: { outcome: "applied" } });
  });
});

describe("gate review: one close path, I9 never stranded (H2)", () => {
  it("Decline on a change item discards its pending change — the task can enter review again", async () => {
    const t = createT();
    const f = await setup(t);
    const c = await changeItem(t, f, "In progress");
    const outcome = await propose(t, f, c);
    const proposalId = (outcome.kind === "change" ? outcome.proposalIds[0] : "") as Id<"agentProposals">;
    await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: c.itemId });
    expect(await get(t, proposalId)).toMatchObject({ status: "discarded" });
    expect(await get(t, c.itemId)).toMatchObject({ status: "done", outcome: "declined" });
    await t.withIdentity(ADMIN).mutation(api.tasks.update, { id: c.task, statusId: f.status["Admin review"] });
  });

  it("the generic Done refuses committed and change items and outcomes that don't match the item", async () => {
    const t = createT();
    const f = await setup(t);
    const done = (itemId: Id<"agentItems">, outcome: "created" | "not_a_change" | "marked_done") =>
      t.withIdentity(ADMIN).mutation(api.agentItems.markItemDone, { itemId, outcome });
    const c = await changeItem(t, f, "In progress");
    await propose(t, f, c);
    await expect(done(c.itemId, "not_a_change")).rejects.toThrow(USE_TRIAGE_ACTIONS_MESSAGE);
    const plain = await planItem(t, f);
    await expect(done(plain.itemId, "created")).rejects.toThrow(USE_TRIAGE_ACTIONS_MESSAGE);
    await expect(done(plain.itemId, "marked_done")).rejects.toThrow(USE_TRIAGE_ACTIONS_MESSAGE);
    await create(t, plain);
    await expect(done(plain.itemId, "not_a_change")).rejects.toThrow(USE_TRIAGE_ACTIONS_MESSAGE);
  });

  it("a sent kickoff does not close the item while an email change is pending on a created task", async () => {
    const t = createT();
    const f = await setup(t);
    const { p, parent } = await createdWithKickoff(t, f);
    const pending = await t.run((ctx) =>
      ctx.db.insert("agentProposals", {
        orgId: ORG, threadId: p.agentThread._id, userId: f.admin, taskId: parent._id, status: "pending", revision: 1, createdAt: Date.now(),
        payload: {
          kind: "updateTask", taskId: parent._id, subtasks: { add: [{ title: "x", assigneeIds: [] }] },
          source: { kind: "email", threadId: p.thread, messageId: p.msg },
        },
      }),
    );
    const draft = (await get(t, (await get(t, p.itemId))!.draftId!))!;
    await t.run(async (ctx) => {
      const out = await ctx.db.insert("emailMessages", {
        orgId: ORG, threadId: p.thread, connectorId: f.mailbox, gmailMessageId: "sent-h2", rfcMessageId: "<sent-h2@test>",
        direction: "outbound", from: { email: "office@agency.test" }, to: draft.to, cc: [], subject: draft.subject,
        bodyText: draft.bodyText, attachments: [], sentAt: Date.now(), stage: "handled", createdAt: Date.now(),
      });
      await ctx.db.patch(draft._id, { status: "sent", sentMessageId: out });
    });
    await t.mutation(internal.email.send.applySentEffect, { draftId: draft._id, effect: "item" });
    expect(await get(t, p.itemId)).toMatchObject({ status: "open", kickoffOutcome: "sent" });
    expect(await get(t, pending)).toMatchObject({ status: "pending" });
  });
});

describe("gate review: a change owns only its own rows (M1)", () => {
  it("never the kickoff's ask row or the plan's question row — in the check, Not a change and Apply", async () => {
    const t = createT();
    const f = await setup(t);
    const { p } = await createdWithKickoff(t, f, { ask: true, question: true });
    const storyBefore = (await get(t, p.rows.story))!;
    const { row } = await followUp(t, f, p.thread);
    await settle(t);
    const item = (await get(t, p.itemId))!;
    expect(item.changePlan?.gaps).toEqual([]); // the canned change covers only the new row
    const change = (await get(t, item.changePlan!.proposalId))!;
    expect(change.payload).toMatchObject({ source: { requestIds: [row] } });
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "question_pending", planned: storyBefore.planned });
    expect(await get(t, p.rows.ask!)).toMatchObject({ disposition: "open", answerInKickoff: true, planned: { disposition: "answered" } });

    await t.withIdentity(ADMIN).mutation(api.email.changes.notAChange, { itemId: p.itemId });
    expect(await get(t, row)).toMatchObject({ disposition: "dismissed", dismissedReason: NOT_A_CHANGE_REASON });
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "question_pending" });
    expect(await get(t, p.rows.ask!)).toMatchObject({ disposition: "open", answerInKickoff: true });
    // The kickoff is still due: the item stays open.
    expect(await get(t, p.itemId)).toMatchObject({ status: "open", kind: "request", commit: { outcome: "created" } });
  });

  it("a change proposal naming only its row has no gap, and Apply converts only that row", async () => {
    const t = createT();
    const f = await setup(t);
    const { p, parent } = await createdWithKickoff(t, f, { ask: true, question: true });
    const { row } = await followUp(t, f, p.thread);
    await settle(t);
    const item = (await get(t, p.itemId))!;
    const change = (await get(t, item.changePlan!.proposalId))!;
    await t.withIdentity(ADMIN).mutation(api.email.changes.applyChange, { itemId: p.itemId, proposalId: change._id, revision: change.revision ?? 1 });
    expect(await get(t, row)).toMatchObject({ disposition: "covered", taskId: parent._id });
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "question_pending" });
    expect(await get(t, p.rows.ask!)).toMatchObject({ disposition: "open", answerInKickoff: true });
  });
});

describe("gate review: nothing drafts inside the undo window (M2)", () => {
  it("an answer during the window starts no draftReply; submitDraft is refused; Undo leaves no draft", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { question: true, fake: true });
    await create(t, p);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("agentRuns", {
        orgId: ORG, threadId: p.agentThread._id, agentId: p.agentThread.agentId, userId: f.admin, via: "background",
        job: "prepareTask", status: "succeeded", startedAt: Date.now(),
      });
      await ctx.db.patch(p.questionId!, { runId });
    });
    await t.withIdentity(ADMIN).mutation(api.agentQuestions.answer, { questionId: p.questionId!, optionIndexes: [1] });
    expect((await all(t, "agentRuns")).filter((r) => r.job === "draftReply")).toEqual([]);
    await expect(
      t.mutation(internal.agentActorTools.submitDraft, {
        actor: { orgId: ORG, userId: f.admin }, componentThreadId: p.agentThread.componentThreadId,
        bodyText: "Kedves Réka!", answersRequestIds: [], sourceSummary: "x",
      }),
    ).rejects.toThrow(/undo window/);
    const commitAt = (await get(t, p.itemId))!.commit!.at;
    expect(await t.mutation(internal.email.reply.startKickoffAfterCreate, { itemId: p.itemId, commitAt })).toEqual({ started: false });
    await t.withIdentity(ADMIN).mutation(api.email.create.undoCreate, { itemId: p.itemId });
    await settle(t, { horizonMs: 60_000 });
    expect((await all(t, "emailDrafts")).filter((d) => d.status !== "discarded")).toEqual([]);
    expect((await get(t, p.itemId))!.draftId).toBeUndefined();
    expect((await all(t, "agentRuns")).filter((r) => r.job === "draftReply")).toEqual([]);
  });
});

describe("gate review: answered questions after Create (M3, M5, L2)", () => {
  it("only questions Create bound; a failed unblock never fails the answer and leaves a note", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { question: true });
    await create(t, p);
    const story = (await all(t, "tasks")).find((x) => x.parentTaskId && x.title.startsWith("Story"))!;
    // No default open status to move it to → the unblock fails.
    await t.run(async (ctx) => {
      for (const name of ["Next up", "Inbox"]) await ctx.db.patch(f.status[name], { archivedAt: Date.now() });
    });
    vi.setSystemTime(FRIDAY_10 + 10_001);
    await answerAfterWindow(t, p, [0]);
    expect(await get(t, p.questionId!)).toMatchObject({ status: "answered" });
    expect((await get(t, story._id))!.statusId).toBe(f.status.Stuck);
    expect((await get(t, p.itemId))!.decisionNote?.message).toContain("could not be unblocked");
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "question_pending" }); // rolled back with it

    // A question Create did not bind changes nothing.
    const other = await t.mutation(internal.agentQuestions.ask, {
      actor: { orgId: ORG, userId: f.admin }, componentThreadId: p.agentThread.componentThreadId, header: "Other", question: "?",
      options: [{ label: "a" }, { label: "b" }], multiSelect: false, allowOther: true, blocks: { requestId: p.rows.story },
    });
    await t.run((ctx) => ctx.db.patch(other.questionId, { status: "answered", answer: { optionIndexes: [0] } }));
    expect(await t.mutation(internal.email.create.afterQuestionAnswered, { questionId: other.questionId, actor: { orgId: ORG, userId: f.admin } })).toEqual({ done: "skipped" });
  });

  it("an email_client answer keeps the row question_pending and the subtask blocked; the kickoff asks it", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { question: true, fake: true });
    await create(t, p);
    await t.run((ctx) => ctx.db.patch(p.questionId!, { status: "answered", answer: { optionIndexes: [1] }, answeredBy: f.admin }));
    expect(await t.mutation(internal.email.create.afterQuestionAnswered, { questionId: p.questionId!, actor: { orgId: ORG, userId: f.admin } })).toEqual({ done: "asked_client" });
    const story = (await all(t, "tasks")).find((x) => x.parentTaskId && x.title.startsWith("Story"))!;
    expect(story.statusId).toBe(f.status.Stuck);
    expect(await get(t, p.rows.story)).toMatchObject({ disposition: "question_pending" });
    await settle(t);
    const [draft] = await all(t, "emailDrafts");
    expect(draft.bodyText).toMatch(/^1\. /m);
  });

  it("without a blocked-role status the subtask keeps its default status with the note; the answer strips it", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run((ctx) => ctx.db.patch(f.status.Stuck, { archivedAt: Date.now() }));
    const p = await planItem(t, f, { question: true });
    await create(t, p);
    const story = (await all(t, "tasks")).find((x) => x.parentTaskId && x.title.startsWith("Story"))!;
    expect(story.statusId).not.toBe(f.status.Stuck);
    expect(story.description).toContain("Kérdésre vár:");
    vi.setSystemTime(FRIDAY_10 + 10_001);
    await answerAfterWindow(t, p, [0]);
    expect((await get(t, story._id))!.description).toBeUndefined();
  });
});

describe("gate review: re-plans and late requests (M6)", () => {
  it("Create refuses while a re-plan is pending or running", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f);
    await t.run((ctx) => ctx.db.patch(p.itemId, { needsReplanSince: Date.now() }));
    await expect(create(t, p)).rejects.toThrow(REPLAN_PENDING_MESSAGE);
    await t.run(async (ctx) => {
      await ctx.db.patch(p.itemId, { needsReplanSince: undefined });
      await ctx.db.insert("agentRuns", {
        orgId: ORG, threadId: p.agentThread._id, agentId: p.agentThread.agentId, userId: f.admin, via: "background",
        job: "prepareTask", status: "queued", startedAt: Date.now(),
      });
    });
    await expect(create(t, p)).rejects.toThrow(REPLAN_PENDING_MESSAGE);
  });

  it("after Create, a follow-up classified as a request with new rows becomes a change; the kickoff send is blocked", async () => {
    const t = createT();
    const f = await setup(t);
    const { p, parent } = await createdWithKickoff(t, f);
    // Unlinked thread (no task link) → dispatch decides "request".
    await t.run(async (ctx) => {
      for (const link of await ctx.db.query("emailThreadTasks").collect()) await ctx.db.delete(link._id);
    });
    const { row } = await followUp(t, f, p.thread);
    let item = (await get(t, p.itemId))!;
    expect(item).toMatchObject({ kind: "change", taskId: parent._id });
    const draft = (await get(t, item.draftId!))!;
    const gate = await t.run(async (ctx) =>
      sendGate(draft, await loadSendGateContext(ctx, draft, { expectedVersion: draft.version, approverIsAdmin: true })),
    );
    expect(gate.blocks.map((b) => b.key)).toContain("new_requests");
    await settle(t);
    item = (await get(t, p.itemId))!;
    expect(item.changePlan).toBeDefined();
    expect((await get(t, item.changePlan!.proposalId))!.payload).toMatchObject({ taskId: parent._id, source: { requestIds: [row] } });
  });

  it("sendGate: newer open rows block a kickoff only", () => {
    const base = {
      expectedVersion: 1, approver: { isAdmin: true }, createdByMember: false, pendingChange: null,
      mailbox: { connected: true, label: "x" }, openRequests: [{ id: "r", text: "Story" }], pendingQuestion: false,
      presendFindings: [], attachmentProblems: [], newRequestsSinceCommit: [{ id: "r", text: "Story" }],
    };
    const d = (kind: string) => ({ kind, version: 1, to: [{ email: "a@b.hu" }], cc: [], createdBy: "agent" });
    expect(sendGate(d("kickoff"), base).blocks.map((b) => b.key)).toContain("new_requests");
    expect(sendGate(d("question"), base).blocks.map((b) => b.key)).not.toContain("new_requests");
  });
});

describe("gate review: Undo after a kind change, Merge cleanup, Gmail replies (L1, L3, L4)", () => {
  it("Undo refuses once a new email changed the item's kind", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f);
    await create(t, p);
    await t.run((ctx) => ctx.db.patch(p.itemId, { kind: "change" }));
    await expect(t.withIdentity(ADMIN).mutation(api.email.create.undoCreate, { itemId: p.itemId })).rejects.toThrow(KIND_CHANGED_MESSAGE);
  });

  it("Merge supersedes the plan's open questions", async () => {
    const t = createT();
    const f = await setup(t);
    const p = await planItem(t, f, { question: true });
    const same = await t.run((ctx) => createTask(ctx, f.auth, { title: "Black Friday", projectId: f.project }, { notify: false }));
    await t.withIdentity(ADMIN).mutation(api.email.changes.mergeInto, { itemId: p.itemId, taskId: same });
    expect(await get(t, p.questionId!)).toMatchObject({ status: "superseded" });
  });

  it("a reply from Gmail stales the kickoff and closes the kickoff-pending item (replied_in_gmail)", async () => {
    const t = createT();
    const f = await setup(t);
    const { p } = await createdWithKickoff(t, f);
    const draftId = (await get(t, p.itemId))!.draftId!;
    const result = await t.mutation(internal.email.reply.markRepliedInGmail, { threadId: p.thread, sentAt: Date.now() });
    expect(result).toEqual({ staled: 1, closed: true });
    expect(await get(t, draftId)).toMatchObject({ stale: { reason: expect.stringContaining("You replied in Gmail at") }, status: "discarded" });
    expect(await get(t, p.itemId)).toMatchObject({ status: "done", outcome: "created", kickoffOutcome: "replied_in_gmail" });
    expect(await get(t, p.thread)).toMatchObject({ waitingOn: "client" });
  });
});

describe("gate review: draftReply reads only its own tasks (M4)", () => {
  it("getReplyTaskBundle returns the committed task, not another one", async () => {
    const t = createT();
    const f = await setup(t);
    const { p, parent } = await createdWithKickoff(t, f);
    const other = await t.run((ctx) => createTask(ctx, f.auth, { title: "Other work", projectId: f.project }, { notify: false }));
    const read = (task: Id<"tasks">) =>
      t.query(internal.agentActorTools.getReplyTaskBundle, {
        actor: { orgId: ORG, userId: f.admin }, componentThreadId: p.agentThread.componentThreadId, task,
      });
    expect(await read(parent._id)).toMatchObject({ task: expect.objectContaining({ title: "Black Friday kampány anyagok" }) });
    expect(await read(other)).toBeNull();
  });
});
