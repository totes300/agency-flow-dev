import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { assertAdmin, getAuthContext, type AuthContext } from "./lib/auth";
import { activityLogValidator, type ActivityType, type ActivityVia } from "./tasks/model";

/**
 * Outbound webhooks V1 (docs/prd-agent-first-backlog.md §5, owner decisions
 * W1–W8). An admin registers one HTTPS endpoint per org (W1); every
 * `activityLog` row (W2) is POSTed to it as a short, signed JSON payload (W3,
 * W4) so an agent wakes up when a human changes something. The changes feed
 * stays the source of truth; a webhook is only a signal.
 *
 * - `scheduleWebhookDeliveries` runs inside `logActivity` (the single writer of
 *   activity rows): one indexed read, then per matching endpoint one pending
 *   `webhookDeliveries` row and a scheduled `deliver`. Never awaited, so a
 *   failing endpoint cannot affect the write (W8).
 * - `deliver` (action, default runtime) signs and POSTs with a 10 s timeout;
 *   a failure is retried after 30 s, 5 min and 30 min as new attempt rows,
 *   then left failed (W6). Each retry resends the same event `id`.
 * - Delivery outcomes are written only to `webhookDeliveries`, never to the
 *   endpoint row: every activity write reads that row, so stamping it per
 *   attempt made concurrent writes in the org retry (W8). The endpoint's
 *   "last delivery" is read from its newest finished attempt.
 * - An attempt whose action died between `startAttempt` and `recordAttempt`
 *   (timeout, deploy) is closed by the hourly cleanup as "Attempt
 *   interrupted", and retried like a failed one.
 * - Admin functions use the app session (`getAuthContext` + admin), so OAuth
 *   tokens are refused (I4); the secret is made in actions (randomness in
 *   mutations is deterministic) and returned only by create / rotate.
 */

/** Delay before attempt 2, 3 and 4 (W6). */
export const WEBHOOK_RETRY_DELAYS_MS = [30_000, 5 * 60_000, 30 * 60_000] as const;
const MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;
/** Delivery rows are kept 7 days (W6). */
export const WEBHOOK_DELIVERY_TTL_MS = 7 * 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
/**
 * A started attempt still pending after this long lost its action (the
 * request itself times out after 10 s); the hourly cleanup closes it.
 */
export const WEBHOOK_ATTEMPT_INTERRUPTED_MS = 5 * 60_000;
/** W1 shows one endpoint per org; reads stay bounded if the table ever holds more. */
const ENDPOINTS_PER_ORG_MAX = 10;
const RECENT_DELIVERIES = 20;
const CLEANUP_BATCH = 500;
/** Interrupted attempts closed per cleanup run; each may queue a retry. */
const INTERRUPTED_BATCH = 100;
/** Recent attempt rows read to find the endpoint's last finished delivery. */
const LAST_DELIVERY_SCAN = 50;
const URL_MAX_LENGTH = 2048;
const EXCLUDE_CLIENTS_MAX = 20;
const AUTH_KEY_MIN = 8;
const AUTH_KEY_MAX = 2000;
/** A key shorter than this gets no hint: its last 4 characters would be most of it. */
const AUTH_KEY_HINT_MIN = 12;
const CONNECTIONS_READ_MAX = 500;
/** Longest string kept in a payload's `change`. */
const CHANGE_STRING_MAX = 200;

/** Every activity type is a deliverable event (W2). */
export const WEBHOOK_EVENT_TYPES: readonly ActivityType[] = activityLogValidator.members.map(
  (member) => member.fields.type.value,
);

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** The app origin, from the MCP resource URL (the app and /mcp share it). */
function appOrigin(): string | null {
  const resource = process.env.MCP_RESOURCE_URL;
  if (!resource) return null;
  try {
    return new URL(resource).origin;
  } catch {
    return null;
  }
}

/**
 * Why a webhook URL is refused, or null (W7): https only, a host name (no IP
 * literal), not localhost or an `.internal` host, not the app itself. A host
 * name that resolves to a private address is an accepted V1 risk.
 */
