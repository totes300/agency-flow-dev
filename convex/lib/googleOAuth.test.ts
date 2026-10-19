// @vitest-environment edge-runtime
//
// Email triage B1: the pure Google OAuth helpers (PKCE, state, authorize URL,
// returnTo validation, redirects, scopes, stored-credential shape) and the
// Gmail client's error mapping over a fake transport.

import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  buildAppRedirect,
  buildGoogleAuthorizeUrl,
  codeChallengeS256,
  DEFAULT_CONNECTORS_RETURN_TO,
  DEV_SITE_URL_FALLBACK,
  emailFromIdToken,
  generateCodeVerifier,
  generateOAuthState,
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
  googleRedirectUri,
  hasRequiredGmailScopes,
  needsRefresh,
  normalizeReturnTo,
  parseGmailCredentials,
  parseScopes,
  resolveSiteUrl,
} from "./googleOAuth";
import { classifyGmailHttpError, createGmailClient, GmailApiError } from "../email/gmailClient";

describe("PKCE + state", () => {
  it("matches the RFC 7636 appendix B S256 vector", async () => {
    expect(await codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("verifiers are 43 unreserved chars; states are unique", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const states = new Set(Array.from({ length: 50 }, () => generateOAuthState()));
    expect(states.size).toBe(50);
    for (const s of states) expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("base64url has no padding or +/", () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 254]))).toBe("-__-");
    expect(base64UrlEncode(new Uint8Array([1]))).toBe("AQ");
  });
});

