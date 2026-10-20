// @vitest-environment edge-runtime
//
// Email triage B3 (docs/prd-email-triage.md D24, D33, D34, D36, §5.2, §7.6,
// §8, I1, I5, I13, I14): the Gmail sync end to end against a FAKE Gmail
// (`gmailClient.setSyncGmailTransportForTesting`) — history cursor, D24
// filter, store, the B4 pipeline to an item, resync, failures, lease, D33.
// Real token path: the connectors hold encrypted test grants (fixed KEK).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { MockLanguageModelV3 } from "ai/test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { __resetSecretCryptoCacheForTests, encryptSecret } from "../lib/secretCrypto";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { setSyncGmailTransportForTesting } from "../email/gmailClient";
import { bytesToBinary } from "../email/mimeParse";
import { MAX_STORED_ATTACHMENT_BYTES, RESYNC_QUERY, SYNC_LEASE_MS } from "../email/syncModel";
import { failStoreForTesting } from "../email/sync";
import type { ClassifyInboundOutput, ScreenSenderOutput } from "../email/jobs";

// ─── Fake model (the B4 pipeline's llm_steps) ────────────────────────────────

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

const calls = { classify: 0, screen: 0 };
let screenResult: ScreenSenderOutput = { possibleClient: true, reason: "Looks like a brief" };

function setModel() {
  modelSlot.current = new MockLanguageModelV3({
    doGenerate: async (options) => {
      const system = options.prompt.find((m) => m.role === "system");
      const systemText = typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
      const user = options.prompt.find((m) => m.role === "user");
      const input = JSON.parse(user && Array.isArray(user.content) && user.content[0]?.type === "text" ? user.content[0].text : "{}");
      let result: unknown;
      if (systemText.includes("You classify ONE inbound client email")) {
        calls.classify++;
        const first = String(input.message?.text ?? "").split("\n")[0] || "Request";
        result = {
          intents: ["add"],
          requests: [{ text: first, constraints: [], intent: "add", refersToRequestId: null }],
          approveHasAction: { hasAction: false, action: null },
          reasons: ["a request"],
          urgent: false,
        } satisfies ClassifyInboundOutput;
      } else if (systemText.includes("You double-check a request ledger")) {
        result = { missing: [] };
      } else {
        calls.screen++;
        result = screenResult;
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
        warnings: [],
      };
    },
  });
}

// ─── Fake Gmail: one mailbox per access token ────────────────────────────────

type FakeMessage = { id: string; threadId: string; labelIds: string[]; internalDate: number; raw: string };
type Mailbox = {
  email: string;
  historyId: number;
  history: Array<{ id: number; added: FakeMessage[] }>;
  messages: Map<string, FakeMessage>;
  /** history.list with a startHistoryId below this answers 404 (expired cursor). */
  expireBelow: number;
  /** The next N messages.get calls fail with this status. */
  failGets: Array<{ status: number; times: number }>;
  /** The Nth messages.get call (1-based) fails with this status. */
  failGetAt?: { call: number; status: number };
  /** Runs before a messages.get answers (e.g. switch the flag off mid-run). */
  onGet?: (id: string) => Promise<void>;
  failProfile?: number;
  gets: string[];
  historyCalls: number;
  listCalls: number;
};
let boxes: Map<string, Mailbox>;
let gmailSeq = 0;

const tokenFor = (email: string) => `tok-${email}`;

function mailbox(email: string): Mailbox {
  let box = boxes.get(tokenFor(email));
  if (!box) {
    box = { email, historyId: 1000, history: [], messages: new Map(), expireBelow: 0, failGets: [], gets: [], historyCalls: 0, listCalls: 0 };
    boxes.set(tokenFor(email), box);
  }
  return box;
}

const toBase64Url = (bin: string) => btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Deliver a message into a mailbox: a new history record (messageAdded). */
function deliver(
  email: string,
  raw: string,
  opts: { labels?: string[]; threadId?: string; id?: string; at?: number } = {},
): FakeMessage {
  const box = mailbox(email);
  const message: FakeMessage = {
    id: opts.id ?? `gm-${++gmailSeq}`,
    threadId: opts.threadId ?? `gt-${gmailSeq}`,
    labelIds: opts.labels ?? ["INBOX", "UNREAD", "CATEGORY_PERSONAL"],
    internalDate: opts.at ?? Date.now(),
    raw: toBase64Url(raw),
  };
  box.messages.set(message.id, message);
  box.historyId += 1;
  box.history.push({ id: box.historyId, added: [message] });
  return message;
}

function installFakeGmail() {
  boxes = new Map();
  setSyncGmailTransportForTesting(async (url, init) => {
    const auth = new Headers(init.headers).get("Authorization") ?? "";
    const token = auth.replace(/^Bearer /, "");
    const box = token.startsWith("tok-") ? mailbox(token.slice(4)) : null;
    if (!box) return Response.json({ error: { code: 401, message: "bad token" } }, { status: 401 });
    const u = new URL(url);
    const path = u.pathname.replace(/^\/gmail\/v1/, "");
    if (path === "/users/me/profile") {
      if (box.failProfile) return Response.json({ error: { code: box.failProfile } }, { status: box.failProfile });
      return Response.json({ emailAddress: box.email, historyId: String(box.historyId) });
    }
    if (path === "/users/me/history") {
      box.historyCalls++;
      const start = Number(u.searchParams.get("startHistoryId"));
      if (start < box.expireBelow) return Response.json({ error: { code: 404, message: "Requested entity was not found." } }, { status: 404 });
      const max = Number(u.searchParams.get("maxResults") ?? 100);
      const offset = Number(u.searchParams.get("pageToken") ?? 0);
      const records = box.history.filter((r) => r.id > start);
      const page = records.slice(offset, offset + max);
      return Response.json({
        history: page.map((r) => ({
          id: String(r.id),
          messages: r.added.map((m) => ({ id: m.id, threadId: m.threadId })),
          messagesAdded: r.added.map((m) => ({ message: { id: m.id, threadId: m.threadId, labelIds: m.labelIds } })),
        })),
        nextPageToken: offset + max < records.length ? String(offset + max) : undefined,
        historyId: String(box.historyId),
      });
    }
    const one = /^\/users\/me\/messages\/([^/]+)$/.exec(path);
    if (one) {
      const id = decodeURIComponent(one[1]);
      box.gets.push(id);
      if (box.onGet) await box.onGet(id);
      if (box.failGetAt && box.gets.length === box.failGetAt.call) {
        return Response.json({ error: { code: box.failGetAt.status, message: "backend error" } }, { status: box.failGetAt.status });
      }
      const fail = box.failGets[0];
      if (fail) {
        fail.times--;
        if (fail.times <= 0) box.failGets.shift();
        return Response.json({ error: { code: fail.status, message: "backend error" } }, { status: fail.status });
      }
      const m = box.messages.get(id);
      if (!m) return Response.json({ error: { code: 404 } }, { status: 404 });
      return Response.json({ id: m.id, threadId: m.threadId, labelIds: m.labelIds, internalDate: String(m.internalDate), sizeEstimate: m.raw.length, raw: m.raw });
    }
    if (path === "/users/me/messages") {
      box.listCalls++;
      expect(u.searchParams.get("q")).toBe(RESYNC_QUERY);
      const since = Date.now() - 7 * 86_400_000;
      const searchable = (m: FakeMessage) =>
        (m.labelIds.includes("INBOX") || m.labelIds.includes("SENT")) && !m.labelIds.some((l) => l.startsWith("CATEGORY_") && l !== "CATEGORY_PERSONAL");
      const all = [...box.messages.values()]
        .filter((m) => m.internalDate >= since && searchable(m))
        .sort((a, b) => b.internalDate - a.internalDate);
      const max = Number(u.searchParams.get("maxResults") ?? 100);
      const offset = Number(u.searchParams.get("pageToken") ?? 0);
      return Response.json({
        messages: all.slice(offset, offset + max).map((m) => ({ id: m.id, threadId: m.threadId })),
        nextPageToken: offset + max < all.length ? String(offset + max) : undefined,
      });
    }
    return Response.json({ error: { code: 404 } }, { status: 404 });
  });
}