export function validateWebhookUrl(raw: string, ownOrigin: string | null): string | null {
  if (raw.length > URL_MAX_LENGTH) return `The webhook URL is longer than ${URL_MAX_LENGTH} characters.`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "Enter a valid URL, e.g. https://agent.example.com/hooks/agency-flow.";
  }
  if (url.protocol !== "https:") return "The webhook URL must start with https://.";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return "The webhook URL must use a host name, not an IP address.";
  }
  if (host === "localhost" || host.endsWith(".localhost")) return "The webhook URL cannot point to localhost.";
  if (host === "internal" || host.endsWith(".internal")) return "The webhook URL cannot point to an internal host.";
  if (ownOrigin && host === new URL(ownOrigin).hostname.toLowerCase()) {
    return "The webhook URL cannot point to Agency Flow itself.";
  }
  return null;
}

/** Metadata keys that are internal ids or free text: never in a payload (W3). */
const CHANGE_DROPPED_KEYS = new Set(["fromId", "toId", "labelId", "userId", "note"]);

/**
 * An activity row's metadata reduced to short scalar fields (W3): status and
 * label names, record ids an agent can fetch, durations; never free text
 * (time-entry notes; comments carry only their id). Strings are capped.
 */
export function changeOf(metadata: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const change: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (CHANGE_DROPPED_KEYS.has(key)) continue;
    if (typeof value === "string") change[key] = value.slice(0, CHANGE_STRING_MAX);
    else if (typeof value === "number" || typeof value === "boolean" || value === null) change[key] = value;
  }
  return change;
}

function checkEventTypes(eventTypes: readonly string[] | undefined): void {
  if (eventTypes === undefined) return;
  if (eventTypes.length === 0) throw new ConvexError("Choose at least one event type, or all.");
  for (const type of eventTypes) {
    if (!(WEBHOOK_EVENT_TYPES as readonly string[]).includes(type)) throw new ConvexError(`Unknown event type "${type}".`);
  }
}

function checkClientIds(clientIds: readonly string[]): void {
  if (clientIds.length > EXCLUDE_CLIENTS_MAX) throw new ConvexError(`At most ${EXCLUDE_CLIENTS_MAX} apps can be excluded.`);
  for (const id of clientIds) {
    if (id.length === 0 || id.length > 300) throw new ConvexError("Invalid app id.");
  }
}

/**
 * The receiver's bearer key as stored: trimmed, without a pasted "Bearer "
 * prefix; one token of 8–2000 printable ASCII characters, no spaces. The
 * character check is also the header-injection guard (no CR/LF) and keeps
 * `fetch` from refusing the header value.
 */
export function normalizeAuthKey(raw: string): string {
  const key = raw.replace(/^\s*bearer(\s+|$)/i, "").trim();
  if (key.length === 0) throw new ConvexError("The authorization key is empty.");
  if (key.length < AUTH_KEY_MIN) throw new ConvexError(`The authorization key is shorter than ${AUTH_KEY_MIN} characters.`);
  if (key.length > AUTH_KEY_MAX) throw new ConvexError(`The authorization key is longer than ${AUTH_KEY_MAX} characters.`);
  if (!/^[\x21-\x7e]+$/.test(key)) throw new ConvexError("The authorization key must be one word of printable characters, without spaces.");
  return key;
}

/**
 * What the UI may show of a stored key: null when there is none, the last 4
 * characters when the key is long enough for that to give nothing away, else
 * "" (set, but no characters shown).
 */
export function authKeyHintOf(authKey: string | undefined): string | null {
  if (!authKey) return null;
  return authKey.length >= AUTH_KEY_HINT_MIN ? authKey.slice(-4) : "";
}

function checkUrl(url: string): void {
  const problem = validateWebhookUrl(url, appOrigin());
  if (problem) throw new ConvexError(problem);
}

