/**
 * Connector OAuth — Gmail sign-in (docs/prd-email-triage.md B1, §4.1
 * `oauthStates`, §4.2 `connectors`, §5.5, D17, D23, I14).
 *
 *   1. `startGmailConnect` (public ACTION) — the signed-in user asks to
 *      connect their OWN mailbox. The action draws the `state` and PKCE
 *      verifier from `crypto.getRandomValues` in the action runtime, then
 *      `createOAuthState` (internal mutation; the caller's auth carries
 *      through) checks auth, the flag (I14), `returnTo` and the dev-seed slot
 *      and writes the one-time `oauthStates` row (10-minute expiry). Returns
 *      Google's authorize URL (S256 challenge, offline, consent).
 *   2. `GET /oauth/google/callback` (convex/http.ts → `handleGoogleCallback`)
 *      — consumes the state exactly once, re-checks the flag, exchanges the
 *      code (client secret + verifier), requires `gmail.readonly` +
 *      `gmail.send`, reads the mailbox address and parks the ENCRYPTED grant
 *      in `oauthPendingGrants` under a fresh one-time token. It never touches
 *      `connectors`: the callback has no session, so it cannot know whose
 *      browser it is running in. Redirects to
 *      `SITE_URL + returnTo?gmail=pending&t=<token>` (or `gmail=error`).
 *   3. `finishGmailConnect` (public mutation) — the app, signed in, hands the
 *      token back. Activated only when the session's user + org are the ones
 *      that started the flow (login-CSRF / consent phishing, M1), the flag is
 *      on, no dev seed holds the slot and no colleague already holds the same
 *      address (L2).
 *
 * Every refusal after a successful code exchange revokes the new grant at
 * Google best-effort (L4) — unless that Google account is live in the org,
 * since a revoke ends the account's whole grant (`revokeGrantUnlessInUse`).
 * Token refresh and revoke: convex/email/gmailAuth.ts.
 */

import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, loadAuthContextForActor, type AuthContext } from "./lib/auth";
import { encryptSecret, SecretCryptoUnavailableError } from "./lib/secretCrypto";
import {
  buildAppRedirect,
  buildGoogleAuthorizeUrl,
  codeChallengeS256,
  DEFAULT_CONNECTORS_RETURN_TO,
  exchangeAuthorizationCode,
  generateCodeVerifier,
  generateOAuthState,
  GoogleTokenError,
  googleRedirectUri,
  hashOneTimeToken,
  hasRequiredGmailScopes,
  normalizeReturnTo,
  OAUTH_STATE_TTL_MS,
  parseScopes,
  randomUrlSafeToken,
  readGoogleClientConfig,
  resolveSiteUrl,
  type CallbackOutcome,
  type GmailConnectErrorReason,
  type GmailCredentials,
  type GoogleTokenResponse,
} from "./lib/googleOAuth";
import { assertNoDevSeedConnection, DEV_SEED_CONNECTION_MESSAGE, loadOwnConnection } from "./connectors";
import { EMAIL_TRIAGE_DISABLED_MESSAGE, isEmailTriageEnabled, requireEmailTriageEnabled } from "./email/gate";
import { createGmailClient, GmailApiError } from "./email/gmailClient";
import { revokeGrantUnlessInUse } from "./email/gmailAuth";

const GMAIL = "gmail";
/** Abandoned rows swept per write — bounded. */
const SWEEP_LIMIT = 25;
/** A pending grant must be finished in the app within this window. */
export const PENDING_GRANT_TTL_MS = 10 * 60_000;

export const GMAIL_NOT_CONFIGURED_MESSAGE =
  "Gmail sign-in isn't configured on this deployment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).";
export const RETURN_TO_INVALID_MESSAGE = "returnTo must be a relative app path.";

// ─── 1. Start ───────────────────────────────────────────────────────────────

/**
 * Begin connecting the caller's own Gmail. Returns the Google authorize URL;
 * the client navigates there (`window.location.assign`).
 */
export const startGmailConnect = action({
  args: { returnTo: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const config = readGoogleClientConfig(process.env);
    const convexSiteUrl = process.env.CONVEX_SITE_URL;
    if (!config || !convexSiteUrl) throw new ConvexError(GMAIL_NOT_CONFIGURED_MESSAGE);

    // Drawn in the action runtime (Web Crypto CSPRNG), not in a mutation.
    const state = generateOAuthState();
    const codeVerifier = generateCodeVerifier();
    await ctx.runMutation(internal.oauth.createOAuthState, { state, codeVerifier, returnTo: args.returnTo });

    const url = buildGoogleAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: googleRedirectUri(convexSiteUrl),
      state,
      codeChallenge: await codeChallengeS256(codeVerifier),
    });
    return { url };
  },
});

