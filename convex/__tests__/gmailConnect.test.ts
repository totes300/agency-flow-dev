// @vitest-environment edge-runtime
//
// Email triage B1 (docs/prd-email-triage.md §4.1 oauthStates, §4.2 connectors,
// §5.5, D17, D23, I14): start (action) → callback → pending grant → finish in
// the app (M1), refresh, disconnect + guarded revoke, the feature gate, and
// per-user isolation. Google is a mocked `fetch`; the KEK is a fixed test key.
// Fake timers throughout so scheduled revokes are drained inside each test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { __resetSecretCryptoCacheForTests, decryptSecret, encryptSecret } from "../lib/secretCrypto";
import {
  codeChallengeS256,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  hashOneTimeToken,
  type GmailCredentials,
} from "../lib/googleOAuth";
import { EMAIL_TRIAGE_DISABLED_MESSAGE } from "../email/gate";
import { DEV_SEED_CONNECTION_MESSAGE } from "../connectors";
import {
  PENDING_EXPIRED_MESSAGE,
  PENDING_INVALID_MESSAGE,
  PENDING_WRONG_ACCOUNT_MESSAGE,
  RETURN_TO_INVALID_MESSAGE,
  type FinishGmailConnectResult,
} from "../oauth";
import { GmailAuthError, getGmailAccessToken } from "../email/gmailAuth";
import * as oauthModule from "../oauth";
import * as gmailAuthModule from "../email/gmailAuth";

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");

const ORG = "org_gmail";
const OFF = "org_gmail_off";
const KEK = (() => {
  let s = "";
  for (let i = 0; i < 32; i++) s += String.fromCharCode(i * 7);
  return btoa(s);
})();
const ENV_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "CONVEX_SITE_URL", "SITE_URL", "AI_KEY_ENCRYPTION_KEK"] as const;

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;
type Who = { subject: string; orgId: string; orgRole: string };

const ALICE: Who = { subject: "clerk_alice", orgId: ORG, orgRole: "org:admin" };
const BOB: Who = { subject: "clerk_bob", orgId: ORG, orgRole: "org:member" };
const CAROL: Who = { subject: "clerk_carol", orgId: OFF, orgRole: "org:admin" };
const BOTH_SCOPES = `openid email ${GMAIL_READONLY_SCOPE} ${GMAIL_SEND_SCOPE}`;

type Fixture = { alice: Id<"users">; bob: Id<"users">; carol: Id<"users"> };

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mk = async (externalId: string, name: string, orgId: string, role: "admin" | "member") => {
      const id = await ctx.db.insert("users", { name, email: `${name}@agency.test`, externalId, createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId, clerkUserId: externalId, userId: id, role, joinedAt: now });
      return id;
    };
    const alice = await mk("clerk_alice", "Alice", ORG, "admin");
    const bob = await mk("clerk_bob", "Bob", ORG, "member");
    const carol = await mk("clerk_carol", "Carol", OFF, "admin");
    for (const [orgId, enabled] of [[ORG, true], [OFF, false]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "HUF", timezone: "Europe/Budapest", roundingMinutes: 15,
        emailTriageEnabled: enabled, createdAt: now, updatedAt: now, createdBy: alice,
      });
    }
    return { alice, bob, carol };
  });
}

// ─── Google mock ────────────────────────────────────────────────────────────

type MockGoogle = {
  fetch: ReturnType<typeof vi.fn>;
  /** Next authorization_code response's scope + mailbox. */
  grant: { scope: string; email: string; refreshToken?: string };
  /** Next refresh_token response: a new access token, or an OAuth error. */
  refresh: { error?: string; status?: number };
  tokenCalls: URLSearchParams[];
  revoked: string[];
};

const idToken = (email: string) =>
  `h.${btoa(JSON.stringify({ email })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.sig`;

