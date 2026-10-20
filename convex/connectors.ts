/**
 * Connector framework (PRD Module 4 · slice 10) — the extensible chassis for
 * external accounts, per-user in V1. Wave 1 ships the framework plus one
 * dev/mock connector ("echo"); real providers (Gmail, Wave 3) are pure
 * addition.
 *
 * Public surface (per-user — everyone, not admin-gated: a connector
 * authenticates the RUNNING user's own account):
 *   - `list`        — the catalog joined to the caller's own connection state
 *                     (status / mask / timestamps). Never returns ciphertext.
 *   - `connect`     — token-auth connect: encrypt + upsert (status connected).
 *   - `disconnect`  — clear the credential + flip status to `revoked` (Gmail:
 *                     plus a best-effort revoke at Google).
 *   - Gmail (OAuth) connects through `oauth.startGmailConnect` + the
 *     `/oauth/google/callback` route (convex/oauth.ts), not `connect`.
 *
 * Internal (server-to-server, consumed by connector-backed tools during a
 * run — each takes the run's actor and re-derives membership from the DB, so
 * these resolve THAT user's connection and no one else's, US 38, and work in
 * background runs without `ctx.auth`):
 *   - `resolveForActor`        — classify + decrypt the actor's connection.
 *   - `touchConnectorForActor` — bump `lastUsedAt` after a successful resolve.
 *   - `markStatusForActor`     — persist a status flip (e.g. `error` when
 *                                decryption fails) so surface + tool agree.
 *
 * Security invariants (mirroring `convex/aiIntegration.ts`):
 *   1. Plaintext credentials never cross the client boundary — `list` returns
 *      only the mask; decryption happens server-side in `resolveForActor`, whose
 *      result flows to the run action's runtime, never to the browser or the
 *      model context.
 *   2. Credentials are AES-GCM-encrypted with the shared KEK
 *      (`convex/lib/secretCrypto.ts`); a rotated/missing KEK degrades to a
 *      clean `error` status, never a crash.
 */

import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  agentActorRefValidator,
  getAuthContext,
  loadAuthContextForActor,
  type AuthContext,
} from "./lib/auth";
import {
  buildKeyMask,
  decryptSecret,
  encryptSecret,
  SecretCryptoUnavailableError,
  SecretDecryptionFailedError,
} from "./lib/secretCrypto";
import {
  classifyConnection,
  getConnectorCatalog,
  getConnectorMeta,
  type ConnectionFailureReason,
  type ConnectorStatus,
} from "../lib/agents/connectors";
import { isEmailTriageEnabled } from "./email/gate";
import { syncErrorFix, type SyncErrorKind } from "./email/syncModel";
import { closeMailboxAttention } from "./email/mailboxItem";

const CONNECTOR_TOKEN_MIN_LEN = 8;
const CONNECTOR_TOKEN_MAX_LEN = 4096;

/** Load the caller's connection row for a type (the unique per-user record). */
export async function loadOwnConnection(
  ctx: QueryCtx | MutationCtx,
  auth: AuthContext,
  type: string,
): Promise<Doc<"connectors"> | null> {
  return await ctx.db
    .query("connectors")
    .withIndex("by_orgId_userId_type", (q) =>
      q.eq("orgId", auth.orgId).eq("userId", auth.userId).eq("type", type),
    )
    .unique();
}

/** The refusal while the email-triage demo mailbox occupies the (org, user, type) slot. */
export const DEV_SEED_CONNECTION_MESSAGE = "Remove the demo mailbox first (devSeedEmail:reset)";

/**
 * Every connect path for (org, user, type) must find NO dev-seed row
 * (`connectors.devSeed`, convex/devSeedEmail.ts) — a real connection must
 * never silently adopt the demo mailbox and its seeded threads. The Gmail
 * OAuth start and callback (convex/oauth.ts) call this too — the callback
 * before it upserts.
 */
