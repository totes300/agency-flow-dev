# PRD: Agency Flow MCP — Drive the App From Claude and Codex

> **Status:** Draft, decisions locked through grilling on 2026-10-24 · Owner: Adam ·
> Revised the same day with feedback from the owner's working agent (Grok Bot), D21–D29.
>
> **Scope:** a remote MCP server that lets every Agency Flow user operate the app from an
> external agent (Claude: claude.ai, Desktop, Claude Code; OpenAI Codex), modelled on
> Notion's hosted MCP. It also covers removing the in-app agent platform and in-app
> email triage.
>
> **Supersedes:** `docs/agentic-platform/prd-v1.md`, `docs/agents-platform-v1-prd.md`,
> `docs/prd-email-triage.md`, `docs/prd-email-triage-implementation-plan.md`. Business
> rules from those documents survive only where this PRD repeats them. In particular,
> D1 ("the model never computes a number") survives.

---

## 1. Problem statement

The in-app agent work (the Agency Copilot chat, the `/agents` workspace and email triage)
produced a lot of code. The owner would still not use it day to day. About 56k lines
are involved: `convex/email` is 20.8k, agent backend 12.7k, agent UI 9.9k, `lib/agents`
10.4k and triage UI 2.9k. External agents such as Claude and Codex will always be
better chat surfaces than a home-grown one, and users already live in them.

What is missing is a way for those agents to **operate Agency Flow**: create and assign
tasks, comment, log time, pull reports and run the month close. The app stays the system
of record and the place where people review and get an overview (planner, board,
billing, month close). Agents take over the input work.

## 2. Goals and non-goals

**Goals**
1. Any Agency Flow user can connect Claude or Codex in one OAuth flow and do, through
   the agent, everything they can do in the app with their role.
2. A small, agent-oriented, token-efficient tool set: 17 tools as built (§6). Schemas and
   descriptions are generated from one registry, with nothing hand-copied.
3. Zero new authorization logic. Every MCP call runs the same `*ForAuth` cores and
   write paths as the UI, under the same tenancy invariants.
4. Delete the in-app agent platform and in-app email triage.

**Non-goals**
- Any in-app chat or agent UI.
- Email inside Agency Flow. Email triage happens in Claude or Codex with *their* Gmail
  connector plus this MCP.
- Sampling, resource subscriptions or prompts. Claude does not support the first two,
  and prompts are not needed for V1.
- Read-only or other scope tiers. There is one scope (D11).
- Changing the worksheet AI summaries or the BYOK AI key. Both stay as they are.
- Outbound webhooks. V2: they will be a signal next to the changes feed (D22), not a
  replacement for it. *Pulled forward 2026-10-25: D-WEBHOOK.*
- API keys / personal access tokens. OAuth refresh tokens do not expire (§5.1), so
  unattended agents keep working.
- New task fields for agents (next step, client summary, draft flag). D24, D25 and D27
  cover these needs with what already exists.

## 3. Locked decisions (owner, 2026-10-24)