/** 32 random bytes, base64url. Call only in an action (W4). */
function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ─── Scheduling (called by logActivity) ──────────────────────────────────────

/**
 * Queues the activity row for every enabled endpoint of the org whose type
 * filter takes it and that does not exclude the writing OAuth client (W5).
 */
export async function scheduleWebhookDeliveries(
  ctx: MutationCtx,
  event: { orgId: string; activityId: Id<"activityLog">; type: ActivityType; via?: ActivityVia },
): Promise<void> {
  const endpoints = await ctx.db
    .query("webhookEndpoints")
    .withIndex("by_orgId", (q) => q.eq("orgId", event.orgId))
    .take(ENDPOINTS_PER_ORG_MAX);
  const now = Date.now();
  for (const endpoint of endpoints) {
    if (!endpoint.enabled) continue;
    if (endpoint.eventTypes && !endpoint.eventTypes.includes(event.type)) continue;
    if (event.via && endpoint.excludeClientIds.includes(event.via.clientId)) continue;
    const deliveryId = await ctx.db.insert("webhookDeliveries", {
      orgId: event.orgId,
      endpointId: endpoint._id,
      activityId: event.activityId,
      attempt: 1,
      status: "pending",
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId });
  }
}

// ─── Delivery ────────────────────────────────────────────────────────────────

type ChangeValue = string | number | boolean | null;

type WebhookPayload = {
  id: string;
  event: string;
  at: string;
  org: string;
  actor?: { name: string; email?: string };
  via?: { clientId: string; clientName: string };
  task?: { ref: string; link?: string; project?: string; client?: string };
  change?: Record<string, ChangeValue>;
};

type DeliveryJob = { url: string; secret: string; authKey: string | null; attempt: number; payload: WebhookPayload };

/** The task ref an activity row recorded (e.g. `task_deleted`), for when the task is gone. */
function recordedIdentifier(row: Doc<"activityLog">): string | null {
  const identifier = (row.metadata as { identifier?: unknown }).identifier;
  return typeof identifier === "string" ? identifier : null;
}

async function taskPart(ctx: QueryCtx, row: Doc<"activityLog">): Promise<NonNullable<WebhookPayload["task"]>> {
  const task = await ctx.db.get(row.taskId);
  if (!task || task.orgId !== row.orgId) {
    // A deleted task: its activity row is the record; the ref is the last one known.
    return { ref: recordedIdentifier(row) ?? row.taskId };
  }
  const origin = appOrigin();
  const part: NonNullable<WebhookPayload["task"]> = {
    ref: task.identifier,
    ...(origin ? { link: `${origin}/tasks/${encodeURIComponent(task.identifier)}` } : {}),
  };
  const project = task.projectId ? await ctx.db.get(task.projectId) : null;
  if (project && project.orgId === row.orgId) part.project = project.code;
  const client = task.clientId ? await ctx.db.get(task.clientId) : null;
  if (client && client.orgId === row.orgId && client.prefix) part.client = `client:${client.prefix}`;
  return part;
}

async function eventPayload(ctx: QueryCtx, row: Doc<"activityLog">): Promise<WebhookPayload> {
  const actor = await ctx.db.get(row.userId);
  const metadata = row.metadata as Record<string, unknown>;
  const change = changeOf(metadata);
  if (typeof metadata.userId === "string") {
    const member = await ctx.db.get(metadata.userId as Id<"users">);
    if (member?.email) change.email = member.email;
  }
  return {
    id: row._id,
    event: row.type,
    at: new Date(row.createdAt).toISOString(),
    org: row.orgId,
    actor: { name: actor?.name ?? "Unknown", ...(actor?.email ? { email: actor.email } : {}) },
    ...(row.via ? { via: { clientId: row.via.clientId, clientName: row.via.clientName } } : {}),
    task: await taskPart(ctx, row),
    change,
  };
}

/**
 * The attempt's job, or null when there is nothing to send: the row is gone
 * or already done, or its endpoint was removed or (for an event) disabled —
 * such a row is closed as failed here, with no retry. A job marks the
 * attempt started (`startedAt`).
 */
