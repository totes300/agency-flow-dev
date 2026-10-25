# MCP server deployment runbook

How to take the Agency Flow MCP server (`docs/prd-mcp.md`) to production. It
adds to `docs/runbooks/deployment.md`; follow that runbook's preflight and
deployment sequence as well.

**Nothing here has been done in production yet.** Every Clerk production change
below is an owner-approved step (`docs/prd-mcp.md` §17): show the exact change,
get a yes, then apply it.

## What the MCP server consists of

- `app/mcp/route.ts`: Streamable HTTP at `https://<prod-domain>/mcp`. It verifies
  the Clerk OAuth access token (exact audience = the resource URL) and calls Convex
  as the user with the same token.
- `app/.well-known/oauth-protected-resource/mcp/route.ts` and
  `app/.well-known/oauth-authorization-server/route.ts`: public discovery documents.
- `proxy.ts` keeps `/mcp` and both discovery paths public, so failures are a
  `401` with `WWW-Authenticate`, never a sign-in redirect.
- `convex/auth.config.ts`: a second auth provider (`customJwt`) that accepts the
  Clerk OAuth JWT with `aud` = `MCP_RESOURCE_URL`.
- `convex/mcp/*`: the public functions the route calls; `convex/http.ts` serves
  the upload endpoint `POST /mcp-upload` on the Convex site URL.

## 1. Environment variables

`MCP_RESOURCE_URL` is the exact URL users paste into Claude and Codex, for example
`https://app.example.com/mcp`. It must be byte-for-byte the same in all three places
(Vercel, Convex, Clerk's registered MCP resource): Clerk puts it in the token's
`aud`, Next.js checks it, Convex checks it, and the discovery document advertises it.

| Variable | Where | Notes |
|---|---|---|
| `MCP_RESOURCE_URL` | Vercel (Production) | Read at request time by `/mcp` and the discovery routes. A build without it succeeds; MCP requests then fail. |
| `MCP_RESOURCE_URL` | Convex production (`npx convex env set --prod MCP_RESOURCE_URL https://<prod-domain>/mcp`) | **`convex/auth.config.ts` throws without it, so a production Convex deploy fails until it is set.** Set it before the first deploy of this branch. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex production | Already required by the app. The MCP provider derives its issuer and JWKS (`<issuer>/.well-known/jwks.json`) from it, so it must be the production Clerk issuer (`https://clerk.<domain>`). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Vercel | Already required. The secret key also resolves OAuth client names for "via <client>" and Connected apps. |
| `CONVEX_SITE_URL` | Convex (built in) | Set by Convex itself; `create_upload` builds the upload URL from it. Nothing to configure. |

Check before deploying (names only; never print values into logs or tickets):

```bash
npx convex env list --prod | cut -d= -f1
```

## 2. Clerk production instance (owner-approved)

The production instance currently has **no MCP resource registered**, and two
settings MCP clients need are off: the `aud` claim and Client ID Metadata Document
(CIMD) support. (Read-only check, 2026-10-25.) The development instance shows the
target state:

| Setting | Development (today) | Production (needed) |
|---|---|---|
| Registered MCP resource | `https://localhost:3001/mcp` | `https://<prod-domain>/mcp` |
| JWT access tokens (`oauth_jwt_access_tokens`) | on | on (already on) |
| `aud` claim from the RFC 8707 resource (`aud_claim_enabled`) | on | **turn on** |
| Advertise CIMD (`client_id_metadata_documents_advertised`) | on | **turn on** |
| Dynamic client registration | off | off unless a client needs it (PRD §5.1 calls DCR a fallback; Claude and Codex both use CIMD) |
| Consent screen with organization picker | on | on (the user picks the org there; `user:org:read`) |

Steps, each after the owner's yes:

1. Register the MCP resource `https://<prod-domain>/mcp` on the production
   instance (Clerk Dashboard → OAuth applications → MCP, or the Clerk MCP
   `configure_mcp_server` tool) with CIMD and the `aud` claim enabled.
2. Keep JWT access tokens on. Convex verifies the token itself (PRD D14, S1); an
   opaque token would break every MCP call.
3. Leave the access-token lifetime at Clerk's default (1 day; Clerk does not offer
   a setting for it, S3). Refresh tokens do not expire (D26).
4. Run the read-only discovery check (Clerk MCP `check_mcp_server` with
   `force_recheck: true`) and expect no blockers.

