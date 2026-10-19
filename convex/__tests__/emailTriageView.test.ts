// @vitest-environment edge-runtime
//
// Email triage B8b (docs/prd-email-triage.md §7.2, §7.6, D24–D27, §5.5, I13,
// I14, E2): the Triage read model (list views, badge, item detail, merge
// candidates), its small actions (Move to Triage, Retry, Plan it), the
// Settings › General "Email triage" group, and the Create event line text —
// with access (admin only), the feature flag and org scoping on each.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { EMAIL_TRIAGE_DISABLED_MESSAGE } from "../email/gate";
import { ALREADY_OPEN_MESSAGE } from "../email/triageView";
import { normalizeIgnoredDomain } from "../email/settings";
import { createdEventText } from "../email/reply";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import type { AuthContext } from "../lib/auth";

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");

const ORG = "org_b8b";
const OTHER = "org_b8b_other";
const OFF = "org_b8b_off";

const ADMIN = { subject: "clerk_b8b_admin", orgId: ORG, orgRole: "org:admin" };
const ADMIN2 = { subject: "clerk_b8b_admin2", orgId: ORG, orgRole: "org:admin" };
const MEMBER = { subject: "clerk_b8b_member", orgId: ORG, orgRole: "org:member" };
const OTHER_ADMIN = { subject: "clerk_b8b_other", orgId: OTHER, orgRole: "org:admin" };
const OFF_ADMIN = { subject: "clerk_b8b_off", orgId: OFF, orgRole: "org:admin" };

const NOW = Date.UTC(2026, 9, 19, 8, 0, 0);

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

type Fixture = {
  admin: Id<"users">;
  admin2: Id<"users">;
  member: Id<"users">;
  client: Id<"clients">;
  project: Id<"projects">;
  mailbox: Id<"connectors">;
  otherMailbox: Id<"connectors">;
  offMailbox: Id<"connectors">;
  status: Record<string, Id<"statuses">>;
};

async function setup(t: T, opts: { actor?: boolean } = {}): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string, orgId: string, role: "admin" | "member") => {
      const id = await ctx.db.insert("users", { name, externalId, email: `${externalId}@agency.test`, createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId, clerkUserId: externalId, userId: id, role, joinedAt: now });
      return id;
    };
    const admin = await mkUser("Tóth Ádám", ADMIN.subject, ORG, "admin");
    const admin2 = await mkUser("Kiss Bence", ADMIN2.subject, ORG, "admin");
    const member = await mkUser("Frances Hall", MEMBER.subject, ORG, "member");
    const otherAdmin = await mkUser("Other Admin", OTHER_ADMIN.subject, OTHER, "admin");
    const offAdmin = await mkUser("Off Admin", OFF_ADMIN.subject, OFF, "admin");
    for (const [orgId, actor, enabled] of [[ORG, admin, true], [OTHER, otherAdmin, true], [OFF, offAdmin, false]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: "Europe/Budapest", roundingMinutes: 15, emailTriageEnabled: enabled,
        ...(opts.actor === false ? {} : { agentActorUserId: actor }),
        createdAt: now, updatedAt: now, createdBy: actor,
      });
    }
    const status: Record<string, Id<"statuses">> = {};
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      status[s.name] = await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, workflowRole: s.workflowRole, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico", currency: "HUF", emailDomains: ["pragmatico.hu"], createdAt: now, updatedAt: now, createdBy: admin,
    });
    const project = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Pragmatico retainer", code: "PRG", billingType: "retainer", createdAt: now, updatedAt: now, createdBy: admin,
    });
    const mk = (orgId: string, userId: Id<"users">, mask: string) =>
      ctx.db.insert("connectors", {
        orgId, userId, type: "gmail", status: "revoked", devSeed: true, credentialMask: mask, scopes: [], connectedAt: now, updatedAt: now,
      });
    const mailbox = await mk(ORG, admin, "office@agency.test");
    const otherMailbox = await mk(OTHER, otherAdmin, "other@agency.test");
    const offMailbox = await mk(OFF, offAdmin, "off@agency.test");
    return { admin, admin2, member, client, project, mailbox, otherMailbox, offMailbox, status };
  });
}

let seq = 0;