export async function assertNoDevSeedConnection(
  ctx: QueryCtx | MutationCtx,
  auth: AuthContext,
  type: string,
): Promise<void> {
  const row = await loadOwnConnection(ctx, auth, type);
  if (row?.devSeed) throw new ConvexError(DEV_SEED_CONNECTION_MESSAGE);
}

// ─── Surface: list (catalog + own state) ────────────────────────────────────

export type ConnectorListItem = {
  type: string;
  displayName: string;
  description: string;
  authKind: "token" | "oauth";
  /** null when the caller has never connected this type. */
  status: ConnectorStatus | null;
  mask: string | null;
  connectedAt: number | null;
  lastUsedAt: number | null;
  scopes: string[];
  /** Polling sync state (Gmail) — null when the type doesn't sync or never did. */
  sync: {
    lastSyncAt: number | null;
    /** B3: the last run's failure; `fix` is what to do about it (§7.6). */
    error: { kind: SyncErrorKind | null; message: string; fix: string | null; at: number } | null;
    /** B3: a `Resync last 7 days` is in progress. */
    resyncing: boolean;
    /** B3 (H1/H2): emails the sync could not read or store (passed; open them in Gmail). */
    unprocessable: { count: number; lastAt: number } | null;
  } | null;
  /** The email-triage dev seed mailbox occupies the slot (connect is refused). */
  isDemo: boolean;
};

/**
 * The Connectors surface: every catalog type joined to the CALLER's own
 * connection state. Per-user by construction (auth context → this user only),
 * so it never leaks whether a teammate connected anything. Ciphertext is
 * never included — only the display mask. Gated types (Gmail) appear only
 * for orgs whose gate is open (I14).
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<ConnectorListItem[]> => {
    const auth = await getAuthContext(ctx);
    // TODO(email-triage): with the flag off, a leftover Gmail row is hidden here, so it can't be disconnected from the UI.
    const emailTriage = await isEmailTriageEnabled(ctx, auth.orgId);
    const rows = await ctx.db
      .query("connectors")
      .withIndex("by_orgId_userId", (q) =>
        q.eq("orgId", auth.orgId).eq("userId", auth.userId),
      )
      .collect();
    const byType = new Map(rows.map((r) => [r.type, r]));

    return getConnectorCatalog({ emailTriage }).map((meta) => {
      const row = byType.get(meta.type);
      return {
        type: meta.type,
        displayName: meta.displayName,
        description: meta.description,
        authKind: meta.authKind,
        status: row?.status ?? null,
        mask: row?.credentialMask ?? null,
        connectedAt: row?.connectedAt ?? null,
        lastUsedAt: row?.lastUsedAt ?? null,
        scopes: row?.scopes ?? [...meta.defaultScopes],
        sync: row?.sync
          ? {
              lastSyncAt: row.sync.lastSyncAt ?? null,
              error: row.sync.error
                ? {
                    kind: row.sync.error.kind ?? null,
                    message: row.sync.error.message,
                    fix: row.sync.error.kind ? syncErrorFix(row.sync.error.kind) : null,
                    at: row.sync.error.at,
                  }
                : null,
              resyncing: row.sync.resyncRequestedAt !== undefined,
              unprocessable: row.sync.unprocessable?.length
                ? {
                    count: row.sync.unprocessable.length,
                    lastAt: Math.max(...row.sync.unprocessable.map((u) => u.at)),
                  }
                : null,
            }
          : null,
        isDemo: row?.devSeed === true,
      };
    });
  },
});

// ─── Surface: connect (token auth) ──────────────────────────────────────────

/**
 * Connect a token-auth connector for the caller's own account: encrypt the
 * pasted token and upsert the connection (status `connected`). Reconnecting
 * an existing/revoked row overwrites it in place — the unique per-user key
 * guarantees at most one row per (org, user, type).
 *
 * OAuth-kind connectors (Gmail, Wave 3) will land their tokens through a
 * dedicated redirect-callback action, not this mutation — this path is only
 * for the "paste a secret" auth kind.
 */