// ─── Messages ────────────────────────────────────────────────────────────────

const CRLF = "\r\n";
const utf8bin = (s: string) => bytesToBinary(new TextEncoder().encode(s));
let rfcSeq = 0;

function mail(o: {
  from: string;
  to?: string;
  subject?: string;
  body?: string;
  messageId?: string;
  inReplyTo?: string;
  headers?: string[];
  attachment?: { name: string; mime: string; base64: string };
  /** Gmail's Authentication-Results; default: a DMARC pass for the From domain. null = none. */
  auth?: string | null;
}): { raw: string; messageId: string } {
  const fromDomain = /@([^>\s]+)>?\s*$/.exec(o.from)?.[1] ?? "invalid";
  const auth =
    o.auth === undefined
      ? `mx.google.com; dkim=pass header.i=@${fromDomain}; spf=pass smtp.mailfrom=bounce@${fromDomain}; dmarc=pass (p=NONE) header.from=${fromDomain}`
      : o.auth;
  const messageId = o.messageId ?? `<rfc-${++rfcSeq}@mail.test>`;
  const head = [
    ...(auth ? [`Authentication-Results: ${auth}`] : []),
    `From: ${o.from}`,
    `To: ${o.to ?? "adam@konverted.io"}`,
    `Subject: ${o.subject ?? "Black Friday bannerek"}`,
    `Date: ${new Date(Date.now() - 60_000).toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),
    ...(o.headers ?? []),
    "MIME-Version: 1.0",
  ];
  const body = o.body ?? "Kérnénk két bannert: 1200×628.\n\nKöszi,\nRéka";
  if (!o.attachment) {
    return { raw: utf8bin([...head, "Content-Type: text/plain; charset=utf-8", "", body].join(CRLF)), messageId };
  }
  const raw = [
    ...head,
    'Content-Type: multipart/mixed; boundary="bnd"',
    "",
    "--bnd",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "--bnd",
    `Content-Type: ${o.attachment.mime}`,
    `Content-Disposition: attachment; filename="${o.attachment.name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    o.attachment.base64,
    "--bnd--",
  ].join(CRLF);
  return { raw: utf8bin(raw), messageId };
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");
const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

const ORG = "org_b3";
const OFF = "org_b3_off";
const ADAM = { subject: "clerk_adam", orgId: ORG, orgRole: "org:admin" };
const KEK = (() => {
  let s = "";
  for (let i = 0; i < 32; i++) s += String.fromCharCode((i * 7 + 5) % 256);
  return btoa(s);
})();
const MONDAY_10 = Date.UTC(2026, 9, 19, 8, 0, 0);

let savedKek: string | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MONDAY_10);
  savedKek = process.env.AI_KEY_ENCRYPTION_KEK;
  process.env.AI_KEY_ENCRYPTION_KEK = KEK;
  __resetSecretCryptoCacheForTests();
  calls.classify = 0;
  calls.screen = 0;
  screenResult = { possibleClient: true, reason: "Looks like a brief" };
  setModel();
  installFakeGmail();
});
afterEach(() => {
  setSyncGmailTransportForTesting(null);
  if (savedKek === undefined) delete process.env.AI_KEY_ENCRYPTION_KEK;
  else process.env.AI_KEY_ENCRYPTION_KEK = savedKek;
  __resetSecretCryptoCacheForTests();
  vi.useRealTimers();
});

