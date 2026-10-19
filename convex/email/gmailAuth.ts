/**
 * Gmail token access for the email jobs (docs/prd-email-triage.md B1, §4.2):
 * decrypt the stored grant, refresh it when it lapses within 2 minutes,
 * persist the refreshed grant, and flip the connector to `expired` when
 * Google says the grant is gone (`invalid_grant`).
 *
 * Server-only. `getGmailAccessToken` is a plain helper for actions (B3 sync,
 * B5 send) — there is no public function that returns or refreshes a token,
 * so no client (user A or B) can reach another user's grant. The internal
 * functions take a `connectorId` that only server code holds.
 *
 * Concurrency: two refreshes may run at once (sync + send). Both get a valid
 * access token from Google (it issues several; the refresh token stays the
 * same), and each persists its own grant — the last write wins, and both
 * writes are whole, valid credential blobs. A write is skipped when the row
 * is no longer the same live grant (disconnected, or reconnected meanwhile —
 * `connectedAt` is the grant's generation), so a late refresh never
 * resurrects a revoked connection or overwrites a newer one.
 */

import { v, ConvexError } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  decryptSecret,
  encryptSecret,
  SecretCryptoUnavailableError,
} from "../lib/secretCrypto";
import {
  needsRefresh,
  parseGmailCredentials,
  readGoogleClientConfig,
  refreshAccessToken,
  revokeGoogleToken,
  GoogleTokenError,
  type FetchLike,
  type GmailCredentials,
} from "../lib/googleOAuth";
import { EMAIL_TRIAGE_DISABLED_MESSAGE, isEmailTriageEnabled } from "./gate";

export type GmailAuthErrorKind = "disconnected" | "permission" | "transient";

/**
 * Why a token could not be produced. `disconnected` → the user must
 * reconnect (the row is `expired` / `error` / `revoked` or gone);
 * `permission` → the grant lacks a needed scope; `transient` → retry later.
 */
export class GmailAuthError extends Error {
  readonly kind: GmailAuthErrorKind;
  constructor(kind: GmailAuthErrorKind, message: string) {
    super(message);
    this.name = "GmailAuthError";
    this.kind = kind;
  }
}

// ─── Internal reads / writes ────────────────────────────────────────────────

type LoadResult =
  | { ok: true; ciphertext: string; connectedAt: number }
  | { ok: false; why: "missing" | "disabled" | "not_connected" };

/** The live grant of a gmail connector, or why there is none. */
export const loadGmailGrant = internalQuery({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, args): Promise<LoadResult> => {
    const row = await ctx.db.get(args.connectorId);
    if (!row || row.type !== "gmail") return { ok: false, why: "missing" };
    if (!(await isEmailTriageEnabled(ctx, row.orgId))) return { ok: false, why: "disabled" };
    if (row.devSeed || row.status !== "connected" || !row.credentialsCiphertext) {
      return { ok: false, why: "not_connected" };
    }
    return { ok: true, ciphertext: row.credentialsCiphertext, connectedAt: row.connectedAt };
  },
});

/** True when the row is still the live grant `connectedAt` names. */
function isSameLiveGrant(
  row: { status: string; connectedAt: number; credentialsCiphertext?: string; devSeed?: boolean } | null,
  connectedAt: number,
): boolean {
  return !!row && row.status === "connected" && row.connectedAt === connectedAt && !!row.credentialsCiphertext && !row.devSeed;
}

/** Persist a refreshed grant (skipped when the grant changed meanwhile). */
export const storeRefreshedGrant = internalMutation({
  args: { connectorId: v.id("connectors"), connectedAt: v.number(), credentialsCiphertext: v.string() },
  handler: async (ctx, args): Promise<{ stored: boolean }> => {
    const row = await ctx.db.get(args.connectorId);
    if (!isSameLiveGrant(row, args.connectedAt)) return { stored: false };
    await ctx.db.patch(args.connectorId, { credentialsCiphertext: args.credentialsCiphertext, updatedAt: Date.now() });
    return { stored: true };
  },
});