| # | Decision |
|---|---|
| D1 | The model never computes or re-types a number. Every figure comes from a deterministic Convex function, and the tool returns it ready-formatted. *(Carried over from the agentic PRD.)* |
| D2 | **Audience:** every member of every org can connect, with exactly the permissions they have in the app. |
| D3 | **Writes are direct**, as in Notion. Tools write immediately. Clients ask the user to confirm based on tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`). There is no in-app proposal/approval layer. |
| D4 | **V1 scope:** tasks (including sub-tasks), comments, time entries and timer, reports, billing (period and retainer-cycle close, invoice generation, invoice status, reverts), clients, projects, planner, daily notes, attachment read and upload, and the user's inbox. |
| D5 | **Billing writes use preview → commit.** `billing_preview` returns the exact effect plus a commit token. `billing_commit` runs only with that token, and only if nothing in the preview's inputs has changed since (§9). |
| D6 | **Deletion:** the agent may delete whatever the user can delete in the app, through the same mutations. These tools carry `destructiveHint`. |
| D7 | **Tool shape:** reads are generic and resource-oriented (`search`, `fetch`). Writes are batched commands per aggregate. Reports go through one `report(kind)` tool. All schemas and descriptions are generated from one registry (§6). |
| D8 | **References follow the Notion pattern:** IDs or URLs, never fuzzy names. On top of that we accept our existing short keys: task `ARLO-21` (with aliases), project code `ARLO`, client `prefix` (`KONV`), member email (§7). |
| D9 | **Reference data** (statuses, categories, labels, members, project codes) comes from `fetch("workspace")`. The **inbox** comes from `fetch("inbox")`. Neither needs its own tool, and neither is put in tool descriptions. |
| D10 | **Output:** compact markdown with short references and app deep links. Lists default to a limit of 25 with a cursor. An `include` parameter controls depth. Reports are markdown tables with an app link. |
| D11 | **Auth:** Clerk is the OAuth authorization server. Org selection happens on the consent screen, so the token carries `org_id`. One connection is bound to one org. There is one scope. |
| D12 | **Role** is always read from `orgMembers` on every call, never from the token. Clerk OAuth tokens carry no org role. |
| D13 | **Hosting:** a Next.js route on Vercel using `mcp-handler` and `@clerk/mcp-tools`, which is Clerk's official path. The route only adapts the protocol. All logic lives in Convex. |
| D14 | **Convex validates the OAuth JWT itself**, as a second auth provider. The fallback, if spike S1 fails, is §5.4. |
| D15 | **Attribution:** activity rows written through MCP show the real user plus a quiet "via <OAuth client name>" marker, for example "via Claude", "via Codex" or "via Grok Bot". The row also stores the OAuth `clientId`, which the changes feed uses for `exclude_self` (D22). For CIMD clients (Claude, Codex) the name is the host of the client's metadata URL, e.g. "via claude.ai": the server never downloads URLs (§10). Clerk-registered clients show their application name (owner, 2026-10-25). |
| D16 | **Notifications:** MCP writes trigger exactly the notifications the same write triggers in the app. There is no MCP-specific branch. |
| D17 | **Connected apps:** shows each client, when it connected and when it was last used, with a Revoke button. **Owner, 2026-10-25:** it lives on a member-accessible `/connected-apps` page opened from the user menu, with the connect help on the same page. Revoke is enforced in Agency Flow: `getMcpAuthContext` refuses every token from a revoked client for that user and org, including one still valid, from the next call. "Allow again" restores access. Clerk cannot list or revoke a user's grants and cannot revoke JWTs (S3/S4). |
| D18 | **File upload follows the Notion pattern on Convex storage:** a tool returns an upload URL, the client POSTs the bytes, and a write tool attaches the result. Small text content can also be passed inline. The server never downloads a URL. *As built (§10, §17 slice 7):* `create_upload` returns an `uploadId` and a one-time URL on the Convex site; the server stores the blob bound to org + user + client, and `attach_file` takes the `uploadId`. The client never receives a `storageId`. |
| D19 | **Removal comes first, in its own PR (slice 0).** The in-app agent and email triage are deleted completely. PRs #14 and #15 (email-triage) are closed without merging. Worksheet AI and BYOK stay. |
| D20 | **Delivery:** one feature branch, built in slices (§14), with one PR to `main` at the end. Slice 0 is the exception and goes in its own PR. |
| D21 | **External source refs on tasks.** Examples: `gmail:<threadId>`, `granola:<noteId>`, `slack:<ts>`. A task can carry many. A ref belongs to at most one task in the org. A `save_tasks` item with no `ref` but a known `externalRefs` entry updates that task instead of creating a new one, so duplicates are impossible by construction. Adding a ref that another task already owns is an error that names the owner, for example `gmail:abc is already on ARLO-21`. It is never moved silently. `search` filters by `external_ref`. **An external ref is a first-class task reference everywhere a task ref is accepted** (`ref`, `parent`, `after`/`before`, comment target, `delete`, `fetch`, the `task` search filter). `save_tasks` items run in order in one transaction, so a later item can reference a card an earlier item created, e.g. a card plus its checklist in one call. Checklist items carry their own refs (`gmail:<thread>#1`) to stay rerun-safe. The sources `client` and `project` are reserved ref qualifiers. A task holds at most 100 refs. A ref on an archived task is refused with a hint to restore it (owner, 2026-10-25). |
| D22 | **Changes feed:** `fetch("changes", { cursor, types[], exclude_self })`, read from `activityLog` (`by_org` index). Each change is one line, for example `ARLO-21 · Csaba · checklist "szűrők" ✓`. The opaque cursor means nothing is processed twice. `exclude_self` drops rows written by the calling user through the calling OAuth client (same user AND same client: a CIMD `client_id` is shared by every user of that client, owner 2026-10-25). `search` also accepts `updated_since`. Webhooks were V2; pulled forward as D-WEBHOOK (2026-10-25), a signal next to this feed. |
| D23 | **Idempotency:** every write tool accepts an optional `idempotencyKey`. A repeated call with the same key (same user and org, kept 24 h) returns the first result. The check runs in the same transaction as the write. The key is bound to the request: the same key with a different request is an error, never a silent replay (owner, 2026-10-25). |
| D24 | **Checklist = sub-tasks.** `save_tasks` creates and ticks items in one call (`done: true` means the project's first completed status) and orders them with `after` / `before` refs (fractional `sortKey`). `fetch` lists them under the parent. The "next step" is the first open sub-task and its assignee. `search` filters on it with `next_assignee`. |
| D25 | **Client summaries are written by the agent from raw material.** For each task, `report(kind="client_monthly")` returns the title, status, deep link, minutes, time-entry notes and the closing comment. The server makes no LLM call and stores no new field. A `missing_time` report kind lists tasks that have no time entries, in the statuses given by its `statuses` param (default: the org's completed-category statuses; no name matching of "Review" or "Done" — owner, 2026-10-25, §17 slice 5). |
| D26 | **Unattended access is OAuth only.** Clerk refresh tokens do not expire, so a client that refreshes keeps working without the user present. API keys were considered and rejected for V1. |
| D27 | **No draft flag.** An agent that wants a card not yet visible to colleagues creates it unassigned in a Backlog status, so no notification fires until someone assigns it. D3 stands. |
| D28 | **Tasks without a client (leads):** `project` is optional in `save_tasks`. The data model already allows it (`tasks.projectId` is optional): such a task gets the org-level identifier key, and its client is empty because the client always follows the project. Time entries require a project, so a lead that needs logged time goes under an ordinary "Leads" client with a non-billable "Leads" project. That is a data convention, not code. When the lead converts, moving the task to the real project keeps the old identifier as an alias. There is no automatic Inbox project. |
| D29 | **Comment text in the changes feed:** `comment_added` rows in `fetch("changes")` include the comment's plain text, capped at 500 characters with "…" and the comment ref when longer. Follow-up checks can then read what colleagues wrote without fetching every card. Turn it off with `include_text: false`. |

### Decisions after D29 (owner, 2026-10-25)

Taken during the build and tagged in code; §17 records the slice each came from.

| Tag | Decision | Where in code |
|---|---|---|
| D-B | `fetch("workspace")` never returns a partial result: a reference table over its read cap refuses the whole fetch with a model-actionable error, the same rule as reports (§7). | `convex/mcp/fetch.ts` |
| D-REVOKE | Revoke is enforced in Agency Flow, not in Clerk: Revoke sets `mcpConnections.revokedAt` and `getMcpAuthContext` refuses every token of that org + user + client from the next call, still-valid access tokens included; "Allow again" clears it (D17). | `convex/lib/mcpAuth.ts`, `convex/lib/mcpConnections.ts`, `convex/schema.ts` |
| D-PAGE | Connected apps is a member-accessible `/connected-apps` page opened from the user menu, listing only the signed-in user's own connections in the active workspace, with the connect help on the same page (D17). | `app/(dashboard)/connected-apps/page.tsx`, `components/connected-apps/*`, `convex/connectedApps.ts` |
| D-TOKENDIET | The advertised `tools/list` schemas are compacted for token cost (draft-7 JSON Schema without `$schema`, `minLength: 1`, the date pattern or `idempotentHint: false`); `tools/call` still validates every argument with the full zod schema. | `lib/mcp/advertise.ts`, `lib/mcp/__tests__/tools-list.test.ts` |
| D-DELETEGUARD | A project is deleted only when nothing hangs off it (no time entries, running timer, tasks, invoices or billing closes); a client only when every one of its projects could be. Anything else is archived instead. The same guard runs in the app's Delete and in MCP `delete`. | `convex/lib/projectDelete.ts`, `convex/projects.ts`, `convex/clients.ts`, `convex/lib/mcpDelete.ts` |
| D-COMMENTATTACH | Files are added to a comment while writing it, so only the comment's author may attach to it, in the app and through MCP. | `convex/commentAttachments.ts`, `convex/lib/mcpFiles.ts` |
| D-MISSING | `missing_time` takes a `statuses` param; the default is every completed-category status, and names are matched exactly, never guessed (D25). | `convex/lib/mcpReports.ts` |
| D-INVITE | 2026-10-25: admins invite members through MCP via Clerk organization invitations (`invite_members`); membership still arrives through the webhook. Convex authorizes and returns the verified org and inviter; the route performs the Clerk call and never takes an org from the client (§4, I3/I4). | `convex/mcp/members.ts`, `convex/lib/mcpMembers.ts`, `lib/mcp/clerk-invitations.ts`, `app/mcp/route.ts` |
| D-TOGGLE | Task descriptions and comments have a Notion-style toggle block (TipTap Details) in the editor; agents write and read it as `<details><summary>Title</summary>…</details>` in markdown, round-trip stable (owner, 2026-10-25). | `components/tasks/tiptap-editor.tsx`, `lib/mcp/markdown-tiptap.ts`, `lib/mcp/tiptap-markdown.ts` |
| D-WEBHOOK | (2026-10-25, pulled forward from V2; `docs/prd-agent-first-backlog.md` §5, W1–W8) Outbound webhooks, managed by admins in the app (no MCP tool): one HTTPS endpoint per org (W1); every `activityLog` row is an event, with an optional type filter (W2); the payload carries the event, time, actor, `via`, the task ref, link, project and client refs and the change's short scalar fields, never bodies, comment text or notes (W3); signed `X-AgencyFlow-Signature: t=<s>,v1=<HMAC-SHA256 hex of "<t>.<body>">` with a per-endpoint secret shown once and rotatable (W4); writes by excluded OAuth clients are not delivered (W5); at-least-once, 10 s timeout, retries after 30 s / 5 min / 30 min, a 7-day delivery log (W6); https host names only, no IP literal, localhost, `.internal` or the app itself (W7); delivery is scheduled from `logActivity`, never awaited (W8). The payload `id` is the event (activity row) id, the same on every retry so receivers dedupe on it; `X-AgencyFlow-Delivery` is the attempt's row id. A "Send test event" row has no `activityId`. | `convex/webhooks.ts`, `convex/activityLog.ts`, `convex/schema.ts`, `convex/crons.ts` |
| D-BILLINGTYPE | (2026-10-25) A project's billing type and its terms may change while the project has **no billing history** — no billing close of any status and no invoice (`projectHasBillingHistory`); the change applies the New Project form's validation to the new terms and clears the previous type's. One predicate, enforced in `projects.update` for the app and for MCP `save_projects` alike; once billing started the type is frozen as before. `save_projects` create may omit `billingType`: the project starts `non_billable` and the result row says so (`note`), so an agent can create before the terms are known and set the type later. | `convex/lib/billing/closeData.ts`, `convex/projects.ts`, `convex/lib/mcpSaveProjects.ts` |

**App-path rule changes shipped with the MCP branch.** MCP reuses the app's write
paths (goal 3), so these owner decisions changed the app as well:

- **Delete guards:** deleting a task with invoiced or settled time entries is refused
  ("Archive it instead", `convex/tasks/write.ts`); a time entry settled by a close is
  refused; projects and clients follow D-DELETEGUARD above.
- **Comment attachments are author-only** (D-COMMENTATTACH).
- **Timer stop writes a `time_entry_logged` activity row** on the task, like a manual
  entry (`convex/lib/timerEntry.ts`; §17 slice 4).
- **A timer running in another workspace is refused untouched:** "Your timer is running
  in another workspace; stop it there." (`convex/lib/timer.ts`, `convex/timer.ts`).
- **Client prefix:** a typed prefix must be valid (A–Z/0–9, up to 10, saved uppercase)
  and free (case-insensitive); a prefix another client uses is refused on save
  (`convex/clients.ts`, `convex/lib/clientPrefix.ts`; §7).
- **App UI uploads are bound to the uploader:** task and comment attachments go through
  `fileUploads:generateUploadUrl` (`POST /upload?u=<uploadId>`, org + user bound) and
  `attachments.save` / `commentAttachments.save` refuse a storage id that is not the
  caller's own upload (`convex/fileUploads.ts`; `4dd2b0b`, merged 2026-10-25).

## 4. Architecture

```
Claude / Codex ──Streamable HTTP + Bearer (Clerk OAuth JWT)──▶ Next.js app/mcp/route.ts
                                                                │  mcp-handler + withMcpAuth
                                                                │  tool registry (lib/mcp/registry)
                                                                │  markdown renderers (lib/mcp/render)
                                                                ▼
                                                   ConvexHttpClient.setAuth(<same OAuth JWT>)
                                                                ▼
                                       convex/mcp/*  public queries / mutations / actions
                                                                │  getMcpAuthContext(ctx)  (§5.2)
                                                                ▼
                                       existing *ForAuth cores + tasks/write.ts, billing, …
```

- **Next.js route** (`app/mcp/route.ts` plus the public `.well-known` routes). There is
  deliberately no root `[transport]` catch-all, which would swallow unknown URLs.
  - It verifies the bearer token with Clerk, which is what `withMcpAuth` and
    `verifyClerkToken` do.
  - It maps tool calls to Convex functions and renders the results as markdown.
  - It holds no domain logic and no authorization decisions.
- **`convex/mcp/`** holds one thin public function per tool operation.
  - Each function calls `getMcpAuthContext` and then the existing cores.
  - Batch writes run in one mutation, so one tool call is one transaction.
  - Functions return compact data, never markdown.
- **`lib/mcp/registry.ts`** is the single source of truth for each tool. It holds:
  - the name and the zod input schema;
  - the annotations;
  - the description text;
  - the Convex function it calls;
  - its renderer.

  It generates the MCP `tools/list` output. Unit tests assert that every entry has
  annotations and that its schema round-trips.
- **The `*ForAuth` pattern already exists** and is the reuse layer, including:
  - `listClientsForAuth`, `listProjectsForAuth`, `listOrgMembersForAuth`;
  - `getWorkspaceRefsForAuth`;
  - `findTasks`, `getTaskDetail`, `resolveTask` and `resolveTaskRef` (in
    `convex/tasks/lookup.ts`);
  - the report collectors in `convex/reports.ts` and the pure layer
    `convex/lib/reportCore.ts`;
  - `lib/reports/views.ts` (report flatteners) and `lib/task-lookup.ts`;
  - `getMonthlyReportForAuth`, `getCloseQueueForAuth`, `getInvoiceForAuth`;
  - `projectOverviewForAuth`.

  Slice 0 (PR #16, merged) already moved these out of the `agent*` files under the
  names above.

## 5. Auth and tenancy

### 5.1 OAuth flow (Clerk)
- **Client onboarding:**
  - CIMD (Clerk's recommendation) with DCR enabled as a fallback. Claude and Codex
    both support CIMD and both fall back to DCR.
  - The consent screen stays on. DCR forces it on anyway, and it is where the user
    picks the org.
- **Scopes:** request `user:org:read`, which adds the org selector to consent and puts
  `org_id` in the access token. There is one product scope (D11).
- **Token format:** JWT, because Convex must be able to verify it (D14).
  - Revoking a connection in `/connected-apps` blocks that client for the user and org in
    `getMcpAuthContext` from the next call, including tokens still valid (D17, owner
    2026-10-25). Clerk's grant and refresh token stay alive; the user also disconnects
    in the client to remove them. Access tokens last 1 day and cannot be shortened (S3).
  - `getMcpAuthContext` re-checks membership on every call, so removing a user from
    the org cuts access immediately.
  - Refresh tokens do not expire, so unattended agents keep working as long as their
    client refreshes (D26).
- **Discovery:**
  - `/.well-known/oauth-protected-resource/mcp` is built with
    `generateClerkProtectedResourceMetadata`. Clerk's `protectedResourceHandlerClerk`
    sets `resource` to the bare origin, which breaks the exact `/mcp` match. The
    metadata advertises `scopes_supported: ["user:org:read", "offline_access"]`.
  - Dev resource URL: `https://localhost:3001/mcp`. Clerk requires https, so the dev
    server runs with `next dev --experimental-https -p 3001`. Both Next and Convex read
    `MCP_RESOURCE_URL`.
  - `/.well-known/oauth-authorization-server` is optional.
  - Both are public. `resource` must exactly equal the URL users paste into Claude.
  - Unauthenticated requests get a **401** with `WWW-Authenticate: Bearer
    resource_metadata=…`. Claude ignores the header on a 200.

### 5.2 `getMcpAuthContext(ctx)` — the only MCP entry point
It returns the same `AuthContext` shape as `getAuthContext`:
1. `ctx.auth.getUserIdentity()` must come from the **OAuth provider**, not the session
   provider. Both share the Clerk issuer, and Convex enforces each provider's audience
   but does not expose which one matched. The discriminator is therefore the
   `client_id` claim, which every OAuth access token carries (RFC 9068) and session
   tokens never do (`oauthClientIdOf` / `getSessionIdentity` in `convex/lib/auth.ts`).
2. `orgId` is the verified `org_id` claim. Missing → `"No organization selected — reconnect
   and pick an organization"`.
3. User comes from `users.byExternalId(subject)`. The role comes **only from
   `orgMembers`**. A missing or stale membership fails closed (D12).
4. `clientId` (the OAuth client) is returned alongside, for attribution (D15) and the
   Connected-apps "last used" time.

**Do not reuse** the JWT-role branch of `loadAuthContextForActor` or
`parseOrgFromIdentity`. An OAuth identity has no `org_role`, so the existing code would
silently demote every admin to member, or worse, if the branches are later edited. The
two context builders share the membership lookup helper only.

### 5.3 Invariants (each gets a test)
- **I1** Every `convex/mcp/*` function calls `getMcpAuthContext` first. It is lint- or
  test-enforced the same way as other protected functions.
- **I2** No MCP function accepts `orgId`, `userId` or a role from arguments.
- **I3** Every reference resolved from input (ID, URL, key, email) is checked for
  ownership against `auth.orgId` before it is read or written. A wrong-org reference
  returns "not found", never "forbidden", so it leaks nothing.
- **I4** A session JWT cannot call `convex/mcp/*`, and an OAuth JWT cannot call UI
  functions. The token type decides the surface.
- **I5** Batch writes are all-or-nothing within one call.

### 5.4 Fallback if S1 fails (Convex cannot verify the Clerk OAuth JWT)
In this fallback:
- The Next route verifies the token with Clerk and reads `org_id`.
- It then calls Convex **internal** functions through one server action guarded by a
  deployment secret, passing `{ clerkUserId, orgId, clientId }`.
- `getMcpAuthContext` then takes those values instead of `ctx.auth`, with the same
  membership check.

Cost: a secret that can act as any user, so it must stay server-only and be rotatable.
Use this only if S1 proves the direct path impossible.

## 6. Tool catalog (V1)

Notion's lesson (blog, July 2025) is that curated, agent-oriented tools and dense
markdown beat a 1:1 API mapping. Today Notion exposes about 60 tools. We stay at 17
(the 16 rows below; `create_upload` and `attach_file` share one) because Codex loads
every tool definition on every turn, and a batch-first design needs fewer calls.

| Tool | Annotations | Purpose |
|---|---|---|
| `search` | read-only | Text query plus structured filters: `types[]` (task, project, client, member, time_entry, invoice, daily_note, comment), assignee, status, label, client, project, date range (due / tracked / updated), `updated_since`, `external_ref` (D21), `next_assignee` (D24), `mine`, `cursor`, `limit`. Returns compact rows with references. |
| `fetch` | read-only | `refs[]` (up to 25) → markdown detail. `include[]` controls depth (subtasks, comments, activity, time, plan, files, attachment_text). Special refs: `workspace`, `inbox`, `me`, and `changes` with `{ cursor, types[], exclude_self, include_text }` (D22, D29). |
| `save_tasks` | write | Batch. An item without `ref` creates a task, unless one of its `externalRefs` already belongs to a task, in which case it updates that task (D21). An item with `ref` patches it. Fields: title, description (markdown), project (optional, D28), parent, status, `done`, `after` / `before` (order), assignees, labels, priority, start/due date, estimate, category, `externalRefs` (add-only). Runs `tasks/write.ts`. |
| `save_comments` | write | Batch create, or edit your own comment. Mentions are written as `@email`. |
| `save_time_entries` | write | Batch create/patch of time entries (task, date, minutes, note, category). |
| `timer` | write | `start(task)`, `stop`, `status`. |
| `save_clients` | write | Batch create/patch. Admins only, as in the app. |
| `save_projects` | write | Batch create/patch. Admins only, as in the app. A create may omit `billingType` (starts non-billable); a patch changes the type with its terms while the project has no close or invoice (D-BILLINGTYPE). |
| `save_plan` | write | Planner segments: create, move or resize (member, task, date range). |
| `save_daily_notes` | write | Create/patch a daily note for a date. |
| `mark_read` | write, idempotent | Mark inbox items, or a task's / comment's notifications, as read. The ref `"inbox"` is the app's "Mark all as read", 200 items per call. |
| `delete` | destructive | `refs[]`. The type is inferred from each ref. Uses the app's delete mutations and rules. Slice 3 covers tasks (with `deleteTimeEntries` for the app's "Delete task + logged time") and comments. Slice 4 adds time entries and slice 7 adds projects and clients, planner bars (the Planner's unschedule) and files (task or comment attachments, by the file id `fetch` lists with `include: ["files"]`), each with the app's rules. Archiving goes through `save_tasks` `archived: true/false`. |
| `report` | read-only | `kind` plus params (§8). Returns a markdown table and an app link. |
| `billing_preview` | read-only | `action` plus params → effect summary and `commitToken`. The actions are the app's own buttons (§17 slice 6, owner 2026-10-25): on a project period (`project` + `period`): `close_period`, `reopen_period`; on a project (`project`, optional `amount`): `create_fixed_invoice`; on an invoice (`invoice`): `mark_invoiced`, `mark_paid`, `mark_unpaid`, `revert_to_draft`, `void_invoice`, `delete_draft`. Admins only. |
| `billing_commit` | destructive | `commitToken` → runs the previewed action (§9). |
| `invite_members` | write, idempotent | `items[]` (up to 25) of `{ email, role: admin \| member }`. Admins only. Convex (`mcp/members:inviteCheck`) authorizes, normalizes the emails and refuses existing members; the Next.js route then creates one Clerk organization invitation per cleared email with the org and inviter from the verified token. Inviting the same email twice is a no-op ("already invited"); membership arrives through the Clerk webhook when the invitee accepts (D-INVITE). |
| `create_upload` / `attach_file` | write | `create_upload(filename, contentType, sizeBytes)` returns an `uploadId` and a one-time upload URL on the Convex site (valid 1 h); the client POSTs the bytes to it. `attach_file(ref, { uploadId } \| { inlineText, filename })` attaches it within 24 h (§10). The client never sees a storage id. |

Rules for every tool:
- **Descriptions** are written for the model. Each says when to use the tool, what a
  reference looks like and one example. They contain no tenant data.
- **Errors are model-actionable.** For example: `"ARLO-99 not found. Did you mean ARLO-19?
  Use search to find tasks."` Ambiguity always returns candidates. The tool never guesses.
- **Write tools return** the affected references and deep links, not full records. The
  agent can `fetch` if it needs more.
- **Every write tool** accepts an optional `idempotencyKey` (D23). It is stored in an
  `mcpIdempotency` table (orgId, userId, key, result, createdAt; 24 h TTL by cron) and
  checked in the same mutation as the write.
- **Keeping the source on the card:** attach the original email or note with
  `attach_file(ref, { inlineText, filename: "source.md" })`. No special field is needed.

## 7. References and output format

**References:**
- A Convex ID.
- An app URL, so a pasted link works.
- A task identifier `KEY-N`. Old identifiers resolve through `taskIdentifierAliases`.
- A project `code`.
- A client `prefix`, written as `client:KONV`. Prefixes are unique per org
  (case-insensitive), and only A–Z/0–9 up to 10 characters are accepted on save, in the
  UI as well (owner, 2026-10-24). Clients without a valid prefix are referenced by ID or
  URL. A bare short key means the **project** code, because task identifiers are built on
  it (owner, 2026-10-24).
- A member email.
- The special refs `workspace`, `inbox`, `me` and `changes`.

All keys appear in `fetch("workspace")`. One parser (`lib/mcp/refs.ts`, pure, unit-tested) turns any
input into a typed reference. Convex resolves and ownership-checks it (I3).

**Output:**
- **List rows** are one line each: ref · title · key fields. They have no IDs when a
  short key exists.
- **Detail** is a heading, a field list, the markdown body and the included sections,
  in that order.
- **Every entity** carries its app deep link. The exception is `fetch("workspace")`,
  which is a key sheet with no links (owner, 2026-10-24).
- **Reference data never comes back clipped.** If a workspace table exceeds its cap,
  `fetch("workspace")` refuses with a model-actionable error, the same rule as reports
  (owner, 2026-10-24).
- **Paging:** the default limit is 25 (the changes feed: 50) and the maximum 100. The cursor is opaque. A
  result is never silently truncated: when more exist, the output says so and gives the
  cursor.
- **Size:** keep each result well under Claude Code's 25k-token cap. `include` lets the
  agent ask for depth explicitly.

## 8. Reports

`report(kind, params)` is a thin registry over existing deterministic cores. Members get
the same self-scope and money stripping as in the app.

| kind | Core today |
|---|---|
| `timesheet` | `timesheets.collectTimesheetData` + `timesheetPivot` |
| `time_by_member` | `timeByMemberForAuth` |
| `client_monthly` | `clientMonthlySummaryForAuth`, extended per task with status, deep link, minutes, time-entry notes and the closing comment (D25) |
| `missing_time` | new: tasks in the period with no time entries, in the statuses given by the `statuses` param; default = every status in the org's completed category. Status names are matched exactly against the org's statuses, never guessed (D25; §17 slice 5) |
| `project_overview` | `projectOverviewForAuth` / `getProjectSummaryForAuth` |
| `project_monthly` | `projectMonthlyBreakdownForAuth` |
| `retainer_statement` | `getMonthlyReportForAuth` / `getRetainerDataForAuth` |
| `retainer_health` | `retainerHealthForMonthForAuth` |
| `close_queue` | `getCloseQueueForAuth` |
| `invoice_metrics` | `getInvoiceMetricsForAuth` |
| `org_finance` | `orgFinanceSnapshotForAuth` |

Report rules:
- Minutes are raw (no rounding on reporting surfaces).
- Money is partitioned by currency.
- A scan over its cap throws "narrow the period". It never returns a clipped sum.
- The markdown table is rendered from the returned rows by code. The model only writes
  the summary around it.

## 9. Billing preview → commit

1. `billing_preview(action, params)` runs the same validation and computation as the
   app's action, without writing.
2. It returns:
   - the effect, as a markdown summary with totals, line counts and any warnings;
   - `commitToken`, short-lived (10 min). **As built (§17 slice 6, owner 2026-10-25) the
     token is not signed:** `billing_preview` stores an `mcpBillingPreviews` row and the
     token is that row's id. The row is bound to `orgId`, `userId` and the OAuth
     `clientId`, so a token previewed in Claude cannot be committed from Codex. At most
     50 open (unexpired, uncommitted) previews per user, across their clients. A
     re-preview of the same action and params from the same connection supersedes the
     earlier preview (its token expires at once); only distinct open targets count, and
     past the cap a preview is refused.
3. The row holds the action, the params, `expiresAt` and an **input fingerprint**
   (SHA-256) of what the preview read: the entries, rates, period state and invoice
   state, per action. The `close_period` fingerprint also includes the checklist
   warnings the user saw, so what was approved is what runs. A second, dateless
   fingerprint and the invoice issue date are stored to tell a day change apart.
4. `billing_commit(commitToken)`:
   - looks the row up; a token of another user, org or client is "Unknown commit
     token"; an expired one is refused;
   - recomputes the plan and its fingerprint and refuses with `"Data changed since
     preview — run billing_preview again."` if it differs. When the re-plan itself
     fails, the message adds `Now: <reason>`; when only the calendar day changed (the
     invoice would be dated another day than the user saw), it names the new issue
     date;
   - otherwise runs the app's own write path for the action as the user, with `via`
     (D15).
5. Commit is idempotent per token: a committed row keeps its result for 24 h (the cron
   then deletes it) and a second commit with the same token replays that first result
   and writes nothing. D5 stands.

## 10. Files

- **`create_upload(filename, contentType, sizeBytes)`** checks the app's size and type
  limits, records the announced file under an unguessable `uploadId` (192 bits, made
  in an action) bound to org + user + OAuth client, and returns the `uploadId` plus a
  one-time upload URL `<CONVEX_SITE_URL>/mcp-upload?u=<uploadId>` (valid 1 h;
  `convex/mcpFileUploads.ts`, `convex/lib/mcpFiles.ts`). The client POSTs the bytes to
  it; the endpoint stores them once and answers `{ uploaded: true }`. The client never
  receives a `storageId`. Claude Code and Codex can do this from a shell. On claude.ai,
  upload works only for inline text (S5). The tool description states the limits
  (agent-first backlog A, 2026-10-25): up to 10 MB; PDF, images (PNG, JPEG, WebP, GIF),
  Word .docx, text, .md, .csv; HTML, scripts and executables are refused
  (`BLOCKED_MIME_TYPES` in `convex/lib/content_validation.ts`).
- **`attach_file(ref, { uploadId } | { inlineText, filename })`** attaches to a task or
  your own comment through the existing attachment write path, within 24 h of
  `create_upload`; the `uploadId` must be the caller's own, in this org. `inlineText` is
  capped at 200 KiB of UTF-8, matching Notion.
- **Read:** `fetch(ref, include: ["files", "attachment_text"])`. The PDF/DOCX/text
  extraction (`attachmentContents`) existed only on the closed email-triage branch
  (c3972ab). It is ported in slice 7 (owner, 2026-10-24); until then the include says
  extraction is not available.
- There is no server-side URL download, so no SSRF surface.

## 11. App-side changes

- **Attribution (D15):** add an optional `via` field on `activityLog` (and on comments
  where shown): `{ kind: "mcp", clientId, clientName }`. The UI renders a muted
  "via <clientName>" next to the actor. For CIMD clients (Claude, Codex) `clientName`
  is the host of the client's metadata URL, e.g. "via claude.ai"; Clerk-registered
  clients show their Clerk application name (D15).
- **External refs (D21):** a new `taskExternalRefs` table (orgId, ref, taskId, createdAt)
  with indexes `by_orgId_ref` (unique lookup) and `by_taskId`. `fetch` shows a task's
  refs. The drawer may list them later; that is not V1.
- **Client prefix uniqueness (§7):** saving a client with a prefix another client
  already uses is refused, in the UI as well as through MCP.
- **Connected apps (D17):** the `/connected-apps` page lists the user's MCP connections
  from our own `mcpConnections` table: client, first seen, last used, with Revoke / Allow
  again. Queries cannot write, so the `/mcp` route registers and stamps the connection
  with `mcp/connections:touch` (`registering: true`) after verifying the token and
  **before** handling the first request, at most hourly per org + user + client.
  `getMcpAuthContext` fails closed without a row (`CONNECTION_UNKNOWN` in
  `convex/lib/mcpAuth.ts`); `touch` is the one caller allowed to create it. An app
  appears after its first request.
- **Notifications (D16):** nothing new. They follow automatically from reusing the
  write paths.
- **Setup docs:** a short in-app help page showing the MCP URL, how to add it in Claude
  (Connectors → Add custom) and in Codex (`codex mcp add …` / `codex mcp login`), and
  three example prompts.

## 12. Slice 0 — removal PR (separate PR, lands first)

> **Done:** PR #16, merged 2026-10-24. `main` never contained `convex/email`; that code
> lived only on the closed email-triage branches. The list below is the original scope.

**Keep, but move out of `agent*` names:**
- the `*ForAuth` cores in `agentReads.ts`, `agentReports.ts` and
  `lib/agentReportCore.ts`;
- `tasks/agent.ts` (`resolveTaskRef`, `findTasksForAuth`, `getTaskDetailForAuth`),
  renamed for example to `tasks/refs.ts`;
- `workspaceRefs`;
- the `timesheets` collector and `timesheetPivot`;
- the membership lookup in `loadAuthContextForActor`;
- worksheet AI (`worksheetAi`), `aiIntegration` and BYOK.

The tests for these modules move with them.

**Delete:**
- **Backend:**
  - the runner, threads, agents, skills, proposals, artifacts, questions, items,
    checks, jobs, background, events, mentions, widgets, audit and attachments
    modules;
  - `agentToolRegistry` and `agentActorTools`;
  - the `@convex-dev/agent` component (`convex.config.ts` and the package);
  - the dev seeds for agents and email.
- **Email:**
  - `convex/email/**`, `oauth.ts`, `connectors.ts`;
  - the `/oauth/google/callback` route in `http.ts`.
- **Schema tables:**
  - agent: `agents`, `skills`, `agentThreads`, `agentRuns`, `agentJobRuns`,
    `agentArtifacts`, `agentProposals`, `agentQuestions`, `agentItems`, `agentChecks`;
  - email: `mailboxSyncStates`, `emailThreads`, `emailThreadTasks`, `emailMessages`,
    `emailDrafts`, `emailPromises`, `clientRequests`;
  - connectors/OAuth: `connectors`, `oauthStates`, `oauthPendingGrants`.

  MVP data is dummy only, so the schema is narrowed directly with no migration.
- **Frontend:**
  - `components/agents/**`, `lib/agents/**`, `components/triage/**`;
  - `app/agents/**`, `app/(dashboard)/triage/**`;
  - the workspace switch, sidebar entries and Settings → Connectors.
- **Env:** Google OAuth client vars, Gmail flags and connector KEK, but only if
  nothing else uses them.

**Exit:** `npx tsc --noEmit`, lint, tests and build are green. A `grep` for
`agentThreads|agentRuns|convex-dev/agent|emailThreads` finds nothing outside docs. PRs
#14 and #15 are closed with a link to this PRD.

## 13. Testing

- **Pure unit tests (Vitest):**
  - the reference parser;
  - registry completeness (every tool has a schema, annotations and a renderer);
  - markdown renderers (golden files);
  - the commit-token fingerprint and expiry;
  - paging and cursor encoding.
- **Convex tests:**
  - `getMcpAuthContext`: OAuth identity → role from `orgMembers`; a session identity is
    refused; a removed member is refused;
  - I2/I3 cross-org references return not-found;
  - batch atomicity (I5);
  - billing commit refused after a data change;
  - external refs: upsert hits the existing task; a ref owned by another task fails with
    that task's identifier; refs from another org never match;
  - an idempotency-key replay returns the first result and writes nothing;
  - the changes feed: cursor resumes exactly, `exclude_self` drops the caller's rows,
    comment rows carry capped text, and comments on tasks the caller cannot read never
    appear;
  - a task created without a project gets the org identifier key and no client;
  - `next_assignee` follows sub-task order.
- **Protocol:**
  - the MCP Inspector against dev (`https://localhost:3001/mcp`) or production. Vercel
    previews get no tokens: Clerk issues them only for the registered resource, so
    the audience never matches there (runbook §1);
  - a 401 + `WWW-Authenticate` check;
  - `tools/list` matches the registry snapshot.
- **End-to-end (manual, every slice):**
  - connect from Claude Desktop and from Codex CLI against dev;
  - run the slice's example prompts;
  - verify the result in the app UI, including "via <client>" and notifications.

## 14. Slices (feature branch `mcp`, one PR at the end)

| # | Slice | Exit |
|---|---|---|
| 0 | Removal PR (§12) | Merged to `main` separately |
| 1 | **Auth tracer:** Clerk upgrade (≥ 7.2.3), OAuth app setup, `.well-known` routes, route skeleton, `getMcpAuthContext`, second Convex provider (S1), `fetch("me")` and `fetch("workspace")` | Claude Desktop and Codex connect, pick an org and get the workspace |
| 2 | `search` + `fetch` (tasks, projects, clients, members, comments, time) + reference parser (client prefix included) + renderers | "What's overdue for me?" and "show ARLO-21 with comments" |
| 3 | `save_tasks` (external refs, checklist `done` / order, `next_assignee`), `save_comments`, `delete`, `idempotencyKey`, attribution `via`, `fetch("changes")` | Email → card with `gmail:<thread>`; a second run updates the same card; a retried call writes once; the activity row shows "via <client>"; the assignee gets the notification; the changes feed shows a teammate's tick and comment text and hides the bot's own writes; a lead card without a project is created |
| 4 | `save_time_entries`, `timer`, `delete` for time entries | Log and fix time; the timer shows in the app |
| 5 | `report` (all kinds in §8, including `missing_time` and the extended `client_monthly`) | Numbers match the app screens exactly |
| 6 | `billing_preview` / `billing_commit` (all actions), plus the `invoice` search type | Close a month and generate an invoice from Claude; a stale token is refused |
| 7 | `save_clients`, `save_projects`, `delete` for projects and clients, `save_plan`, `save_daily_notes`, the `daily_note` search type, `fetch("inbox")` + `mark_read`, files including the ported attachment extraction | Each has an example prompt that passes end to end |
| 8 | Settings → Connected apps, help page, final review | Revoke works; docs are done; the full checks pass |

## 15. Spikes and open facts (resolve in slice 1)

- **S1:** Can Convex verify a Clerk OAuth access token directly? Check:
  - a `customJwt` provider with `issuer`/`jwks`;
  - whether the token has a usable `aud` and `kid`;
  - whether a `typ: at+jwt` header is accepted.

  If not, use §5.4.
  **Outcome (2026-10-24): passed.** Convex 1.34.1 accepts the Clerk OAuth JWT (`typ: at+jwt`)
  through the `customJwt` provider and exposes `client_id` and `org_id` on the identity, so
  §5.4 is not needed.
- **S2:** Version compatibility of `@clerk/mcp-tools` 0.7.x with `mcp-handler`. Clerk's
  example pins `mcp-handler` 1.x / SDK v1, while `mcp-handler` 2.x needs the v2 SDK.
  Stay on the combination Clerk's example uses.
  **Outcome (owner-accepted 2026-10-24):** `@clerk/mcp-tools` 0.6 + `mcp-handler` 1.1,
  the example's packages. An npm `overrides` entry collapses the MCP SDK to a single
  `@modelcontextprotocol/sdk` 1.32.2. The pinned 1.26.0 has a high-severity advisory,
  and every SDK import `mcp-handler` uses was checked against 1.32.2.
- **S3:** Can the OAuth access-token lifetime be shortened in Clerk (for example to
  1 h), and does Clerk rotate refresh tokens for public clients?
  **Outcome (2026-10-25):** no lifetime setting (access tokens 1 day, refresh tokens never
  expire, per Clerk docs); refresh-token rotation for public clients is not documented.
- **S4:** Does the Clerk Backend API list and revoke a user's OAuth grants per client
  (for Connected apps)? If not, list from our own last-used stamps and revoke through
  the API that exists.
  **Outcome (2026-10-25):** no. Clerk's only revoke needs the client's refresh token or an
  opaque token plus an OAuth application id, and CIMD clients have none. Connected apps
  therefore lists our own stamps, and Revoke is enforced in Convex (D17).
- **S5:** Can claude.ai web upload a file to a URL a tool returns? Expected: no, so only
  inline text works there, which is acceptable for V1.
  **Outcome (2026-10-25):** no. claude.ai on the web cannot POST to the upload URL, so
  there `attach_file` works with `inlineText` only; the `create_upload` description says
  so and points the model at `inlineText`. Claude Code and Codex upload from a shell.

## 16. Sources (checked 2026-10-24)

- Clerk: build an MCP server (Next.js) — clerk.com/docs/nextjs/guides/ai/mcp/build-mcp-server
- Clerk: how Clerk implements OAuth (scopes, `user:org:read`, `org_id`, token formats) —
  clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth;
  changelog 2026-05-14 "OAuth organizations"
- Claude connectors: building and auth requirements — claude.com/docs/connectors/building
- Claude Code MCP — code.claude.com/docs/en/mcp
- Codex MCP — learn.chatgpt.com/docs/extend/mcp
- Notion MCP tools — developers.notion.com/docs/mcp-supported-tools; design notes —
  notion.com/blog/notions-hosted-mcp-server-an-inside-look (2025-07-15)
- Convex HTTP actions — docs.convex.dev/functions/http-actions

## 17. Execution and resume protocol

Resume with: **Continue the MCP build per docs/prd-mcp.md §17.**

This table is the single source of truth for execution progress. Slice 0 is done
(PR #16). Work strictly in order, one slice at a time, on `mcp` in this checkout;
no worktrees, extra branches, pushes or PRs before the final owner gate. Preserve
all unrelated working-tree changes.

For each slice:
1. Re-read its §14 row, locked decisions and §13 tests; record a short file/reuse/test plan.
2. Delegate implementation with a complete, self-contained brief when agents are
   available. Enforce I1–I5; reuse existing domain cores. Read installed Next.js docs
   before route work and version-matched Clerk/Convex sources before API work.
3. Make small logical commits. Independently review the full diff from the slice's
   starting commit for standards and exact spec coverage. Challenge findings, fix
   confirmed issues and repeat review until clean.
4. Run `npx tsc --noEmit`, touched tests and `npm run build` when routes change.
   Deploy backend changes to shared dummy-data dev with `npx convex dev --once`.
   Local checks are the gate; do not wait for CI or previews. The known three
   timestamp-test failures and existing untouched lint errors are not slice work.
5. After owner setup, connect Codex to `https://localhost:3001/mcp`, run the slice's
   tools/example prompts and verify observable effects in the app. Record actual
   outputs and clearly distinguish tested, failed and unverified behavior.
6. Update this table with commits, independent review and deviations; append one
   line to `project_mcp_direction.md` for each finished slice. Report 2–4 lines in
   Hungarian and continue immediately to the next slice.

Stop for owner approval before Clerk configuration changes (development only),
one-time owner consent/client setup, spike results changing the plan, unsettled
questions or contradictions with locked decisions, and the final push/PR after
slice 8. Show the concrete change first; ask short numbered questions with 2–3
options and the recommendation first. A MUST deviation requires owner approval
before changing the PRD. Code, documentation and commit messages stay in English.

| # | Slice | Status | Commits | Review | Notes / deviations |
|---|---|---|---|---|---|
| 1 | Auth tracer | **Done** 2026-10-24. End to end: Claude Code connected via CIMD, owner consent with org pick, `fetch(me)` + `fetch(workspace)` returned correct org data (admin role from orgMembers). App UI verified on https with Clerk 7.9.20 | `def14c9` `cffbbd3` `3033410` `b80637f` + fixes `543d1f8` `f6cc62b` `4ccb821` `28ff3f5` `4ecaeb7` | Two independent reviews (standards/security, spec): no blockers or majors. 9 minor fixes done and re-verified (tsc clean, 65 MCP + lookup tests green) | Clerk dev MCP resource `https://localhost:3001/mcp` registered with owner approval (CIMD + aud on). Deviations accepted: https URL, `app/mcp/route.ts`, `generateClerkProtectedResourceMetadata`, `client_id` discriminator, S2 SDK override, workspace refuses instead of clipping, no links in the workspace sheet. |
| 2 | Search, fetch, references and renderers | **Done** 2026-10-24 | `fff5558` `435999c` `b9ad704` `ab8136e` `8dc3e57` `c8abc6c` + fixes `524a17e` `326202f` `3f9a6ba` | Two reviews: no tenancy/access blocker. Round 1 fixed: read budgets (one Convex call per ref, comment scan 500), user content fenced as data, task filter for comments/time, no body caps (budgeted lists). Re-verified: tsc clean, 147 tests green, exit prompts + `ARLO` / `client:ARLO` + task-filtered comment search end to end | Owner decisions: bare key = project, clients as `client:KEY`; prefix A–Z/0–9 ≤10; attachment extraction ported in slice 7. Search additions: `overdue`, `status` = open/any/category, `due_/tracked_/updated_from/to`, `types` default `["task"]`, a filter that doesn't apply is an error. `invoice`/`daily_note` types move to slices 6/7. Comment search relies on `comment_added` activity rows (seeded comments lack them) |
| 3 | Tasks, comments, delete, idempotency, attribution and changes | **Done** 2026-10-25 | `8ba87d5` `06b044d` `b76c9ce` + fixes `2944597` `ec939e8` `aaaa8e3` | Two reviews: no blockers. Round 1 fixed (idempotency bound to request, markdown fidelity, archived-ref refusal, client-name lookup, ref cap). End to end via MCP: one-call card + checklist with `gmail:` refs, idempotent replay, rerun = no change, comment with @mention, changes feed with `via claude.ai` and exclude_self, delete frees the ref; the assignee got 3 assignment + 1 mention notifications; "via claude.ai" shows in the app activity | Owner decisions 2026-10-25: external ref = task reference everywhere + ordered batch; `archived` in save_tasks; via = host for CIMD clients; exclude_self = same user AND same client. `deleteTimeEntries` flag for app parity. Sub-tasks inherit the parent's assignees when omitted (app rule) |
| 4 | Time entries and timer | **Done** 2026-10-25 | `d05bcae` `2cf164e` `2069c32` + fixes `8bf591e` `ce7a12b` | Two reviews: the app time/timer refactor was verified behaviour-preserving. Round 1 fixed: a timer running in another org is refused untouched (app too) and reports `elsewhere`; timer times in the org timezone; `fetch("me")` shows Today and the timer; category on time rows; billable; timer-stop activity rows. End to end via MCP: Today, log 1h30 "yesterday" in Design, fix to 2h, timer start shown in the app sidebar + floating timer, stop saves an entry, changes feed `via claude.ai`, delete | Owner decisions 2026-10-25: timer stops write `time_entry_logged` in the app too; `billable` like the app's form. Members log only on tasks they can read. Caps: 1,440 min per entry, 2,000-char notes. Carried to slice 8: Clerk 7.9 deprecates `createRouteMatcher` (proxy.ts) |
| 5 | Reports | **Done** 2026-10-25 | `12ecdf8` `b8b00f3` `8f5cfc4` `9db9a1a` `0bbfcb2` + fixes `73d1793` `f9a5bc3` `e152d42` | Two reviews: no blockers; billing-file refactors verified wrapper-only. Round 1 fixed: missing_time period-bounded loads + `statuses` param, client_monthly project param/subtotals/parent keys/billable-marked notes/human closing comment, D1 subtotals, project codes+links | Owner decision: missing_time `statuses` param, default = completed statuses (no name guessing). Members may run only time_by_member (own) and missing_time (own). Billing vocabulary follows docs/prd-project-billing-redesign.md |
| 6 | Billing preview and commit | **Done** 2026-10-25 | `c7413ae` `368eb90` `4fff338` + fixes `a8b363b` `841d167` `59192c7` | Two reviews: no blockers or majors; the plan/apply refactor was verified behaviour-preserving; OCC, commit safety and SHA-256 verified. Round 1 fixed: warnings in the fingerprint, midnight message, 50-preview cap, `outstanding` filter + per-status totals, days overdue, amount on commit results, clearer reopen/empty-month errors, any invoice prefix, real after-state chips. End to end via MCP: close_queue (hub vocabulary) → preview close PRAG 2026-04 ($1,050.00, 7 entries) → commit (draft, 4 lines) → two delete_draft previews → commit A → commit B refused "Data changed since preview" → A replayed; dev data back to the start | Owner decisions 2026-10-25: actions follow the app's buttons (close_period, reopen_period, create_fixed_invoice with optional `amount`, mark_invoiced, mark_paid, mark_unpaid, revert_to_draft, void_invoice, delete_draft); close_queue = the billing hub's Needs action. Token = id of a stored preview row bound to org+user+client (instead of a signed token); the token is billing_commit's idempotency key. `via` is stored on billingEvents (not displayed). Not exposed: invoice edits, skip entries, bulk mark-paid |
| 7 | Clients, projects, planner, notes, inbox and files | **Done** 2026-10-25 | 7a: `9d7c038`..`88ffbf5`; 7b: `a550cf1` `1e4e667` `d8b5541` + fixes `25bd98f` `5c85ddf` `091c782` `d36f8d3` `338c51d` `0e9107a` | Four reviews in total (7a, 7b): no blockers. 7b round 1 fixed the major (upload bytes bound server-side through an HTTP upload endpoint keyed by a 192-bit uploadId made in an action) plus org-scoped text deletion, one attachment per blob, file-text paging, and capped PDF/DOCX extraction work. End to end via MCP: 7a examples (see above); 7b create_upload → curl → attach PDF to ARLO-21, inline source.md, extraction of both, re-attach refused; test files removed | Owner decisions 2026-10-25: delete guards (app too); daily notes caller-only; comment attachments author-only (app too). Members see no project billing type (admin-only nav). Follow-ups outside MCP: project page route guard; app upload ownership (Known limits) |
| 8 | Connected apps, help and final review | **Done** 2026-10-25, final whole-branch review done | `10b4a66`..`50fd01f`, `2baf261` `dd80a61` `8ed6418` `c3b9ed7` `3bafdca` + fixes `f986637` `2f98460` `20b0083` `e135994` `232b85a` `d307aac` `6a56a49` | Two reviews: no blockers. Round 1 fixed: server `instructions` + per-tool safety/refs tails (tools individually usable), compact advertised schemas (tools/list 51,420 → 27,905 chars), `MCP_DISABLED` global kill switch, stamp error handling, same-name client labels, runbook (Vercel builds deploy Convex, preview env, forward-only rollback, owner yes for every prod command), MCP sections in development/architecture/tenancy docs, vitest excludes worktrees. Live: /connected-apps page, Revoke refused the next call, Allow again restored; final 17-step regression across all tools OK and cleaned up | Owner decisions 2026-10-25: app-side revoke; member page /connected-apps; tools/list diet. createRouteMatcher kept (tested). DCR off unless needed Final reviews (cross-slice MCP + the Linear restyle): no blockers. Fixed: fail-closed without a connection row (the route registers first), upload endpoint honours revoke/membership/MCP_DISABLED, honest redacted-error hint, shared helpers; Linear UI gets the Notion faceted filter (generic components/filters/facet-filter), tasks-page icons/dot, focus-safe Active/All, ghost Edit buttons, thin client page. Verified: tsc clean, 2077 tests green (3 known timestamp failures), next build OK, dev deploy, live MCP check, /projects filter chips in the browser. Follow-up: move /tasks onto the generic facet-filter (filter-menu.tsx is now a near-copy) |

### Integration (2026-10-25)

`mcp` now also contains the billing hub + project page redesign (branch
`claude/sweet-germain-e3c03d`, billing slices 0–8) and the Linear-style projects/clients
restyle (`wip/linear-directory-views`). They were merged in a separate worktree
(merges `1eeb66a`, `9dd7e04`) and fast-forwarded with owner approval. Cause of the
earlier 3001/3002 drift: two branches pushed to the one shared dev Convex deployment.
Rule from now on: every session works from `mcp` (or merges the latest `mcp` first)
before any `npx convex dev`. Verified after the switch: a 27-step MCP regression with
a real token (every tool, all 11 report kinds) was all OK; the billing hub, project page
and Linear lists render in the browser.

### Production review (2026-10-25)

Seven specialist reviews (MCP design and token cost, architecture, security and
tenancy, Convex correctness and limits, domain and billing, a real-agent dogfood run,
docs and operations) plus a final whole-diff review: 73 findings, no blocker, 13 majors,
all fixed or deferred with a reason. Fixes landed on `mcp` in `3b06b16`, `f33d4e0`,
`946a30d`, `dbf5dcf`, `a53c74d`, `25635a7`, `76cc00e`, `8e01413`; the app upload binding
(`4dd2b0b`) was merged with owner approval. Report, numbers, verdict ("ready after the
runbook's production setup") and the follow-up list: `docs/reviews/mcp-review-2026-10-25.md`.

**Next backlog (owner-approved 2026-10-25):** `docs/prd-agent-first-backlog.md` — outbound
webhooks V1 (pulled forward from V2), full-text search across tasks, comments and
attachment text, a `task_deleted` audit event, upload documentation, and the agent
recipes that replace in-app email ingestion and reminder rules.

### Known limits (accepted, owner 2026-10-24)

- A Convex read-limit error (4,096 index ranges per function) cannot be caught inside
  the function, and production may redact its text. The model then sees "Internal
  error.". The defence is sizing every path to stay under budget; a one-off stress test
  on dev after slice 3 verifies the budgets. **Verified 2026-10-25 on dev:** 600 tasks + 1,000 comments
  (one task with 400). Global comment search (reports incomplete correctly), task-filtered comment
  search (401 exact), a 400-comment task fetch with every include, a 25-ref fetch and a 100-row
  changes page all succeeded with no read-limit error. The seed data was removed afterwards.
- ~~Pre-existing app gap: the app's `attachments.save` / `commentAttachments.save` accepted any
  `_storage` id without proving the caller uploaded it.~~ **Closed 2026-10-25:** UI attachment
  uploads go through `fileUploads:generateUploadUrl` (an action-made uploadId bound to org + user,
  `POST /upload?u=`), and both save paths refuse a storage id that is not the caller's own upload
  (convex/fileUploads.ts, convex/__tests__/fileUploads.test.ts). Editor images still use a plain
  Convex upload URL (embedded by URL, never attached).
- Revoke is enforced only in Agency Flow; the Clerk grant and refresh token stay alive.
  An app appears in Connected apps only after its first request, and last-used moves at
  most hourly.
- `proxy.ts` keeps Clerk's deprecated `createRouteMatcher` (the replacement spreads auth
  checks into every page); its behaviour is locked by `lib/__tests__/proxy.test.ts`.
- Dynamic client registration (DCR) is off in dev; CIMD covers Claude and Codex. Prod keeps
  it off unless a client needs it (owner confirms at the prod step).
- The member path of task search costs about one read range per assigned task. This is
  shared with the UI and only matters at around 2,000 tasks per member. Optimise it
  together with the UI if that ever becomes real.

### Slice 1 plan and preflight (2026-10-24)

- Update `package.json` / lockfile for Clerk >=7.2.3 and the official example's
  compatible MCP dependency combination; resolve S2 from package manifests.
- Add `app/mcp/route.ts`, public `.well-known` discovery routes and thin
  `lib/mcp/registry.ts` / render adapters. Adjust `proxy.ts` so MCP uses OAuth and
  discovery stays public. Keep the resource URL exactly `https://localhost:3001/mcp`.
- Add `convex/lib/mcpAuth.ts`, `convex/mcp` fetch entry points and the second provider
  in `convex/auth.config.ts` after S1 establishes real token claims and validation.
  Roles come only from `orgMembers`. Extract and reuse the existing workspace core
  in `convex/workspaceRefs.ts`; the named `getWorkspaceRefsForAuth` helper in §4 is
  not currently present. Guard UI auth helpers and direct identity readers against
  OAuth identities to enforce both directions of I4.
- Test membership-derived admin/member roles, absent org/user/membership, token
  surface separation, cross-org isolation, auth-first/no-identity-arguments
  invariants, registry/render output, metadata and unauthenticated 401 challenge.
  Run typecheck, touched tests and build; then dev deployment and real Codex/Claude
  connection, `fetch(me)` and `fetch(workspace)` after owner consent.
- Installed versions: Next.js 16.2.2, Clerk 7.0.7, Convex 1.34.1. The generated
  Convex guidelines target ^1.44.0: mismatch flagged; verify APIs against installed
  1.34.1 rather than assuming newer APIs or silently upgrading Convex.
- Read-only development discovery returned HTTP 200: `user:org:read`, `org_id`
  and RS256 advertised; CIMD and DCR are not advertised. No Clerk configuration
  was changed. A real OAuth token is still required for S1; S1–S5 are not marked
  passed. No implementation, typecheck, test run, build or end-to-end result yet.
- Proposed owner-approved development settings: publish CIMD support, publish DCR
  fallback, keep consent enabled with organization selection, use JWT access tokens,
  and default/request `user:org:read` plus `offline_access` for D26 refresh access.
  `offline_access` is a protocol scope, not another product permission tier.
  Keep token lifetime unchanged pending S3 findings. Clerk's official OAuth and MCP
  guides were checked; settings remain pending explicit owner approval.
- Independent read-only plan review confirmed the auth boundary must also cover
  `convex/users.ts` and `convex/attachments.ts`. Convex 1.34.1 supports `customJwt`,
  but deployed acceptance of the real OAuth token remains unverified. S1 must prove
  a token-surface discriminator; a shared issuer alone is insufficient.
- Follow-up facts to resolve before affected implementation: membership removal is
  webhook-synchronized (no freshness marker); workspace tables currently silently
  cap at 2,000; query auth cannot write last-used timestamps. Do not claim immediate
  upstream revocation, return clipped workspace output, or write from queries.
  Resolve any resulting spec decision at the owner gate, without changing D1–D29.