type Fixture = {
  adam: Id<"users">;
  mari: Id<"users">;
  client: Id<"clients">;
  task: Id<"tasks">;
  adamBox: Id<"connectors">;
  benceBox: Id<"connectors">;
  mariBox: Id<"connectors">;
  offBox: Id<"connectors">;
  expiredBox: Id<"connectors">;
  seedBox: Id<"connectors">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string, email: string, orgId: string, role: "admin" | "member") => {
      const id = await ctx.db.insert("users", { name, externalId, email, createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId, clerkUserId: externalId, userId: id, role, joinedAt: now });
      return id;
    };
    const adam = await mkUser("Tóth Ádám", "clerk_adam", "adam@konverted.io", ORG, "admin");
    const bence = await mkUser("Kiss Bence", "clerk_bence", "bence@konverted.io", ORG, "admin");
    const mari = await mkUser("Varga Mari", "clerk_mari", "mari@konverted.io", ORG, "member");
    const kati = await mkUser("Kati", "clerk_kati", "kati@konverted.io", ORG, "admin");
    const lili = await mkUser("Lili", "clerk_lili", "lili@konverted.io", ORG, "admin");
    const carol = await mkUser("Carol", "clerk_carol", "carol@other.test", OFF, "admin");
    for (const [orgId, enabled, by] of [[ORG, true, adam], [OFF, false, carol]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: "Europe/Budapest", roundingMinutes: 15,
        emailTriageEnabled: enabled, ignoredEmailDomains: orgId === ORG ? ["vendor.example"] : undefined,
        createdAt: now, updatedAt: now, createdBy: by,
      });
    }
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, workflowRole: s.workflowRole, createdAt: now, updatedAt: now, createdBy: adam,
      });
    }
    const client = await ctx.db.insert("clients", {
      orgId: ORG, name: "Pragmatico", currency: "HUF", emailDomains: ["pragmatico.hu"], createdAt: now, updatedAt: now, createdBy: adam,
    });
    await ctx.db.insert("clientContacts", {
      orgId: ORG, clientId: client, name: "Gmail Gábor", email: "gabor.pragmatico@gmail.com", isPrimary: false,
      createdAt: now, updatedAt: now, createdBy: adam,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Pragmatico retainer", code: "PRG", billingType: "retainer",
      createdAt: now, updatedAt: now, createdBy: adam,
    });
    const adminAuth: AuthContext = { userId: adam, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(adam))! };
    const task = await createTask(ctx, adminAuth, { title: "Black Friday bannerek", projectId }, { notify: false });

    const box = async (userId: Id<"users">, email: string, orgId = ORG, status: "connected" | "expired" = "connected") =>
      ctx.db.insert("connectors", {
        orgId, userId, type: "gmail", status,
        credentialsCiphertext: await encryptSecret(
          JSON.stringify({ accessToken: tokenFor(email), refreshToken: "refresh", expiresAt: now + 10 * 365 * 86_400_000, scope: "gmail.readonly gmail.send" }),
        ),
        credentialMask: email, scopes: ["gmail.readonly", "gmail.send"], connectedAt: now, sync: { cursor: undefined }, updatedAt: now,
      });
    const seedBox = await ctx.db.insert("connectors", {
      orgId: ORG, userId: kati, type: "gmail", status: "connected", devSeed: true, scopes: [], connectedAt: now, updatedAt: now,
    });
    return {
      adam, mari, client, task, seedBox,
      adamBox: await box(adam, "adam@konverted.io"),
      benceBox: await box(bence, "bence@konverted.io"),
      mariBox: await box(mari, "mari@konverted.io"),
      offBox: await box(carol, "carol@other.test", OFF),
      expiredBox: await box(lili, "lili@konverted.io", ORG, "expired"),
    };
  });
}

/** Drain scheduled functions in time order (each finishes before the clock moves on). */
async function settle(t: T): Promise<void> {
  for (let i = 0; i < 300; i++) {
    await vi.advanceTimersByTimeAsync(0);
    await t.finishInProgressScheduledFunctions();
    const pending = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.state.kind === "pending"),
    );
    if (pending.length === 0) return;
    const next = Math.min(...pending.map((p) => p.scheduledTime));
    await vi.advanceTimersByTimeAsync(Math.max(0, next - Date.now()) + 1);
  }
  throw new Error("settle: scheduled functions did not drain");
}

const sync = (t: T, connectorId: Id<"connectors">) => t.action(internal.email.syncNode.syncMailbox, { connectorId });

/** First sync (cursor = now), so later deliveries are what the next run reads. */
async function startFromNow(t: T, ...ids: Id<"connectors">[]) {
  for (const id of ids) expect((await sync(t, id)).status).toBe("first_sync");
}

const connector = (t: T, id: Id<"connectors">) => t.run((ctx) => ctx.db.get(id));
const stateOf = (t: T, id: Id<"connectors">) =>
  t.run((ctx) => ctx.db.query("mailboxSyncStates").withIndex("by_connectorId", (q) => q.eq("connectorId", id)).unique());
const messagesOf = (t: T, connectorId?: Id<"connectors">) =>
  t.run(async (ctx) => (await ctx.db.query("emailMessages").collect()).filter((m) => !connectorId || m.connectorId === connectorId));
const emailItems = (t: T) => t.run(async (ctx) => (await ctx.db.query("agentItems").collect()).filter((i) => i.source === "email"));
const passTime = async (ms: number) => vi.setSystemTime(Date.now() + ms);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("first sync (D34)", () => {
  it("sets the cursor to the mailbox's current history id and stores nothing", async () => {
    const t = createT();
    const f = await setup(t);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    const res = await sync(t, f.adamBox);
    expect(res).toEqual({ status: "first_sync", cursor: "1002" });
    const row = await connector(t, f.adamBox);
    expect((await stateOf(t, f.adamBox))?.cursor).toBe("1002");
    expect(row?.sync?.lastSyncAt).toBe(Date.now());
    expect((await stateOf(t, f.adamBox))?.leaseId).toBeUndefined();
    expect(await messagesOf(t)).toHaveLength(0);
    expect(mailbox("adam@konverted.io").gets).toEqual([]);
  });
});

describe("incremental sync → the B4 pipeline", () => {
  it("stores a client email (thread, links, stripped body, attachment) and runs it to a Triage item", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const brief = btoa("Brief: 2 banner, 1200x628 es 1080x1080");
    const { messageId } = mail({ from: "x@x.hu" });
    const raw = mail({
      from: "Kovács Réka <reka@pragmatico.hu>",
      messageId,
      body: "Kérnénk két bannert: 1200×628.\n\nKöszi,\nRéka\n\n2026. okt. 16., P 15:12 dátummal Tóth Ádám <adam@konverted.io> ezt írta:\n> régi levél",
      attachment: { name: "brief.txt", mime: "text/plain", base64: brief },
    }).raw;
    const gm = deliver("adam@konverted.io", raw, { threadId: "gt-bf" });

    const res = await sync(t, f.adamBox);
    expect(res).toMatchObject({ status: "synced", fetched: 1, stored: 1 });
    const [m] = await messagesOf(t);
    expect(m).toMatchObject({
      gmailMessageId: gm.id,
      rfcMessageId: messageId,
      direction: "inbound",
      from: { name: "Kovács Réka", email: "reka@pragmatico.hu" },
      to: [{ email: "adam@konverted.io" }],
      subject: "Black Friday bannerek",
      stage: "received",
    });
    expect(m.bodyText).toContain("Kérnénk két bannert");
    expect(m.bodyText).not.toContain("régi levél");
    expect(m.bodyHtml).toContain("régi levél");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0]).toMatchObject({ name: "brief.txt", mime: "text/plain" });
    const stored = await t.run((ctx) => ctx.db.system.get("_storage", m.attachments[0].storageId!));
    expect(stored?.size).toBe(m.attachments[0].size);
    const thread = await t.run((ctx) => ctx.db.get(m.threadId));
    expect(thread).toMatchObject({ gmailThreadId: "gt-bf", clientId: f.client, waitingOn: "us", subject: "Black Friday bannerek" });
    expect((await stateOf(t, f.adamBox))?.cursor).toBe(String(mailbox("adam@konverted.io").historyId));

    await settle(t);
    const after = (await messagesOf(t))[0];
    expect(after.stage).toBe("handled");
    const items = await emailItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "request", status: "open", anchor: { type: "emailThread", id: m.threadId } });
    expect(calls.classify).toBe(1);
  });

  it("a client contact on a public mail domain is known; a reply joins the stored thread", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const first = mail({ from: "Gábor <gabor.pragmatico@gmail.com>", subject: "Kérdés" });
    deliver("adam@konverted.io", first.raw, { threadId: "gt-g" });
    deliver("adam@konverted.io", mail({ from: "Gábor <gabor.pragmatico@gmail.com>", subject: "Re: Kérdés", inReplyTo: first.messageId }).raw, {
      threadId: "gt-g",
    });
    await sync(t, f.adamBox);
    const messages = await messagesOf(t);
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((m) => m.threadId)).size).toBe(1);
    const thread = await t.run((ctx) => ctx.db.get(messages[0].threadId));
    expect(thread?.clientId).toBe(f.client);
  });
});

