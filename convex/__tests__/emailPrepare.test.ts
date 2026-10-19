// @vitest-environment edge-runtime
//
// Email triage B6a (docs/prd-email-triage.md §6.1, §6.4, D6, D18, D25, I6,
// I11, I12, E2): the prepareTask job — triggered by dispatch, its read tools
// (admin only, org-scoped, capped), `submitTriagePlan` (code checks, retry
// once then stored with gaps, proposals + ledger + item), the re-plan merge
// of owner edits, the fail-closed designated actor and the canned seed plans.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { listMessages, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { NO_AGENT_ACTOR_MESSAGE } from "../agentJobs";
import { RUN_INCOMPLETE_MESSAGE } from "../email/prepare";
import { CREATE_FROM_TRIAGE_MESSAGE } from "../agentProposals";
import { EMAIL_ASSISTANT_TOOLS } from "../lib/systemAgents";
import { getToolsForAgent } from "../lib/agentToolRegistry";
import { addCalendarDays, localDateOf } from "../lib/workingDays";
import type { TriagePlanInput } from "../email/plan";
import { getJobStages } from "../lib/agentJobs";
import { computeStageStates } from "../../lib/agents/jobStages";

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

const ORG = "org_b6";
const OTHER = "org_b6_other";
const TZ = "Europe/Budapest";

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

const ADMIN = { subject: "clerk_b6_admin", orgId: ORG, orgRole: "org:admin" };

type Fixture = {
  admin: Id<"users">;
  member: Id<"users">;
  otherAdmin: Id<"users">;
  client: Id<"clients">;
  project: Id<"projects">;
  design: Id<"workCategories">;
  mailbox: Id<"connectors">;
  otherMailbox: Id<"connectors">;
};