/** A conversation with one inbound email and its Triage item. */
async function item(
  t: T,
  f: Fixture,
  over: Partial<Doc<"agentItems">> & { orgId?: string; connector?: Id<"connectors">; noClient?: boolean; sentAt?: number; failed?: boolean } = {},
): Promise<{ itemId: Id<"agentItems">; thread: Id<"emailThreads">; msg: Id<"emailMessages"> }> {
  const n = ++seq;
  const { orgId = ORG, connector = f.mailbox, noClient, sentAt, failed, ...fields } = over;
  return await t.run(async (ctx) => {
    const now = Date.now();
    const at = sentAt ?? now;
    const sender = { name: "Kovács Réka", email: "reka@pragmatico.hu" };
    const thread = await ctx.db.insert("emailThreads", {
      orgId, connectorId: connector, gmailThreadId: `b8b-${n}`, subject: `Black Friday ${n}`,
      clientId: noClient || orgId !== ORG ? undefined : f.client, participants: [sender], lastMessageAt: at, lastInboundAt: at,
      waitingOn: "us", createdAt: now, updatedAt: now,
    });
    const msg = await ctx.db.insert("emailMessages", {
      orgId, threadId: thread, connectorId: connector, gmailMessageId: `b8b-m-${n}`, rfcMessageId: `<b8b-${n}@test>`,
      direction: "inbound", from: sender, to: [{ email: "office@agency.test" }], cc: [], subject: `Black Friday ${n}`,
      bodyText: "Sziasztok!\n\nKérnénk bannereket.\n\n<b>nem HTML</b>\nRéka",
      attachments: [{ name: "brief.pdf", mime: "application/pdf", size: 1200 }],
      sentAt: at, stage: failed ? "failed" : "handled",
      ...(failed ? { stageError: { stage: "received", message: "Couldn't read", attempts: 3 } } : {}),
      createdAt: now,
    });
    const itemId = await ctx.db.insert("agentItems", {
      orgId, source: "email", anchor: { type: "emailThread", id: thread }, kind: "request", status: "open",
      messageIds: [msg], messageCount: 1, createdAt: now, updatedAt: now,
      ...(failed ? { attentions: [{ messageId: msg, stage: "received", message: "Couldn't read the email", attempts: 3, at: now }] } : {}),
      ...fields,
    });
    return { itemId, thread, msg };
  });
}

const PAGE = { numItems: 50, cursor: null };