/** The checks + insert behind `startGmailConnect` (auth = the action's caller). */
export const createOAuthState = internalMutation({
  args: { state: v.string(), codeVerifier: v.string(), returnTo: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const auth = await getAuthContext(ctx);
    await requireEmailTriageEnabled(ctx, auth.orgId);

    const returnTo =
      args.returnTo === undefined ? DEFAULT_CONNECTORS_RETURN_TO : normalizeReturnTo(args.returnTo);
    if (returnTo === null) throw new ConvexError(RETURN_TO_INVALID_MESSAGE);

    // Early, friendly refusal; the callback and the finish step re-check.
    await assertNoDevSeedConnection(ctx, auth, GMAIL);

    const now = Date.now();
    const stale = await ctx.db
      .query("oauthStates")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(SWEEP_LIMIT);
    for (const row of stale) await ctx.db.delete(row._id);

    await ctx.db.insert("oauthStates", {
      orgId: auth.orgId,
      userId: auth.userId,
      connectorType: GMAIL,
      state: args.state,
      codeVerifier: args.codeVerifier,
      returnTo,
      createdAt: now,
      expiresAt: now + OAUTH_STATE_TTL_MS,
    });
    return null;
  },
});

// ─── 2. Callback: consume the state (exactly once) ──────────────────────────

type ConsumeResult =
  | { ok: true; orgId: string; userId: Id<"users">; codeVerifier: string; returnTo: string }
  | { ok: false; reason: GmailConnectErrorReason; returnTo: string | null };

/**
 * Look up the state and delete it in the same transaction, so a replayed or
 * concurrent callback finds nothing. Expiry and the org's flag (I14) are
 * checked after the delete — a refused state is still spent.
 */
export const consumeOAuthState = internalMutation({
  args: { state: v.string(), connectorType: v.string() },
  handler: async (ctx, args): Promise<ConsumeResult> => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!row) return { ok: false, reason: "invalid_state", returnTo: null };
    await ctx.db.delete(row._id);

    const returnTo = row.returnTo ?? DEFAULT_CONNECTORS_RETURN_TO;
    if (row.connectorType !== args.connectorType) return { ok: false, reason: "invalid_state", returnTo };
    if (row.expiresAt <= Date.now()) return { ok: false, reason: "expired", returnTo };
    if (!(await isEmailTriageEnabled(ctx, row.orgId))) return { ok: false, reason: "disabled", returnTo };
    return { ok: true, orgId: row.orgId, userId: row.userId, codeVerifier: row.codeVerifier, returnTo };
  },
});

// ─── 2b. Callback: park the grant as pending ────────────────────────────────

/** Schedule the guarded best-effort revoke of an encrypted grant. */
async function scheduleRevoke(
  ctx: MutationCtx,
  grant: { credentialsCiphertext: string; orgId: string; emailAddress?: string },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.email.gmailAuth.revokeGmailGrant, {
    credentialsCiphertext: grant.credentialsCiphertext,
    orgId: grant.orgId,
    emailAddress: grant.emailAddress,
  });
}

/**
 * Store the encrypted grant under the token's hash for the finish step. The
 * user + org come from the consumed state row (never from the request).
 * Early re-checks (membership, flag, dev seed) refuse before anything is
 * parked; the caller then revokes. Also sweeps expired pending grants
 * (revoking each).
 */
export const storePendingGrant = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.id("users"),
    tokenHash: v.string(),
    emailAddress: v.string(),
    credentialsCiphertext: v.string(),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; reason: GmailConnectErrorReason }> => {
    let auth: AuthContext;
    try {
      auth = await loadAuthContextForActor(ctx, { orgId: args.orgId, userId: args.userId });
    } catch {
      return { ok: false, reason: "not_member" };
    }
    if (!(await isEmailTriageEnabled(ctx, auth.orgId))) return { ok: false, reason: "disabled" };
    if ((await loadOwnConnection(ctx, auth, GMAIL))?.devSeed) return { ok: false, reason: "demo_mailbox" };

    const now = Date.now();
    const stale = await ctx.db
      .query("oauthPendingGrants")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(SWEEP_LIMIT);
    for (const row of stale) {
      await ctx.db.delete(row._id);
      await scheduleRevoke(ctx, row);
    }

    await ctx.db.insert("oauthPendingGrants", {
      orgId: auth.orgId,
      userId: auth.userId,
      connectorType: GMAIL,
      tokenHash: args.tokenHash,
      credentialsCiphertext: args.credentialsCiphertext,
      emailAddress: args.emailAddress,
      scopes: args.scopes,
      createdAt: now,
      expiresAt: now + PENDING_GRANT_TTL_MS,
    });
    return { ok: true };
  },
});

