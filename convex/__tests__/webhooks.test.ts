// @vitest-environment edge-runtime
//
// Outbound webhooks V1 (docs/prd-agent-first-backlog.md §5, decisions W1–W8):
//   W2  every activity row is an event; the endpoint's type filter applies
//   W3  the payload is short: refs and names, never bodies or comment text
//   W4  HMAC-SHA256 over "<t>.<body>", verified here independently
//   W5  writes by an excluded OAuth client are not delivered
//   W6  at-least-once: 3 retries (30 s, 5 min, 30 min), then failed; 7-day log
//   W7  the URL guard (https, no IP literal, no localhost/.internal, not the app)
//   W8  delivery is scheduled, never awaited by the write
// Admin functions use the app session (getAuthContext + admin), so members
// and OAuth tokens (I4) are refused.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask, updateTask } from "../tasks/write";
import { loadTaskForWrite } from "../tasks/access";
import { changeOf, validateWebhookUrl, WEBHOOK_DELIVERY_TTL_MS, WEBHOOK_EVENT_TYPES, WEBHOOK_RETRY_DELAYS_MS } from "../webhooks";
import { WEBHOOK_PICKER_TYPES } from "../../lib/webhook-events";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_webhooks";
const OTHER = "org_webhooks_other";
const RESOURCE = "https://flow.test/mcp";
const HOOK = "https://agent.example.com/hooks/flow";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "other";
const SUBJECT: Record<Caller, [string, string]> = {
  admin: ["clerk_admin", ORG],
  alice: ["clerk_alice", ORG],
  other: ["clerk_other", OTHER],
};

const inApp = (t: T, caller: Caller, role: "org:admin" | "org:member" = caller === "alice" ? "org:member" : "org:admin") =>
  t.withIdentity({ subject: SUBJECT[caller][0], tokenIdentifier: `test|${SUBJECT[caller][0]}`, org_id: SUBJECT[caller][1], org_role: role });

const viaMcp = (t: T, caller: Caller, clientId: string) =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: clientId, org_id: SUBJECT[caller][1] });