/** What the screen shows: the pinned changes (Open), then the first page newest email first; null = no Triage. */
async function list(t: T, who: typeof ADMIN, view: "open" | "snoozed" | "done" | "filtered" = "open") {
  const as = t.withIdentity(who);
  const meta = await as.query(api.email.triageView.listMeta, {});
  const page = await as.query(api.email.triageView.listItems, view === "done" ? { view, doneSince: 0, paginationOpts: PAGE } : { view, paginationOpts: PAGE });
  if (!meta) {
    expect(page.page).toEqual([]);
    return null;
  }
  const pinned = view === "open" ? ((await as.query(api.email.triageView.listPinned, {})) ?? []) : [];
  return { rows: [...pinned, ...[...page.page].sort((a, b) => b.at - a.at)], gmailConnected: meta.gmailConnected };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("listItems — access, flag, org", () => {
  it("admins of a flagged org see their org's open items; members, flag-off and other orgs see nothing", async () => {
    const t = createT();
    const f = await setup(t);
    const mine = await item(t, f);
    await item(t, f, { orgId: OTHER, connector: f.otherMailbox });
    await item(t, f, { orgId: OFF, connector: f.offMailbox });

    const result = await list(t, ADMIN);
    expect(result?.rows.map((r) => r._id)).toEqual([mine.itemId]);
    expect(result?.rows[0]).toMatchObject({
      title: expect.stringMatching(/^Black Friday/),
      clientName: "Pragmatico",
      sender: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
      messageCount: 1,
      state: { label: "New", tone: "progress", fresh: true },
    });
    expect(result?.gmailConnected).toBe(true); // the seed mailbox counts

    expect(await list(t, MEMBER)).toBeNull();
    expect(await list(t, OFF_ADMIN)).toBeNull();
    expect((await list(t, OTHER_ADMIN))?.rows).toHaveLength(1);
    expect((await list(t, OTHER_ADMIN))?.rows[0]._id).not.toBe(mine.itemId);
  });

  it("derives the row state per kind; a change is pinned on top, otherwise the newest email first", async () => {
    const t = createT();
    const f = await setup(t);
    const older = await item(t, f, { kind: "needs_look", sentAt: NOW - 60_000 });
    const newer = await item(t, f, { kind: "approval", sentAt: NOW });
    const change = await item(t, f, { kind: "change", sentAt: NOW - 120_000 });
    const failed = await item(t, f, { failed: true, sentAt: NOW - 30_000 });
    const noActor = await item(t, f, {
      sentAt: NOW - 90_000,
      planIssue: { kind: "no_actor", message: "No designated agent actor", at: NOW },
    });
    const rows = (await list(t, ADMIN))!.rows;
    expect(rows.map((r) => r._id)).toEqual([change.itemId, newer.itemId, failed.itemId, older.itemId, noActor.itemId]);
    const by = new Map(rows.map((r) => [r._id, r.state]));
    expect(by.get(older.itemId)).toMatchObject({ label: "Needs a look", tone: "waiting" });
    expect(by.get(newer.itemId)).toMatchObject({ label: "Client approved", tone: "waiting" });
    expect(by.get(change.itemId)).toMatchObject({ label: "New", tone: "progress" });
    expect(by.get(failed.itemId)).toMatchObject({ label: "Couldn't read the email", tone: "waiting" });
    expect(by.get(noActor.itemId)).toMatchObject({ label: "No agent actor set", tone: "waiting" });
  });

  it("the views: Snoozed, Done (since the cutoff) and Filtered; 'Updated · N emails' counts", async () => {
    const t = createT();
    const f = await setup(t);
    const snoozed = await item(t, f, { status: "snoozed", snoozedUntil: NOW + 86_400_000 });
    const done = await item(t, f, { status: "done", outcome: "declined" });
    const filtered = await item(t, f, { status: "filtered", kind: "new_sender", noClient: true });
    const joined = await item(t, f, { messageCount: 3 });

    expect((await list(t, ADMIN, "snoozed"))!.rows.map((r) => [r._id, r.state.label, r.snoozedUntil])).toEqual([
      [snoozed.itemId, "Snoozed", NOW + 86_400_000],
    ]);
    expect((await list(t, ADMIN, "done"))!.rows.map((r) => [r._id, r.state.label, r.state.tone])).toEqual([
      [done.itemId, "Declined", "done"],
    ]);
    const cutoff = await t.withIdentity(ADMIN).query(api.email.triageView.listItems, { view: "done", doneSince: NOW + 1, paginationOpts: PAGE });
    expect(cutoff.page).toEqual([]);
    expect((await list(t, ADMIN, "filtered"))!.rows.map((r) => [r._id, r.state.label, r.clientName])).toEqual([
      [filtered.itemId, "Filtered", null],
    ]);
    const open = (await list(t, ADMIN))!.rows;
    expect(open.map((r) => r._id)).toEqual([joined.itemId]);
    expect(open[0].messageCount).toBe(3);
  });
});

describe("listItems paging + pinned changes, listMeta", () => {
  it("pages by cursor; the open changes are never in a page — listPinned returns them whatever the paging", async () => {
    const t = createT();
    const f = await setup(t);
    const change = await item(t, f, { kind: "change", updatedAt: NOW - 600_000 });
    const a = await item(t, f, { updatedAt: NOW - 3 });
    const b = await item(t, f, { updatedAt: NOW - 2 });
    const c = await item(t, f, { updatedAt: NOW - 1 });
    const as = t.withIdentity(ADMIN);
    const first = await as.query(api.email.triageView.listItems, { view: "open", paginationOpts: { numItems: 2, cursor: null } });
    expect(first.page.map((r) => r._id)).toEqual([c.itemId, b.itemId]);
    expect(first.isDone).toBe(false);
    const second = await as.query(api.email.triageView.listItems, { view: "open", paginationOpts: { numItems: 2, cursor: first.continueCursor } });
    // The change sits on the oldest page by activity, but it is left out of every page …
    const paged = [...first.page, ...second.page].map((r) => r._id);
    expect(paged).toEqual([c.itemId, b.itemId, a.itemId]);
    // … because it is always pinned.
    expect((await as.query(api.email.triageView.listPinned, {}))?.map((r) => r._id)).toEqual([change.itemId]);
    expect(await t.withIdentity(MEMBER).query(api.email.triageView.listPinned, {})).toBeNull();
  });

  it("gmailConnected: any admin's mailbox of the org — a member's mailbox doesn't count", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await t.withIdentity(ADMIN2).query(api.email.triageView.listMeta, {})).toEqual({ gmailConnected: true });
    await t.run((ctx) => ctx.db.patch(f.mailbox, { userId: f.member }));
    expect(await t.withIdentity(ADMIN).query(api.email.triageView.listMeta, {})).toEqual({ gmailConnected: false });
    expect(await t.withIdentity(MEMBER).query(api.email.triageView.listMeta, {})).toBeNull();
    expect(await t.withIdentity(OFF_ADMIN).query(api.email.triageView.listMeta, {})).toBeNull();
  });
});