describe("the D24 filter", () => {
  it("a newsletter, a Promotions message, an ignored domain and an unknown sender in a member's mailbox are never stored", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.mariBox);
    const mari = "mari@konverted.io";
    deliver(mari, mail({ from: "Shop <news@shop.example>", headers: ["List-Unsubscribe: <mailto:u@shop.example>", "Precedence: bulk"] }).raw);
    deliver(mari, mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Akció" }).raw, { labels: ["INBOX", "CATEGORY_PROMOTIONS"] });
    deliver(mari, mail({ from: "Számla <billing@vendor.example>" }).raw);
    deliver(mari, mail({ from: "Idegen <someone@random.example>", body: "Szia, árajánlatot kérnék." }).raw);
    deliver(mari, mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Spam?" }).raw, { labels: ["SPAM"] });
    const known = deliver(mari, mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Banner" }).raw);

    const res = await sync(t, f.mariBox);
    expect(res).toMatchObject({ status: "synced", stored: 1 });
    const messages = await messagesOf(t);
    expect(messages.map((m) => m.gmailMessageId)).toEqual([known.id]);
    // Label-skipped messages are not even downloaded.
    expect(mailbox(mari).gets).not.toContain(mailbox(mari).history[1].added[0].id);
    expect(mailbox(mari).gets).not.toContain(mailbox(mari).history[4].added[0].id);
    expect((await t.run((ctx) => ctx.db.query("emailThreads").collect())).length).toBe(1);
  });

  it("an unknown sender in an admin's mailbox is stored and screened (filtered when not a possible client)", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    screenResult = { possibleClient: false, reason: "A cold sales pitch" };
    deliver("adam@konverted.io", mail({ from: "Sales <sales@leadgen.example>", body: "Növeljük a forgalmát!" }).raw);
    await sync(t, f.adamBox);
    const [m] = await messagesOf(t);
    expect(m.direction).toBe("inbound");
    const thread = await t.run((ctx) => ctx.db.get(m.threadId));
    expect(thread?.clientId).toBeUndefined();
    await settle(t);
    expect(calls.screen).toBe(1);
    const items = await emailItems(t);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "new_sender", status: "filtered" });
  });

  it("our own mail off a tracked thread is skipped; an internal email is never stored", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    deliver("adam@konverted.io", mail({ from: "Tóth Ádám <adam@konverted.io>", to: "friend@private.example" }).raw, { labels: ["SENT"] });
    deliver("adam@konverted.io", mail({ from: "Kiss Bence <bence@konverted.io>", subject: "Ebéd?" }).raw);
    await sync(t, f.adamBox);
    expect(await messagesOf(t)).toHaveLength(0);
  });
});

describe("I1 / I13 — one email, two mailboxes", () => {
  it("the same email in two admins' mailboxes is stored twice (provenance) and makes ONE item", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox, f.benceBox);
    const { raw } = mail({ from: "Kovács Réka <reka@pragmatico.hu>", to: "adam@konverted.io, bence@konverted.io" });
    deliver("adam@konverted.io", raw, { threadId: "gt-a" });
    deliver("bence@konverted.io", raw, { threadId: "gt-b" });
    await sync(t, f.adamBox);
    await settle(t);
    await sync(t, f.benceBox);
    await settle(t);
    const messages = await messagesOf(t);
    expect(messages).toHaveLength(2);
    expect(new Set(messages.map((m) => m.rfcMessageId)).size).toBe(1);
    expect(new Set(messages.map((m) => m.connectorId)).size).toBe(2);
    expect((await emailItems(t)).filter((i) => i.status === "open")).toHaveLength(1);
    expect(calls.classify).toBe(1);
  });
});