type Sent = { url: string; headers: Record<string, string>; body: string };
let sent: Sent[] = [];
let respond: () => Promise<Response> = async () => new Response("ok", { status: 200 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("MCP_RESOURCE_URL", RESOURCE);
  sent = [];
  respond = async () => new Response("ok", { status: 200 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: init.body as string });
    return await respond();
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(t: T) {
  const f = await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Ada Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    const statusIds: Record<string, Id<"statuses">> = {};
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      statusIds[s.name] = await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const client = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const arlo = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Arlow site", code: "ARLO", billingType: "retainer", monthlyFee: 5000,
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const task = await createTask(ctx, adminAuth, { title: "Logo v2", projectId: arlo, assigneeIds: [alice] }, { notify: false });
    return { admin, alice, arlo, adminAuth, task, statusIds, identifier: (await ctx.db.get(task))!.identifier };
  });
  await t.run((ctx) => connectMembers(ctx, ["client_claude", "client_codex"]));
  return f;
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const createEndpoint = (t: T, args: { url?: string; eventTypes?: string[]; excludeClientIds?: string[] } = {}) =>
  inApp(t, "admin").action(api.webhooks.create, { url: args.url ?? HOOK, eventTypes: args.eventTypes, excludeClientIds: args.excludeClientIds });

const deliveries = (t: T) =>
  t.run(async (ctx) => (await ctx.db.query("webhookDeliveries").collect()).sort((a, b) => a.attempt - b.attempt || a._creationTime - b._creationTime));

/** Moves the fixture's task to Done in the app (one status_changed event). */
const moveToDone = (t: T, f: Fixture) =>
  t.run(async (ctx) => {
    const access = await loadTaskForWrite(ctx, f.task, f.adminAuth);
    await updateTask(ctx, access, { statusId: f.statusIds[DEFAULT_STATUS_SEED.find((s) => s.category === "completed")!.name] });
  });

const runAll = (t: T) => t.finishAllScheduledFunctions(() => vi.runAllTimers());

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── URL guard (W7) ──────────────────────────────────────────────────────────

describe("validateWebhookUrl (W7)", () => {
  it.each([
    ["http://agent.example.com/hook", "https"],
    ["https://127.0.0.1/hook", "IP"],
    ["https://[::1]/hook", "IP"],
    ["https://10.0.0.8/hook", "IP"],
    ["https://localhost/hook", "localhost"],
    ["https://api.localhost/hook", "localhost"],
    ["https://metadata.internal/hook", "internal"],
    ["https://flow.test/api/hook", "Agency Flow"],
    ["not a url", "URL"],
  ])("refuses %s", (url, reason) => {
    expect(validateWebhookUrl(url, "https://flow.test")).toMatch(new RegExp(reason, "i"));
  });

  it("accepts a public https URL", () => {
    expect(validateWebhookUrl(HOOK, "https://flow.test")).toBeNull();
  });
});

// ─── Payload reduction (W3) ──────────────────────────────────────────────────

describe("changeOf (W3)", () => {
  it("keeps short scalar fields and drops internal ids and free text", () => {
    expect(changeOf({ from: "In progress", to: "Done", fromId: "s1", toId: "s2", toCategory: "completed" })).toEqual({
      from: "In progress", to: "Done", toCategory: "completed",
    });
    expect(changeOf({ entryId: "e1", duration: "1:30", note: "Called the client about the invoice" })).toEqual({ entryId: "e1", duration: "1:30" });
    expect(changeOf({ commentId: "c1" })).toEqual({ commentId: "c1" });
    expect(changeOf({ title: "x".repeat(500) }).title).toHaveLength(200);
  });
});

describe("event families (Settings → Webhooks picker)", () => {
  it("offer every deliverable type once, except the legacy description_changed", () => {
    expect(new Set(WEBHOOK_PICKER_TYPES).size).toBe(WEBHOOK_PICKER_TYPES.length);
    expect([...WEBHOOK_PICKER_TYPES].sort()).toEqual(WEBHOOK_EVENT_TYPES.filter((t) => t !== "description_changed").sort());
  });
});

// ─── Scheduling (W2, W5, W8) ─────────────────────────────────────────────────

describe("scheduling", () => {
  it("an activity write schedules one delivery per enabled, matching endpoint", async () => {
    const t = createT();
    const f = await setup(t);
    await createEndpoint(t);
    await moveToDone(t, f);
    const rows = await deliveries(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: ORG, attempt: 1, status: "pending" });
    const activity = await t.run(async (ctx) => await ctx.db.get(rows[0].activityId!));
    expect(activity?.type).toBe("status_changed");
  });

  it("no endpoint: nothing is scheduled", async () => {
    const t = createT();
    const f = await setup(t);
    await moveToDone(t, f);
    expect(await deliveries(t)).toHaveLength(0);
  });

  it("the type filter, a disabled endpoint and an excluded client skip", async () => {
    const t = createT();
    const f = await setup(t);
    const { endpointId } = await createEndpoint(t, { eventTypes: ["comment_added"], excludeClientIds: ["client_claude"] });
    await moveToDone(t, f);
    expect(await deliveries(t)).toHaveLength(0);

    // A comment by the excluded client is not delivered; by another client it is.
    await viaMcp(t, "admin", "client_claude").mutation(api.mcp.write.saveComments, {
      items: [{ task: f.identifier, body: "From Claude" }] as never, clientName: "Claude",
    });
    expect(await deliveries(t)).toHaveLength(0);
    await viaMcp(t, "admin", "client_codex").mutation(api.mcp.write.saveComments, {
      items: [{ task: f.identifier, body: "From Codex" }] as never, clientName: "Codex",
    });
    expect(await deliveries(t)).toHaveLength(1);

    await inApp(t, "admin").mutation(api.webhooks.update, { endpointId, enabled: false });
    await viaMcp(t, "admin", "client_codex").mutation(api.mcp.write.saveComments, {
      items: [{ task: f.identifier, body: "Again" }] as never, clientName: "Codex",
    });
    expect(await deliveries(t)).toHaveLength(1);
  });

  it("an unknown event type is refused", async () => {
    const t = createT();
    await setup(t);
    await expect(createEndpoint(t, { eventTypes: ["due_soon"] })).rejects.toThrow(/Unknown event type/);
  });
});