export const startAttempt = internalMutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }): Promise<DeliveryJob | null> => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return null;
    const endpoint = await ctx.db.get(delivery.endpointId);
    const live = endpoint && endpoint.orgId === delivery.orgId && (endpoint.enabled || !delivery.activityId);
    if (!live) {
      await ctx.db.patch(deliveryId, { status: "failed", error: "Endpoint removed or disabled" });
      return null;
    }
    let payload: WebhookPayload;
    if (delivery.activityId) {
      const row = await ctx.db.get(delivery.activityId);
      if (!row || row.orgId !== delivery.orgId) {
        await ctx.db.patch(deliveryId, { status: "failed", error: "Event not found" });
        return null;
      }
      payload = await eventPayload(ctx, row);
    } else {
      payload = { id: deliveryId, event: "test", at: new Date(delivery.createdAt).toISOString(), org: delivery.orgId };
    }
    await ctx.db.patch(deliveryId, { startedAt: Date.now() });
    return { url: endpoint.url, secret: endpoint.secret, authKey: endpoint.authKey ?? null, attempt: delivery.attempt, payload };
  },
});

type AttemptOutcome = { ok: boolean; httpStatus?: number; error?: string };

/**
 * Closes a pending attempt with its outcome; a failed event attempt below the
 * limit, on an endpoint still enabled, queues the next one (W6). Test events
 * are never retried. Writes only delivery rows (W8).
 */
async function closeAttempt(ctx: MutationCtx, delivery: Doc<"webhookDeliveries">, { ok, httpStatus, error }: AttemptOutcome) {
  await ctx.db.patch(delivery._id, { status: ok ? "ok" : "failed", httpStatus, error });
  if (ok || !delivery.activityId || delivery.attempt >= MAX_ATTEMPTS) return;
  const endpoint = await ctx.db.get(delivery.endpointId);
  if (!endpoint || endpoint.orgId !== delivery.orgId || !endpoint.enabled) return;
  const now = Date.now();
  const delay = WEBHOOK_RETRY_DELAYS_MS[delivery.attempt - 1];
  await ctx.db.patch(delivery._id, { nextAttemptAt: now + delay });
  const next = await ctx.db.insert("webhookDeliveries", {
    orgId: delivery.orgId,
    endpointId: delivery.endpointId,
    activityId: delivery.activityId,
    attempt: delivery.attempt + 1,
    status: "pending",
    createdAt: now,
  });
  await ctx.scheduler.runAfter(delay, internal.webhooks.deliver, { deliveryId: next });
}

/**
 * Records an attempt's outcome. An attempt already closed (by the cleanup, as
 * interrupted) is left as it is: its retry is already queued.
 */
export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    httpStatus: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { deliveryId, ...outcome }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "pending") return null;
    await closeAttempt(ctx, delivery, outcome);
    return null;
  },
});

type AttemptResult = { status: "ok" | "failed"; httpStatus?: number };

/** One signed POST for one delivery row (W4); the outcome is recorded, never thrown (W8). */
async function attemptDelivery(ctx: ActionCtx, deliveryId: Id<"webhookDeliveries">): Promise<AttemptResult | null> {
  const job: DeliveryJob | null = await ctx.runMutation(internal.webhooks.startAttempt, { deliveryId });
  if (!job) return null;
  const body = JSON.stringify(job.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await hmacSha256Hex(job.secret, `${timestamp}.${body}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let httpStatus: number | undefined;
  let error: string | undefined;
  try {
    const response = await fetch(job.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AgencyFlow-Webhooks/1",
        "X-AgencyFlow-Event": job.payload.event,
        "X-AgencyFlow-Delivery": deliveryId,
        "X-AgencyFlow-Signature": `t=${timestamp},v1=${signature}`,
        ...(job.authKey ? { Authorization: `Bearer ${job.authKey}` } : {}),
      },
      body,
      signal: controller.signal,
      redirect: "manual",
    });
    httpStatus = response.status;
  } catch {
    // Never the error text: it can carry the URL and its query string.
    error = controller.signal.aborted ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000} s` : "Network error";
  } finally {
    clearTimeout(timer);
  }
  const ok = httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300;
  if (!ok && error === undefined) error = `HTTP ${httpStatus}`;
  await ctx.runMutation(internal.webhooks.recordAttempt, { deliveryId, ok, httpStatus, error });
  console.log(`[webhook] delivery ${deliveryId} attempt ${job.attempt} ${ok ? "ok" : "failed"}`);
  return { status: ok ? "ok" : "failed", ...(httpStatus !== undefined ? { httpStatus } : {}) };
}

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    await attemptDelivery(ctx, deliveryId);
    return null;
  },
});