describe("openCount — the sidebar badge", () => {
  it("counts open items only, and is null without Triage", async () => {
    const t = createT();
    const f = await setup(t);
    await item(t, f);
    await item(t, f);
    await item(t, f, { status: "snoozed" });
    await item(t, f, { status: "filtered" });
    await item(t, f, { status: "done", outcome: "declined" });
    expect(await t.withIdentity(ADMIN).query(api.email.triageView.openCount, {})).toEqual({ count: 2, capped: false });
    expect(await t.withIdentity(MEMBER).query(api.email.triageView.openCount, {})).toBeNull();
    expect(await t.withIdentity(OFF_ADMIN).query(api.email.triageView.openCount, {})).toBeNull();
  });
});

describe("getItem", () => {
  it("returns the stored text untouched, the attachments, the mailbox; null across orgs, for members and flag-off", async () => {
    const t = createT();
    const f = await setup(t);
    const mine = await item(t, f);
    const detail = await t.withIdentity(ADMIN).query(api.email.triageView.getItem, { itemId: mine.itemId });
    expect(detail).toMatchObject({
      _id: mine.itemId,
      clientName: "Pragmatico",
      agentThreadId: null,
      plan: null,
      mailbox: { email: "office@agency.test", connected: false },
    });
    expect(detail!.emails).toHaveLength(1);
    expect(detail!.emails[0].bodyText).toBe("Sziasztok!\n\nKérnénk bannereket.\n\n<b>nem HTML</b>\nRéka");
    expect(detail!.emails[0].attachments).toEqual([{ name: "brief.pdf", mime: "application/pdf", size: 1200, url: null }]);

    // By conversation (an Inbox `?thread=` link).
    const byThread = await t.withIdentity(ADMIN).query(api.email.triageView.getItem, { emailThreadId: mine.thread });
    expect(byThread?._id).toBe(mine.itemId);

    // No live item on the conversation: the most recent one by time (not by status order).
    const older = await item(t, f, { status: "filtered" });
    const newer = await t.run(async (ctx) => {
      await ctx.db.patch(mine.itemId, { status: "done", outcome: "declined" });
      await ctx.db.patch(older.itemId, { anchor: { type: "emailThread", id: mine.thread }, createdAt: NOW - 100_000 });
      return mine.itemId;
    });
    const fallback = await t.withIdentity(ADMIN).query(api.email.triageView.getItem, { emailThreadId: mine.thread });
    expect(fallback?._id).toBe(newer);

    expect(await t.withIdentity(MEMBER).query(api.email.triageView.getItem, { itemId: mine.itemId })).toBeNull();
    expect(await t.withIdentity(OTHER_ADMIN).query(api.email.triageView.getItem, { itemId: mine.itemId })).toBeNull();
    expect(await t.withIdentity(ADMIN).query(api.email.triageView.getItem, { itemId: "garbage" })).toBeNull();
    const off = await item(t, f, { orgId: OFF, connector: f.offMailbox });
    expect(await t.withIdentity(OFF_ADMIN).query(api.email.triageView.getItem, { itemId: off.itemId })).toBeNull();
  });
});