describe("failures and catch-up", () => {
  it("a failed run keeps its progress; the next run catches up with no duplicates", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const box = mailbox("adam@konverted.io");
    for (let i = 0; i < 3; i++) deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: `Kérés ${i}` }).raw);
    const firstRecord = String(box.history[0].id);
    // Run 1: the first download works, the 2nd one fails (Gmail 500 — transient).
    box.gets.length = 0;
    box.failGetAt = { call: 2, status: 500 };
    const res = await sync(t, f.adamBox);
    box.failGetAt = undefined;
    expect(res).toEqual({ status: "failed", kind: "transient" });
    let row = await connector(t, f.adamBox);
    expect(row?.sync?.error).toMatchObject({ kind: "transient", at: Date.now() });
    expect(row?.sync?.error?.message).toContain("500");
    expect((await stateOf(t, f.adamBox))?.cursor).toBe(firstRecord); // advanced past the stored message only
    expect(row?.sync?.backoffUntil).toBe(Date.now() + 60_000);
    expect(await messagesOf(t)).toHaveLength(1);
    // Backing off: the cron skips it (bence + mari only) and a run is refused.
    expect((await t.mutation(internal.email.sync.scheduleOrgSyncs, { orgId: ORG, cursor: null })).scheduled).toBe(2);
    expect((await sync(t, f.adamBox)).status).toBe("skipped");

    await passTime(61_000);
    const res2 = await sync(t, f.adamBox);
    expect(res2).toMatchObject({ status: "synced", stored: 2 });
    const messages = await messagesOf(t);
    expect(messages).toHaveLength(3);
    expect(new Set(messages.map((m) => m.gmailMessageId)).size).toBe(3);
    row = await connector(t, f.adamBox);
    expect(row?.sync?.error).toBeUndefined();
    expect((await stateOf(t, f.adamBox))?.cursor).toBe(String(box.historyId));
  });

  it("an expired cursor runs the bounded resync (last 7 days) with no duplicates, then a fresh cursor", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const box = mailbox("adam@konverted.io");
    const old = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Régi" }).raw, {
      at: Date.now() - 9 * 86_400_000,
    });
    const a = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "A" }).raw);
    await sync(t, f.adamBox);
    expect((await messagesOf(t)).map((m) => m.gmailMessageId).sort()).toEqual([old.id, a.id].sort());
    // The mailbox moves on while we are away; our cursor falls out of Gmail's history.
    const b = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "B" }).raw);
    deliver("adam@konverted.io", mail({ from: "Shop <news@shop.example>", headers: ["Precedence: bulk"] }).raw);
    box.expireBelow = box.historyId + 1;
    box.gets.length = 0;

    const res = await sync(t, f.adamBox);
    expect(res).toMatchObject({ status: "synced", stored: 1, resync: false });
    expect(box.listCalls).toBe(1);
    // Stored ones are not downloaded again; the 9-day-old one is outside the window.
    expect(box.gets).not.toContain(a.id);
    const messages = await messagesOf(t);
    expect(messages.map((m) => m.gmailMessageId).sort()).toEqual([old.id, a.id, b.id].sort());
    const row = await connector(t, f.adamBox);
    expect((await stateOf(t, f.adamBox))?.cursor).toBe(String(box.historyId));
    expect((await stateOf(t, f.adamBox))?.resync).toBeUndefined();
    expect(row?.sync?.lastFullSyncAt).toBe(Date.now());

    // The next run reads the history again from the new cursor.
    box.expireBelow = 0;
    const c = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "C" }).raw);
    expect(await sync(t, f.adamBox)).toMatchObject({ status: "synced", stored: 1 });
    expect((await messagesOf(t)).map((m) => m.gmailMessageId)).toContain(c.id);
  });

  it("a mailbox failing for 10 minutes gets ONE \"Mailbox not syncing\" item, closed when sync recovers", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const box = mailbox("adam@konverted.io");
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    box.failGets.push({ status: 503, times: 100 });
    for (let i = 0; i < 6; i++) {
      expect((await sync(t, f.adamBox)).status).toBe("failed");
      await passTime(31 * 60_000); // past any backoff
    }
    let items = (await emailItems(t)).filter((i) => i.anchor.type === "mailbox");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "attention", status: "open", anchor: { id: f.adamBox } });
    expect(items[0].decisionNote?.message).toContain("retrying by itself");
    const rows = await t.withIdentity(ADAM).query(api.email.triageView.listItems, {
      view: "open",
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(rows.page.find((r) => r._id === items[0]._id)?.title).toBe("Mailbox not syncing · adam@konverted.io");

    box.failGets.length = 0;
    expect((await sync(t, f.adamBox)).status).toBe("synced");
    items = (await emailItems(t)).filter((i) => i.anchor.type === "mailbox");
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe("done");
    expect((await connector(t, f.adamBox))?.sync?.failingSince).toBeUndefined();
  });

  it("a 401 marks the grant expired at once and shows the reconnect fix", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    mailbox("adam@konverted.io").failGets.push({ status: 401, times: 1 });
    expect(await sync(t, f.adamBox)).toEqual({ status: "failed", kind: "disconnected" });
    const row = await connector(t, f.adamBox);
    expect(row?.status).toBe("expired");
    expect(row?.sync?.backoffUntil).toBeUndefined();
    const list = await t.withIdentity(ADAM).query(api.connectors.list, {});
    expect(list.find((c) => c.type === "gmail")?.sync?.error).toMatchObject({
      kind: "disconnected",
      fix: "Reconnect Gmail to resume syncing.",
    });
    // L4: a mailbox that needs a reconnect gets no Triage item — its row shows the fix.
    expect((await emailItems(t)).filter((i) => i.anchor.type === "mailbox")).toHaveLength(0);
  });
});

describe("our own mail", () => {
  async function trackedConversation(t: T, f: Fixture) {
    await startFromNow(t, f.adamBox);
    const client = mail({ from: "Kovács Réka <reka@pragmatico.hu>" });
    deliver("adam@konverted.io", client.raw, { threadId: "gt-conv" });
    await sync(t, f.adamBox);
    await settle(t);
    const [m] = await messagesOf(t);
    return { clientMessageId: client.messageId, thread: m.threadId };
  }

  it("D33: a reply written in Gmail by a team member stales the open draft and closes the kickoff item", async () => {
    const t = createT();
    const f = await setup(t);
    const { clientMessageId, thread } = await trackedConversation(t, f);
    const { itemId, draftId } = await t.run(async (ctx) => {
      const now = Date.now();
      const item = (await ctx.db.query("agentItems").collect()).find((i) => i.anchor.id === thread)!;
      const draftId = await ctx.db.insert("emailDrafts", {
        orgId: ORG, threadId: thread, kind: "kickoff", version: 1, to: [{ email: "reka@pragmatico.hu" }], cc: [],
        subject: "Re: Black Friday bannerek", bodyText: "Köszönjük, elkezdtük.", attachments: [], sourceSummary: "",
        subjectLocked: true, fromConnectorId: f.adamBox, status: "draft", createdBy: "agent", createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(item._id, {
        draftId,
        commit: { outcome: "created", at: now, userId: f.adam, taskIds: [f.task], proposalIds: [], converted: [], threadTaskIds: [] },
      });
      return { itemId: item._id, draftId };
    });

    deliver(
      "adam@konverted.io",
      mail({ from: "Tóth Ádám <adam@konverted.io>", to: "Kovács Réka <reka@pragmatico.hu>", subject: "Re: Black Friday bannerek", inReplyTo: clientMessageId, body: "Szia Réka, megcsináljuk szerdára." }).raw,
      { threadId: "gt-conv", labels: ["SENT"] },
    );
    expect(await sync(t, f.adamBox)).toMatchObject({ stored: 1 });
    await settle(t);
    const outbound = (await messagesOf(t)).find((m) => m.direction === "outbound")!;
    expect(outbound).toMatchObject({ threadId: thread, stage: "handled", from: { email: "adam@konverted.io" } });
    const state = await t.run(async (ctx) => ({
      item: await ctx.db.get(itemId),
      draft: await ctx.db.get(draftId),
      thread: await ctx.db.get(thread),
    }));
    expect(state.item).toMatchObject({ status: "done", outcome: "created", kickoffOutcome: "replied_in_gmail" });
    expect(state.draft?.stale?.reason ?? state.draft?.status).toBeTruthy();
    expect(state.draft?.stale?.reason).toMatch(/^You replied in Gmail at \d\d:\d\d$/);
    expect(state.thread).toMatchObject({ waitingOn: "client", lastOutboundAt: outbound.sentAt });
    expect(calls.classify).toBe(1); // our own mail is never classified
  });

  it("an app-sent message (stored by B5, or still dispatching) is not stored again", async () => {
    const t = createT();
    const f = await setup(t);
    const { thread } = await trackedConversation(t, f);
    // B5 stored its send with Gmail's id …
    const sent = mail({ from: "Tóth Ádám <adam@konverted.io>", to: "reka@pragmatico.hu", subject: "Re: Black Friday bannerek" });
    const gmSent = deliver("adam@konverted.io", sent.raw, { threadId: "gt-conv", labels: ["SENT"] });
    // … and a second send is still in flight (dispatching) under its own Message-ID.
    const inFlight = mail({ from: "Tóth Ádám <adam@konverted.io>", to: "reka@pragmatico.hu", subject: "Re: Black Friday bannerek" });
    deliver("adam@konverted.io", inFlight.raw, { threadId: "gt-conv", labels: ["SENT"] });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("emailMessages", {
        orgId: ORG, threadId: thread, connectorId: f.adamBox, gmailMessageId: gmSent.id, rfcMessageId: sent.messageId,
        direction: "outbound", from: { email: "adam@konverted.io" }, to: [{ email: "reka@pragmatico.hu" }], cc: [],
        subject: "Re: Black Friday bannerek", bodyText: "x", attachments: [], sentAt: now, stage: "handled", createdAt: now,
      });
      await ctx.db.insert("emailDrafts", {
        orgId: ORG, threadId: thread, kind: "reply", version: 1, to: [{ email: "reka@pragmatico.hu" }], cc: [],
        subject: "Re: Black Friday bannerek", bodyText: "y", attachments: [], sourceSummary: "", subjectLocked: true,
        fromConnectorId: f.adamBox, status: "dispatching", messageIdHeader: inFlight.messageId, createdBy: "agent",
        createdAt: now, updatedAt: now,
      });
    });
    const before = (await messagesOf(t)).length;
    await sync(t, f.adamBox);
    expect((await messagesOf(t)).length).toBe(before);
    // The B5 row is not downloaded at all (I1).
    expect(mailbox("adam@konverted.io").gets).not.toContain(gmSent.id);
  });
});