function mockGoogle(): MockGoogle {
  let issued = 0;
  const m: MockGoogle = {
    grant: { scope: BOTH_SCOPES, email: "Alice@Gmail.test", refreshToken: "refresh-1" },
    refresh: {},
    tokenCalls: [],
    revoked: [],
    fetch: vi.fn(),
  };
  m.fetch.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === GOOGLE_TOKEN_URL) {
      const body = new URLSearchParams(String(init?.body ?? ""));
      m.tokenCalls.push(body);
      if (body.get("grant_type") === "authorization_code") {
        issued += 1;
        return Response.json({
          access_token: `access-code-${issued}`,
          expires_in: 3599,
          refresh_token: m.grant.refreshToken,
          scope: m.grant.scope,
          id_token: idToken(m.grant.email),
          token_type: "Bearer",
        });
      }
      if (m.refresh.error) {
        return Response.json({ error: m.refresh.error }, { status: m.refresh.status ?? 400 });
      }
      issued += 1;
      return Response.json({ access_token: `access-refreshed-${issued}`, expires_in: 3599, scope: BOTH_SCOPES });
    }
    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
      return Response.json({ emailAddress: m.grant.email, historyId: "777" });
    }
    if (url === GOOGLE_REVOKE_URL) {
      m.revoked.push(new URLSearchParams(String(init?.body ?? "")).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    return new Response("not mocked", { status: 599 });
  });
  vi.stubGlobal("fetch", m.fetch);
  return m;
}

// ─── Flow helpers ───────────────────────────────────────────────────────────

async function start(t: T, who: Who, returnTo?: string) {
  const { url } = await t.withIdentity(who).action(api.oauth.startGmailConnect, returnTo === undefined ? {} : { returnTo });
  return { url: new URL(url), state: new URL(url).searchParams.get("state")! };
}

async function callback(t: T, query: string) {
  const res = await t.fetch(`/oauth/google/callback?${query}`, { method: "GET" });
  const location = new URL(res.headers.get("Location")!);
  const p = location.searchParams;
  return { status: res.status, location, gmail: p.get("gmail"), reason: p.get("reason"), token: p.get("t") };
}

/** start → Google → callback; returns the pending token. */
async function authorize(t: T, starter: Who): Promise<string> {
  const { state } = await start(t, starter);
  const res = await callback(t, `state=${state}&code=auth-code`);
  expect(res.gmail).toBe("pending");
  return res.token!;
}

async function finish(t: T, who: Who, token: string): Promise<FinishGmailConnectResult> {
  return await t.withIdentity(who).mutation(api.oauth.finishGmailConnect, { t: token });
}

async function connect(t: T, who: Who): Promise<FinishGmailConnectResult> {
  return await finish(t, who, await authorize(t, who));
}

const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function gmailRows(t: T) {
  return await t.run(async (ctx) => (await ctx.db.query("connectors").collect()).filter((r) => r.type === "gmail"));
}

async function pendingRows(t: T) {
  return await t.run(async (ctx) => ctx.db.query("oauthPendingGrants").collect());
}

async function decryptRow(ciphertext: string | undefined): Promise<GmailCredentials> {
  return JSON.parse(await decryptSecret(ciphertext!)) as GmailCredentials;
}

async function insertGrant(
  t: T,
  userId: Id<"users">,
  creds: GmailCredentials,
  ciphertext?: string,
): Promise<Id<"connectors">> {
  const blob = ciphertext ?? (await encryptSecret(JSON.stringify(creds)));
  return await t.run(async (ctx) =>
    ctx.db.insert("connectors", {
      orgId: ORG, userId, type: "gmail", status: "connected", credentialsCiphertext: blob,
      credentialMask: "alice@gmail.test", scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE],
      connectedAt: 1000, sync: {}, updatedAt: 1000,
    }),
  );
}

/** Run the helper inside an inline action; return the token or the error kind. */
async function accessToken(t: T, connectorId: Id<"connectors">): Promise<{ token: string } | { kind: string }> {
  return await t.action(async (ctx) => {
    try {
      return { token: await getGmailAccessToken(ctx, connectorId) };
    } catch (err) {
      if (err instanceof GmailAuthError) return { kind: err.kind };
      throw err;
    }
  });
}

const fresh = (over: Partial<GmailCredentials> = {}): GmailCredentials => ({
  accessToken: "old", refreshToken: "r", expiresAt: Date.now() - 1, scope: BOTH_SCOPES, ...over,
});

// ─── Env ────────────────────────────────────────────────────────────────────

const savedEnv: Record<string, string | undefined> = {};
let google: MockGoogle;