export const connect = mutation({
  args: { type: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<{ mask: string }> => {
    const auth = await getAuthContext(ctx);
    const meta = getConnectorMeta(args.type);
    if (!meta) throw new ConvexError("Unknown connector type");
    await assertNoDevSeedConnection(ctx, auth, meta.type);
    if (meta.authKind !== "token") {
      throw new ConvexError(
        `${meta.displayName} connects through a sign-in flow, not a pasted token.`,
      );
    }

    const token = args.token.trim();
    if (token.length < CONNECTOR_TOKEN_MIN_LEN) {
      throw new ConvexError(
        `That token looks too short (min ${CONNECTOR_TOKEN_MIN_LEN} characters).`,
      );
    }
    if (token.length > CONNECTOR_TOKEN_MAX_LEN) {
      throw new ConvexError("That token is too long.");
    }

    let ciphertext: string;
    try {
      ciphertext = await encryptSecret(JSON.stringify({ token }));
    } catch (err) {
      if (err instanceof SecretCryptoUnavailableError) {
        throw new ConvexError(
          "Server-side encryption isn't configured. Ask your operator to set " +
            "AI_KEY_ENCRYPTION_KEK on the Convex deployment.",
        );
      }
      throw err;
    }
    const mask = buildKeyMask(token);
    const now = Date.now();

    const existing = await loadOwnConnection(ctx, auth, meta.type);
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "connected",
        credentialsCiphertext: ciphertext,
        credentialMask: mask,
        scopes: [...meta.defaultScopes],
        connectedAt: now,
        lastUsedAt: undefined,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("connectors", {
        orgId: auth.orgId,
        userId: auth.userId,
        type: meta.type,
        status: "connected",
        credentialsCiphertext: ciphertext,
        credentialMask: mask,
        scopes: [...meta.defaultScopes],
        connectedAt: now,
        updatedAt: now,
      });
    }
    return { mask };
  },
});

// ─── Surface: disconnect ────────────────────────────────────────────────────

/**
 * Disconnect the caller's own connection: wipe the ciphertext and flip status
 * to `revoked`. The row is kept (not deleted) so the surface shows the
 * disconnected state; a later `connect` upserts over it. Idempotent — a
 * missing/already-revoked connection is a no-op.
 *
 * Gmail: the wiped (still encrypted) grant is handed to a scheduled action
 * that revokes it at Google, best-effort — the row is clean the moment this
 * mutation commits, whether or not Google answers. The revoke is skipped
 * while another live gmail row in the org holds the same address (L2: one
 * Google grant per account, so revoking would cut that connection too). Not
 * gated on the email flag: removing your own credentials must always work.
 */
export const disconnect = mutation({
  args: { type: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const row = await loadOwnConnection(ctx, auth, args.type);
    if (!row || row.status === "revoked") return null;
    if (row.type === "gmail" && row.credentialsCiphertext && !row.devSeed) {
      await ctx.scheduler.runAfter(0, internal.email.gmailAuth.revokeGmailGrant, {
        credentialsCiphertext: row.credentialsCiphertext,
        orgId: row.orgId,
        emailAddress: row.credentialMask,
      });
    }
    await ctx.db.patch(row._id, {
      status: "revoked",
      credentialsCiphertext: undefined,
      credentialMask: undefined,
      updatedAt: Date.now(),
    });
    // B3 (L4): a disconnected mailbox has no "Mailbox not syncing" item.
    if (row.type === "gmail") await closeMailboxAttention(ctx, row);
    return null;
  },
});

// ─── Run-time resolution (internal — connector-backed tools) ────────────────

/**
 * What a connector-backed tool receives. `ok` carries the decrypted
 * credentials (server-side only — the tool uses them to do its work and
 * returns only safe output, never the secret). A failure carries the reason
 * the guidance message keys off, plus the connectorId when a row exists so
 * the tool can persist an `error` flip.
 */