/**
 * Flip the live grant to `expired` (Google refused the refresh) or `error`
 * (the stored blob can't be decrypted). Clears nothing else: the mask, scopes
 * and sync state stay so the surface shows which mailbox needs a reconnect.
 */
export const markGmailGrantStatus = internalMutation({
  args: {
    connectorId: v.id("connectors"),
    connectedAt: v.number(),
    status: v.union(v.literal("expired"), v.literal("error")),
  },
  handler: async (ctx, args): Promise<null> => {
    const row = await ctx.db.get(args.connectorId);
    if (!isSameLiveGrant(row, args.connectedAt)) return null;
    await ctx.db.patch(args.connectorId, { status: args.status, updatedAt: Date.now() });
    return null;
  },
});

// ─── The helper ─────────────────────────────────────────────────────────────

/**
 * Decrypt a stored grant. `unreadable` = the blob itself is bad (decryption
 * or parse failure) — the connector needs a reconnect. A missing / invalid
 * KEK is a deployment problem, NOT the grant's: it is rethrown as
 * `SecretCryptoUnavailableError` and never marks the connector (L3).
 */
async function decryptGrant(ciphertext: string): Promise<GmailCredentials | "unreadable"> {
  try {
    return parseGmailCredentials(JSON.parse(await decryptSecret(ciphertext))) ?? "unreadable";
  } catch (err) {
    if (err instanceof SecretCryptoUnavailableError) throw err;
    return "unreadable";
  }
}

const CRYPTO_UNAVAILABLE = "Server-side encryption isn't configured on this deployment (AI_KEY_ENCRYPTION_KEK).";

/**
 * A usable Gmail access token for the connector — refreshed (and persisted)
 * when it lapses within 2 minutes. Throws `GmailAuthError`; a ConvexError
 * when the org has email triage off (I14).
 */
export async function getGmailAccessToken(
  ctx: ActionCtx,
  connectorId: Id<"connectors">,
  options: { fetch?: FetchLike; now?: () => number } = {},
): Promise<string> {
  const now = options.now ?? Date.now;
  const loaded: LoadResult = await ctx.runQuery(internal.email.gmailAuth.loadGmailGrant, { connectorId });
  if (!loaded.ok) {
    if (loaded.why === "disabled") throw new ConvexError(EMAIL_TRIAGE_DISABLED_MESSAGE);
    throw new GmailAuthError("disconnected", "Gmail is not connected for this mailbox.");
  }

  let credentials: GmailCredentials | "unreadable";
  try {
    credentials = await decryptGrant(loaded.ciphertext);
  } catch (err) {
    if (err instanceof SecretCryptoUnavailableError) throw new GmailAuthError("transient", CRYPTO_UNAVAILABLE);
    throw err;
  }
  if (credentials === "unreadable") {
    await ctx.runMutation(internal.email.gmailAuth.markGmailGrantStatus, {
      connectorId,
      connectedAt: loaded.connectedAt,
      status: "error",
    });
    throw new GmailAuthError("disconnected", "The stored Gmail credentials can't be read; reconnect Gmail.");
  }
  if (!needsRefresh(credentials, now())) return credentials.accessToken;

  const config = readGoogleClientConfig(process.env);
  if (!config) throw new GmailAuthError("transient", "Gmail sign-in isn't configured on this deployment.");

  let refreshed;
  try {
    refreshed = await refreshAccessToken(
      { refreshToken: credentials.refreshToken, clientId: config.clientId, clientSecret: config.clientSecret },
      options.fetch,
    );
  } catch (err) {
    if (!(err instanceof GoogleTokenError)) throw err;
    if (err.oauthError === "invalid_grant") {
      await ctx.runMutation(internal.email.gmailAuth.markGmailGrantStatus, {
        connectorId,
        connectedAt: loaded.connectedAt,
        status: "expired",
      });
      throw new GmailAuthError("disconnected", "Google revoked or expired the Gmail grant; reconnect Gmail.");
    }
    if (err.oauthError === "invalid_scope" || err.oauthError === "insufficient_scope") {
      throw new GmailAuthError("permission", "The Gmail grant is missing a required permission.");
    }
    console.warn(`[gmailAuth] token refresh failed: status ${err.status} ${err.oauthError ?? ""}`);
    throw new GmailAuthError("transient", "Couldn't refresh the Gmail token; try again shortly.");
  }

  const next: GmailCredentials = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
    expiresAt: now() + refreshed.expiresInSec * 1000,
    scope: refreshed.scope ?? credentials.scope,
  };
  let credentialsCiphertext: string;
  try {
    credentialsCiphertext = await encryptSecret(JSON.stringify(next));
  } catch (err) {
    if (err instanceof SecretCryptoUnavailableError) throw new GmailAuthError("transient", CRYPTO_UNAVAILABLE);
    throw err;
  }
  await ctx.runMutation(internal.email.gmailAuth.storeRefreshedGrant, {
    connectorId,
    connectedAt: loaded.connectedAt,
    credentialsCiphertext,
  });
  return next.accessToken;
}

