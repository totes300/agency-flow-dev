# MCP server deployment runbook

How to take the Agency Flow MCP server (`docs/prd-mcp.md`) to production. It
adds to `docs/runbooks/deployment.md`; follow that runbook's preflight and
deployment sequence as well.

> **Rule: every production command — Convex (`--prod`, `npx convex deploy`), Vercel
> (env vars, deploys, rollbacks) and Clerk (production instance settings) — runs
> only after the owner's explicit yes** (`docs/prd-mcp.md` §17). Show the exact
> command or change first.

**Production status (2026-10-25):** done. `MCP_RESOURCE_URL = https://flow.konverted.io/mcp`
is set on Convex production and on Vercel (Production + Preview); the Clerk production
instance has the MCP resource registered (CIMD and the `aud` claim on, DCR off; Clerk's
discovery check: every MUST passed); PR #17 merged as `7eee5bd` and the Vercel build
deployed Convex production (45 `mcp/*` functions, the four cleanup crons, `/mcp-upload`).
Verified: discovery document, 401 challenge, Clerk check. Not done: the attachment
extraction backfill (owner: production holds dummy data only), the Convex **Preview**
default environment variable (dashboard only; until it is set, Vercel preview builds fail
at `convex/auth.config.ts`), and the end-to-end OAuth connect from a real client.

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

It must be the **canonical production domain**, the one `/connected-apps` shows. The
project's `*.vercel.app` URL also serves `/mcp`, but every call there fails with 401:
Clerk issues tokens for the registered resource only, so the audience never matches.
Never give that URL to users.

| Variable | Where | Notes |
|---|---|---|
| `MCP_RESOURCE_URL` | Vercel (Production) | Read at request time by `/mcp` and the discovery routes. A build without it succeeds; MCP requests then fail. Vercel env changes apply only to new deployments, so set it before the merge (section 3). |
| `MCP_RESOURCE_URL` | Vercel (Preview), optional | Without it `/mcp` and the discovery routes answer 500 on previews and `/connected-apps` says the server is not configured. Any https URL works; MCP cannot be used on a preview either way (no tokens for that audience). |
| `MCP_RESOURCE_URL` | Convex production (`npx convex env set --prod MCP_RESOURCE_URL https://<prod-domain>/mcp`) | **`convex/auth.config.ts` throws without it, so a production Convex deploy fails until it is set.** Set it before the first deploy of this branch. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex production | Already required by the app. The MCP provider derives its issuer and JWKS (`<issuer>/.well-known/jwks.json`) from it, so it must be the production Clerk issuer (`https://clerk.<domain>`). |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Vercel | Already required. The secret key also resolves OAuth client names for "via <client>" and Connected apps. |
| `CONVEX_SITE_URL` | Convex (built in) | Set by Convex itself; `create_upload` builds the upload URL from it. Nothing to configure. |
| `MCP_RESOURCE_URL` | Convex **default environment variables for Preview** (Convex dashboard → project settings) | Vercel Preview builds create Convex preview deployments, and `convex/auth.config.ts` throws there too without it. Any https URL works (e.g. the production MCP URL); MCP itself is not offered on previews, because Clerk issues tokens only for the registered resource. |
| `MCP_DISABLED` | Convex production, normally unset | The global stop: `"true"` refuses every MCP call (see Rollback). |

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
| Dynamic client registration | off | off unless a client needs it — **the owner confirms at the production step** (PRD §5.1 calls DCR a fallback; CIMD covers Claude and Codex) |
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

The Vercel build deploys Convex itself (`vercel.json`: `npx convex deploy --cmd
'next build'`), so merging to `main` deploys both. Hence:

1. **Before the merge**, set `MCP_RESOURCE_URL` in three places: on Convex production,
   in the Convex default environment variables for Preview (section 1), and on
   Vercel Production (Vercel env changes apply only to deployments made after them).
   Without the Convex value the Convex deploy inside the Vercel build fails at
   `convex/auth.config.ts`; without the Vercel value the deploy succeeds but `/mcp`
   and the discovery routes answer 500 until the next deploy.