describe("lease, cron and gates", () => {
  it("the lease prevents overlapping runs of one mailbox", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    const other = await t.mutation(internal.email.sync.claimSyncLease, { connectorId: f.adamBox, leaseId: "other-run" });
    expect(other).not.toBeNull();
    expect(await sync(t, f.adamBox)).toEqual({ status: "skipped" });
    expect(await t.mutation(internal.email.sync.claimSyncLease, { connectorId: f.adamBox, leaseId: "third" })).toBeNull();
    expect(await messagesOf(t)).toHaveLength(0);
    // The stale run cannot move the cursor once it lost the lease.
    await passTime(SYNC_LEASE_MS + 1);
    expect(await sync(t, f.adamBox)).toMatchObject({ status: "synced", stored: 1 });
    const late = await t.mutation(internal.email.sync.finishSyncRun, { connectorId: f.adamBox, leaseId: "other-run", cursor: "999999" });
    expect(late).toEqual({ applied: false });
  });

  it("the cron schedules only connected, non-seed mailboxes of flagged orgs; the others are skipped", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await t.mutation(internal.email.sync.scheduleSyncs, {})).toEqual({ orgs: 1 }); // the OFF org is not visited
    const { scheduled } = await t.mutation(internal.email.sync.scheduleOrgSyncs, { orgId: ORG, cursor: null });
    expect(scheduled).toBe(3); // adam, bence, mari — not the expired row or the seed mailbox
    expect(await t.mutation(internal.email.sync.scheduleOrgSyncs, { orgId: OFF, cursor: null })).toEqual({ scheduled: 0 });
    const fns = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).map((s) => s.args[0] as { connectorId?: string; orgId?: string }),
    );
    expect(fns.filter((a) => a.connectorId).map((a) => a.connectorId).sort()).toEqual([f.adamBox, f.benceBox, f.mariBox].sort());
    expect(fns.filter((a) => a.orgId).map((a) => a.orgId)).toEqual([ORG]);
    for (const id of [f.offBox, f.expiredBox, f.seedBox]) {
      expect(await sync(t, id)).toEqual({ status: "skipped" });
      expect((await stateOf(t, id))?.cursor).toBeUndefined();
    }
  });

  it("Resync last 7 days: the owner's own mailbox, idempotent; refused without a live mailbox", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    // Arrived before the cursor (e.g. while disconnected): only a resync reads it.
    const box = mailbox("adam@konverted.io");
    const early = mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Korábbi" });
    box.messages.set("gm-early", { id: "gm-early", threadId: "gt-early", labelIds: ["INBOX"], internalDate: Date.now() - 86_400_000, raw: toBase64Url(early.raw) });
    expect(await t.withIdentity(ADAM).mutation(api.email.sync.resyncMyMailbox, {})).toEqual({ alreadyRunning: false });
    expect(await t.withIdentity(ADAM).query(api.connectors.list, {})).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "gmail", sync: expect.objectContaining({ resyncing: true }) })]),
    );
    await settle(t);
    expect((await messagesOf(t)).map((m) => m.gmailMessageId)).toEqual(["gm-early"]);
    expect((await stateOf(t, f.adamBox))?.resync).toBeUndefined();
    expect((await connector(t, f.adamBox))?.sync?.resyncRequestedAt).toBeUndefined();
    // Again: nothing new is stored.
    await t.withIdentity(ADAM).mutation(api.email.sync.resyncMyMailbox, {});
    await settle(t);
    expect(await messagesOf(t)).toHaveLength(1);
    // A seed mailbox and an expired one are not resynced.
    for (const subject of ["clerk_kati", "clerk_lili"]) {
      await expect(
        t.withIdentity({ subject, orgId: ORG, orgRole: "org:admin" }).mutation(api.email.sync.resyncMyMailbox, {}),
      ).rejects.toThrow(/Connect Gmail first/);
    }
  });

  it("the flag switched off: the run stores nothing", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: false });
    expect(await sync(t, f.adamBox)).toEqual({ status: "skipped" });
    expect(await messagesOf(t)).toHaveLength(0);
  });
});