export type ResolveConnectionResult =
  | {
      ok: true;
      connectorId: Id<"connectors">;
      credentials: Record<string, unknown>;
      mask: string | null;
      scopes: string[];
    }
  | {
      ok: false;
      reason: ConnectionFailureReason;
      connectorId: Id<"connectors"> | null;
    };

/**
 * Resolve the ACTING user's connection for a type (`resolveConnection` in
 * the PRD's contract). Only `connected` is usable; a corrupt/undecryptable
 * credential resolves to `error` (the tool persists the flip via
 * `markStatusForActor`). The connection is looked up by the actor's own
 * (orgId, userId) — user A's run can never pick up user B's connection.
 */
async function resolveConnectionForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  type: string,
): Promise<ResolveConnectionResult> {
  const row = await loadOwnConnection(ctx, auth, type);

  const decision = classifyConnection(row?.status ?? null);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason, connectorId: row?._id ?? null };
  }
  // Status is `connected` — a row with ciphertext must exist. Defensive:
  // a connected row lacking ciphertext is treated as an error, not a crash.
  if (!row!.credentialsCiphertext) {
    return { ok: false, reason: "error", connectorId: row!._id };
  }
  let credentials: Record<string, unknown>;
  try {
    const plaintext = await decryptSecret(row!.credentialsCiphertext);
    const parsed: unknown = JSON.parse(plaintext);
    credentials =
      typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : {};
  } catch (err) {
    if (
      err instanceof SecretDecryptionFailedError ||
      err instanceof SecretCryptoUnavailableError ||
      err instanceof SyntaxError
    ) {
      console.warn(
        `[connectors] Credential decrypt failed for org ${auth.orgId} type ${type}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { ok: false, reason: "error", connectorId: row!._id };
    }
    throw err;
  }
  return {
    ok: true,
    connectorId: row!._id,
    credentials,
    mask: row!.credentialMask ?? null,
    scopes: row!.scopes,
  };
}

/**
 * Actor-path resolver (agent runs, interactive AND background — docs/
 * prd-email-triage-implementation-plan.md §3 P1). The actor comes from the
 * run (never a client argument); membership is re-checked on every call via
 * `loadAuthContextForActor`, so a member removed mid-run fails closed.
 */
export const resolveForActor = internalQuery({
  args: { actor: agentActorRefValidator, type: v.string() },
  handler: async (ctx, args): Promise<ResolveConnectionResult> => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    return await resolveConnectionForAuth(ctx, auth, args.type);
  },
});

/** Owner + org guard for the internal status-writing helpers. */
async function requireOwnConnectorRow(
  ctx: MutationCtx,
  auth: AuthContext,
  connectorId: Id<"connectors">,
): Promise<Doc<"connectors"> | null> {
  const row = await ctx.db.get(connectorId);
  if (!row || row.orgId !== auth.orgId || row.userId !== auth.userId) return null;
  return row;
}

/** Bump `lastUsedAt` after a successful resolve (best-effort; no-op if gone). */
export const touchConnectorForActor = internalMutation({
  args: { actor: agentActorRefValidator, connectorId: v.id("connectors") },
  handler: async (ctx, args) => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    const row = await requireOwnConnectorRow(ctx, auth, args.connectorId);
    if (!row) return null;
    await ctx.db.patch(row._id, { lastUsedAt: Date.now() });
    return null;
  },
});

/**
 * Persist a status flip from run-time resolution — today only the `error`
 * flip when a stored credential can't be decrypted, so the failure becomes
 * visible on the surface instead of silently retrying every run. Never
 * touches `connected` (that only happens through `connect`).
 */
export const markStatusForActor = internalMutation({
  args: {
    actor: agentActorRefValidator,
    connectorId: v.id("connectors"),
    status: v.union(v.literal("expired"), v.literal("error"), v.literal("revoked")),
  },
  handler: async (ctx, args) => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    const row = await requireOwnConnectorRow(ctx, auth, args.connectorId);
    if (!row || row.status === args.status) return null;
    await ctx.db.patch(row._id, { status: args.status, updatedAt: Date.now() });
    return null;
  },
});