2. Merge; the Vercel production build deploys Convex. It adds the tables `taskExternalRefs`,
   `mcpIdempotency`, `mcpFileUploads`, `mcpBillingPreviews`, `attachmentContents`
   `mcpConnections` (Connected apps stamps and revokes) and `fileUploads` (the app
   UI's own upload announcements, `4dd2b0b`), and the cron jobs below.
   If the Vercel build fails **after** `npx convex deploy` ran, Convex is already on
   the new version. That is safe: the change is additive (new tables, optional
   fields, crons) and the old Next.js deployment keeps working against it. Fix
   forward and redeploy; do not roll Convex back.
3. Apply the Clerk production steps (section 2).
4. Run the attachment extraction backfill (section 5).
5. Verify (section 6).

## 4. Cron jobs

Defined in `convex/crons.ts`; they deploy with the functions. Each runs hourly:

| Job | What it removes |
|---|---|
| `mcp idempotency cleanup` | Idempotency keys older than 24 h (D23). |
| `mcp billing preview cleanup` | Billing previews older than 24 h (tokens commit within 10 minutes, §9). |
| `mcp upload cleanup` | Upload announcements after 25 h, and the blobs of uploads that were never attached (§10). |
| `app upload cleanup` | The same for the app UI's `fileUploads` rows (`convex/fileUploads.ts`). |

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
3. Connect Claude (claude.ai and Claude Desktop: Settings → Connectors → Add custom
   connector → the MCP URL) and Codex (`codex mcp add agency-flow --url
   https://<prod-domain>/mcp`, then `codex mcp login agency-flow`). Pick the
   organization on the consent screen.
4. Ask each for `fetch("me")` and `fetch("workspace")`: the right org and the role
   from Agency Flow, not from the token.
5. Create a throwaway task through MCP, check "via <client>" in its activity in the
   app, then delete it through MCP.
6. Open Connected apps (user menu → Connected apps, `/connected-apps`): the
   client appears with its connected and last-used times (last used moves at
   most once an hour). Revoke it: the client's next MCP call is refused with
   "Access for this app was revoked…". Allow it again: the next call works.
7. Upload: `create_upload` for a small text file, `curl -X POST --data-binary @file
   -H 'Content-Type: text/plain' '<upload URL>'` (the URL is on `<CONVEX_SITE_URL>/mcp-upload?u=…`),
   then `attach_file` with the uploadId; `fetch` the task with
   `include: ["attachment_text"]` shows the text. Delete the file afterwards.
8. Member vs admin: as a member, `report` `time_by_member` returns only their own
   time and an admin-only kind (e.g. `close_queue`) is refused; as an admin both work.
9. Observability. The route logs one line per tool call, `[mcp] tool <name> <ms>ms
   ok|error` (no arguments, no user content), and on an internal error a short
   `ref <8 hex>` next to the tool name; the user sees the same ref in the error
   text. Refused calls (a `ConvexError`, e.g. "not found", admin-only, revoked) are
   tool results: they show as `error` in the per-call line (the result was an error
   for the agent) but produce no `[mcp] tool error` line and no ref.
   - Vercel → the project's Runtime logs, filter `[mcp]`: per-tool errors, latency,
     and the error ref a user reports.
   - Convex → Logs, filter the function path `mcp/`: the Convex side of the same
     calls, including uncaught errors.
   - Convex → Functions: p95 duration per `mcp/*` function.
10. Vercel function max duration for `/mcp` is at least 60 s (the route exports
    `maxDuration = 60` and the handler is created with the same value; check the
    function's settings in the Vercel deployment). A lower plan limit cuts long
    report and billing calls off mid-request.

## Connected apps and revocation (owner decisions D-PAGE, D-REVOKE, 2026-10-25)

- `/connected-apps` is open to every member (not an admin route) and lists only
  the signed-in user's own connections in the active workspace, from the
  `mcpConnections` rows the `/mcp` route stamps (first use = "Connected", last
  use at most hourly). Clerk has no API that lists a user's OAuth grants.
- **Revoke is enforced in Agency Flow, not in Clerk.** Clerk can revoke a grant
  only with the refresh token or an opaque access token in hand
  (`POST /oauth_applications/{id}/revoke_token`), and JWT access tokens cannot be
  revoked at all. Revoke therefore sets `mcpConnections.revokedAt`, and
  `getMcpAuthContext` refuses every token of that org + user + client from the next
  call, including an access token issued before the revoke and every refreshed one
  (one indexed read per MCP call). It also fails closed without a row: the `/mcp`
  route registers the connection (`mcp/connections:touch`) before a client's first
  call. That is a precondition the route satisfies, not a boundary against the
  token holder: the Convex functions `convex/mcp/*` are public, so whoever holds a
  valid OAuth token can call them (including `touch`) directly, with exactly the
  access the token's user has in that org. The controls are the token itself,
  Convex re-checking org, membership, role and revoke on every call, and Revoke.
  The upload endpoint refuses a revoked connection or a
  removed member (403) and answers 503 while `MCP_DISABLED` is set. The client keeps its stored connection until
  the user disconnects it there (Claude: Settings → Connectors; Codex:
  `codex mcp logout agency-flow`); the page says so.
- "Allow again" clears `revokedAt`; the client's existing tokens work again.
- Removing a member from the organization cuts MCP access on the next call,
  because Convex re-checks `orgMembers` every time. That table is kept in sync by
  the Clerk webhook (`/clerk-users-webhook` on the Convex site), so the production
  Clerk webhook must deliver `organizationMembership.created/updated/deleted`
  events; check its delivery log after the release.

## Rollback

- **Global stop (preferred):** `npx convex env set --prod MCP_DISABLED true` (owner's
  yes). `getMcpAuthContext` then refuses every MCP call at once, including tokens
  already issued; the app is unaffected. `npx convex env remove --prod MCP_DISABLED`
  turns MCP back on. No deploy is needed.
- **Vercel Instant Rollback does not roll back Convex.** It only switches the
  Next.js deployment; Convex keeps the newer functions and schema.
- **Convex is forward-only once MCP writes exist.** MCP writes add optional `via`
  fields on `activityLog`, `comments` and `billingEvents` rows (and rows in the new
  tables, e.g. `mcpFileUploads.clientId`). Deploying
  an older Convex version whose schema lacks them fails schema validation. To roll
  Convex back, first strip those fields (a one-off internal mutation) or keep the
  schema fields and roll back only the functions. Tables the schema does not list
  are allowed by Convex (only listed tables are validated), so the new MCP tables
  do not block a functions-only rollback; the optional fields on existing tables
  do. The preferred path stays `MCP_DISABLED` plus fix forward.
- Unregistering the resource in Clerk stops new tokens; it does not stop issued ones
  (use `MCP_DISABLED`).
- Do not remove `MCP_RESOURCE_URL` from Convex while `convex/auth.config.ts`
  requires it: the next Convex deploy would fail.

## Tool and schema changes

- Changes to `tools/list` are **additive only**: add a tool, an optional parameter
  or an enum value; never rename or remove one, or make a parameter required, in a
  release that connected clients are still using.
- `MCP_SERVER_INFO.version` (`lib/mcp/handler.ts`) follows the `package.json`
  version. Bump it on every `tools/list` change, so clients and logs can tell the
  versions apart.
- `lib/mcp/__tests__/tools-list.test.ts` holds the `tools/list` snapshot and is the
  gate: an unintended change fails it; an intended one updates the snapshot in the
  same commit.
- Clients cache `tools/list` per session. Claude.ai, Claude Desktop and Claude Code
  pick a change up at their next session; Codex on its next turn. The handler is
  stateless (no SSE), so it cannot push `notifications/tools/list_changed`; there
  is nothing to do but wait for the clients to reconnect.

## Follow-ups

- **Rate limiting.** The app has none for MCP. Before public exposure, add Vercel
  Firewall rate rules for `/mcp` and `/.well-known/*`, and limit the Convex upload
  endpoints (`POST /mcp-upload` and the app UI's `POST /upload`, both on the Convex
  site URL) the same way. Convex's own
  budgets bound each call's reads, not the number of calls.
- **Clerk `createRouteMatcher` deprecation** (`@clerk/nextjs` 7.9). Clerk recommends
  replacing middleware path matching with auth checks in each page, route handler
  and server function
  (clerk.com/docs/guides/development/upgrading/upgrade-guides/migrate-from-create-route-matcher).
  That touches every route, so it is not part of the MCP release. `proxy.ts` keeps
  the matcher; `lib/__tests__/proxy.test.ts` locks its behaviour (public routes,
  `auth.protect()`, admin redirect) for the migration. Convex enforces
  authorization regardless.
- **Clerk-side revocation.** If Clerk adds an API that lists or revokes a user's
  grants per client, Revoke could also delete the grant there; until then it is
  enforced in Agency Flow only (section above).