// ─── 2c. Callback: the HTTP action body ─────────────────────────────────────

function redirectTo(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/**
 * `GET /oauth/google/callback` (registered in convex/http.ts). Never logs a
 * code, token or the client secret — only statuses and Google error codes.
 */
export async function handleGoogleCallback(ctx: ActionCtx, request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const site = resolveSiteUrl(process.env.SITE_URL);
  if (!site.fromEnv) {
    console.warn(`[oauth] SITE_URL is not set; redirecting to ${site.origin}`);
  }
  const finish = (returnTo: string | null, outcome: CallbackOutcome) =>
    redirectTo(buildAppRedirect(site.origin, returnTo ?? DEFAULT_CONNECTORS_RETURN_TO, outcome));
  const fail = (returnTo: string | null, reason: GmailConnectErrorReason) =>
    finish(returnTo, { kind: "error", reason });

  const state = params.get("state");
  if (!state) return fail(null, "invalid_state");

  const consumed: ConsumeResult = await ctx.runMutation(internal.oauth.consumeOAuthState, {
    state,
    connectorType: GMAIL,
  });
  if (!consumed.ok) return fail(consumed.returnTo, consumed.reason);
  const { returnTo, orgId } = consumed;

  // The user cancelled (or Google refused) on the consent screen.
  if (params.get("error")) return fail(returnTo, "denied");
  const code = params.get("code");
  if (!code) return fail(returnTo, "failed");

  const config = readGoogleClientConfig(process.env);
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  if (!config || !convexSiteUrl) return fail(returnTo, "config");

  let tokens: GoogleTokenResponse;
  try {
    tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: consumed.codeVerifier,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: googleRedirectUri(convexSiteUrl),
    });
  } catch (err) {
    if (err instanceof GoogleTokenError) {
      console.warn(`[oauth] Google code exchange failed: status ${err.status} ${err.oauthError ?? ""}`);
      return fail(returnTo, "failed");
    }
    throw err;
  }

  // From here on Google has issued a grant: every refusal revokes it (L4).
  let knownAddress: string | null = tokens.idTokenEmail ?? null;
  const refuse = async (reason: GmailConnectErrorReason) => {
    await revokeGrantUnlessInUse(ctx, {
      token: tokens.refreshToken ?? tokens.accessToken,
      orgId,
      emailAddress: knownAddress,
    });
    return fail(returnTo, reason);
  };

  const scopes = parseScopes(tokens.scope);
  if (!hasRequiredGmailScopes(scopes)) return await refuse("permission");
  if (!tokens.refreshToken) {
    // `access_type=offline` + `prompt=consent` always yields one; without it
    // the connection could not outlive the first hour.
    console.warn("[oauth] Google grant came back without a refresh token");
    return await refuse("failed");
  }

  let emailAddress: string;
  try {
    emailAddress = (await createGmailClient(tokens.accessToken).getProfile()).emailAddress;
  } catch (err) {
    if (err instanceof GmailApiError) {
      console.warn(`[oauth] Gmail profile read failed: ${err.kind} status ${err.status}`);
      return await refuse(err.kind === "permission" ? "permission" : "failed");
    }
    throw err;
  }
  knownAddress = emailAddress;

  const credentials: GmailCredentials = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresInSec * 1000,
    scope: scopes.join(" "),
  };
  let credentialsCiphertext: string;
  try {
    credentialsCiphertext = await encryptSecret(JSON.stringify(credentials));
  } catch (err) {
    if (err instanceof SecretCryptoUnavailableError) return await refuse("config");
    throw err;
  }

  // The one-time finish token, drawn in this action; only its hash is stored.
  const pendingToken = randomUrlSafeToken(32);
  const stored: { ok: true } | { ok: false; reason: GmailConnectErrorReason } = await ctx.runMutation(
    internal.oauth.storePendingGrant,
    {
      orgId,
      userId: consumed.userId,
      tokenHash: await hashOneTimeToken(pendingToken),
      emailAddress,
      credentialsCiphertext,
      scopes,
    },
  );
  if (!stored.ok) return await refuse(stored.reason);
  return finish(returnTo, { kind: "pending", token: pendingToken });
}

// ─── 3. Finish in the app (signed in) ───────────────────────────────────────

export type FinishGmailConnectResult =
  | { ok: true; emailAddress: string }
  | {
      ok: false;
      reason: "invalid" | "expired" | "wrong_account" | "disabled" | "demo_mailbox" | "duplicate";
      message: string;
    };

export const PENDING_INVALID_MESSAGE = "This Gmail sign-in link was already used or is invalid. Connect again.";
export const PENDING_EXPIRED_MESSAGE = "The Gmail sign-in took too long to finish. Connect again.";
export const PENDING_WRONG_ACCOUNT_MESSAGE =
  "This Gmail sign-in was started from a different account. Nothing was connected.";