describe("attachments", () => {
  it("an attachment over 25 MB is listed with its size but not stored; a small one is stored", { timeout: 120_000 }, async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const bigBytes = MAX_STORED_ATTACHMENT_BYTES + 3 * 1024;
    const bigBase64 = "A".repeat(Math.ceil(bigBytes / 3) * 4).replace(/(.{76})/g, "$1\r\n");
    const raw = [
      "From: Kovács Réka <reka@pragmatico.hu>",
      "To: adam@konverted.io",
      "Subject: Videó",
      "Message-ID: <big@pragmatico.hu>",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Csatolom a videót és a logót.",
      "--b",
      "Content-Type: video/mp4",
      'Content-Disposition: attachment; filename="spot.mp4"',
      "Content-Transfer-Encoding: base64",
      "",
      bigBase64,
      "--b",
      "Content-Type: image/png",
      'Content-Disposition: attachment; filename="logo.png"',
      "Content-Transfer-Encoding: base64",
      "",
      btoa("small-png-bytes"),
      "--b--",
    ].join(CRLF);
    deliver("adam@konverted.io", raw);
    expect(await sync(t, f.adamBox)).toMatchObject({ stored: 1 });
    const [m] = await messagesOf(t);
    expect(m.attachments).toHaveLength(2);
    expect(m.attachments[0]).toMatchObject({ name: "spot.mp4", mime: "video/mp4" });
    expect(m.attachments[0].size).toBeGreaterThan(MAX_STORED_ATTACHMENT_BYTES);
    expect(m.attachments[0].storageId).toBeUndefined();
    expect(m.attachments[1]).toMatchObject({ name: "logo.png", size: "small-png-bytes".length });
    expect(m.attachments[1].storageId).toBeDefined();
    const files = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(files).toHaveLength(1);
  });
});