describe("authorize URL", () => {
  it("carries offline consent, granted scopes, S256 and the four scopes", () => {
    const url = new URL(
      buildGoogleAuthorizeUrl({
        clientId: "cid",
        redirectUri: googleRedirectUri("https://x.convex.site/"),
        state: "st",
        codeChallenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("redirect_uri")).toBe("https://x.convex.site/oauth/google/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("include_granted_scopes")).toBe("true");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe("ch");
    expect(p.get("state")).toBe("st");
    expect(p.get("scope")?.split(" ")).toEqual(["openid", "email", GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE]);
  });
});

describe("returnTo + redirects", () => {
  it("accepts relative app paths only", () => {
    expect(normalizeReturnTo("/agents?view=connectors")).toBe("/agents?view=connectors");
    expect(normalizeReturnTo("/agents?view=connectors#x")).toBe("/agents?view=connectors");
    for (const bad of [
      "https://evil.example/",
      "//evil.example/x",
      "/\\evil.example",
      "\\\\evil",
      "javascript:alert(1)",
      "agents",
      "",
      "/a\nb",
      "/..//evil.com",
      "/.//evil.com",
      "/%2e%2e//evil.com",
      "/a/../..//evil.com",
      `/${"a".repeat(600)}`,
    ]) {
      expect(normalizeReturnTo(bad), bad).toBeNull();
    }
  });

  it("builds the app redirect with the outcome, dropping stale gmail params", () => {
    expect(
      buildAppRedirect("http://localhost:3000", "/agents?view=connectors&gmail=error&reason=x&t=old", {
        kind: "pending",
        token: "tok",
      }),
    ).toBe("http://localhost:3000/agents?view=connectors&gmail=pending&t=tok");
    expect(buildAppRedirect("https://app.example", "/agents", { kind: "error", reason: "permission" })).toBe(
      "https://app.example/agents?gmail=error&reason=permission",
    );
    // A bad returnTo can never leave the app origin.
    for (const bad of ["//evil.example", "/..//evil.com", "/%2e%2e//evil.com"]) {
      const url = new URL(buildAppRedirect("https://app.example", bad, { kind: "error", reason: "failed" }));
      expect(url.origin, bad).toBe("https://app.example");
      expect(url.pathname + "?" + url.searchParams.get("view")).toBe("/agents?connectors");
    }
    expect(DEFAULT_CONNECTORS_RETURN_TO).toBe("/agents?view=connectors");
  });

  it("SITE_URL must be http(s); otherwise the dev fallback", () => {
    expect(resolveSiteUrl("https://app.example/some/path")).toEqual({ origin: "https://app.example", fromEnv: true });
    expect(resolveSiteUrl(undefined)).toEqual({ origin: DEV_SITE_URL_FALLBACK, fromEnv: false });
    expect(resolveSiteUrl("javascript:alert(1)")).toEqual({ origin: DEV_SITE_URL_FALLBACK, fromEnv: false });
    expect(resolveSiteUrl("not a url")).toEqual({ origin: DEV_SITE_URL_FALLBACK, fromEnv: false });
  });
});

describe("scopes + credentials", () => {
  it("requires both gmail scopes", () => {
    expect(hasRequiredGmailScopes(parseScopes(`openid ${GMAIL_READONLY_SCOPE}  ${GMAIL_SEND_SCOPE}`))).toBe(true);
    expect(hasRequiredGmailScopes(parseScopes(`openid ${GMAIL_READONLY_SCOPE}`))).toBe(false);
    expect(hasRequiredGmailScopes(parseScopes(undefined))).toBe(false);
  });

  it("refreshes within the 2-minute margin", () => {
    const creds = { accessToken: "a", refreshToken: "r", expiresAt: 1_000_000, scope: "" };
    expect(needsRefresh(creds, 1_000_000 - 3 * 60_000)).toBe(false);
    expect(needsRefresh(creds, 1_000_000 - 2 * 60_000)).toBe(true);
    expect(needsRefresh(creds, 2_000_000)).toBe(true);
  });

  it("reads the email claim of an id_token", () => {
    const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(emailFromIdToken(`h.${b64url({ email: "Alice@Gmail.test" })}.sig`)).toBe("alice@gmail.test");
    expect(emailFromIdToken(`h.${b64url({ sub: "1" })}.sig`)).toBeUndefined();
    expect(emailFromIdToken("garbage")).toBeUndefined();
    expect(emailFromIdToken(undefined)).toBeUndefined();
  });

  it("parses only the full credential shape", () => {
    expect(parseGmailCredentials({ accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "s" })).toEqual({
      accessToken: "a", refreshToken: "r", expiresAt: 1, scope: "s",
    });
    expect(parseGmailCredentials({ token: "x" })).toBeNull();
    expect(parseGmailCredentials(null)).toBeNull();
  });
});

describe("gmail client", () => {
  it("maps HTTP failures to kinds (PRD §5.4)", () => {
    const body = (reason: string, message = "x") => ({ error: { message, errors: [{ reason }] } });
    expect(classifyGmailHttpError(401, null).kind).toBe("disconnected");
    expect(classifyGmailHttpError(403, body("insufficientPermissions")).kind).toBe("permission");
    expect(classifyGmailHttpError(403, body("rateLimitExceeded")).kind).toBe("quota");
    expect(classifyGmailHttpError(429, null).kind).toBe("quota");
    expect(classifyGmailHttpError(400, body("invalidArgument", "Invalid To header")).kind).toBe("recipient");
    expect(classifyGmailHttpError(400, body("invalidArgument", "Bad request")).kind).toBe("unknown");
    expect(classifyGmailHttpError(503, null).kind).toBe("transient");
    expect(classifyGmailHttpError(404, null).kind).toBe("unknown");
  });

  it("getProfile over a fake transport: bearer token, lowercased address", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const client = createGmailClient("tok", async (url, init) => {
      calls.push({ url, auth: new Headers(init.headers).get("Authorization") });
      return new Response(JSON.stringify({ emailAddress: "Adam@Konverted.io", historyId: "42" }), { status: 200 });
    });
    expect(await client.getProfile()).toMatchObject({ emailAddress: "adam@konverted.io", historyId: "42" });
    expect(calls).toEqual([{ url: "https://gmail.googleapis.com/gmail/v1/users/me/profile", auth: "Bearer tok" }]);
  });

  it("throws typed errors for HTTP and network failures", async () => {
    const http = createGmailClient("tok", async () => new Response("{}", { status: 401 }));
    await expect(http.getProfile()).rejects.toMatchObject({ name: "GmailApiError", kind: "disconnected", status: 401 });
    const net = createGmailClient("tok", async () => {
      throw new TypeError("fetch failed");
    });
    const err = await net.getProfile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailApiError);
    expect(err).toMatchObject({ kind: "transient", status: 0 });
  });
});