// ─── Delivery (W3, W4, W6) ───────────────────────────────────────────────────

describe("delivery", () => {
  it("posts the short, signed payload and stamps the endpoint", async () => {
    const t = createT();
    const f = await setup(t);
    const { secret } = await createEndpoint(t);
    await moveToDone(t, f);
    await runAll(t);

    expect(sent).toHaveLength(1);
    const [post] = sent;
    expect(post.url).toBe(HOOK);
    const payload = JSON.parse(post.body);
    const [row] = await deliveries(t);
    expect(payload).toEqual({
      id: row.activityId,
      event: "status_changed",
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      org: ORG,
      actor: { name: "Ada Admin", email: "clerk_admin@x.test" },
      task: { ref: f.identifier, link: `https://flow.test/tasks/${f.identifier}`, project: "ARLO", client: "client:ARL" },
      change: { from: expect.any(String), to: "Done", toCategory: "completed" },
    });
    expect(post.headers["Content-Type"]).toBe("application/json");
    expect(post.headers["User-Agent"]).toBe("AgencyFlow-Webhooks/1");
    expect(post.headers["X-AgencyFlow-Event"]).toBe("status_changed");
    expect(post.headers["X-AgencyFlow-Delivery"]).toBe(row._id);

    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(post.headers["X-AgencyFlow-Signature"]);
    expect(match).not.toBeNull();
    expect(match![2]).toBe(await hmacHex(secret, `${match![1]}.${post.body}`));

    expect(row).toMatchObject({ status: "ok", httpStatus: 200 });
    const endpoint = await inApp(t, "admin").query(api.webhooks.get, {});
    expect(endpoint).toMatchObject({ lastDeliveryStatus: "ok", lastDeliveryHttpStatus: 200 });
  });

  it("a comment event carries the comment id, never its text, and via for MCP writes", async () => {
    const t = createT();
    const f = await setup(t);
    await createEndpoint(t);
    await viaMcp(t, "admin", "client_codex").mutation(api.mcp.write.saveComments, {
      items: [{ task: f.identifier, body: "The client approved the secret logo" }] as never, clientName: "Codex",
    });
    await runAll(t);
    const payload = JSON.parse(sent[0].body);
    expect(payload.event).toBe("comment_added");
    expect(payload.via).toEqual({ clientId: "client_codex", clientName: "Codex" });
    expect(Object.keys(payload.change)).toEqual(["commentId"]);
    expect(sent[0].body).not.toContain("secret logo");
  });

  it("a failing endpoint retries after 30 s, 5 min and 30 min, then fails (W6)", async () => {
    const t = createT();
    const f = await setup(t);
    await createEndpoint(t);
    respond = async () => new Response("nope", { status: 503 });
    await moveToDone(t, f);
    await runAll(t);

    const rows = await deliveries(t);
    expect(rows.map((r) => [r.attempt, r.status, r.httpStatus])).toEqual([
      [1, "failed", 503], [2, "failed", 503], [3, "failed", 503], [4, "failed", 503],
    ]);
    // Each failed attempt but the last names when the next one runs; the next
    // row is created at that failure.
    expect(rows.slice(0, 3).map((r, i) => r.nextAttemptAt! - rows[i + 1].createdAt)).toEqual([...WEBHOOK_RETRY_DELAYS_MS]);
    expect(rows[3].nextAttemptAt).toBeUndefined();
    expect(new Set(rows.map((r) => r.activityId)).size).toBe(1);
    // Retries resend the same event id, so receivers can dedupe.
    expect(new Set(sent.map((s) => JSON.parse(s.body).id)).size).toBe(1);
    expect(await inApp(t, "admin").query(api.webhooks.get, {})).toMatchObject({ lastDeliveryStatus: "failed", lastDeliveryHttpStatus: 503 });
    // The list names the task and when a failed attempt is retried.
    const recent = await inApp(t, "admin").query(api.webhooks.recentDeliveries, { endpointId: rows[0].endpointId });
    expect(recent.map((r) => [r.attempt, r.task, r.nextAttemptAt === null])).toEqual([
      [4, f.identifier, true], [3, f.identifier, false], [2, f.identifier, false], [1, f.identifier, false],
    ]);
  });

  it("a network error is recorded without the response or the URL", async () => {
    const t = createT();
    const f = await setup(t);
    await createEndpoint(t, { url: `${HOOK}?token=abc` });
    respond = async () => {
      throw new Error("connect ECONNREFUSED https://agent.example.com/hooks/flow?token=abc");
    };
    await moveToDone(t, f);
    await runAll(t);
    const rows = await deliveries(t);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.status).toBe("failed");
      expect(row.error).toBeTruthy();
      expect(row.error).not.toContain("token=abc");
    }
  });

  it("a removed endpoint stops pending deliveries", async () => {
    const t = createT();
    const f = await setup(t);
    const { endpointId } = await createEndpoint(t);
    await moveToDone(t, f);
    await inApp(t, "admin").mutation(api.webhooks.remove, { endpointId });
    await runAll(t);
    expect(sent).toHaveLength(0);
  });
});