describe("mergeCandidates", () => {
  it("lists the client's open top-level tasks; nothing for a conversation without a client", async () => {
    const t = createT();
    const f = await setup(t);
    const mine = await item(t, f);
    const noClient = await item(t, f, { noClient: true, kind: "new_sender" });
    await t.run(async (ctx) => {
      const user = (await ctx.db.get(f.admin))!;
      const auth: AuthContext = { userId: f.admin, orgId: ORG, orgRole: "admin", isAdmin: true, user };
      const open = await createTask(ctx, auth, { title: "Őszi kampány", projectId: f.project }, { notify: false });
      await createTask(ctx, auth, { title: "Sub", parentTaskId: open }, { notify: false });
      await createTask(ctx, auth, { title: "Lezárt", projectId: f.project, statusId: f.status["Done"] }, { notify: false });
    });
    const candidates = await t.withIdentity(ADMIN).query(api.email.triageView.mergeCandidates, { itemId: mine.itemId });
    expect(candidates?.map((c) => c.title)).toEqual(["Őszi kampány"]);
    expect(await t.withIdentity(ADMIN).query(api.email.triageView.mergeCandidates, { itemId: noClient.itemId })).toEqual([]);
    expect(await t.withIdentity(MEMBER).query(api.email.triageView.mergeCandidates, { itemId: mine.itemId })).toBeNull();
  });
});

describe("promoteFiltered — Move to Triage (D24)", () => {
  it("opens a filtered item and schedules its plan; refuses a second live item, members and flag-off", async () => {
    const t = createT();
    const f = await setup(t);
    const filtered = await item(t, f, { status: "filtered", kind: "new_sender", noClient: true });
    await expect(t.withIdentity(MEMBER).mutation(api.email.triageView.promoteFiltered, { itemId: filtered.itemId })).rejects.toThrow(/Admin/);
    await t.withIdentity(ADMIN).mutation(api.email.triageView.promoteFiltered, { itemId: filtered.itemId });
    const promoted = await t.run((ctx) => ctx.db.get(filtered.itemId));
    expect(promoted).toMatchObject({ status: "open", kind: "new_sender" });
    expect(promoted!.planStartScheduledAt).toBe(NOW);
    await expect(t.withIdentity(ADMIN).mutation(api.email.triageView.promoteFiltered, { itemId: filtered.itemId })).rejects.toThrow(/not in Filtered/);

    // I13: the same conversation already has a live item.
    const second = await t.run(async (ctx) =>
      ctx.db.insert("agentItems", {
        orgId: ORG, source: "email", anchor: { type: "emailThread", id: filtered.thread }, kind: "new_sender", status: "filtered",
        messageIds: [filtered.msg], createdAt: Date.now(), updatedAt: Date.now(),
      }),
    );
    await expect(t.withIdentity(ADMIN).mutation(api.email.triageView.promoteFiltered, { itemId: second })).rejects.toThrow(ALREADY_OPEN_MESSAGE);

    const off = await item(t, f, { orgId: OFF, connector: f.offMailbox, status: "filtered" });
    await expect(t.withIdentity(OFF_ADMIN).mutation(api.email.triageView.promoteFiltered, { itemId: off.itemId })).rejects.toThrow(
      EMAIL_TRIAGE_DISABLED_MESSAGE,
    );
    await expect(t.withIdentity(OTHER_ADMIN).mutation(api.email.triageView.promoteFiltered, { itemId: filtered.itemId })).rejects.toThrow(
      /not found/,
    );
  });
});

describe("retryAttention + planNeedsLook", () => {
  it("Retry restarts the failed stage and clears the attention", async () => {
    const t = createT();
    const f = await setup(t);
    const failed = await item(t, f, { failed: true });
    await expect(t.withIdentity(MEMBER).mutation(api.email.triageView.retryAttention, { itemId: failed.itemId })).rejects.toThrow(/Admin/);
    expect(await t.withIdentity(ADMIN).mutation(api.email.triageView.retryAttention, { itemId: failed.itemId })).toEqual({ retried: 1 });
    expect((await t.run((ctx) => ctx.db.get(failed.itemId)))!.attentions).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(failed.msg)))!.stage).toBe("received");
    await expect(t.withIdentity(ADMIN).mutation(api.email.triageView.retryAttention, { itemId: failed.itemId })).rejects.toThrow(/Nothing to retry/);
  });

  it("Plan it turns a needs-a-look item into a request and starts planning", async () => {
    const t = createT();
    const f = await setup(t);
    const look = await item(t, f, { kind: "needs_look" });
    const request = await item(t, f);
    await t.withIdentity(ADMIN).mutation(api.email.triageView.planNeedsLook, { itemId: look.itemId });
    const after = (await t.run((ctx) => ctx.db.get(look.itemId)))!;
    expect(after).toMatchObject({ kind: "request", planStartScheduledAt: NOW });
    expect(after.agentThreadId).toBeDefined();
    await expect(t.withIdentity(ADMIN).mutation(api.email.triageView.planNeedsLook, { itemId: request.itemId })).rejects.toThrow(
      /needs-a-look/,
    );
    await expect(t.withIdentity(MEMBER).mutation(api.email.triageView.planNeedsLook, { itemId: look.itemId })).rejects.toThrow(/Admin/);
  });
});