describe("security review (B3)", () => {
  it("M1: a forged client From (dmarc=fail) is never stored in a member's mailbox; in an admin's it is screened and flagged", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.mariBox, f.adamBox);
    const forged = (to: string) =>
      mail({
        from: "Kovács Réka <reka@pragmatico.hu>",
        to,
        auth: "mx.google.com; spf=pass smtp.mailfrom=x@evil.example; dmarc=fail (p=QUARANTINE) header.from=pragmatico.hu",
        body: "Kérlek, utald át a számlát erre a számlaszámra.",
      }).raw;
    deliver("mari@konverted.io", forged("mari@konverted.io"));
    deliver("mari@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", to: "mari@konverted.io", auth: null }).raw);
    await sync(t, f.mariBox);
    expect(await messagesOf(t, f.mariBox)).toHaveLength(0);

    screenResult = { possibleClient: false, reason: "Suspicious" };
    deliver("adam@konverted.io", forged("adam@konverted.io"));
    await sync(t, f.adamBox);
    const [m] = await messagesOf(t, f.adamBox);
    expect(m.unverifiedSender).toBe(true);
    const thread = await t.run((ctx) => ctx.db.get(m.threadId));
    expect(thread?.clientId).toBeUndefined();
    expect(thread?.participants).toEqual([]);
    await settle(t);
    expect(calls.screen).toBe(1);
    expect((await emailItems(t))[0]).toMatchObject({ kind: "new_sender", status: "filtered" });
  });

  it("M1: an authenticated client (DMARC pass) is known; the Triage row has no unverified note", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.mariBox);
    deliver("mari@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", to: "mari@konverted.io" }).raw);
    await sync(t, f.mariBox);
    const [m] = await messagesOf(t);
    expect(m.unverifiedSender).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(m.threadId)))?.clientId).toBe(f.client);
  });

  it("M2: on a client thread in a member's mailbox an unknown sender is not stored and never joins the participants", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.mariBox);
    const first = mail({ from: "Kovács Réka <reka@pragmatico.hu>", to: "mari@konverted.io" });
    deliver("mari@konverted.io", first.raw, { threadId: "gt-m" });
    await sync(t, f.mariBox);
    deliver("mari@konverted.io", mail({ from: "Stranger <x@stranger.example>", to: "mari@konverted.io", inReplyTo: first.messageId }).raw, { threadId: "gt-m" });
    // A participant (Réka) is still stored on the same thread.
    deliver("mari@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", to: "mari@konverted.io", inReplyTo: first.messageId }).raw, { threadId: "gt-m" });
    await sync(t, f.mariBox);
    const messages = await messagesOf(t);
    expect(messages.map((m) => m.from.email)).toEqual(["reka@pragmatico.hu", "reka@pragmatico.hu"]);
    const thread = await t.run((ctx) => ctx.db.get(messages[0].threadId));
    expect(thread?.participants.map((p) => p.email)).not.toContain("x@stranger.example");
  });

  it("M3: an INBOX message with a colleague's forged From is an unverified inbound — never ours, no D33", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const client = mail({ from: "Kovács Réka <reka@pragmatico.hu>" });
    deliver("adam@konverted.io", client.raw, { threadId: "gt-x" });
    await sync(t, f.adamBox);
    deliver(
      "adam@konverted.io",
      mail({
        from: "Kiss Bence <bence@konverted.io>",
        to: "reka@pragmatico.hu",
        inReplyTo: client.messageId,
        auth: "mx.google.com; dmarc=fail (p=NONE) header.from=konverted.io",
      }).raw,
      { threadId: "gt-x" },
    );
    await sync(t, f.adamBox);
    const forged = (await messagesOf(t)).find((m) => m.from.email === "bence@konverted.io")!;
    expect(forged).toMatchObject({ direction: "inbound", unverifiedSender: true, stage: "received" });
    const scheduledD33 = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("markRepliedInGmail")),
    );
    expect(scheduledD33).toHaveLength(0);
  });

  it("M4: a resync waits for the backoff; asking for one clears it", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    mailbox("adam@konverted.io").failGets.push({ status: 503, times: 1 });
    expect((await sync(t, f.adamBox)).status).toBe("failed");
    await t.run(async (ctx) => {
      const state = (await ctx.db.query("mailboxSyncStates").collect())[0];
      await ctx.db.patch(state._id, { resync: { reason: "expired", requestedAt: Date.now() } });
    });
    expect(await sync(t, f.adamBox)).toEqual({ status: "skipped" });
    await t.withIdentity(ADAM).mutation(api.email.sync.resyncMyMailbox, {});
    expect((await connector(t, f.adamBox))?.sync?.backoffUntil).toBeUndefined();
    expect((await sync(t, f.adamBox)).status).toBe("synced");
  });

  it("H1: a message whose attempts keep dying is passed on the 4th try and listed; the cursor moves past it", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const bad = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Rossz" }).raw);
    const good = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: "Jó" }).raw);
    // Three earlier runs died while parsing `bad` (the marker stayed).
    await t.run(async (ctx) => {
      const state = (await ctx.db.query("mailboxSyncStates").collect())[0];
      await ctx.db.patch(state._id, { attempts: [{ gmailMessageId: bad.id, count: 3, at: Date.now() }] });
    });
    expect(await sync(t, f.adamBox)).toMatchObject({ status: "synced", stored: 1 });
    expect((await messagesOf(t)).map((m) => m.gmailMessageId)).toEqual([good.id]);
    expect((await stateOf(t, f.adamBox))?.attempts ?? []).toEqual([]);
    expect((await stateOf(t, f.adamBox))?.cursor).toBe(String(mailbox("adam@konverted.io").historyId));
    const list = await t.withIdentity(ADAM).query(api.connectors.list, {});
    expect(list.find((c) => c.type === "gmail")?.sync?.unprocessable).toMatchObject({ count: 1 });
  });

  it("H2: a store that fails keeps a minimal row with an attention; the mailbox keeps syncing", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const gm = deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    failStoreForTesting([gm.id]);
    try {
      expect(await sync(t, f.adamBox)).toMatchObject({ status: "synced", stored: 1 });
    } finally {
      failStoreForTesting([]);
    }
    const [m] = await messagesOf(t);
    expect(m).toMatchObject({ gmailMessageId: gm.id, stage: "failed", bodyText: "", attachments: [] });
    const items = await emailItems(t);
    expect(items[0]).toMatchObject({ kind: "attention", status: "open" });
    expect(items[0].attentions?.[0].message).toMatch(/couldn't be stored/);
    expect((await connector(t, f.adamBox))?.sync?.error).toBeUndefined();
  });

  it("H2: a huge CJK body, 9000 To addresses and a huge Subject are stored within the byte budget", { timeout: 60_000 }, async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const many = Array.from({ length: 9_000 }, (_, i) => `u${i}@pragmatico.hu`).join(", ");
    deliver(
      "adam@konverted.io",
      mail({ from: "Kovács Réka <reka@pragmatico.hu>", to: many, subject: "件名".repeat(30_000), body: "漢字かな交じり文".repeat(60_000) }).raw,
    );
    expect(await sync(t, f.adamBox)).toMatchObject({ stored: 1 });
    const [m] = await messagesOf(t);
    const bytes = new TextEncoder().encode(JSON.stringify(m)).length;
    expect(bytes).toBeLessThan(800_000);
    expect(m.to).toHaveLength(100);
    expect(m.toOverflow).toBeGreaterThan(0);
    expect(new TextEncoder().encode(m.subject).length).toBeLessThanOrEqual(2_000);
    expect(m.bodyText.length).toBeGreaterThan(1_000);
  });

  it("L1: the flag switched off mid-run aborts without moving the cursor", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const before = (await stateOf(t, f.adamBox))?.cursor;
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    const box = mailbox("adam@konverted.io");
    box.onGet = async () => {
      if (box.gets.length === 2) await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: false });
    };
    expect(await sync(t, f.adamBox)).toEqual({ status: "aborted" });
    const state = await stateOf(t, f.adamBox);
    expect(state?.leaseId).toBeUndefined();
    // The first message was stored; the cursor stays where it was (its record is re-read later, I1).
    expect(state?.cursor).toBe(before);
  });

  it("L3: a resync continues across runs from its page token (nothing downloaded twice)", { timeout: 120_000 }, async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const box = mailbox("adam@konverted.io");
    for (let i = 0; i < 130; i++) {
      const id = `gm-old-${i}`;
      box.messages.set(id, {
        id, threadId: `gt-old-${i}`, labelIds: ["INBOX"], internalDate: Date.now() - 86_400_000 + i * 1000,
        raw: toBase64Url(mail({ from: "Kovács Réka <reka@pragmatico.hu>", subject: `Régi ${i}` }).raw),
      });
    }
    await t.withIdentity(ADAM).mutation(api.email.sync.resyncMyMailbox, {});
    // Run 1: the first page (100) — then the budget; run 2: the rest.
    expect(await sync(t, f.adamBox)).toMatchObject({ status: "partial", fetched: 100, resync: true });
    expect((await stateOf(t, f.adamBox))?.resync?.pageToken).toBe("100");
    expect(await sync(t, f.adamBox)).toMatchObject({ status: "synced", fetched: 30, resync: false });
    expect(box.gets).toHaveLength(130);
    expect(await messagesOf(t)).toHaveLength(130);
  });

  it("L4 / L5: disconnect closes the mailbox item; an idle run does not rewrite the connector row", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    const idle1 = await connector(t, f.adamBox);
    await passTime(60_000);
    expect((await sync(t, f.adamBox)).status).toBe("synced");
    expect(await connector(t, f.adamBox)).toEqual(idle1); // nothing it shows changed
    await passTime(5 * 60_000);
    await sync(t, f.adamBox);
    expect((await connector(t, f.adamBox))?.sync?.lastSyncAt).toBe(Date.now());

    deliver("adam@konverted.io", mail({ from: "Kovács Réka <reka@pragmatico.hu>" }).raw);
    const box = mailbox("adam@konverted.io");
    box.failGets.push({ status: 503, times: 100 });
    for (let i = 0; i < 6; i++) {
      await sync(t, f.adamBox);
      await passTime(31 * 60_000);
    }
    expect((await emailItems(t)).filter((i) => i.anchor.type === "mailbox" && i.status === "open")).toHaveLength(1);
    await t.withIdentity(ADAM).mutation(api.connectors.disconnect, { type: "gmail" });
    expect((await emailItems(t)).filter((i) => i.anchor.type === "mailbox" && i.status === "open")).toHaveLength(0);
  });

  it("L6: an HTML attachment is stored as a plain download (the original type stays on the row)", async () => {
    const t = createT();
    const f = await setup(t);
    await startFromNow(t, f.adamBox);
    deliver(
      "adam@konverted.io",
      mail({ from: "Kovács Réka <reka@pragmatico.hu>", attachment: { name: "page.html", mime: "text/html", base64: btoa("<script>alert(1)</script>") } }).raw,
    );
    await sync(t, f.adamBox);
    const [m] = await messagesOf(t);
    expect(m.attachments[0]).toMatchObject({ name: "page.html", mime: "text/html" });
    const type = await t.run(async (ctx) => (await ctx.storage.get(m.attachments[0].storageId!))?.type);
    expect(type).toBe("application/octet-stream");
  });
});