async function setup(t: T, opts: { actor?: boolean } = {}): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = (name: string, externalId: string) =>
      ctx.db.insert("users", { name, externalId, email: `${externalId}@agency.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Tóth Ádám", "clerk_b6_admin");
    const member = await mkUser("Frances", "clerk_b6_member");
    const otherAdmin = await mkUser("Other Admin", "clerk_b6_other");
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_b6_admin", userId: admin, role: "admin", joinedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_b6_member", userId: member, role: "member", joinedAt: now });
    await ctx.db.insert("orgMembers", { orgId: OTHER, clerkUserId: "clerk_b6_other", userId: otherAdmin, role: "admin", joinedAt: now });
    for (const [orgId, actor] of [[ORG, admin], [OTHER, otherAdmin]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: TZ, roundingMinutes: 15, emailTriageEnabled: true,
        createdAt: now, updatedAt: now, createdBy: actor,
        ...(opts.actor === false ? {} : { agentActorUserId: actor }),
      });
    }
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
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
    const project = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
      defaultAssignees: [{ workCategoryId: design, userId: member }], createdAt: now, updatedAt: now, createdBy: admin,
    });
    const mailbox = await ctx.db.insert("connectors", {
      orgId: ORG, userId: admin, type: "gmail", status: "connected", scopes: [], connectedAt: now, updatedAt: now,
    });
    const otherMailbox = await ctx.db.insert("connectors", {
      orgId: OTHER, userId: otherAdmin, type: "gmail", status: "connected", scopes: [], connectedAt: now, updatedAt: now,
    });
    return { admin, member, otherAdmin, client, project, design, mailbox, otherMailbox };
  });
}

let seq = 0;
async function newThread(t: T, f: Fixture, opts: { orgId?: string } = {}): Promise<Id<"emailThreads">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const other = opts.orgId === OTHER;
    return await ctx.db.insert("emailThreads", {
      orgId: opts.orgId ?? ORG,
      connectorId: other ? f.otherMailbox : f.mailbox,
      gmailThreadId: `b6-thread-${++seq}`,
      subject: "Black Friday kampány – anyagok",
      clientId: other ? undefined : f.client,
      participants: [],
      lastMessageAt: now,
      waitingOn: "us",
      createdAt: now,
      updatedAt: now,
    });
  });
}

/** A classified inbound message (classification done, dispatch next). */
async function addMessage(
  t: T,
  threadId: Id<"emailThreads">,
  body: string,
  opts: { sentAt?: number; urgent?: boolean; attachments?: Doc<"emailMessages">["attachments"] } = {},
): Promise<Id<"emailMessages">> {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(threadId))!;
    const n = ++seq;
    return await ctx.db.insert("emailMessages", {
      orgId: thread.orgId,
      threadId,
      connectorId: thread.connectorId,
      gmailMessageId: `b6-msg-${n}`,
      rfcMessageId: `<b6-msg-${n}@test>`,
      direction: "inbound",
      from: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
      to: [{ email: "adam@agency.test" }],
      cc: [],
      subject: thread.subject,
      bodyText: body,
      attachments: opts.attachments ?? [],
      sentAt: opts.sentAt ?? Date.now() + n,
      classification: { intents: ["add"], triggers: [], reasons: ["Requests"], urgent: opts.urgent ?? false, source: "model" },
      stage: "classified",
      createdAt: Date.now(),
    });
  });
}

async function addRow(
  t: T,
  threadId: Id<"emailThreads">,
  messageId: Id<"emailMessages">,
  text: string,
  constraints: Array<{ kind: string; value: string }> = [],
): Promise<Id<"clientRequests">> {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(threadId))!;
    return await ctx.db.insert("clientRequests", {
      orgId: thread.orgId, clientId: thread.clientId, threadId, messageId, text,
      constraints: constraints.length > 0 ? constraints : undefined, intent: "add", disposition: "open",
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  });
}

/**
 * Drain the scheduled functions that are due now (real timers: the agent
 * runner streams through timers, which fake timers would stall). Work
 * scheduled for later (none in these flows) is left alone.
 */
async function settle(t: T): Promise<void> {
  for (let i = 0; i < 200; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await t.finishInProgressScheduledFunctions();
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (s) => (s.state.kind === "pending" || s.state.kind === "inProgress") && s.scheduledTime <= Date.now() + 50,
      ),
    );
    if (pending.length === 0) return;
  }
  throw new Error("settle: scheduled functions did not drain");
}

async function dispatch(t: T, messageId: Id<"emailMessages">) {
  await t.mutation(internal.email.pipeline.processInboundMessage, { messageId });
  await settle(t);
}

const itemOf = (t: T, threadId: Id<"emailThreads">) =>
  t.run(async (ctx) => (await ctx.db.query("agentItems").collect()).find((i) => i.anchor.id === threadId)!);
const runs = (t: T) => t.run((ctx) => ctx.db.query("agentRuns").collect());

function recordingModel(args: Parameters<typeof mockModel>[0]) {
  const model = mockModel(args);
  return model as typeof model & { doStreamCalls: Array<Parameters<typeof model.doStream>[0]> };
}

const submitCall = (id: string, plan: TriagePlanInput) => ({
  type: "tool-call" as const, toolCallId: id, toolName: "submitTriagePlan", input: JSON.stringify(plan),
});

/** The anchored Triage conversation of an email thread, created like the job does. */
async function triageThread(t: T, threadId: Id<"emailThreads">, orgId = ORG): Promise<Doc<"agentThreads">> {
  const prepared = await t.mutation(internal.agentJobs.prepareAgentJob, {
    job: "prepareTask", orgId, anchor: { type: "emailThread", id: threadId },
  });
  if (!prepared.ok) throw new Error(prepared.error);
  return (await t.run((ctx) => ctx.db.get(prepared.threadId)))!;
}

/** An open request item on the thread, without running dispatch (no job). */
async function openItem(t: T, threadId: Id<"emailThreads">, messageId: Id<"emailMessages">, extra: Partial<Doc<"agentItems">> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("agentItems", {
      orgId: ORG, source: "email", anchor: { type: "emailThread", id: threadId }, kind: "request", status: "open",
      messageIds: [messageId], messageCount: 1, createdAt: Date.now(), updatedAt: Date.now(), ...extra,
    }),
  );
}

const submitDirect = (t: T, thread: Doc<"agentThreads">, actor: Id<"users">, plan: TriagePlanInput, acceptGaps = false) =>
  t.mutation(internal.agentActorTools.submitTriagePlan, {
    actor: { orgId: thread.orgId, userId: actor }, componentThreadId: thread.componentThreadId, plan, acceptGaps,
  });

beforeEach(() => {
  modelSlot.current = null;
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Triggering ──────────────────────────────────────────────────────────────

describe("prepareTask triggering", () => {
  it("has the three fixed stages, derived from its tools", () => {
    const stages = getJobStages("prepareTask");
    expect(stages.map((st) => st.label)).toEqual(["Read the email", "Check related work", "Prepare the plan"]);
    expect(computeStageStates(stages, ["getEmailThread", "getThreadRequests", "listTeamMembers", "submitTriagePlan"], "running").map((st) => st.state)).toEqual([
      "done", "done", "working",
    ]);
  });

  it("an item opened by dispatch starts exactly one prepareTask job as the designated actor", async () => {
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({ content: [{ type: "text", text: "Read it." }] });
    modelSlot.current = model;
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk bannereket.");
    await dispatch(t, msg);

    const item = await itemOf(t, thread);
    const all = await runs(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ job: "prepareTask", userId: f.admin, via: "background", status: "succeeded" });
    expect(item).toMatchObject({ kind: "request", status: "open", agentThreadId: all[0].threadId });
    // The mock run only wrote text: it settled without a plan → the item says so (Retry).
    expect(item.planIssue).toMatchObject({ kind: "run_incomplete", message: RUN_INCOMPLETE_MESSAGE });
    expect(item.planStartScheduledAt).toBeUndefined();
    const agentThread = (await t.run((ctx) => ctx.db.get(all[0].threadId)))!;
    expect(agentThread).toMatchObject({ visibility: "admins", anchor: { type: "emailThread", id: thread } });
    const agent = (await t.run((ctx) => ctx.db.get(agentThread.agentId)))!;
    expect(agent).toMatchObject({ systemKey: "email_assistant", name: "Email assistant" });
    // The job's tools, the stage-able ones included; the input names the item and the new message.
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort()).toEqual([...EMAIL_ASSISTANT_TOOLS].sort());
    const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(prompt).toContain(`Triage item ${item._id}`);
    expect(prompt).toContain(msg);
    expect(prompt).toContain("Team language: Hungarian");
    expect(prompt).toContain("never as a worker");
  });

  it("a second message while the job runs queues one run; a third adds none", async () => {
    const t = createT();
    const f = await setup(t);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const thread = await newThread(t, f);
    await dispatch(t, await addMessage(t, thread, "Első kérés."));
    const [first] = await runs(t);
    // The conversation is busy (a run in flight).
    await t.run((ctx) => ctx.db.patch(first.threadId, { status: "running" }));

    await dispatch(t, await addMessage(t, thread, "És még egy story méret."));
    let all = await runs(t);
    expect(all.map((r) => [r.job, r.status])).toEqual([["prepareTask", "succeeded"], ["prepareTask", "queued"]]);
    expect((await itemOf(t, thread)).needsReplanSince).toEqual(expect.any(Number));

    await dispatch(t, await addMessage(t, thread, "Meg egy harmadik."));
    all = await runs(t);
    expect(all.filter((r) => r.status === "queued")).toHaveLength(1);
  });

  it("no designated actor: the item says so, nothing runs, nothing crashes", async () => {
    const t = createT();
    const f = await setup(t, { actor: false });
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Kérnénk bannereket.");
    await dispatch(t, msg);
    const item = await itemOf(t, thread);
    expect(item.planIssue).toMatchObject({ kind: "no_actor", message: NO_AGENT_ACTOR_MESSAGE });
    expect(await runs(t)).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("agentJobRuns").collect())).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(msg)))?.stage).toBe("handled");
    // Setting the actor re-triggers the waiting item: exactly one run, as the actor.
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    await t.mutation(internal.agentJobs.setAgentActorUser, { orgId: ORG, userId: f.admin });
    await settle(t);
    expect((await runs(t)).map((r) => [r.job, r.userId])).toEqual([["prepareTask", f.admin]]);
    expect((await itemOf(t, thread)).planIssue?.kind).not.toBe("no_actor");
  });
});

// ─── submitTriagePlan ────────────────────────────────────────────────────────

function rekaPlan(rows: { banner: string; story: string }, f: Fixture, overrides: Partial<TriagePlanInput> = {}): TriagePlanInput {
  return {
    grouping: "one",
    suggestedGrouping: "one",
    tasks: [
      {
        title: "Black Friday kampány anyagok",
        description: { summary: "Réka bannereket és story méretet kér.", doneWhen: ["Minden méret kész"] },
        projectId: f.project,
        clientId: f.client,
        assigneeIds: [f.member],
        subtasks: [
          { title: "Bannerek 1200×628 méretben, jövő szerdáig", assigneeIds: [f.member], requestIds: [rows.banner], duePhrase: "jövő szerdáig" },
          { title: "Story méret az Instagramra", assigneeIds: [f.member], requestIds: [rows.story] },
        ],
        fieldReasons: [{ field: "assigneeIds", reason: "Project routing: Design → Frances", confidence: "sure" }],
      },
    ],
    dispositions: [
      { requestId: rows.banner, disposition: "covered", subtask: 0 },
      { requestId: rows.story, disposition: "covered", subtask: 1 },
    ],
    ...overrides,
  };
}

async function rekaFixture(t: T, f: Fixture) {
  const thread = await newThread(t, f);
  const msg = await addMessage(t, thread, "Jövő szerdáig kellene:\n1. Bannerek 1200×628.\n2. Story méret az Instagramra.");
  const banner = await addRow(t, thread, msg, "Bannerek 1200×628.", [{ kind: "size", value: "1200×628" }]);
  const story = await addRow(t, thread, msg, "Story méret az Instagramra.", [{ kind: "platform", value: "Instagramra" }]);
  return { thread, msg, rows: { banner, story } };
}

describe("submitTriagePlan", () => {
  it("through a run: refuses a plan with gaps once, then stores it WITH the gaps", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    const gappy = rekaPlan(rows, f, { dispositions: [{ requestId: rows.banner, disposition: "covered", subtask: 0 }] });
    const model = recordingModel({
      contentSteps: [[submitCall("s1", gappy)], [submitCall("s2", gappy)], [{ type: "text", text: "Saved." }]],
    });
    modelSlot.current = model;
    await dispatch(t, msg);

    expect(model.doStreamCalls).toHaveLength(3);
    // The first refusal lists the gap for the model …
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("The plan was NOT saved");
    // … the second submit is stored, gaps marked on the item.
    const item = await itemOf(t, thread);
    expect(item.plan?.gaps).toEqual([expect.objectContaining({ kind: "missing_disposition", requestId: rows.story })]);
    expect(item.plan?.proposalIds).toHaveLength(1);
    const proposals = await t.run((ctx) => ctx.db.query("agentProposals").collect());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ status: "pending", threadId: item.agentThreadId });
    const story = await t.run((ctx) => ctx.db.get(rows.story));
    expect(story?.planned).toBeUndefined(); // the gap: no disposition
  });

  it("on success: proposals created + linked, ledger dispositions written, due dates by code", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    const itemId = await openItem(t, thread, msg, { needsReplanSince: 1 });
    const agentThread = await triageThread(t, thread);
    const plan = rekaPlan(rows, f, {
      dispositions: [
        { requestId: rows.banner, disposition: "covered", subtask: 0 },
        { requestId: rows.story, disposition: "question_pending", subtask: 1, question: "Melyik story méret?" },
      ],
    });
    const outcome = await submitDirect(t, agentThread, f.admin, plan);
    expect(outcome).toMatchObject({ status: "stored", planRevision: 1, revised: false, gaps: [] });
    if (outcome.status !== "stored") throw new Error("unreachable");

    const item = (await t.run((ctx) => ctx.db.get(itemId)))!;
    expect(item).toMatchObject({
      proposalId: outcome.proposalIds[0],
      agentThreadId: agentThread._id,
      plan: { planId: `plan_${itemId}`, proposalIds: outcome.proposalIds, revision: 1, gaps: [], grouping: { mode: "one", suggested: "one" } },
    });
    expect(item.needsReplanSince).toBeUndefined(); // no run → this submit saw it

    const proposal = (await t.run((ctx) => ctx.db.get(outcome.proposalIds[0])))!;
    const sentAt = (await t.run((ctx) => ctx.db.get(msg)))!.sentAt;
    const sentDay = localDateOf(sentAt, TZ);
    expect(proposal.payload).toMatchObject({
      kind: "createTask",
      title: "Black Friday kampány anyagok",
      source: { kind: "email", threadId: thread, messageId: msg, requestIds: [rows.banner, rows.story] },
      grouping: { planId: `plan_${itemId}`, index: 1, count: 1 },
    });
    if (proposal.payload.kind !== "createTask") throw new Error("unreachable");
    // "jövő szerdáig" resolved by code (next week's Wednesday); story: default 2 working days.
    const due = proposal.payload.subtasks!.map((s) => s.dueDate!);
    expect(due[0] > sentDay).toBe(true);
    expect(new Date(`${due[0]}T00:00:00Z`).getUTCDay()).toBe(3);
    expect(proposal.payload.dueDate).toBe([...due].sort().at(-1));
    expect(proposal.payload.fieldReasons?.["subtasks.1.dueDate"]?.reason).toBe("No deadline in the email — default 2 working days");
    expect(JSON.parse(proposal.payload.descriptionJson!).content[1].content[0].text).toBe("Kész, ha:");

    const [banner, story] = await t.run(async (ctx) => [await ctx.db.get(rows.banner), await ctx.db.get(rows.story)]);
    expect(banner).toMatchObject({ disposition: "open", planned: { disposition: "covered", proposalId: proposal._id, taskIndex: 0, subtaskIndex: 0, planRevision: 1 } });
    expect(story).toMatchObject({ disposition: "question_pending", planned: { disposition: "question_pending", question: "Melyik story méret?" } });
  });

  it("a bad id is refused with a model-actionable error and nothing is written", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    await openItem(t, thread, msg);
    const agentThread = await triageThread(t, thread);
    const plan = rekaPlan(rows, f);
    plan.tasks[0].subtasks[0].assigneeIds = [f.otherAdmin]; // another org's user
    await expect(submitDirect(t, agentThread, f.admin, plan)).rejects.toThrow(/Unknown team member/);
    expect(await t.run((ctx) => ctx.db.query("agentProposals").collect())).toEqual([]);
  });

  it("only an admin with write access to the Triage conversation may submit", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    await openItem(t, thread, msg);
    const agentThread = await triageThread(t, thread);
    await expect(submitDirect(t, agentThread, f.member, rekaPlan(rows, f))).rejects.toThrow(/Thread not found/);
  });
});

// ─── Re-plan (D25) ───────────────────────────────────────────────────────────

describe("re-plan merge (D25)", () => {
  it("revises the same proposal: owner edits survive unless changedByNewEmail names them", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    const itemId = await openItem(t, thread, msg);
    const agentThread = await triageThread(t, thread);
    const v1 = await submitDirect(t, agentThread, f.admin, rekaPlan(rows, f));
    if (v1.status !== "stored") throw new Error("unreachable");
    const proposalId = v1.proposalIds[0];

    // The owner edits the title and the story subtask's wording.
    const before = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    if (before.payload.kind !== "createTask") throw new Error("unreachable");
    await t.withIdentity(ADMIN).mutation(api.agentProposals.updateDraft, {
      proposalId,
      revision: 1,
      editedPayload: {
        ...before.payload,
        title: "BF anyagok (Ádám)",
        subtasks: before.payload.subtasks!.map((s, i) => (i === 1 ? { ...s, title: "Story az Instagramra (Ádám)" } : s)),
      },
    });

    // A new email: a third request; the agent also renames the task.
    const msg2 = await addMessage(t, thread, "És egy hírlevél is kellene.");
    const news = await addRow(t, thread, msg2, "És egy hírlevél is kellene.");
    await t.run((ctx) => ctx.db.patch(itemId, { needsReplanSince: Date.now() }));
    const v2plan = rekaPlan(rows, f);
    v2plan.tasks[0].title = "Black Friday anyagok + hírlevél";
    v2plan.tasks[0].subtasks.push({ title: "Hírlevél a feliratkozóknak", assigneeIds: [f.member], requestIds: [news] });
    v2plan.dispositions.push({ requestId: news, disposition: "covered", subtask: 2 });
    v2plan.tasks[0].changedByNewEmail = ["subtasks.2"];
    const v2 = await submitDirect(t, agentThread, f.admin, v2plan);
    expect(v2).toMatchObject({ status: "stored", planRevision: 2, revised: true, proposalIds: [proposalId] });

    const after = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    expect(after.revision).toBe(3); // 1 → owner edit 2 → agent revision 3
    expect(after.payload).toMatchObject({ title: "Black Friday anyagok + hírlevél" });
    if (after.editedPayload?.kind !== "createTask") throw new Error("owner edits should survive");
    expect(after.editedPayload.title).toBe("BF anyagok (Ádám)"); // not in changedByNewEmail → kept
    expect(after.editedPayload.subtasks!.map((s) => s.title)).toEqual([
      "Bannerek 1200×628 méretben, jövő szerdáig",
      "Story az Instagramra (Ádám)",
      "Hírlevél a feliratkozóknak",
    ]);
    const item = (await t.run((ctx) => ctx.db.get(itemId)))!;
    expect(item.needsReplanSince).toBeUndefined();
    expect(item.plan?.revision).toBe(2);

    // The title named as changed by the new email → the owner's title gives way.
    v2plan.tasks[0].changedByNewEmail = ["title"];
    await submitDirect(t, agentThread, f.admin, v2plan);
    const third = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    expect(third.editedPayload?.kind === "createTask" ? third.editedPayload.title : "Black Friday anyagok + hírlevél").toBe(
      "Black Friday anyagok + hírlevél",
    );
  });
});

// ─── Read tools ──────────────────────────────────────────────────────────────

describe("email read tools (I6)", () => {
  it("are admin-scoped in the registry", () => {
    const names = ["getEmailThread", "getThreadRequests", "findSimilarTasksForClient", "submitTriagePlan"];
    const member = getToolsForAgent(names, { orgId: ORG, userId: "u" as Id<"users">, isAdmin: false, via: "background" });
    expect(Object.keys(member.tools)).toEqual([]);
    const admin = getToolsForAgent(names, { orgId: ORG, userId: "u" as Id<"users">, isAdmin: true, via: "background" });
    expect(Object.keys(admin.tools).sort()).toEqual([...names].sort());
  });

  it("getEmailThread: admin only, never another org's thread, capped", async () => {
    const t = createT();
    const f = await setup(t);
    const thread = await newThread(t, f);
    for (let i = 0; i < 23; i++) await addMessage(t, thread, `Üzenet ${i}`, { sentAt: 1_000 + i });
    const read = (userId: Id<"users">, orgId = ORG) =>
      t.query(internal.agentActorTools.getEmailThread, { actor: { orgId, userId }, threadId: thread });
    const result = await read(f.admin);
    expect(result).not.toBeNull();
    expect(result!.messages).toHaveLength(20);
    expect(result!.omitted).toMatchObject({ messages: 1, messagesIsLowerBound: true }); // older ones exist
    expect(result!.messages[0].text).toBe("Üzenet 3"); // the latest 20, oldest first
    expect(result!.client).toEqual({ id: f.client, name: "Pragmatico" });
    expect(result!.untrustedEmailContent).toBe(true);
    expect(await read(f.member)).toBeNull();
    expect(await read(f.otherAdmin, OTHER)).toBeNull();
  });

  it("getThreadRequests and findSimilarTasksForClient: admin only, org-scoped", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, rows } = await rekaFixture(t, f);
    await t.run(async (ctx) => {
      const user = (await ctx.db.get(f.admin))!;
      const auth: AuthContext = { userId: f.admin, orgId: ORG, orgRole: "admin", isAdmin: true, user };
      await createTask(ctx, auth, { title: "Black Friday bannerek 2025", projectId: f.project, workCategoryId: f.design, assigneeIds: [f.member] }, { notify: false });
      await createTask(ctx, auth, { title: "Havi riport", projectId: f.project }, { notify: false });
    });
    const requests = await t.query(internal.agentActorTools.getThreadRequests, { actor: { orgId: ORG, userId: f.admin }, threadId: thread });
    expect(requests?.requests.map((r) => [r.id, r.disposition])).toEqual([[rows.banner, "open"], [rows.story, "open"]]);
    expect(requests?.unresolved).toBe(2);
    expect(await t.query(internal.agentActorTools.getThreadRequests, { actor: { orgId: ORG, userId: f.member }, threadId: thread })).toBeNull();
    expect(await t.query(internal.agentActorTools.getThreadRequests, { actor: { orgId: OTHER, userId: f.otherAdmin }, threadId: thread })).toBeNull();

    const similar = await t.query(internal.agentActorTools.findSimilarTasksForClient, {
      actor: { orgId: ORG, userId: f.admin }, clientId: f.client, query: "Black Friday banner", workCategoryId: f.design,
    });
    expect(similar?.tasks.map((r) => r.title)).toEqual(["Black Friday bannerek 2025", "Havi riport"]);
    expect(similar?.tasks[0]).toMatchObject({ workCategoryId: f.design, assignees: [{ id: f.member, name: "Frances" }] });
    expect(similar!.tasks[0].score).toBeGreaterThan(similar!.tasks[1].score);
    expect(await t.query(internal.agentActorTools.findSimilarTasksForClient, { actor: { orgId: ORG, userId: f.member }, clientId: f.client, query: "x" })).toBeNull();
    expect(await t.query(internal.agentActorTools.findSimilarTasksForClient, { actor: { orgId: OTHER, userId: f.otherAdmin }, clientId: f.client, query: "x" })).toBeNull();
  });

  it("getAttachmentText reads an email attachment for an admin only", async () => {
    const t = createT();
    const f = await setup(t);
    const thread = await newThread(t, f);
    const msg = await addMessage(t, thread, "Csatoltam.", { attachments: [{ name: "brief.pdf", mime: "application/pdf", size: 10 }] });
    const read = (userId: Id<"users">, index: number) =>
      t.query(internal.agentActorTools.getEmailAttachmentText, { actor: { orgId: ORG, userId }, emailMessageId: msg, index });
    expect(await read(f.admin, 0)).toMatchObject({ file: { name: "brief.pdf", source: "email" }, status: "not_processed", content: null });
    expect(await read(f.admin, 3)).toBeNull();
    expect(await read(f.member, 0)).toBeNull();
  });
});

// ─── Gate review fixes (B6a) ─────────────────────────────────────────────────

describe("plan identity (re-plan)", () => {
  /** v1: two tasks — A covers the banner, B the story. */
  function twoTasks(rows: { banner: string; story: string }, f: Fixture, order: "AB" | "BA" = "AB"): TriagePlanInput {
    const base = rekaPlan(rows, f);
    const [banner, story] = base.tasks[0].subtasks;
    const A = { ...base.tasks[0], title: "Bannerek", subtasks: [banner] };
    const B = { ...base.tasks[0], title: "Story", subtasks: [story] };
    const tasks = order === "AB" ? [A, B] : [B, A];
    const at = (name: "A" | "B") => (order === "AB" ? (name === "A" ? 0 : 1) : name === "A" ? 1 : 0);
    return {
      ...base,
      grouping: "byDiscipline",
      tasks,
      dispositions: [
        { requestId: rows.banner, disposition: "covered", task: at("A"), subtask: 0 },
        { requestId: rows.story, disposition: "covered", task: at("B"), subtask: 0 },
      ],
    };
  }

  async function v1(t: T) {
    const f = await setup(t);
    const fx = await rekaFixture(t, f);
    const itemId = await openItem(t, fx.thread, fx.msg);
    const agentThread = await triageThread(t, fx.thread);
    const out = await submitDirect(t, agentThread, f.admin, twoTasks(fx.rows, f));
    if (out.status !== "stored") throw new Error("unreachable");
    const [pA, pB] = out.proposalIds;
    return { f, fx, itemId, agentThread, pA, pB };
  }

  const editTitle = async (t: T, proposalId: Id<"agentProposals">, title: string) => {
    const row = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    await t.withIdentity(ADMIN).mutation(api.agentProposals.updateDraft, {
      proposalId, revision: row.revision ?? 1, editedPayload: { ...row.payload, title } as never,
    });
  };

  it("reordered tasks keep their owner edits (matched by covered requests, not position)", async () => {
    const t = createT();
    const { f, fx, agentThread, pA, pB } = await v1(t);
    await editTitle(t, pB, "Story (Ádám)");
    const out = await submitDirect(t, agentThread, f.admin, twoTasks(fx.rows, f, "BA"));
    expect(out).toMatchObject({ status: "stored", proposalIds: [pB, pA], revised: true });
    const b = (await t.run((ctx) => ctx.db.get(pB)))!;
    expect(b.editedPayload?.kind === "createTask" ? b.editedPayload.title : null).toBe("Story (Ádám)");
    expect(b.payload.kind === "createTask" ? b.payload.grouping : null).toMatchObject({ index: 1, count: 2 });
    // An explicit proposalId wins over the overlap.
    const explicit = twoTasks(fx.rows, f, "BA");
    explicit.tasks[0].proposalId = pB;
    expect(await submitDirect(t, agentThread, f.admin, explicit)).toMatchObject({ proposalIds: [pB, pA] });
    explicit.tasks[0].proposalId = "nope";
    await expect(submitDirect(t, agentThread, f.admin, explicit)).rejects.toThrow(/not a proposal of this plan/);
  });

  it("discard P0 + edit P1 + re-plan → P1 keeps its edits, P0 stays discarded; newWork proposes it again", async () => {
    const t = createT();
    const { f, fx, agentThread, pA, pB, itemId } = await v1(t);
    await t.withIdentity(ADMIN).mutation(api.agentProposals.discard, { proposalId: pA });
    await editTitle(t, pB, "Story (Ádám)");
    const out = await submitDirect(t, agentThread, f.admin, twoTasks(fx.rows, f));
    expect(out).toMatchObject({ status: "stored", proposalIds: [pB], skippedDiscarded: [0] });
    expect((await t.run((ctx) => ctx.db.get(pA)))?.status).toBe("discarded");
    const b = (await t.run((ctx) => ctx.db.get(pB)))!;
    expect(b.editedPayload?.kind === "createTask" ? b.editedPayload.title : null).toBe("Story (Ádám)");
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.plan?.proposalIds).toEqual([pB]);
    expect((await t.run((ctx) => ctx.db.query("agentProposals").collect())).length).toBe(2);
    // The banner row is not planned (its task was discarded) — the owner decides.
    expect((await t.run((ctx) => ctx.db.get(fx.rows.banner)))?.planned).toBeUndefined();

    // The new email asks for new banner work → a NEW proposal, the old one stays discarded.
    const again = twoTasks(fx.rows, f);
    again.tasks[0].changedByNewEmail = ["newWork"];
    const out2 = await submitDirect(t, agentThread, f.admin, again);
    if (out2.status !== "stored") throw new Error("unreachable");
    expect(out2.proposalIds).toHaveLength(2);
    expect(out2.proposalIds).not.toContain(pA);
    const fresh = (await t.run((ctx) => ctx.db.get(out2.proposalIds[0])))!;
    expect(fresh.payload.kind === "createTask" ? fresh.payload.fieldReasons?.newWork?.reason : null).toMatch(/discarded an earlier version/);
    expect((await t.run((ctx) => ctx.db.get(pA)))?.status).toBe("discarded");
  });
});

describe("approve paths (B6b owns Create)", () => {
  it("approve and approveAll refuse an email createTask proposal", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    await openItem(t, thread, msg);
    const agentThread = await triageThread(t, thread);
    const out = await submitDirect(t, agentThread, f.admin, rekaPlan(rows, f));
    if (out.status !== "stored") throw new Error("unreachable");
    const proposalId = out.proposalIds[0];
    const admin = t.withIdentity(ADMIN);
    await expect(admin.mutation(api.agentProposals.approve, { proposalId, revision: 1 })).rejects.toThrow(CREATE_FROM_TRIAGE_MESSAGE);
    expect(
      await admin.mutation(api.agentProposals.approveAll, { threadId: agentThread._id, items: [{ proposalId, revision: 1 }] }),
    ).toEqual([{ proposalId, result: "failed", reason: CREATE_FROM_TRIAGE_MESSAGE }]);
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.status).toBe("pending");
    expect(await t.run((ctx) => ctx.db.query("tasks").collect())).toEqual([]);
  });
});

describe("plan scope", () => {
  it("newClient: only for an unknown sender, its own domain and address, never free mail", async () => {
    const t = createT();
    const f = await setup(t);
    const mkUnknown = async (from: string) => {
      const thread = await t.run(async (ctx) =>
        ctx.db.insert("emailThreads", {
          orgId: ORG, connectorId: f.mailbox, gmailThreadId: `b6-new-${++seq}`, subject: "Bemutatkozás",
          participants: [], lastMessageAt: Date.now(), waitingOn: "us", createdAt: Date.now(), updatedAt: Date.now(),
        }),
      );
      const msg = await addMessage(t, thread, "Ajánlatot kérnénk.");
      await t.run((ctx) => ctx.db.patch(msg, { from: { name: "Molnár Judit", email: from } }));
      const row = await addRow(t, thread, msg, "Ajánlatot kérnénk.");
      await openItem(t, thread, msg, { kind: "new_sender" });
      return { thread, row, agentThread: await triageThread(t, thread) };
    };
    const planFor = (row: string, newClient: TriagePlanInput["newClient"]): TriagePlanInput => ({
      grouping: "one",
      suggestedGrouping: "one",
      tasks: [{ title: "Ajánlat", description: { summary: "Új ügyfél.", doneWhen: ["Kész az ajánlat"] }, subtasks: [{ title: "Ajánlat előkészítése", assigneeIds: [], requestIds: [row] }] }],
      dispositions: [{ requestId: row, disposition: "covered", subtask: 0 }],
      newClient,
    });
    const contact = (email: string) => ({ name: "Molnár Judit", email });

    const ok = await mkUnknown("judit@zoldkert.hu");
    expect(await submitDirect(t, ok.agentThread, f.admin, planFor(ok.row, { name: "Zöldkert Kft.", domain: "zoldkert.hu", contact: contact("judit@zoldkert.hu") }))).toMatchObject({ status: "stored" });
    await expect(submitDirect(t, ok.agentThread, f.admin, planFor(ok.row, { name: "X", domain: "other.hu", contact: contact("judit@zoldkert.hu") }))).rejects.toThrow(/not the domain of a sender/);
    await expect(submitDirect(t, ok.agentThread, f.admin, planFor(ok.row, { name: "X", domain: "zoldkert.hu", contact: contact("boss@zoldkert.hu") }))).rejects.toThrow(/not a sender of this conversation/);

    const free = await mkUnknown("judit@gmail.com");
    await expect(submitDirect(t, free.agentThread, f.admin, planFor(free.row, { name: "X", domain: "gmail.com", contact: contact("judit@gmail.com") }))).rejects.toThrow(/free-mail or ignored/);
    await t.run(async (ctx) => {
      const settings = (await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique())!;
      await ctx.db.patch(settings._id, { ignoredEmailDomains: ["zoldkert.hu"] });
    });
    await expect(submitDirect(t, ok.agentThread, f.admin, planFor(ok.row, { name: "X", domain: "zoldkert.hu", contact: contact("judit@zoldkert.hu") }))).rejects.toThrow(/free-mail or ignored/);

    // A conversation with a client never gets a newClient.
    const known = await rekaFixture(t, f);
    await openItem(t, known.thread, known.msg);
    const knownThread = await triageThread(t, known.thread);
    await expect(
      submitDirect(t, knownThread, f.admin, { ...rekaPlan(known.rows, f), newClient: { name: "X", domain: "pragmatico.hu", contact: contact("reka@pragmatico.hu") } }),
    ).rejects.toThrow(/only for an unknown sender/);
  });

  it("a conversation with a client keeps every task with that client", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    await openItem(t, thread, msg);
    const agentThread = await triageThread(t, thread);
    const foreignProject = await t.run(async (ctx) => {
      const other = await ctx.db.insert("clients", { orgId: ORG, name: "Arlo", currency: "HUF", createdAt: 0, updatedAt: 0, createdBy: f.admin });
      return await ctx.db.insert("projects", { orgId: ORG, clientId: other, name: "Arlo", code: "ARLO", billingType: "retainer", createdAt: 0, updatedAt: 0, createdBy: f.admin });
    });
    const plan = rekaPlan(rows, f);
    plan.tasks[0].projectId = foreignProject;
    delete plan.tasks[0].clientId;
    await expect(submitDirect(t, agentThread, f.admin, plan)).rejects.toThrow(/another client than this conversation/);
    // A missing clientId is filled with the conversation's client.
    const fill = rekaPlan(rows, f);
    delete fill.tasks[0].clientId;
    const out = await submitDirect(t, agentThread, f.admin, fill);
    if (out.status !== "stored") throw new Error("unreachable");
    expect((await t.run((ctx) => ctx.db.get(out.proposalIds[0])))?.payload).toMatchObject({ clientId: f.client });
  });
});

describe("runs without a plan + retry", () => {
  it("a run that ends without storing a plan flags the item with its last gaps; retryPlanning starts again", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    const gappy = rekaPlan(rows, f, { dispositions: [{ requestId: rows.banner, disposition: "covered", subtask: 0 }] });
    modelSlot.current = mockModel({ contentSteps: [[submitCall("s1", gappy)], [{ type: "text", text: "I give up." }]] });
    await dispatch(t, msg);
    const item = await itemOf(t, thread);
    expect(item.plan).toBeUndefined();
    expect(item.planIssue).toMatchObject({
      kind: "run_incomplete",
      message: RUN_INCOMPLETE_MESSAGE,
      gaps: [expect.objectContaining({ kind: "missing_disposition", requestId: rows.story })],
    });

    // Retry: admin only; starts a new run.
    await expect(t.withIdentity({ subject: "clerk_b6_member", orgId: ORG, orgRole: "org:member" }).mutation(api.email.prepare.retryPlanning, { itemId: item._id })).rejects.toThrow();
    modelSlot.current = mockModel({ contentSteps: [[submitCall("s2", rekaPlan(rows, f))], [{ type: "text", text: "Done." }]] });
    expect(await t.withIdentity(ADMIN).mutation(api.email.prepare.retryPlanning, { itemId: item._id })).toEqual({ result: "scheduled" });
    await settle(t);
    const after = await itemOf(t, thread);
    expect(after.planIssue).toBeUndefined();
    expect(after.plan?.revision).toBe(1);
    expect(await runs(t)).toHaveLength(2);
  });

  it("an immediate second message starts no second parallel run (queued at most once)", async () => {
    const t = createT();
    const f = await setup(t);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const thread = await newThread(t, f);
    const m1 = await addMessage(t, thread, "Első.");
    const m2 = await addMessage(t, thread, "Második.");
    const m3 = await addMessage(t, thread, "Harmadik.");
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: m1 });
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: m2 });
    await t.mutation(internal.email.pipeline.processInboundMessage, { messageId: m3 });
    await settle(t);
    const all = await runs(t);
    expect(all.filter((r) => r.status === "queued").length).toBeLessThanOrEqual(1);
    expect(all.filter((r) => r.status !== "queued")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.query("agentThreads").collect()))).toHaveLength(1);
  });
});

describe("I12 across mailbox copies", () => {
  it("the disposition check covers the rows of every copy of the conversation", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread, msg, rows } = await rekaFixture(t, f);
    // The same email in a colleague's mailbox, then a message only that mailbox got.
    const copy = await t.run(async (ctx) => {
      const original = (await ctx.db.get(msg))!;
      const mailbox2 = await ctx.db.insert("connectors", {
        orgId: ORG, userId: f.member, type: "gmail", status: "connected", scopes: [], connectedAt: 0, updatedAt: 0,
      });
      const copyThread = await ctx.db.insert("emailThreads", {
        orgId: ORG, connectorId: mailbox2, gmailThreadId: "b6-copy", subject: original.subject, clientId: f.client,
        participants: [], lastMessageAt: 0, waitingOn: "us", createdAt: 0, updatedAt: 0,
      });
      const { _id: _ignored, _creationTime: _c, ...rest } = original;
      void _ignored;
      void _c;
      await ctx.db.insert("emailMessages", { ...rest, threadId: copyThread, connectorId: mailbox2, gmailMessageId: "copy-1" });
      const later = await ctx.db.insert("emailMessages", {
        ...rest, threadId: copyThread, connectorId: mailbox2, gmailMessageId: "copy-2", rfcMessageId: "<copy-2@test>",
        bodyText: "És egy hírlevél is.", sentAt: original.sentAt + 60_000,
      });
      const row = await ctx.db.insert("clientRequests", {
        orgId: ORG, clientId: f.client, threadId: copyThread, messageId: later, text: "És egy hírlevél is.",
        intent: "add", disposition: "open", createdAt: Date.now(), updatedAt: Date.now(),
      });
      return { row };
    });
    await openItem(t, thread, msg);
    const agentThread = await triageThread(t, thread);
    const reads = await t.query(internal.agentActorTools.getThreadRequests, { actor: { orgId: ORG, userId: f.admin }, threadId: thread });
    expect(reads?.requests.map((r) => r.id)).toContain(copy.row);

    const without = await submitDirect(t, agentThread, f.admin, rekaPlan(rows, f));
    expect(without).toMatchObject({ status: "gaps", gaps: [expect.objectContaining({ requestId: copy.row })] });
    const plan = rekaPlan(rows, f);
    plan.tasks[0].subtasks.push({ title: "Hírlevél", assigneeIds: [], requestIds: [copy.row] });
    plan.dispositions.push({ requestId: copy.row, disposition: "covered", subtask: 2 });
    expect(await submitDirect(t, agentThread, f.admin, plan)).toMatchObject({ status: "stored", gaps: [] });
    expect((await t.run((ctx) => ctx.db.get(copy.row)))?.planned).toMatchObject({ disposition: "covered", subtaskIndex: 2 });
  });
});

// ─── The canned seed plans (devSeedEmail:process fakeModel) ─────────────────

describe("fake seed plans", () => {
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
      const project = await ctx.db.insert("projects", {
        orgId: ORG, clientId: pragmatico, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
        defaultAssignees: [{ workCategoryId: design, userId: designer }], createdAt: now, updatedAt: now, createdBy: admin,
      });
      const arlo = await ctx.db.insert("clients", { orgId: ORG, name: "Arlo", currency: "HUF", createdAt: now, updatedAt: now, createdBy: admin });
      const arloProject = await ctx.db.insert("projects", { orgId: ORG, clientId: arlo, name: "Arlo", code: "ARLO", billingType: "retainer", createdAt: now, updatedAt: now, createdBy: admin });
      const auth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
      await createTask(ctx, auth, { title: "Őszi kampány aloldal", projectId: arloProject, assigneeIds: [admin] }, { notify: false });
      return { admin, designer, project };
    });
  }

  it("Réka gets one task with 5 self-explaining subtasks, the right owners and dues, and the countdown question", async () => {
    const t = createT();
    const s = await seedFixture(t);
    await t.mutation(internal.devSeedEmail.seed, { orgId: ORG });
    await t.mutation(internal.devSeedEmail.process, { orgId: ORG, fakeModel: true });
    await settle(t);

    const data = await t.run(async (ctx) => ({
      threads: await ctx.db.query("emailThreads").collect(),
      items: await ctx.db.query("agentItems").collect(),
      rows: await ctx.db.query("clientRequests").collect(),
      proposals: await ctx.db.query("agentProposals").collect(),
      questions: await ctx.db.query("agentQuestions").collect(),
      runs: await ctx.db.query("agentRuns").collect(),
    }));
    expect(data.runs).toEqual([]); // no model run — the canned plans
    const thread = (needle: string) => data.threads.find((th) => th.subject.includes(needle))!;
    const item = (needle: string) => data.items.find((i) => i.anchor.id === thread(needle)._id)!;

    const reka = item("Black Friday");
    expect(reka.plan).toMatchObject({ revision: 1, gaps: [], grouping: { mode: "one", suggested: "one" } });
    const proposal = data.proposals.find((p) => p._id === reka.plan!.proposalIds[0])!;
    if (proposal.payload.kind !== "createTask") throw new Error("unreachable");
    const p = proposal.payload;
    expect(p.title).toBe("Black Friday kampány anyagok");
    expect(p.projectId).toBe(s.project);
    expect(p.subtasks).toHaveLength(5);
    expect(p.subtasks!.map((x) => x.title)).toEqual([
      "Bannerek 1200×628 és 1080×1920 méretben a Black Friday kampányhoz, jövő szerdáig",
      "A bannereken jelezni, hogy a 20% kedvezmény csak a webshopra vonatkozik, az üzletekre nem",
      "Visszaszámláló a landing oldalra, ami péntek éjfélig fut",
      "Hírlevél a meglévő feliratkozóknak a bannerek vizuáljával, kiküldésre készen",
      "Story méret az Instagramra a Black Friday bannerek vizuáljával",
    ]);
    // Owners: Design → the routed designer; no routing for the others → the actor.
    expect(p.subtasks!.map((x) => x.assigneeIds)).toEqual([[s.designer], [s.designer], [s.admin], [s.admin], [s.designer]]);
    // "Jövő szerdáig" from Friday 15:12 → next week's Wednesday, for every subtask and the task.
    const rekaMessage = await t.run(async (ctx) =>
      (await ctx.db.query("emailMessages").collect()).find((m) => m.threadId === thread("Black Friday")._id)!,
    );
    const wednesday = addCalendarDays(localDateOf(rekaMessage.sentAt, TZ), 5);
    expect(p.subtasks!.every((x) => x.dueDate === wednesday)).toBe(true);
    expect(p.dueDate).toBe(wednesday);

    // Every ledger row dispositioned: 4 covered (provisional), the countdown question pending.
    const rows = data.rows.filter((r) => r.threadId === thread("Black Friday")._id);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.planned)).toBe(true);
    expect(rows.map((r) => r.planned!.disposition).sort()).toEqual(["covered", "covered", "covered", "covered", "question_pending"]);
    const countdown = rows.find((r) => r.text.includes("visszaszámláló"))!;
    expect(countdown.disposition).toBe("question_pending");
    const question = data.questions.find((q) => q.agentThreadId === reka.agentThreadId)!;
    expect(question).toMatchObject({
      status: "pending", header: "Countdown", proposalId: proposal._id, proposalRevision: 1,
      askedUserId: s.admin, blocks: { requestId: countdown._id },
    });

    // The conversation shows the plan + question tool calls.
    const agentThread = (await t.run((ctx) => ctx.db.get(reka.agentThreadId!)))!;
    const messages = await t.run((ctx) =>
      listMessages(ctx, components.agent, { threadId: agentThread.componentThreadId, paginationOpts: { cursor: null, numItems: 20 } }),
    );
    expect(messages.page.map((m) => m.message?.role).sort()).toEqual(["assistant", "assistant", "tool", "tool", "user"]);

    // Gábor: urgent → today; Péter: a reply plan; Judit: a new client.
    const gabor = data.proposals.find((x) => x._id === item("rossz ár").plan!.proposalIds[0])!;
    expect(gabor.payload).toMatchObject({ priority: 1, dueDate: localDateOf(Date.now(), TZ) });
    expect(item("Őszi kampány").plan).toMatchObject({ proposalIds: [], reply: { intent: expect.stringContaining("Péter") } });
    const judit = data.proposals.find((x) => x._id === item("Bemutatkozás").plan!.proposalIds[0])!;
    expect(judit.payload).toMatchObject({ newClient: { name: "Zöldkert Kft.", domain: "zoldkert.hu" } });
    expect(data.items.every((i) => !i.plan || i.plan.gaps.length === 0)).toBe(true);

    // Reset removes the seed's Triage threads and everything hanging off them — seed only.
    await t.run((ctx) =>
      ctx.db.insert("agentJobRuns", {
        orgId: ORG, job: "classifyInbound", tier: "llm_step", anchor: { type: "emailThread", id: thread("Black Friday")._id },
        status: "succeeded", startedAt: 0,
      }),
    );
    const keptJobRun = await t.run((ctx) =>
      ctx.db.insert("agentJobRuns", { orgId: ORG, job: "classifyInbound", tier: "llm_step", anchor: { type: "emailThread", id: "real" }, status: "succeeded", startedAt: 0 }),
    );
    const reset = await t.mutation(internal.devSeedEmail.reset, { orgId: ORG });
    expect(reset.deleted).toMatchObject({ agentThreads: 4, agentProposals: 3, agentQuestions: 1, agentJobRuns: 1 });
    const left = await t.run(async (ctx) => ({
      threads: await ctx.db.query("agentThreads").collect(),
      proposals: await ctx.db.query("agentProposals").collect(),
      questions: await ctx.db.query("agentQuestions").collect(),
      jobRuns: await ctx.db.query("agentJobRuns").collect(),
    }));
    expect([left.threads, left.proposals, left.questions]).toEqual([[], [], []]);
    expect(left.jobRuns.map((r) => r._id)).toEqual([keptJobRun]);
  });
});