/**
 * Closes attempts started more than 5 minutes ago and still pending as
 * "Attempt interrupted" (retried like any failure); true when more may be left.
 */
async function closeInterruptedAttempts(ctx: MutationCtx): Promise<boolean> {
  const cutoff = Date.now() - WEBHOOK_ATTEMPT_INTERRUPTED_MS;
  // A queued attempt not yet started has no `startedAt` and sorts below 0.
  const stale = await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_status_startedAt", (q) => q.eq("status", "pending").gt("startedAt", 0).lte("startedAt", cutoff))
    .take(INTERRUPTED_BATCH);
  for (const row of stale) await closeAttempt(ctx, row, { ok: false, error: "Attempt interrupted" });
  return stale.length === INTERRUPTED_BATCH;
}

/**
 * Closes interrupted attempts, then deletes delivery rows older than 7 days,
 * oldest first (W6). Runs hourly (crons.ts).
 */
export const cleanupExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const moreInterrupted = await closeInterruptedAttempts(ctx);
    const cutoff = Date.now() - WEBHOOK_DELIVERY_TTL_MS;
    const expired = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", cutoff))
      .take(CLEANUP_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    if (moreInterrupted || expired.length === CLEANUP_BATCH) {
      await ctx.scheduler.runAfter(0, internal.webhooks.cleanupExpired, {});
    }
    return null;
  },
});

// ─── Admin (Settings → Webhooks) ─────────────────────────────────────────────

async function requireAdminAuth(ctx: QueryCtx | MutationCtx): Promise<AuthContext> {
  const auth = await getAuthContext(ctx);
  assertAdmin(auth);
  return auth;
}

/** The endpoint when it is the caller's org's ("not found" otherwise, I3). */
async function ownEndpoint(ctx: QueryCtx | MutationCtx, auth: AuthContext, endpointId: Id<"webhookEndpoints">) {
  const endpoint = await ctx.db.get(endpointId);
  if (!endpoint || endpoint.orgId !== auth.orgId) throw new ConvexError("Webhook endpoint not found.");
  return endpoint;
}

type LastDelivery = { at: number; status: "ok" | "failed"; httpStatus: number | null };

/**
 * The endpoint's last finished attempt, by when it ran, among its recent rows
 * (W6 "last delivery state"; the endpoint row is never stamped, W8).
 */
async function lastDeliveryOf(ctx: QueryCtx, endpointId: Id<"webhookEndpoints">): Promise<LastDelivery | null> {
  const rows = await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_endpointId_createdAt", (q) => q.eq("endpointId", endpointId))
    .order("desc")
    .take(LAST_DELIVERY_SCAN);
  let last: LastDelivery | null = null;
  for (const row of rows) {
    if (row.status === "pending") continue;
    const at = row.startedAt ?? row.createdAt;
    if (!last || at > last.at) last = { at, status: row.status, httpStatus: row.httpStatus ?? null };
  }
  return last;
}