describe("decline + undoDecline", () => {
  async function withRows(t: T, f: Fixture) {
    const base = await item(t, f);
    const rows = await t.run(async (ctx) => {
      const now = Date.now();
      const row = (text: string, disposition: "open" | "question_pending") =>
        ctx.db.insert("clientRequests", {
          orgId: ORG, clientId: f.client, threadId: base.thread, messageId: base.msg, text, intent: "add", disposition, createdAt: now, updatedAt: now,
        });
      return [await row("Bannerek", "open"), await row("Story méret?", "question_pending")];
    });
    return { ...base, rows };
  }

  it("Decline returns the toast's undoMs; Undo puts exactly that back (rows, waitingOn, the item)", async () => {
    const t = createT();
    const f = await setup(t);
    const d = await withRows(t, f);
    const res = await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: d.itemId });
    expect(res).toEqual({ dismissed: 2, undoMs: 8_000 });
    expect(await t.run((ctx) => ctx.db.get(d.rows[0]))).toMatchObject({ disposition: "dismissed", dismissedReason: "declined" });

    await expect(t.withIdentity(MEMBER).mutation(api.email.triage.undoDecline, { itemId: d.itemId })).rejects.toThrow(/Admin/);
    vi.setSystemTime(NOW + 5_000);
    await t.withIdentity(ADMIN).mutation(api.email.triage.undoDecline, { itemId: d.itemId });
    const back = (await t.run((ctx) => ctx.db.get(d.itemId)))!;
    expect(back).toMatchObject({ status: "open" });
    expect(back.outcome).toBeUndefined();
    expect(back.declineUndo).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(d.rows[0])))!.disposition).toBe("open");
    expect((await t.run((ctx) => ctx.db.get(d.rows[1])))!.disposition).toBe("question_pending");
    expect((await t.run((ctx) => ctx.db.get(d.thread)))!.waitingOn).toBe("us");
    await expect(t.withIdentity(ADMIN).mutation(api.email.triage.undoDecline, { itemId: d.itemId })).rejects.toThrow(/no decline/);
  });

  it("refuses once the window passed or anything changed (a newer email, a new item)", async () => {
    const t = createT();
    const f = await setup(t);
    const late = await withRows(t, f);
    await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: late.itemId });
    vi.setSystemTime(NOW + 13_000);
    await expect(t.withIdentity(ADMIN).mutation(api.email.triage.undoDecline, { itemId: late.itemId })).rejects.toThrow(/Too late/);

    vi.setSystemTime(NOW);
    const newer = await withRows(t, f);
    await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: newer.itemId });
    await t.run((ctx) => ctx.db.patch(newer.thread, { lastMessageAt: NOW + 1 }));
    await expect(t.withIdentity(ADMIN).mutation(api.email.triage.undoDecline, { itemId: newer.itemId })).rejects.toThrow(/changed/);

    const reopened = await withRows(t, f);
    await t.withIdentity(ADMIN).mutation(api.email.triage.declineItem, { itemId: reopened.itemId });
    await t.run((ctx) =>
      ctx.db.insert("agentItems", {
        orgId: ORG, source: "email", anchor: { type: "emailThread", id: reopened.thread }, kind: "request", status: "open",
        createdAt: NOW, updatedAt: NOW,
      }),
    );
    await expect(t.withIdentity(ADMIN).mutation(api.email.triage.undoDecline, { itemId: reopened.itemId })).rejects.toThrow(/changed/);
  });

  it("promoteFiltered reads the role from orgMembers, not the token", async () => {
    const t = createT();
    const f = await setup(t);
    const filtered = await item(t, f, { status: "filtered", kind: "new_sender", noClient: true });
    const forged = { ...MEMBER, orgRole: "org:admin" };
    await expect(t.withIdentity(forged).mutation(api.email.triageView.promoteFiltered, { itemId: filtered.itemId })).rejects.toThrow(/Admin/);
  });
});