beforeEach(() => {
  vi.useFakeTimers();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.CONVEX_SITE_URL = "https://unit-test-123.eu-west-1.convex.site";
  process.env.SITE_URL = "http://localhost:3000";
  process.env.AI_KEY_ENCRYPTION_KEK = KEK;
  __resetSecretCryptoCacheForTests();
  google = mockGoogle();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  __resetSecretCryptoCacheForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─── startGmailConnect ──────────────────────────────────────────────────────

describe("startGmailConnect (action)", () => {
  it("refuses when email triage is off for the org (I14)", async () => {
    const t = createT();
    await setup(t);
    await expect(t.withIdentity(CAROL).action(api.oauth.startGmailConnect, {})).rejects.toThrow(
      EMAIL_TRIAGE_DISABLED_MESSAGE,
    );
    expect(await t.run(async (ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
  });

  it("refuses unauthenticated callers", async () => {
    const t = createT();
    await setup(t);
    await expect(t.action(api.oauth.startGmailConnect, {})).rejects.toThrow("Not authenticated");
  });

  it("refuses a non-relative returnTo", async () => {
    const t = createT();
    await setup(t);
    for (const returnTo of ["https://evil.example/", "//evil.example", "agents", "/..//evil.com"]) {
      await expect(t.withIdentity(ALICE).action(api.oauth.startGmailConnect, { returnTo })).rejects.toThrow(
        RETURN_TO_INVALID_MESSAGE,
      );
    }
  });

  it("refuses while a dev seed mailbox holds the slot", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("connectors", {
        orgId: ORG, userId: f.alice, type: "gmail", status: "revoked", scopes: [], connectedAt: 1, devSeed: true, updatedAt: 1,
      });
    });
    await expect(t.withIdentity(ALICE).action(api.oauth.startGmailConnect, {})).rejects.toThrow(
      DEV_SEED_CONNECTION_MESSAGE,
    );
  });

  it("creates a 10-minute PKCE state row from auth and returns the Google URL", async () => {
    const t = createT();
    const f = await setup(t);
    const { url, state } = await start(t, ALICE, "/agents?view=connectors");
    const rows = await t.run(async (ctx) => ctx.db.query("oauthStates").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toMatchObject({ orgId: ORG, userId: f.alice, connectorType: "gmail", state, returnTo: "/agents?view=connectors" });
    expect(row.expiresAt - row.createdAt).toBe(10 * 60_000);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("code_challenge")).toBe(await codeChallengeS256(row.codeVerifier));
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://unit-test-123.eu-west-1.convex.site/oauth/google/callback",
    );
    expect(url.toString()).not.toContain("test-client-secret");
  });
});

// ─── Callback ───────────────────────────────────────────────────────────────

describe("GET /oauth/google/callback", () => {
  it("parks the encrypted grant as pending, consumes the state, never touches connectors", async () => {
    const t = createT();
    const f = await setup(t);
    const { state } = await start(t, ALICE, "/agents?view=connectors");
    const res = await callback(t, `state=${state}&code=auth-code`);

    expect(res.status).toBe(302);
    expect(res.location.origin).toBe("http://localhost:3000");
    expect(res.location.pathname).toBe("/agents");
    expect(res.location.searchParams.get("view")).toBe("connectors");
    expect(res.gmail).toBe("pending");
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const exchange = google.tokenCalls[0];
    expect(exchange.get("grant_type")).toBe("authorization_code");
    expect(exchange.get("client_secret")).toBe("test-client-secret");
    expect(exchange.get("code")).toBe("auth-code");
    expect(exchange.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(await gmailRows(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
    const pending = await pendingRows(t);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ orgId: ORG, userId: f.alice, emailAddress: "alice@gmail.test" });
    expect(pending[0].tokenHash).toBe(await hashOneTimeToken(res.token!));
    expect(pending[0].tokenHash).not.toBe(res.token);
    expect(pending[0].expiresAt - pending[0].createdAt).toBe(10 * 60_000);
    expect(pending[0].credentialsCiphertext).not.toContain("refresh-1");
    expect(google.revoked).toEqual([]);
  });

  it("a replayed state is refused", async () => {
    const t = createT();
    await setup(t);
    const { state } = await start(t, ALICE);
    expect((await callback(t, `state=${state}&code=auth-code`)).gmail).toBe("pending");
    const replay = await callback(t, `state=${state}&code=auth-code-2`);
    expect(replay).toMatchObject({ gmail: "error", reason: "invalid_state" });
    expect(google.tokenCalls).toHaveLength(1);
    expect(await pendingRows(t)).toHaveLength(1);
  });

  it("an unknown or missing state is refused", async () => {
    const t = createT();
    await setup(t);
    expect(await callback(t, "state=nope&code=x")).toMatchObject({ gmail: "error", reason: "invalid_state" });
    expect(await callback(t, "code=x")).toMatchObject({ gmail: "error", reason: "invalid_state" });
    expect(google.tokenCalls).toHaveLength(0);
  });

  it("an expired state is refused and spent", async () => {
    const t = createT();
    await setup(t);
    const { state } = await start(t, ALICE);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("oauthStates").collect())[0];
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    expect(await callback(t, `state=${state}&code=auth-code`)).toMatchObject({ gmail: "error", reason: "expired" });
    expect(google.tokenCalls).toHaveLength(0);
    expect(await pendingRows(t)).toHaveLength(0);
    expect(await t.run(async (ctx) => ctx.db.query("oauthStates").collect())).toHaveLength(0);
  });

  it("a grant without gmail.send: permission error, nothing stored, grant revoked (L4)", async () => {
    const t = createT();
    await setup(t);
    google.grant.scope = `openid email ${GMAIL_READONLY_SCOPE}`;
    const { state } = await start(t, ALICE);
    expect(await callback(t, `state=${state}&code=auth-code`)).toMatchObject({ gmail: "error", reason: "permission" });
    expect(await gmailRows(t)).toHaveLength(0);
    expect(await pendingRows(t)).toHaveLength(0);
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("a grant without a refresh token is refused and its access token revoked (L4)", async () => {
    const t = createT();
    await setup(t);
    google.grant.refreshToken = undefined;
    const { state } = await start(t, ALICE);
    expect(await callback(t, `state=${state}&code=auth-code`)).toMatchObject({ gmail: "error", reason: "failed" });
    expect(await pendingRows(t)).toHaveLength(0);
    expect(google.revoked).toEqual(["access-code-1"]);
  });

  it("a cancelled consent screen is reported as denied", async () => {
    const t = createT();
    await setup(t);
    const { state } = await start(t, ALICE);
    expect(await callback(t, `state=${state}&error=access_denied`)).toMatchObject({ gmail: "error", reason: "denied" });
    expect(google.tokenCalls).toHaveLength(0);
  });

  it("a dev seed row present at callback time is refused, never adopted, grant revoked", async () => {
    const t = createT();
    const f = await setup(t);
    const { state } = await start(t, ALICE);
    await t.run(async (ctx) => {
      await ctx.db.insert("connectors", {
        orgId: ORG, userId: f.alice, type: "gmail", status: "revoked", credentialMask: "Seed mailbox",
        scopes: [], connectedAt: 1, devSeed: true, updatedAt: 1,
      });
    });
    expect(await callback(t, `state=${state}&code=auth-code`)).toMatchObject({ gmail: "error", reason: "demo_mailbox" });
    const rows = await gmailRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ devSeed: true, status: "revoked", credentialMask: "Seed mailbox" });
    expect(rows[0].credentialsCiphertext).toBeUndefined();
    expect(await pendingRows(t)).toHaveLength(0);
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("a user removed from the org mid-flow is refused and the grant revoked", async () => {
    const t = createT();
    await setup(t);
    const { state } = await start(t, BOB);
    await t.run(async (ctx) => {
      const m = (await ctx.db.query("orgMembers").collect()).find((r) => r.clerkUserId === "clerk_bob")!;
      await ctx.db.delete(m._id);
    });
    expect(await callback(t, `state=${state}&code=auth-code`)).toMatchObject({ gmail: "error", reason: "not_member" });
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("the org flag is re-checked at callback time (I14)", async () => {
    const t = createT();
    await setup(t);
    const { state } = await start(t, ALICE);
    await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: false });
    expect(await callback(t, `state=${state}&code=auth-code`)).toMatchObject({ gmail: "error", reason: "disabled" });
    expect(google.tokenCalls).toHaveLength(0);
    expect(await pendingRows(t)).toHaveLength(0);
  });
});

// ─── finishGmailConnect (M1) ────────────────────────────────────────────────

describe("finishGmailConnect", () => {
  it("the user who started the flow finishes it: connected, pending spent", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await connect(t, ALICE);
    expect(result).toEqual({ ok: true, emailAddress: "alice@gmail.test" });
    expect(await pendingRows(t)).toHaveLength(0);

    const rows = await gmailRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: ORG, userId: f.alice, status: "connected", credentialMask: "alice@gmail.test", sync: {},
    });
    expect(rows[0].scopes).toEqual(expect.arrayContaining([GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE]));
    const creds = await decryptRow(rows[0].credentialsCiphertext);
    expect(creds).toMatchObject({ accessToken: "access-code-1", refreshToken: "refresh-1" });
    expect(creds.expiresAt).toBeGreaterThan(Date.now());

    const list = await t.withIdentity(ALICE).query(api.connectors.list, {});
    expect(list.find((c) => c.type === "gmail")).toMatchObject({
      status: "connected", mask: "alice@gmail.test", sync: { lastSyncAt: null, error: null },
    });
    expect(JSON.stringify(list)).not.toContain("v1:");
    await drain(t);
    expect(google.revoked).toEqual([]);
  });

  it("login-CSRF: a victim completing the attacker's link never connects the attacker", async () => {
    const t = createT();
    await setup(t);
    // Bob (attacker) starts the flow and sends the Google link to Alice, who
    // consents with HER mailbox; the callback lands in Alice's browser.
    const token = await authorize(t, BOB);
    const victim = await finish(t, ALICE, token);
    expect(victim).toEqual({ ok: false, reason: "wrong_account", message: PENDING_WRONG_ACCOUNT_MESSAGE });
    expect(await gmailRows(t)).toHaveLength(0);
    expect(await pendingRows(t)).toHaveLength(0);
    // Even holding the token, the attacker can no longer activate it.
    expect(await finish(t, BOB, token)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await gmailRows(t)).toHaveLength(0);
    await drain(t);
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("a wrong-account refusal never revokes the victim's own live connection", async () => {
    const t = createT();
    await setup(t);
    expect((await connect(t, ALICE)).ok).toBe(true);
    google.grant.refreshToken = "refresh-2";
    const token = await authorize(t, BOB); // Alice consents again with her mailbox
    expect(await finish(t, ALICE, token)).toMatchObject({ ok: false, reason: "wrong_account" });
    await drain(t);
    expect(google.revoked).toEqual([]);
    expect((await gmailRows(t))[0].status).toBe("connected");
  });

  it("the same user in another org is refused", async () => {
    const t = createT();
    await setup(t);
    const token = await authorize(t, ALICE);
    const otherOrg = { ...ALICE, orgId: OFF };
    expect(await finish(t, otherOrg, token)).toMatchObject({ ok: false, reason: "wrong_account" });
    expect(await gmailRows(t)).toHaveLength(0);
    await drain(t);
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("reuse is refused", async () => {
    const t = createT();
    await setup(t);
    const token = await authorize(t, ALICE);
    expect((await finish(t, ALICE, token)).ok).toBe(true);
    expect(await finish(t, ALICE, token)).toEqual({ ok: false, reason: "invalid", message: PENDING_INVALID_MESSAGE });
    expect(await finish(t, ALICE, "made-up")).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("an expired pending grant is refused and revoked", async () => {
    const t = createT();
    await setup(t);
    const token = await authorize(t, ALICE);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("oauthPendingGrants").collect())[0];
      await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    expect(await finish(t, ALICE, token)).toEqual({ ok: false, reason: "expired", message: PENDING_EXPIRED_MESSAGE });
    expect(await gmailRows(t)).toHaveLength(0);
    await drain(t);
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("the flag is re-checked at finish (I14)", async () => {
    const t = createT();
    await setup(t);
    const token = await authorize(t, ALICE);
    await t.mutation(internal.email.gate.setEmailTriageEnabled, { orgId: ORG, enabled: false });
    expect(await finish(t, ALICE, token)).toMatchObject({ ok: false, reason: "disabled" });
    expect(await gmailRows(t)).toHaveLength(0);
  });

  it("L2: a mailbox a colleague already holds is refused, and their grant is not revoked", async () => {
    const t = createT();
    await setup(t);
    expect((await connect(t, ALICE)).ok).toBe(true);
    google.grant.refreshToken = "refresh-bob";
    const result = await connect(t, BOB); // same alice@gmail.test mailbox
    expect(result).toEqual({ ok: false, reason: "duplicate", message: "This mailbox is already connected by Alice." });
    const rows = await gmailRows(t);
    expect(rows).toHaveLength(1);
    await drain(t);
    expect(google.revoked).toEqual([]);
  });

  it("a second connect of the same mailbox updates the same row and revokes nothing", async () => {
    const t = createT();
    await setup(t);
    await connect(t, ALICE);
    const first = (await gmailRows(t))[0];
    google.grant.refreshToken = "refresh-2";
    expect((await connect(t, ALICE)).ok).toBe(true);
    const rows = await gmailRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(first._id);
    expect((await decryptRow(rows[0].credentialsCiphertext)).refreshToken).toBe("refresh-2");
    await drain(t);
    // Same Google account = one grant: revoking the old token would kill the new one.
    expect(google.revoked).toEqual([]);
  });

  it("L4: reconnecting a different mailbox revokes the replaced grant", async () => {
    const t = createT();
    await setup(t);
    await connect(t, ALICE);
    google.grant = { scope: BOTH_SCOPES, email: "alice.other@gmail.test", refreshToken: "refresh-other" };
    expect(await connect(t, ALICE)).toEqual({ ok: true, emailAddress: "alice.other@gmail.test" });
    await drain(t);
    expect(google.revoked).toEqual(["refresh-1"]);
    expect((await gmailRows(t))[0].credentialMask).toBe("alice.other@gmail.test");
  });
});

// ─── Refresh ────────────────────────────────────────────────────────────────

describe("getGmailAccessToken", () => {
  it("returns the stored token without calling Google when it is not expiring", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh({ accessToken: "still-good", expiresAt: Date.now() + 30 * 60_000 }));
    expect(await accessToken(t, id)).toEqual({ token: "still-good" });
    expect(google.tokenCalls).toHaveLength(0);
  });

  it("refreshes a token expiring within 2 minutes and persists it (refresh token kept)", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh({ refreshToken: "keep-me", expiresAt: Date.now() + 60_000 }));
    const res = await accessToken(t, id);
    expect(res).toEqual({ token: expect.stringMatching(/^access-refreshed-/) });
    expect(google.tokenCalls[0].get("grant_type")).toBe("refresh_token");
    expect(google.tokenCalls[0].get("refresh_token")).toBe("keep-me");
    const creds = await decryptRow((await gmailRows(t))[0].credentialsCiphertext);
    expect(creds).toMatchObject({ accessToken: (res as { token: string }).token, refreshToken: "keep-me" });
    expect(creds.expiresAt).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it("invalid_grant marks the connector expired, keeps everything else, and throws disconnected", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh({ refreshToken: "dead" }));
    const before = (await gmailRows(t))[0];
    google.refresh = { error: "invalid_grant" };
    expect(await accessToken(t, id)).toEqual({ kind: "disconnected" });
    const row = (await gmailRows(t))[0];
    expect(row.status).toBe("expired");
    expect(row.credentialsCiphertext).toBe(before.credentialsCiphertext);
    expect(row.credentialMask).toBe(before.credentialMask);
    expect(await accessToken(t, id)).toEqual({ kind: "disconnected" });
  });

  it("a server error is transient and leaves the row connected", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh());
    google.refresh = { error: "backend_error", status: 503 };
    expect(await accessToken(t, id)).toEqual({ kind: "transient" });
    expect((await gmailRows(t))[0].status).toBe("connected");
  });

  it("L3: a missing KEK is transient and never marks the connector error", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh({ expiresAt: Date.now() + 30 * 60_000 }));
    delete process.env.AI_KEY_ENCRYPTION_KEK;
    __resetSecretCryptoCacheForTests();
    expect(await accessToken(t, id)).toEqual({ kind: "transient" });
    expect((await gmailRows(t))[0].status).toBe("connected");
  });

  it("L3: an undecryptable stored grant marks the connector error", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh(), "v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(await accessToken(t, id)).toEqual({ kind: "disconnected" });
    expect((await gmailRows(t))[0].status).toBe("error");
  });

  it("two concurrent refreshes both return valid tokens and leave a whole grant", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh({ refreshToken: "shared" }));
    const [a, b] = await Promise.all([accessToken(t, id), accessToken(t, id)]);
    const tokens = [a, b].map((r) => (r as { token: string }).token);
    expect(tokens.every((tok) => tok.startsWith("access-refreshed-"))).toBe(true);
    expect(new Set(tokens).size).toBe(2);
    const creds = await decryptRow((await gmailRows(t))[0].credentialsCiphertext);
    expect(tokens).toContain(creds.accessToken);
    expect(creds.refreshToken).toBe("shared");
  });

  it("a late refresh never resurrects a disconnected grant", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await insertGrant(t, f.alice, fresh());
    await t.withIdentity(ALICE).mutation(api.connectors.disconnect, { type: "gmail" });
    const late = await t.mutation(internal.email.gmailAuth.storeRefreshedGrant, {
      connectorId: id, connectedAt: 1000, credentialsCiphertext: "v1:late",
    });
    expect(late).toEqual({ stored: false });
    const row = (await gmailRows(t))[0];
    expect(row.status).toBe("revoked");
    expect(row.credentialsCiphertext).toBeUndefined();
    await drain(t);
    expect(google.revoked).toEqual(["r"]);
  });
});