// ─── Revoke (best-effort, guarded) ──────────────────────────────────────────

/**
 * True while a live (not revoked, not seed, holding credentials) gmail row in
 * the org is connected to `emailAddress`. Google's revoke ends the whole grant
 * for that account + our OAuth client, so revoking a token whose account is
 * live elsewhere would also cut that connection.
 */
export const isGmailAddressLive = internalQuery({
  args: { orgId: v.string(), emailAddress: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const rows = await ctx.db
      .query("connectors")
      .withIndex("by_orgId_type_credentialMask", (q) =>
        q.eq("orgId", args.orgId).eq("type", "gmail").eq("credentialMask", args.emailAddress),
      )
      .take(20);
    return rows.some((r) => !r.devSeed && r.status !== "revoked" && !!r.credentialsCiphertext);
  },
});

/**
 * Revoke a token at Google unless its mailbox is live in the org (see
 * `isGmailAddressLive`). `emailAddress: null` = account unknown → revoke.
 * Best-effort: never throws; logs the HTTP status only.
 */
export async function revokeGrantUnlessInUse(
  ctx: ActionCtx,
  args: { token: string; orgId: string; emailAddress: string | null },
): Promise<"revoked" | "skipped" | "failed"> {
  if (args.emailAddress) {
    const live: boolean = await ctx.runQuery(internal.email.gmailAuth.isGmailAddressLive, {
      orgId: args.orgId,
      emailAddress: args.emailAddress,
    });
    if (live) return "skipped";
  }
  const status = await revokeGoogleToken(args.token);
  if (status !== 200) {
    console.warn(`[gmailAuth] Google revoke returned status ${status}`);
    return "failed";
  }
  return "revoked";
}

/**
 * Best-effort revoke of an encrypted grant — scheduled by
 * `connectors.disconnect`, by a refused / expired pending grant and by a
 * reconnect that replaced a different mailbox (convex/oauth.ts). Skipped while
 * the same address is live in the org (L2). Revoking the refresh token ends
 * the whole grant.
 */
export const revokeGmailGrant = internalAction({
  args: { credentialsCiphertext: v.string(), orgId: v.string(), emailAddress: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    let credentials: GmailCredentials | "unreadable";
    try {
      credentials = await decryptGrant(args.credentialsCiphertext);
    } catch {
      console.warn("[gmailAuth] revoke skipped: encryption key unavailable");
      return null;
    }
    if (credentials === "unreadable") {
      console.warn("[gmailAuth] revoke skipped: stored credentials unreadable");
      return null;
    }
    await revokeGrantUnlessInUse(ctx, {
      token: credentials.refreshToken || credentials.accessToken,
      orgId: args.orgId,
      emailAddress: args.emailAddress ?? null,
    });
    return null;
  },
});