describe("Settings › General › Email triage", () => {
  it("reads and saves the default due date and the ignored domains (admin + flag only, validated)", async () => {
    const t = createT();
    await setup(t);
    expect(await t.withIdentity(ADMIN).query(api.email.settings.get, {})).toMatchObject({
      defaultDueWorkingDays: 2,
      ignoredDomains: [],
      admins: [expect.objectContaining({ name: "Kiss Bence" }), expect.objectContaining({ name: "Tóth Ádám" })],
    });
    expect(await t.withIdentity(MEMBER).query(api.email.settings.get, {})).toBeNull();
    expect(await t.withIdentity(OFF_ADMIN).query(api.email.settings.get, {})).toBeNull();

    await t.withIdentity(ADMIN).mutation(api.email.settings.update, {
      defaultDueWorkingDays: 3,
      ignoredDomains: ["@Newsletter.Example.com", "newsletter.example.com", "*.tools.io"],
    });
    expect(await t.withIdentity(ADMIN).query(api.email.settings.get, {})).toMatchObject({
      defaultDueWorkingDays: 3,
      ignoredDomains: ["newsletter.example.com", "tools.io"],
    });
    await expect(t.withIdentity(ADMIN).mutation(api.email.settings.update, { defaultDueWorkingDays: 2.5 })).rejects.toThrow(/working days/);
    await expect(t.withIdentity(ADMIN).mutation(api.email.settings.update, { defaultDueWorkingDays: 31 })).rejects.toThrow(/working days/);
    await expect(t.withIdentity(ADMIN).mutation(api.email.settings.update, { ignoredDomains: ["not a domain"] })).rejects.toThrow(/not a domain/);
    await expect(t.withIdentity(MEMBER).mutation(api.email.settings.update, { defaultDueWorkingDays: 1 })).rejects.toThrow(/Admin/);
    await expect(t.withIdentity(OFF_ADMIN).mutation(api.email.settings.update, { defaultDueWorkingDays: 1 })).rejects.toThrow(
      EMAIL_TRIAGE_DISABLED_MESSAGE,
    );
  });

  it("sets the agent actor to a current admin only, and clears it", async () => {
    const t = createT();
    const f = await setup(t, { actor: false });
    await t.withIdentity(ADMIN).mutation(api.email.settings.setAgentActor, { userId: f.admin2 });
    expect((await t.withIdentity(ADMIN).query(api.email.settings.get, {}))!.agentActorUserId).toBe(f.admin2);
    await expect(t.withIdentity(ADMIN).mutation(api.email.settings.setAgentActor, { userId: f.member })).rejects.toThrow(/must be an admin/);
    await expect(t.withIdentity(MEMBER).mutation(api.email.settings.setAgentActor, { userId: f.member })).rejects.toThrow(/Admin/);
    await t.withIdentity(ADMIN).mutation(api.email.settings.setAgentActor, { userId: null });
    expect((await t.withIdentity(ADMIN).query(api.email.settings.get, {}))!.agentActorUserId).toBeNull();

    // A saved actor who is no longer an admin is named and flagged.
    await t.run(async (ctx) => {
      const settings = await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique();
      await ctx.db.patch(settings!._id, { agentActorUserId: f.member });
    });
    expect((await t.withIdentity(ADMIN).query(api.email.settings.get, {}))!.agentActor).toEqual({
      _id: f.member,
      name: "Frances Hall",
      isAdmin: false,
    });
  });

  it("normalizes a domain", () => {
    expect(normalizeIgnoredDomain("  @Mail.Pragmatico.HU. ")).toBe("mail.pragmatico.hu");
    expect(() => normalizeIgnoredDomain("localhost")).toThrow(/not a domain/);
  });
});

describe("the Create event line", () => {
  it("names the tasks and who was notified", () => {
    expect(createdEventText(["PRG-132"], ["Frances", "Lili"])).toBe("Created PRG-132 · Frances, Lili notified");
    expect(createdEventText(["PRG-132", "PRG-133"], [])).toBe("Created PRG-132, PRG-133");
  });
});