## 3. Deploy order

1. Set `MCP_RESOURCE_URL` on Convex production (section 1).
2. Deploy Convex (`npx convex deploy`). It adds the tables `taskExternalRefs`,
   `mcpIdempotency`, `mcpFileUploads`, `mcpBillingPreviews`, `attachmentContents`
   and `mcpConnections`, and the cron jobs below.
3. Set `MCP_RESOURCE_URL` on Vercel Production and deploy the Next.js app.
4. Apply the Clerk production steps (section 2).
5. Run the attachment extraction backfill (section 5).
6. Verify (section 6).

## 4. Cron jobs

Defined in `convex/crons.ts`; they deploy with the functions. Each runs hourly:

| Job | What it removes |
|---|---|
| `mcp idempotency cleanup` | Idempotency keys older than 24 h (D23). |
| `mcp billing preview cleanup` | Billing previews older than 24 h (tokens commit within 10 minutes, §9). |
| `mcp upload cleanup` | Upload announcements after 25 h, and the blobs of uploads that were never attached (§10). |

After the deploy, confirm all three are listed in the Convex dashboard (Schedules →
Cron jobs) and that their first runs succeed.

## 5. Attachment extraction backfill

New task and comment files are read in the background (PDF, Word `.docx`, text) so
`fetch` with `include: ["attachment_text"]` can show their text. Files uploaded
before this release have no extraction yet. Run once after the Convex deploy:

```bash
npx convex run --prod attachmentContents:backfillExtractions '{}'
```

It pages through task attachments, then comment attachments, staggering the
extraction actions, and continues itself through the scheduler. It is idempotent:
files that already have a row are skipped, so a second run is harmless. Watch the
logs for `attachmentContents` errors; a failed file is recorded with a fixed reason
and shown honestly by `fetch`.

## 6. Verification

1. Discovery document:

   ```bash
   curl -s https://<prod-domain>/.well-known/oauth-protected-resource/mcp
   ```

   `resource` must be exactly `https://<prod-domain>/mcp`; `authorization_servers`
   the production Clerk issuer; `scopes_supported` `["user:org:read", "offline_access"]`.
2. Unauthenticated challenge:

   ```bash
   curl -si -X POST https://<prod-domain>/mcp -H 'content-type: application/json' -d '{}'
   ```

   Expect `401` and `WWW-Authenticate: Bearer … resource_metadata="https://<prod-domain>/.well-known/oauth-protected-resource/mcp"`.
3. Connect Claude (Settings → Connectors → Add custom connector → the MCP URL) and
   Codex (`codex mcp add agency-flow --url https://<prod-domain>/mcp`, then
   `codex mcp login agency-flow`). Pick the organization on the consent screen.
4. Ask each for `fetch("me")` and `fetch("workspace")`: the right org and the role
   from Agency Flow, not from the token.
5. Create a throwaway task through MCP, check "via <client>" in its activity in the
   app, then delete it through MCP.
6. Open Connected apps in the app: the client appears with its connected and
   last-used times (last used moves at most once an hour).
7. Check the Convex and Vercel logs for `[mcp]` errors.

## Rollback

- The MCP route, tables and crons are additive; the app does not depend on them.
  To switch MCP off quickly, unregister the resource in Clerk (no new tokens) or
  remove `MCP_RESOURCE_URL` from Vercel (the route fails closed). Issued access
  tokens stop working when Convex no longer accepts them, at the latest when they
  expire (1 day).
- Do not remove `MCP_RESOURCE_URL` from Convex while `convex/auth.config.ts`
  requires it: the next Convex deploy would fail.

## Follow-ups

- **Clerk `createRouteMatcher` deprecation** (`@clerk/nextjs` 7.9). Clerk recommends
  replacing middleware path matching with auth checks in each page, route handler
  and server function
  (clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher).
  That touches every route, so it is not part of the MCP release. `proxy.ts` keeps
  the matcher; `lib/__tests__/proxy.test.ts` locks its behaviour (public routes,
  `auth.protect()`, admin redirect) for the migration. Convex enforces
  authorization regardless.
- **Revocation limits.** Clerk can revoke a grant only with the refresh token or an
  opaque access token in hand (`POST /oauth_applications/{id}/revoke_token`), and
  JWT access tokens cannot be revoked at all. Removing a member from the org cuts
  MCP access on the next call, because Convex re-checks membership every time.