// ─── Disconnect ─────────────────────────────────────────────────────────────

describe("disconnect", () => {
  it("wipes the ciphertext, flips to revoked and revokes the grant at Google", async () => {
    const t = createT();
    await setup(t);
    await connect(t, ALICE);
    await t.withIdentity(ALICE).mutation(api.connectors.disconnect, { type: "gmail" });
    const row = (await gmailRows(t))[0];
    expect(row.status).toBe("revoked");
    expect(row.credentialsCiphertext).toBeUndefined();
    expect(row.credentialMask).toBeUndefined();
    await drain(t);
    expect(google.revoked).toEqual(["refresh-1"]);
  });

  it("L2: skips the revoke while another live row holds the same address", async () => {
    const t = createT();
    const f = await setup(t);
    await insertGrant(t, f.alice, fresh({ refreshToken: "alice-r" }));
    await insertGrant(t, f.bob, fresh({ refreshToken: "bob-r" })); // legacy duplicate
    await t.withIdentity(BOB).mutation(api.connectors.disconnect, { type: "gmail" });
    await drain(t);
    expect(google.revoked).toEqual([]);
  });
});

// ─── Isolation ──────────────────────────────────────────────────────────────

describe("per-user + per-org isolation", () => {
  it("Gmail is listed only for orgs with email triage on", async () => {
    const t = createT();
    await setup(t);
    const on = await t.withIdentity(ALICE).query(api.connectors.list, {});
    expect(on.map((c) => c.type)).toEqual(["echo", "gmail"]);
    const off = await t.withIdentity(CAROL).query(api.connectors.list, {});
    expect(off.map((c) => c.type)).toEqual(["echo"]);
  });

  it("user B never sees, disconnects or refreshes user A's mailbox", async () => {
    const t = createT();
    await setup(t);
    await connect(t, ALICE);
    const aliceRow = (await gmailRows(t))[0];

    const bobList = await t.withIdentity(BOB).query(api.connectors.list, {});
    expect(bobList.find((c) => c.type === "gmail")).toMatchObject({ status: null, mask: null });
    expect(JSON.stringify(bobList)).not.toContain("alice@gmail.test");

    await t.withIdentity(BOB).mutation(api.connectors.disconnect, { type: "gmail" });
    expect((await gmailRows(t))[0]).toMatchObject({ status: "connected", credentialsCiphertext: aliceRow.credentialsCiphertext });

    // Bob's own mailbox writes Bob's row, never Alice's.
    google.grant = { scope: BOTH_SCOPES, email: "bob@gmail.test", refreshToken: "bob-refresh" };
    expect((await connect(t, BOB)).ok).toBe(true);
    const rows = await gmailRows(t);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r._id === aliceRow._id)!.credentialsCiphertext).toBe(aliceRow.credentialsCiphertext);
  });

  it("no public function reads or refreshes a token: only start + finish are public", () => {
    const registered = (mod: Record<string, unknown>) =>
      Object.entries(mod).filter(([, fn]) => typeof fn === "function" && ("isPublic" in fn || "isInternal" in fn)) as Array<
        [string, { isPublic?: boolean }]
      >;
    const publicNames = [...registered(oauthModule), ...registered(gmailAuthModule)]
      .filter(([, fn]) => fn.isPublic)
      .map(([name]) => name)
      .sort();
    expect(publicNames).toEqual(["finishGmailConnect", "startGmailConnect"]);
  });
});