function publicEndpoint(endpoint: Doc<"webhookEndpoints">, createdByName: string | null, last: LastDelivery | null) {
  return {
    _id: endpoint._id,
    url: endpoint.url,
    secretHint: endpoint.secretHint,
    authKeyHint: authKeyHintOf(endpoint.authKey),
    eventTypes: endpoint.eventTypes ?? null,
    excludeClientIds: endpoint.excludeClientIds,
    enabled: endpoint.enabled,
    createdAt: endpoint.createdAt,
    createdByName,
    updatedAt: endpoint.updatedAt,
    lastDeliveryAt: last?.at ?? null,
    lastDeliveryStatus: last?.status ?? null,
    lastDeliveryHttpStatus: last?.httpStatus ?? null,
  };
}

/** The org's endpoint, without its secret; null when none is set up. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAdminAuth(ctx);
    const endpoint = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .first();
    if (!endpoint) return null;
    const creator = await ctx.db.get(endpoint.createdBy);
    return publicEndpoint(endpoint, creator?.name ?? null, await lastDeliveryOf(ctx, endpoint._id));
  },
});

/** Creates the org's endpoint; returns the secret, the only time it is shown (W4). */
export const create = action({
  args: {
    url: v.string(),
    eventTypes: v.optional(v.array(v.string())),
    excludeClientIds: v.optional(v.array(v.string())),
    authKey: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ endpointId: Id<"webhookEndpoints">; secret: string }> => {
    const secret = newSecret();
    const endpointId: Id<"webhookEndpoints"> = await ctx.runMutation(internal.webhooks.insertEndpoint, { ...args, secret });
    return { endpointId, secret };
  },
});

/** The write half of `create`, as the action's caller (internal: the secret is the action's). */
export const insertEndpoint = internalMutation({
  args: {
    url: v.string(),
    eventTypes: v.optional(v.array(v.string())),
    excludeClientIds: v.optional(v.array(v.string())),
    authKey: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdminAuth(ctx);
    const existing = await ctx.db
      .query("webhookEndpoints")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .first();
    if (existing) throw new ConvexError("This workspace already has a webhook endpoint; edit it instead.");
    const url = args.url.trim();
    checkUrl(url);
    checkEventTypes(args.eventTypes);
    const excludeClientIds = args.excludeClientIds ?? [];
    checkClientIds(excludeClientIds);
    const authKey = args.authKey?.trim() ? normalizeAuthKey(args.authKey) : undefined;
    const now = Date.now();
    return await ctx.db.insert("webhookEndpoints", {
      orgId: auth.orgId,
      url,
      secret: args.secret,
      secretHint: args.secret.slice(-4),
      eventTypes: args.eventTypes,
      excludeClientIds,
      authKey,
      enabled: true,
      createdBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Edits the endpoint; `eventTypes: null` = every event type, `authKey: null`
 * removes the key (omitted = unchanged). A new URL is re-validated (W7).
 */
export const update = mutation({
  args: {
    endpointId: v.id("webhookEndpoints"),
    url: v.optional(v.string()),
    eventTypes: v.optional(v.union(v.null(), v.array(v.string()))),
    excludeClientIds: v.optional(v.array(v.string())),
    authKey: v.optional(v.union(v.null(), v.string())),
    enabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const auth = await requireAdminAuth(ctx);
    const endpoint = await ownEndpoint(ctx, auth, args.endpointId);
    const patch: Partial<Doc<"webhookEndpoints">> = { updatedAt: Date.now() };
    if (args.url !== undefined) {
      const url = args.url.trim();
      checkUrl(url);
      patch.url = url;
    }
    if (args.eventTypes !== undefined) {
      checkEventTypes(args.eventTypes ?? undefined);
      patch.eventTypes = args.eventTypes ?? undefined;
    }
    if (args.excludeClientIds !== undefined) {
      checkClientIds(args.excludeClientIds);
      patch.excludeClientIds = args.excludeClientIds;
    }
    if (args.authKey !== undefined) patch.authKey = args.authKey === null ? undefined : normalizeAuthKey(args.authKey);
    if (args.enabled !== undefined) patch.enabled = args.enabled;
    await ctx.db.patch(endpoint._id, patch);
    return null;
  },
});

/** A new secret; the old one stops signing at once. Returned only here. */
export const rotateSecret = action({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }): Promise<{ secret: string }> => {
    const secret = newSecret();
    await ctx.runMutation(internal.webhooks.setSecret, { endpointId, secret });
    return { secret };
  },
});

export const setSecret = internalMutation({
  args: { endpointId: v.id("webhookEndpoints"), secret: v.string() },
  handler: async (ctx, { endpointId, secret }) => {
    const auth = await requireAdminAuth(ctx);
    await ownEndpoint(ctx, auth, endpointId);
    await ctx.db.patch(endpointId, { secret, secretHint: secret.slice(-4), updatedAt: Date.now() });
    return null;
  },
});

/** Deletes the endpoint; its queued deliveries close as failed, its log ages out. */
export const remove = mutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    const auth = await requireAdminAuth(ctx);
    await ownEndpoint(ctx, auth, endpointId);
    await ctx.db.delete(endpointId);
    return null;
  },
});