// ─── Admin functions ─────────────────────────────────────────────────────────

describe("admin functions", () => {
  it("create returns the secret once; get never returns it", async () => {
    const t = createT();
    await setup(t);
    const { secret } = await createEndpoint(t);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const endpoint = await inApp(t, "admin").query(api.webhooks.get, {});
    expect(endpoint).toMatchObject({ url: HOOK, secretHint: secret.slice(-4), enabled: true, excludeClientIds: [], createdByName: "Ada Admin" });
    expect(JSON.stringify(endpoint)).not.toContain(secret);
  });

  it("one endpoint per organization (W1)", async () => {
    const t = createT();
    await setup(t);
    await createEndpoint(t);
    await expect(createEndpoint(t)).rejects.toThrow(/already has a webhook/);
  });

  it("rotateSecret returns a new secret that signs from then on", async () => {
    const t = createT();
    const f = await setup(t);
    const { endpointId, secret } = await createEndpoint(t);
    const rotated = await inApp(t, "admin").action(api.webhooks.rotateSecret, { endpointId });
    expect(rotated.secret).not.toBe(secret);
    await moveToDone(t, f);
    await runAll(t);
    const [, t0, mac] = /^t=(\d+),v1=(\w+)$/.exec(sent[0].headers["X-AgencyFlow-Signature"])!;
    expect(mac).toBe(await hmacHex(rotated.secret, `${t0}.${sent[0].body}`));
  });

  it("update re-validates a changed URL", async () => {
    const t = createT();
    await setup(t);
    const { endpointId } = await createEndpoint(t);
    await expect(inApp(t, "admin").mutation(api.webhooks.update, { endpointId, url: "http://agent.example.com" })).rejects.toThrow(/https/);
    await inApp(t, "admin").mutation(api.webhooks.update, { endpointId, url: "https://other.example.com/x", eventTypes: null });
    expect(await inApp(t, "admin").query(api.webhooks.get, {})).toMatchObject({ url: "https://other.example.com/x" });
  });

  it("sendTest posts a signed test event and logs it; recentDeliveries lists it", async () => {
    const t = createT();
    await setup(t);
    const { endpointId, secret } = await createEndpoint(t);
    const result = await inApp(t, "admin").action(api.webhooks.sendTest, { endpointId });
    expect(result).toMatchObject({ status: "ok", httpStatus: 200 });
    const payload = JSON.parse(sent[0].body);
    expect(payload).toMatchObject({ event: "test", org: ORG });
    const [, t0, mac] = /^t=(\d+),v1=(\w+)$/.exec(sent[0].headers["X-AgencyFlow-Signature"])!;
    expect(mac).toBe(await hmacHex(secret, `${t0}.${sent[0].body}`));
    const recent = await inApp(t, "admin").query(api.webhooks.recentDeliveries, { endpointId });
    expect(recent).toEqual([expect.objectContaining({ event: "test", status: "ok", httpStatus: 200, attempt: 1, task: null })]);
  });

  it("a failing test event is not retried", async () => {
    const t = createT();
    await setup(t);
    const { endpointId } = await createEndpoint(t);
    respond = async () => new Response("", { status: 500 });
    expect(await inApp(t, "admin").action(api.webhooks.sendTest, { endpointId })).toMatchObject({ status: "failed", httpStatus: 500 });
    await runAll(t);
    expect(await deliveries(t)).toHaveLength(1);
  });

  it("connectedClients lists the org's OAuth clients once each", async () => {
    const t = createT();
    await setup(t);
    const clients = await inApp(t, "admin").query(api.webhooks.connectedClients, {});
    expect(clients.map((c) => c.clientId).sort()).toEqual(["client_claude", "client_codex"]);
  });

  it("members, OAuth tokens (I4) and other orgs cannot read or change endpoints", async () => {
    const t = createT();
    await setup(t);
    const { endpointId } = await createEndpoint(t);
    await expect(inApp(t, "alice").query(api.webhooks.get, {})).rejects.toThrow(/Admin/);
    await expect(inApp(t, "alice").mutation(api.webhooks.update, { endpointId, enabled: false })).rejects.toThrow(/Admin/);
    await expect(inApp(t, "alice").action(api.webhooks.create, { url: HOOK })).rejects.toThrow(/Admin/);
    await expect(inApp(t, "alice").action(api.webhooks.sendTest, { endpointId })).rejects.toThrow(/Admin/);
    await expect(viaMcp(t, "admin", "client_claude").query(api.webhooks.get, {})).rejects.toThrow(/Not authenticated/);
    await expect(viaMcp(t, "admin", "client_claude").action(api.webhooks.rotateSecret, { endpointId })).rejects.toThrow(/Not authenticated/);
    // Another org's admin: the endpoint does not exist for them.
    expect(await inApp(t, "other").query(api.webhooks.get, {})).toBeNull();
    await expect(inApp(t, "other").mutation(api.webhooks.remove, { endpointId })).rejects.toThrow(/not found/);
    await expect(inApp(t, "other").query(api.webhooks.recentDeliveries, { endpointId })).rejects.toThrow(/not found/);
  });
});

// ─── Cleanup (W6) ────────────────────────────────────────────────────────────

describe("cleanup", () => {
  it("removes deliveries older than 7 days and nothing newer", async () => {
    const t = createT();
    const f = await setup(t);
    await createEndpoint(t);
    await moveToDone(t, f);
    await runAll(t);
    vi.advanceTimersByTime(WEBHOOK_DELIVERY_TTL_MS - 60_000);
    await t.run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, f.task, f.adminAuth);
      await updateTask(ctx, access, { title: "Logo v3" });
    });
    await runAll(t);
    expect(await deliveries(t)).toHaveLength(2);
    vi.advanceTimersByTime(120_000);
    await t.mutation(internal.webhooks.cleanupExpired, {});
    const left = await deliveries(t);
    expect(left).toHaveLength(1);
    const kept = await t.run(async (ctx) => await ctx.db.get(left[0].activityId!));
    expect(kept?.type).toBe("title_changed");
  });
});