/**
 * Activate a pending grant for the signed-in user (M1). The token is spent
 * on the first call whatever the outcome; every refusal revokes the grant
 * (guarded) and returns a message for the toast — it returns rather than
 * throws so the delete commits.
 */
export const finishGmailConnect = mutation({
  args: { t: v.string() },
  handler: async (ctx, args): Promise<FinishGmailConnectResult> => {
    const auth = await getAuthContext(ctx);
    const tokenHash = await hashOneTimeToken(args.t);
    const row = await ctx.db
      .query("oauthPendingGrants")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .first();
    if (!row || row.connectorType !== GMAIL) {
      return { ok: false, reason: "invalid", message: PENDING_INVALID_MESSAGE };
    }
    await ctx.db.delete(row._id);
    const refuse = async (reason: Exclude<FinishGmailConnectResult, { ok: true }>["reason"], message: string) => {
      await scheduleRevoke(ctx, row);
      return { ok: false as const, reason, message };
    };

    if (row.expiresAt <= Date.now()) return await refuse("expired", PENDING_EXPIRED_MESSAGE);
    if (row.userId !== auth.userId || row.orgId !== auth.orgId) {
      return await refuse("wrong_account", PENDING_WRONG_ACCOUNT_MESSAGE);
    }
    if (!(await isEmailTriageEnabled(ctx, auth.orgId))) return await refuse("disabled", EMAIL_TRIAGE_DISABLED_MESSAGE);

    const existing = await loadOwnConnection(ctx, auth, GMAIL);
    if (existing?.devSeed) return await refuse("demo_mailbox", DEV_SEED_CONNECTION_MESSAGE);

    // L2: one live connection per address per org.
    const sameAddress = await ctx.db
      .query("connectors")
      .withIndex("by_orgId_type_credentialMask", (q) =>
        q.eq("orgId", auth.orgId).eq("type", GMAIL).eq("credentialMask", row.emailAddress),
      )
      .take(20);
    const holder = sameAddress.find(
      (r) => r.userId !== auth.userId && !r.devSeed && r.status !== "revoked" && !!r.credentialsCiphertext,
    );
    if (holder) {
      const name = (await ctx.db.get(holder.userId))?.name ?? "a colleague";
      return await refuse("duplicate", `This mailbox is already connected by ${name}.`);
    }

    await activateGmailConnection(ctx, auth, existing, row);
    return { ok: true, emailAddress: row.emailAddress };
  },
});

/**
 * Upsert the (org, user, gmail) row with the pending grant.
 *
 * `sync`: a new mailbox starts at `{ cursor: undefined }` (D34 — B3 sets the
 * "start from now" cursor on its first run). Reconnecting the SAME address
 * after `expired` / `error` keeps the cursor so B3 fills the gap; after a
 * user disconnect (`revoked`) or with a different address it starts fresh.
 *
 * The replaced grant is revoked (L4) only when it was a DIFFERENT address:
 * the same Google account + our client is one grant at Google, so revoking
 * the old refresh token would also kill the one just stored.
 */
async function activateGmailConnection(
  ctx: MutationCtx,
  auth: AuthContext,
  existing: Doc<"connectors"> | null,
  grant: Doc<"oauthPendingGrants">,
): Promise<void> {
  const now = Date.now();
  // TODO(B3): the first sync sets `sync.cursor` to the profile's current
  // historyId ("start from now", D34) when it finds no cursor.
  if (existing) {
    const sameMailbox = existing.credentialMask === grant.emailAddress && existing.status !== "revoked";
    await ctx.db.patch(existing._id, {
      status: "connected",
      credentialsCiphertext: grant.credentialsCiphertext,
      credentialMask: grant.emailAddress,
      scopes: grant.scopes,
      connectedAt: now,
      lastUsedAt: undefined,
      sync: sameMailbox && existing.sync ? { ...existing.sync, error: undefined } : { cursor: undefined },
      updatedAt: now,
    });
    if (existing.credentialsCiphertext && existing.credentialMask !== grant.emailAddress) {
      await scheduleRevoke(ctx, {
        credentialsCiphertext: existing.credentialsCiphertext,
        orgId: existing.orgId,
        emailAddress: existing.credentialMask,
      });
    }
    return;
  }
  await ctx.db.insert("connectors", {
    orgId: auth.orgId,
    userId: auth.userId,
    type: GMAIL,
    status: "connected",
    credentialsCiphertext: grant.credentialsCiphertext,
    credentialMask: grant.emailAddress,
    scopes: grant.scopes,
    connectedAt: now,
    sync: { cursor: undefined },
    updatedAt: now,
  });
}