/** Sends a signed `{ event: "test" }` now and logs it like any delivery (no retries). */
export const sendTest = action({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }): Promise<AttemptResult> => {
    const deliveryId: Id<"webhookDeliveries"> = await ctx.runMutation(internal.webhooks.queueTest, { endpointId });
    return (await attemptDelivery(ctx, deliveryId)) ?? { status: "failed" };
  },
});

export const queueTest = internalMutation({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    const auth = await requireAdminAuth(ctx);
    const endpoint = await ownEndpoint(ctx, auth, endpointId);
    return await ctx.db.insert("webhookDeliveries", {
      orgId: endpoint.orgId,
      endpointId,
      attempt: 1,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

/** The endpoint's last 20 delivery attempts, newest first, with the event's task ref. */
export const recentDeliveries = query({
  args: { endpointId: v.id("webhookEndpoints") },
  handler: async (ctx, { endpointId }) => {
    const auth = await requireAdminAuth(ctx);
    await ownEndpoint(ctx, auth, endpointId);
    const rows = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_endpointId_createdAt", (q) => q.eq("endpointId", endpointId))
      .order("desc")
      .take(RECENT_DELIVERIES);
    const deliveries = [];
    for (const row of rows) {
      const found = row.activityId ? await ctx.db.get(row.activityId) : null;
      const activity = found && found.orgId === auth.orgId ? found : null;
      const task = activity ? await ctx.db.get(activity.taskId) : null;
      deliveries.push({
        _id: row._id,
        createdAt: row.createdAt,
        event: row.activityId ? (activity?.type ?? "unknown") : "test",
        // A deleted task (e.g. `task_deleted`): the ref its event recorded.
        task: task && task.orgId === auth.orgId ? task.identifier : activity ? recordedIdentifier(activity) : null,
        attempt: row.attempt,
        status: row.status,
        httpStatus: row.httpStatus ?? null,
        error: row.error ?? null,
        nextAttemptAt: row.nextAttemptAt ?? null,
      });
    }
    return deliveries;
  },
});

/** The org's OAuth clients (Connected apps), once each, for the W5 picker. */
export const connectedClients = query({
  args: {},
  handler: async (ctx) => {
    const auth = await requireAdminAuth(ctx);
    const rows = await ctx.db
      .query("mcpConnections")
      .withIndex("by_orgId_userId_clientId", (q) => q.eq("orgId", auth.orgId))
      .take(CONNECTIONS_READ_MAX);
    const latest = new Map<string, Doc<"mcpConnections">>();
    for (const row of rows) {
      const seen = latest.get(row.clientId);
      if (!seen || row.lastUsedAt > seen.lastUsedAt) latest.set(row.clientId, row);
    }
    return [...latest.values()]
      .map((row) => ({ clientId: row.clientId, clientName: row.clientName }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.clientId.localeCompare(b.clientId));
  },
});
