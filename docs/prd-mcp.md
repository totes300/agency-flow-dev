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
2. A small, agent-oriented, token-efficient tool set: about 15 tools. Schemas and
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
  replacement for it.
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
| D15 | **Attribution:** activity rows written through MCP show the real user plus a quiet "via <OAuth client name>" marker, for example "via Claude", "via Codex" or "via Grok Bot". The row also stores the OAuth `clientId`, which the changes feed uses for `exclude_self` (D22). |
| D16 | **Notifications:** MCP writes trigger exactly the notifications the same write triggers in the app. There is no MCP-specific branch. |
| D17 | **Settings → Connected apps:** shows each client, when it connected and when it was last used, with a Revoke button. |
| D18 | **File upload follows the Notion pattern on Convex storage:** a tool returns a Convex upload URL, the client POSTs the bytes, and a write tool attaches the resulting `storageId`. Small text content can also be passed inline. The server never downloads a URL. |
| D19 | **Removal comes first, in its own PR (slice 0).** The in-app agent and email triage are deleted completely. PRs #14 and #15 (email-triage) are closed without merging. Worksheet AI and BYOK stay. |
| D20 | **Delivery:** one feature branch, built in slices (§14), with one PR to `main` at the end. Slice 0 is the exception and goes in its own PR. |
| D21 | **External source refs on tasks.** Examples: `gmail:<threadId>`, `granola:<noteId>`, `slack:<ts>`. A task can carry many. A ref belongs to at most one task in the org. A `save_tasks` item with no `ref` but a known `externalRefs` entry updates that task instead of creating a new one, so duplicates are impossible by construction. Adding a ref that another task already owns is an error that names the owner, for example `gmail:abc is already on ARLO-21`. It is never moved silently. `search` filters by `external_ref`. |
| D22 | **Changes feed:** `fetch("changes", { cursor, types[], exclude_self })`, read from `activityLog` (`by_org` index). Each change is one line, for example `ARLO-21 · Csaba · checklist "szűrők" ✓`. The opaque cursor means nothing is processed twice. `exclude_self` drops rows written by the calling OAuth client. `search` also accepts `updated_since`. Webhooks are V2. |
| D23 | **Idempotency:** every write tool accepts an optional `idempotencyKey`. A repeated call with the same key (same user and org, kept 24 h) returns the first result. The check runs in the same transaction as the write. |
| D24 | **Checklist = sub-tasks.** `save_tasks` creates and ticks items in one call (`done: true` means the project's first completed status) and orders them with `after` / `before` refs (fractional `sortKey`). `fetch` lists them under the parent. The "next step" is the first open sub-task and its assignee. `search` filters on it with `next_assignee`. |
| D25 | **Client summaries are written by the agent from raw material.** For each task, `report(kind="client_monthly")` returns the title, status, deep link, minutes, time-entry notes and the closing comment. The server makes no LLM call and stores no new field. A `missing_time` report kind lists Review/Done tasks that have no time entries. |
| D26 | **Unattended access is OAuth only.** Clerk refresh tokens do not expire, so a client that refreshes keeps working without the user present. API keys were considered and rejected for V1. |
| D27 | **No draft flag.** An agent that wants a card not yet visible to colleagues creates it unassigned in a Backlog status, so no notification fires until someone assigns it. D3 stands. |
| D28 | **Tasks without a client (leads):** `project` is optional in `save_tasks`. The data model already allows it (`tasks.projectId` is optional): such a task gets the org-level identifier key, and its client is empty because the client always follows the project. Time entries require a project, so a lead that needs logged time goes under an ordinary "Leads" client with a non-billable "Leads" project. That is a data convention, not code. When the lead converts, moving the task to the real project keeps the old identifier as an alias. There is no automatic Inbox project. |
| D29 | **Comment text in the changes feed:** `comment_added` rows in `fetch("changes")` include the comment's plain text, capped at 500 characters with "…" and the comment ref when longer. Follow-up checks can then read what colleagues wrote without fetching every card. Turn it off with `include_text: false`. |

## 4. Architecture

```
Claude / Codex ──Streamable HTTP + Bearer (Clerk OAuth JWT)──▶ Next.js app/[transport]/route.ts
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

- **Next.js route** (`app/[transport]/route.ts` plus the public `.well-known` routes).
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
  - Revoking a connection deletes the grant and refresh token.
  - The access token stays valid until it expires (default 1 day; shorten it if Clerk
    allows, see S3).
  - `getMcpAuthContext` re-checks membership on every call, so removing a user from
    the org cuts access immediately.
  - Refresh tokens do not expire, so unattended agents keep working as long as their
    client refreshes (D26).
- **Discovery:**
  - `/.well-known/oauth-protected-resource/mcp` is served by
    `protectedResourceHandlerClerk`.
  - `/.well-known/oauth-authorization-server` is optional.
  - Both are public. `resource` must exactly equal the URL users paste into Claude.
  - Unauthenticated requests get a **401** with `WWW-Authenticate: Bearer
    resource_metadata=…`. Claude ignores the header on a 200.

### 5.2 `getMcpAuthContext(ctx)` — the only MCP entry point
It returns the same `AuthContext` shape as `getAuthContext`:
1. `ctx.auth.getUserIdentity()` must come from the **OAuth provider** (check issuer or
   audience), not the session provider.
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
markdown beat a 1:1 API mapping. Today Notion exposes about 60 tools. We stay at about
15 because Codex loads every tool definition on every turn, and a batch-first design
needs fewer calls.

| Tool | Annotations | Purpose |
|---|---|---|
| `search` | read-only | Text query plus structured filters: `types[]` (task, project, client, member, time_entry, invoice, daily_note, comment), assignee, status, label, client, project, date range (due / tracked / updated), `updated_since`, `external_ref` (D21), `next_assignee` (D24), `mine`, `cursor`, `limit`. Returns compact rows with references. |
| `fetch` | read-only | `refs[]` (up to 25) → markdown detail. `include[]` controls depth (subtasks, comments, activity, time, files, attachment_text). Special refs: `workspace`, `inbox`, `me`, and `changes` with `{ cursor, types[], exclude_self, include_text }` (D22, D29). |
| `save_tasks` | write | Batch. An item without `ref` creates a task, unless one of its `externalRefs` already belongs to a task, in which case it updates that task (D21). An item with `ref` patches it. Fields: title, description (markdown), project (optional, D28), parent, status, `done`, `after` / `before` (order), assignees, labels, priority, start/due date, estimate, category, `externalRefs` (add-only). Runs `tasks/write.ts`. |
| `save_comments` | write | Batch create, or edit your own comment. Mentions are written as `@email`. |
| `save_time_entries` | write | Batch create/patch of time entries (task, date, minutes, note, category). |
| `timer` | write | `start(task)`, `stop`, `status`. |
| `save_clients` | write | Batch create/patch. Admins only, as in the app. |
| `save_projects` | write | Batch create/patch. Admins only, as in the app. |
| `save_plan` | write | Planner segments: create, move or resize (member, task, date range). |
| `save_daily_notes` | write | Create/patch a daily note for a date. |
| `mark_read` | write, idempotent | Mark inbox items or comments as read. |
| `delete` | destructive | `refs[]`. The type is inferred from each ref. Uses the app's delete mutations and rules. |
| `report` | read-only | `kind` plus params (§8). Returns a markdown table and an app link. |
| `billing_preview` | read-only | `action` (`close_period`, `close_retainer_cycle`, `generate_invoice`, `set_invoice_status`, `revert`) plus params → effect summary and `commitToken`. |
| `billing_commit` | destructive | `commitToken` → runs the previewed action (§9). |
| `create_upload` / `attach_file` | write | `create_upload` returns a Convex upload URL. `attach_file(ref, storageId \| inlineText, filename)` attaches it (§10). |

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
- A client `prefix` (`KONV`). Prefixes become unique per org when set; clients without
  one are referenced by ID or URL.
- A member email.
- The special refs `workspace`, `inbox`, `me` and `changes`.

All keys appear in `fetch("workspace")`. One parser (`lib/mcp/refs.ts`, pure, unit-tested) turns any
input into a typed reference. Convex resolves and ownership-checks it (I3).

**Output:**
- **List rows** are one line each: ref · title · key fields. They have no IDs when a
  short key exists.
- **Detail** is a heading, a field list, the markdown body and the included sections,
  in that order.
- **Every entity** carries its app deep link.
- **Paging:** the default limit is 25 and the maximum 100. The cursor is opaque. A
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
| `missing_time` | new: Review/Done tasks in the period with no time entries (D25) |
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
   - `commitToken`, which is signed and short-lived (10 min).
3. The token encodes the action, the params, `orgId`, `userId` and an **input
   fingerprint**: a hash of the entries, rates, period state and invoice state the
   preview read.
4. `billing_commit(commitToken)`:
   - checks the signature, expiry and same user/org;
   - recomputes the fingerprint and refuses with `"Data changed since preview — run
     billing_preview again"` if it differs;
   - otherwise runs the real mutation (`closePeriod`, `closeRetainerCycle`, invoice
     generation or status, or revert) as the user.
5. Commit is idempotent per token: a second commit with the same token is a no-op that
   returns the first result.

## 10. Files

- **`create_upload(filename, contentType, sizeBytes)`** checks the app's size and type
  limits and returns a Convex `generateUploadUrl` result. The client sends the bytes
  with a POST and receives a `storageId`. Claude Code and Codex can do this from a
  shell. On claude.ai, upload works only for inline text (S5).
- **`attach_file(ref, { storageId } | { inlineText, filename })`** attaches to a task or
  comment through the existing attachment write path. `inlineText` is capped at
  200 KiB, matching Notion.
- **Read:** `fetch(ref, include: ["files", "attachment_text"])` uses the existing
  extraction (`attachmentContents`) for PDF, DOCX and text.
- There is no server-side URL download, so no SSRF surface.

## 11. App-side changes

- **Attribution (D15):** add an optional `via` field on `activityLog` (and on comments
  where shown): `{ kind: "mcp", clientId, clientName }`. The UI renders a muted
  "via <clientName>" next to the actor. `clientName` comes from the Clerk OAuth
  application name for `client_id`.
- **External refs (D21):** a new `taskExternalRefs` table (orgId, ref, taskId, createdAt)
  with indexes `by_orgId_ref` (unique lookup) and `by_taskId`. `fetch` shows a task's
  refs. The drawer may list them later; that is not V1.
- **Client prefix uniqueness (§7):** saving a client with a prefix another client
  already uses is refused, in the UI as well as through MCP.
- **Connected apps (D17):** a Settings section listing the user's OAuth grants (Clerk
  Backend API): client, connected-at and last-used, with Revoke. Last-used is stamped
  by `getMcpAuthContext`, throttled to once per hour per client.
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
  - the MCP Inspector against a preview deployment;
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
| 4 | `save_time_entries`, `timer` | Log and fix time; the timer shows in the app |
| 5 | `report` (all kinds in §8, including `missing_time` and the extended `client_monthly`) | Numbers match the app screens exactly |
| 6 | `billing_preview` / `billing_commit` (all actions) | Close a month and generate an invoice from Claude; a stale token is refused |
| 7 | `save_clients`, `save_projects`, `save_plan`, `save_daily_notes`, `fetch("inbox")` + `mark_read`, files | Each has an example prompt that passes end to end |
| 8 | Settings → Connected apps, help page, final review | Revoke works; docs are done; the full checks pass |

## 15. Spikes and open facts (resolve in slice 1)

- **S1:** Can Convex verify a Clerk OAuth access token directly? Check:
  - a `customJwt` provider with `issuer`/`jwks`;
  - whether the token has a usable `aud` and `kid`;
  - whether a `typ: at+jwt` header is accepted.

  If not, use §5.4.
- **S2:** Version compatibility of `@clerk/mcp-tools` 0.7.x with `mcp-handler`. Clerk's
  example pins `mcp-handler` 1.x / SDK v1, while `mcp-handler` 2.x needs the v2 SDK.
  Stay on the combination Clerk's example uses.
- **S3:** Can the OAuth access-token lifetime be shortened in Clerk (for example to
  1 h), and does Clerk rotate refresh tokens for public clients?
- **S4:** Does the Clerk Backend API list and revoke a user's OAuth grants per client
  (for Connected apps)? If not, list from our own last-used stamps and revoke through
  the API that exists.
- **S5:** Can claude.ai web upload a file to a URL a tool returns? Expected: no, so only
  inline text works there, which is acceptable for V1.

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
