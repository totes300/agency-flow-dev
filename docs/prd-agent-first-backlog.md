# PRD: Agent-first backlog — webhooks, full-text search, deletion audit, upload docs

> **Status:** Approved for build by the owner (Adam) on 2026-10-25, after the MCP production
> review and the first week of real agent use (the owner's "Grok Bot", a project-manager
> agent that drives Agency Flow headlessly through the MCP).
> **Builds on:** `docs/prd-mcp.md` (the MCP server, decisions D1–D29 and the "Decisions
> after D29" table), `docs/reviews/mcp-review-2026-10-25.md` (what was just hardened and
> the known follow-ups), `docs/runbooks/mcp-deployment.md` (how production is deployed).
> **Language:** code, commits and docs in English; talk to the owner in Hungarian.

This document is self-contained: a fresh session can build from it without the history
behind it. Read §1 (context) and §2 (house rules) before touching code.

---

## 1. Context a builder must know

### 1.1 What Agency Flow is, and how agents use it

Agency Flow is a multi-tenant B2B SaaS for agencies: clients → projects → tasks, time
entries and a timer, planner, comments, inbox, monthly billing (period close, retainers,
invoices). Next.js 16 (App Router) + Convex 1.34 + Clerk 7.9 + TypeScript + shadcn/ui.
Clerk Organization = tenant.

Since 2026-10-25 it has a **remote MCP server** in production at
`https://flow.konverted.io/mcp` (18 tools: `search`, `fetch`, `report`, `save_tasks`,
`save_comments`, `save_time_entries`, `timer`, `save_clients`, `save_projects`,
`save_plan`, `save_daily_notes`, `mark_read`, `delete`, `create_upload`, `attach_file`,
`invite_members`, `billing_preview`, `billing_commit`). External agents (Claude, Codex,
the owner's Grok Bot) operate the app through it as the signed-in user, with that user's
role. Humans use the web app. Both write the same tables through the same Convex cores.

The agent-first workflow this backlog serves: work arrives by email or phone; the agent
creates and assigns tasks (one Gmail thread = one task, `externalRefs: ["gmail:<id>"]`),
humans do the work and move statuses in the app, the agent follows up, reports and runs
billing. **The agent already has Gmail through its own connector**: email never enters
Agency Flow (owner decision, PRD §2 non-goals). What the agent still lacks is (a) being
woken up when a human changes something, (b) finding old decisions by text, (c) a trace
of deletions, and (d) confidence about uploads.

### 1.2 Repository map (what you will touch)

| Area | Files |
|---|---|
| Schema | `convex/schema.ts` (tables, indexes; one existing `searchIndex` on `tasks.title` named `search_title`, filter fields `orgId`, `statusCategory`) |
| Activity log | `convex/activityLog.ts` — **`logActivity(ctx, args)` is the single writer** of `activityLog` rows (called from `convex/tasks/write.ts`, `convex/comments.ts`, `convex/timeEntries.ts`, `convex/lib/timerEntry.ts`). Rows: `activityLogValidator` in `convex/tasks/model.ts` (`taskId`, `orgId`, `userId`, `type`, `metadata`, `createdAt`, optional `via: { kind: "mcp", clientId, clientName }`). Indexes `by_task`, `by_org`, `by_org_type`. |
| Changes feed (MCP) | `convex/lib/mcpChanges.ts` (reads `activityLog.by_org` with a keyset cursor, `exclude_self`), rendered by `renderChanges` in `lib/mcp/render.ts` |
| Search (MCP) | `convex/lib/mcpSearch.ts` (per type: tasks via `convex/tasks/lookup.ts` `findTaskDocsForAuth`, comments via `activityLog.by_org_type` `comment_added`, time entries, projects, clients, members, invoices, daily notes), `convex/mcp/search.ts` (entry points), `lib/mcp/registry.ts` `searchInput` / `SEARCH_FILTERS` / `searchRunner`, `lib/mcp/cursor.ts` |
| Task access | `convex/tasks/access.ts` (`loadTaskForReadOrNull`, `filterReadableTasks`: a member reads a task iff they have an assignee edge on it or its parent; admins read everything) |
| Attachments | `attachments` (task files) and `commentAttachments` tables; extracted text in `attachmentContents` (`orgId`, `storageId`, `status`, `text` ≤ 50,000 chars); extraction in `convex/attachmentContents.ts` + `convex/attachmentExtraction.ts` (Node action: PDF via unpdf, DOCX via mammoth, text) |
| MCP files | `convex/lib/mcpFiles.ts` (`create_upload`: 10 MB cap = `MAX_FILE_SIZE` in `lib/attachment.ts`, blocked MIME list in `convex/lib/content_validation.ts`), `convex/mcpFileUploads.ts` + `convex/http.ts` (`POST /mcp-upload?u=<uploadId>`) |
| MCP tool surface | `lib/mcp/registry.ts` (single source of truth: zod schema, annotations, description, Convex function, renderer per tool), `lib/mcp/advertise.ts` (compact `tools/list`), `lib/mcp/instructions.ts` (server instructions), `lib/mcp/limits.ts` |
| MCP auth | `convex/lib/mcpAuth.ts` `getMcpAuthContext` (every `convex/mcp/*` function calls it first), `convex/lib/auth.ts` (`getAuthContext` for app sessions, `assertAdmin`) |
| Settings UI | `app/(dashboard)/settings/page.tsx` (tabs: General, Team, Statuses, …; admin route), `components/settings/*` |
| Connected apps | `/connected-apps` page and `mcpConnections` table (`clientId`, `clientName` per org + user + OAuth client) — the source of "which agent" for `exclude_self` |
| Crons | `convex/crons.ts` (hourly cleanups) |
| Tests | Vitest; Convex tests with `convex-test` under `convex/__tests__/` (fixtures in `helpers/`), MCP unit tests under `lib/mcp/__tests__/` (tools/list snapshot in `__snapshots__/tools-list.json`, bound `TOOLS_LIST_MAX_CHARS` in `tools-list.test.ts`), invariants scan `convex/__tests__/mcpInvariants.test.ts`, read-budget test `convex/__tests__/mcpBudgets.test.ts` |

### 1.3 Facts that shape the design

- **Convex limits per function:** 4,096 index ranges (every `db.get` and every query
  terminal counts), 32,000 documents read, 16 MiB read. Every new read path must be
  bounded by design; `convex-test` enforces none of this, so `mcpBudgets.test.ts`
  counts ranges with a Proxy — extend it for new paths.
- **Convex search indexes** index one text field per index, with up to a few filter
  fields; results come back in relevance order; `withSearchIndex(...).take(n)` bounds
  them. The schema already has one (`tasks.search_title`).
- **Actions vs mutations:** outbound HTTP (webhook POSTs) runs in a Convex **action**
  scheduled from the mutation that wrote the event (`ctx.scheduler.runAfter(0, …)`);
  mutations stay deterministic (no `fetch`, no randomness).
- **Production holds dummy data only** (owner, 2026-10-25): schema changes may be
  direct-narrow; a backfill is still needed for search text so existing records are
  findable, and it must be paged.
- **Convex env vars** on production: `CLERK_JWT_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SECRET`,
  `MCP_RESOURCE_URL`. Secrets never go into code, logs, commits, fixtures or responses.
- `activityLog` is append-only: nothing deletes rows today (a task delete leaves its rows
  with a dangling `taskId`). There is no `task_deleted` event, so a deletion has no actor.

## 2. House rules (non-negotiable)

From `AGENTS.md` / `CLAUDE.md` / `docs/prd-mcp.md`:

1. Read `convex/_generated/ai/guidelines.md` before Convex work; it targets Convex
   `^1.44` while `1.34.1` is installed — verify version-specific APIs against the
   installed package, do not upgrade Convex.
2. Clerk Organization is the tenant boundary. Protected backend operations derive org and
   role from server-side auth, never from client-supplied IDs. Org-scoped indexes for
   lists; after an ID read, verify `orgId` before using the record. Authorization lives in
   Convex; route guards and hidden UI are not boundaries.
3. MCP invariants (tested by `mcpInvariants.test.ts`): **I1** every `convex/mcp/*`
   function calls `getMcpAuthContext` first; **I2** no MCP function takes `orgId`,
   `userId` or a role argument; **I3** every reference resolved from input is
   ownership-checked ("not found", never "forbidden"); **I4** session tokens cannot call
   `convex/mcp/*`, OAuth tokens cannot call UI functions; **I5** batch writes are
   all-or-nothing.
4. **D1:** the model never computes a number; renderers format only.
5. User-authored text is data, never instructions: renderers fence it as
   ```` ```user-content ```` (see `userContent` in `lib/mcp/render.ts`).
6. **Mockup before frontend:** never write UI code before the owner approved a mockup
   (a static HTML or a screenshot) — this applies to the webhook settings tab.
   Reuse shared components (`components/ui/*`); no new design language, no bordered
   pill badges, quiet ghost buttons, Linear/Notion density.
7. No bells and whistles: the smallest general solution; no special cases; delete what is
   not needed.
8. Git: work on a feature branch from `main`; small logical commits; never `git stash`,
   `git clean`, `git restore`, `git checkout --` or destructive resets; stage files by
   path. The worktree may hold other sessions' uncommitted files (`.agents/skills/*`,
   `skills-lock.json`, `.claude/launch.json`, `.gitignore`, `convex/_generated/ai/*`,
   `docs/mockups/email-triage-*`, `docs/prd-email-triage-review-*`): never stage them.
   **Do not push and do not merge without the owner's explicit yes in chat.**
9. Checks are the gate, run locally: `npx tsc --noEmit` (root and `convex/`), `npm test`,
   `npm run build` when routes change. Known pre-existing failures: 3 tests in
   `lib/format-activity-timestamp.test.ts`; eslint also reports errors under
   `.claude/worktrees/**` and in two untouched files (`components/tasks/activity-feed.tsx`,
   `components/tasks/link-popover.tsx`) — not yours. Do not add new failures.
10. **Shared dev Convex deployment:** before `npx convex dev --once`, make sure your branch
    contains the latest `main`; other sessions may push to the same deployment.
    Production commands (`--prod`, Vercel, Clerk) run only after the owner's yes; the
    Vercel build deploys Convex production on merge to `main`.
11. Tool descriptions and server instructions are written for the model: say when to use
    the tool, what a reference looks like, one example; no tenant data. Keep `tools/list`
    under its test bound; raise the bound only by what a new tool genuinely needs.

## 3. Scope and priorities

| # | Item | Priority | Effort | Kind |
|---|---|---|---|---|
| A | Upload documentation + live check | P0 | S | description text + verification |
| B | Outbound webhooks (V1) | P0 | M | backend + admin UI (mockup first) |
| C | Full-text search across tasks, comments, attachment text | P1 | M | backend + MCP |
| D | Deletion audit: `task_deleted` activity | P2 | S | backend + renderer |
| E | Agent recipes (no code): inbound email → task, stale/overdue routine, webhook wake-up | — | S | docs for the agent's prompt |

**Explicit non-goals (owner):** inbound email ingestion in the app; an in-app reply
composer or reply metadata on tasks; a rules engine for stale/due reminders (the agent's
own routine does it, see E); full before/after audit of every field; multiple webhook
endpoints per org, delivery dashboards, or `due_soon` / `task_stale` events in webhook V1.

Build order: A → B → C → D (E is written alongside A). Each item is its own slice with its
own commits and its own review; B's UI waits for the mockup gate.

---

## 4. Item A — Upload documentation and live check (P0, S)

**Problem.** `create_upload` + `attach_file` work (PDF, images, DOCX, MD, CSV; 10 MB;
`attachment_text` for PDF/DOCX/text; `idempotencyKey` on `attach_file`), but the tool
descriptions do not state the limits or the accepted types, so the agent hesitates.

**Change.**
1. `lib/mcp/registry.ts`, `create_upload` description: add one sentence — `Up to 10 MB;
   PDF, images (PNG, JPEG, WebP, GIF), Word .docx, text, .md, .csv; HTML, scripts and
   executables are refused.` Keep the existing "claude.ai on the web cannot POST: use
   inlineText" sentence. Update the tools/list snapshot deliberately.
2. Verify the blocked list in `convex/lib/content_validation.ts` matches the sentence
   (today: `text/html`, JavaScript types, `application/xhtml+xml`, executables).
3. Live check on dev with a headless agent run (see §9.3): a PNG and a PDF from disk via
   `create_upload` → `curl -X POST --data-binary` → `attach_file`; then `fetch` with
   `include: ["files", "attachment_text"]` shows both; a second `attach_file` with the same
   `idempotencyKey` replays and attaches nothing new. Delete the test files afterwards.

**Done when:** the description sentence is in the snapshot and the live check passed
(record the run in the slice's commit message or review note).

---

## 5. Item B — Outbound webhooks V1 (P0, M)

### 5.1 Why

A human moves a task from In progress to Done in the app; the agent should wake up within
seconds and continue (comment, notify the client, start the next step), instead of
polling `fetch("changes")` on a schedule. The owner's agent runtime can receive an HTTPS
POST as a trigger. `docs/prd-mcp.md` listed webhooks as V2 next to the changes feed
(D22); the owner pulls them forward on 2026-10-25. The changes feed stays the
catch-up path; a webhook is a signal, not a second source of truth.

### 5.2 Decisions (owner, 2026-10-25 — do not reopen without evidence)

| # | Decision |
|---|---|
| W1 | **One endpoint per organization** in V1 (the table allows more; the UI shows one). Admins manage it under Settings → Webhooks. |
| W2 | **Events = `activityLog` rows.** Every type in `activityLogValidator` is deliverable; the endpoint has an event-type filter (default: all). No synthetic events (`due_soon`, `task_stale`) in V1. |
| W3 | **Payload is short:** the event, when, who, the task ref and link, and the change's minimal metadata (e.g. status from → to, comment id). Detail is fetched with the MCP `fetch(ref)`; the payload never carries task bodies, comment text or file contents. |
| W4 | **Signed:** HMAC-SHA256 over `"<timestamp>.<raw body>"` with a per-endpoint secret, sent as `X-AgencyFlow-Signature: t=<unix seconds>,v1=<hex>`, plus `X-AgencyFlow-Event: <type>` and `X-AgencyFlow-Delivery: <delivery id>` headers. The secret is generated server-side (32 random bytes, base64url), shown **once** at creation, rotatable. |
| W5 | **`exclude_self` per endpoint:** an optional list of OAuth client ids (chosen from the org's Connected apps) whose own writes are not delivered, so the agent is not woken by what it just wrote. Default empty. |
| W6 | **Delivery:** at-least-once; 10 s request timeout; retries after 30 s, 5 min, 30 min (3 retries), then marked failed. Deliveries are logged for 7 days and the endpoint shows its last delivery state; no dead-letter UI in V1. |
| W7 | **SSRF guard:** the URL must be `https://`, must not be an IP literal, `localhost`, `*.localhost`, `*.internal`, or the app's own origin. Residual risk (DNS to a private address) is accepted for V1 and noted in the PRD. |
| W8 | A failing endpoint never affects the write that produced the event: delivery is scheduled, never awaited, and errors are swallowed into the delivery log. |

### 5.3 Data model (`convex/schema.ts`)

```ts
webhookEndpoints: defineTable({
  orgId: v.string(),
  url: v.string(),
  secret: v.string(),                 // base64url, 32 random bytes; never returned after creation
  secretHint: v.string(),             // last 4 chars, for the UI
  eventTypes: v.optional(v.array(v.string())), // undefined = all activity types
  excludeClientIds: v.array(v.string()),       // W5
  enabled: v.boolean(),
  createdBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
  lastDeliveryAt: v.optional(v.number()),
  lastDeliveryStatus: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
  lastDeliveryHttpStatus: v.optional(v.number()),
}).index("by_orgId", ["orgId"]),

webhookDeliveries: defineTable({
  orgId: v.string(),
  endpointId: v.id("webhookEndpoints"),
  activityId: v.id("activityLog"),
  attempt: v.number(),                // 1..4
  status: v.union(v.literal("pending"), v.literal("ok"), v.literal("failed")),
  httpStatus: v.optional(v.number()),
  error: v.optional(v.string()),      // short, no response bodies
  createdAt: v.number(),
  nextAttemptAt: v.optional(v.number()),
})
  .index("by_endpointId_createdAt", ["endpointId", "createdAt"])
  .index("by_createdAt", ["createdAt"]),
```

### 5.4 Backend

- **Hook point:** `logActivity` in `convex/activityLog.ts` is the one writer. After the
  insert, call `scheduleWebhookDeliveries(ctx, { orgId, activityId, via })` (new module
  `convex/webhooks.ts`): read `webhookEndpoints.by_orgId` (one bounded range), skip
  disabled endpoints, endpoints whose `eventTypes` exclude this type, and endpoints whose
  `excludeClientIds` contain `via?.clientId`; for each remaining endpoint insert a
  `webhookDeliveries` row (`attempt: 1, status: "pending"`) and
  `ctx.scheduler.runAfter(0, internal.webhooks.deliver, { deliveryId })`. This adds at
  most one indexed range plus one insert per endpoint to every activity write — budget
  it in `mcpBudgets.test.ts` (a 25-task `save_tasks` batch creates ~25–50 events).
- **`deliver` (internal action, Node not required):** load the delivery, endpoint and
  activity row (internal query); build the payload (§5.5); sign (Web Crypto
  `crypto.subtle` HMAC-SHA256); `fetch(url, { method: "POST", headers, body, signal:
  AbortSignal.timeout(10_000) })`. 2xx → mark `ok`, stamp the endpoint's last delivery.
  Otherwise mark `failed` with `httpStatus`/short `error` and, if `attempt < 4`, insert
  the next attempt row and `runAfter(delay, deliver)` with 30 s / 5 min / 30 min. Never
  log the URL's query string, the secret or response bodies; log one line
  `[webhook] delivery <id> attempt <n> <status>`.
- **Cleanup cron** (`convex/crons.ts`, hourly): delete `webhookDeliveries` older than
  7 days via `by_createdAt`, paged like the existing MCP cleanups (batch + scheduler
  continuation).
- **Admin functions** (`convex/webhooks.ts`, app session auth via `getAuthContext` +
  `assertAdmin`, I4 keeps OAuth tokens out): `get` (the org's endpoint without the
  secret), `create` (URL validation per W7, secret generated in an **action** that then
  calls an internal mutation — mutations must not use randomness; returns the secret
  once), `update` (url, eventTypes, excludeClientIds, enabled; a URL change re-validates),
  `rotateSecret` (action → internal mutation; returns the new secret once), `remove`,
  `sendTest` (action: delivers a synthetic `{ event: "test" }` payload signed the same
  way, records a delivery row with `activityId` absent — make `activityId` optional or
  use a separate marker; choose the smaller change and say which), `recentDeliveries`
  (last 20 by `by_endpointId_createdAt`).
- **No MCP tool in V1.** Agents do not configure webhooks; the admin does, in the app.

### 5.5 Payload

```json
{
  "id": "<webhookDeliveries id>",
  "event": "status_changed",
  "at": "2026-10-25T17:03:11.000Z",
  "org": "org_…",
  "actor": { "name": "Csaba Kovács", "email": "csaba@konverted.io" },
  "via": { "clientId": "…", "clientName": "claude.ai" },
  "task": { "ref": "ARLO-21", "link": "https://flow.konverted.io/tasks/ARLO-21", "project": "ARLO", "client": "client:ARLO" },
  "change": { "from": "In progress", "to": "Done" }
}
```

- `via` is present only for writes made through MCP; `change` carries the row's
  `metadata` reduced to short scalar fields (status names, assignee email, comment id,
  minutes); never comment text or descriptions.
- `task.ref` is the identifier (or the task id when none), `link` the app deep link
  (reuse `taskLink` in `lib/mcp/links.ts` — the origin is the resource URL's origin; in
  Convex use `process.env.MCP_RESOURCE_URL`'s origin, already required by
  `auth.config.ts`).
- Headers: `Content-Type: application/json`, `User-Agent: AgencyFlow-Webhooks/1`,
  `X-AgencyFlow-Event`, `X-AgencyFlow-Delivery`, `X-AgencyFlow-Signature` (W4).
- Receivers verify: recompute HMAC over `"<t>.<body>"`, constant-time compare, reject if
  `|now − t| > 300 s`, dedupe on `id`.

### 5.6 Admin UI — Settings → Webhooks (mockup gate first)

Produce a static mockup (HTML in `docs/mockups/` or a screenshot) and get the owner's
yes before writing components. Content (not design): endpoint URL field; event types
multi-select (default all; group by family: task, status, assignee, comment, time);
"Don't notify for writes by" multi-select listing the org's Connected apps client names
(from `mcpConnections`; show client name + id when names collide); enabled switch;
"Send test event" button; secret shown once in a copyable field after Create / Rotate;
a quiet list of the last 20 deliveries (time, event, status, HTTP code). Admin-only tab in
`app/(dashboard)/settings/page.tsx`. Shared components only.

### 5.7 Tests

- `convex/__tests__/webhooks.test.ts` (convex-test): an activity write schedules exactly
  one delivery per enabled, matching endpoint; type filter and `excludeClientIds` skip;
  disabled endpoint skips; payload shape (no text fields); signature matches an
  independent HMAC in the test; retry schedule (attempt rows and delays) on a failing
  `fetch` (mock `globalThis.fetch`); success stamps the endpoint; URL validation refuses
  `http://`, IP literals, `localhost`, the app origin; secret never returned by `get`;
  member cannot read or change endpoints; an OAuth identity cannot call the admin
  functions (I4); cleanup removes rows older than 7 days and nothing newer.
- `mcpBudgets.test.ts`: a 25-item `save_tasks` with one endpoint stays under the budget
  (count the added ranges and lock with headroom).
- `mcpInvariants.test.ts` must stay green (the new module is not under `convex/mcp/`, so
  it is an app module: `getAuthContext`, not `getMcpAuthContext`).

### 5.8 Docs

- `docs/prd-mcp.md`: add `D-WEBHOOK` to "Decisions after D29" (pulled forward from V2;
  W1–W8 in one sentence each or a pointer here); amend D22's "Webhooks are V2".
- `docs/runbooks/mcp-deployment.md`: a "Webhooks" section — the new tables and cron, how
  to read delivery failures (Convex logs filter `[webhook]`), and that the receiver must
  verify the signature.
- `docs/security/tenancy.md`: webhooks are per org, admin-managed, signed; payloads
  carry refs and names, never bodies.

**Done when:** on dev, an admin creates the endpoint pointing at a local receiver
(`npx` a one-file HTTPS receiver or a request bin that supports HTTPS), moves a task's
status in the app, and the signed POST arrives within 3 s with the payload above; a
`save_tasks` write through the MCP by the excluded client does not arrive; a failing URL
produces the retry rows and the "failed" state; the admin UI matches the approved mockup.

---

## 6. Item C — Full-text search (P1, M)

### 6.1 Why

Today `search.query` is a case-insensitive substring over titles, names, codes, comment
text, time-entry notes and daily notes. It does not see task descriptions or attachment
text, and it has no relevance ranking, so "find the task where the client approved the
logo" fails. Finding an old decision is a daily PM need for the agent.

### 6.2 Decisions

| # | Decision |
|---|---|
| S1 | Convex search indexes, one per text source: tasks (title + description plain text), comments (plain text), attachment text (`attachmentContents.text`). Org is a filter field on each. |
| S2 | `query` matches any of the sources; results stay grouped by the existing `types` (a hit in a comment is a `comment` row; a hit in an attachment's text is reported on its **task** as a task row with a one-line `· matched in file "<name>"` marker). Existing filters still apply, AND-ed, after the search. |
| S3 | With a `query`, task rows come in **search relevance order**; without one, the current recent-activity order stays. The cursor stays an opaque offset over this order (same `lib/mcp/cursor.ts`); the known offset-cursor limitation (`docs/reviews/mcp-review-2026-10-25.md`, CVX-3) is unchanged. |
| S4 | Members see only what they can read today (`filterReadableTasks`); the search index is queried org-wide and filtered afterwards with the existing access rules. |
| S5 | Search text is denormalized at write time and backfilled once; it is capped so a document stays well under 1 MiB. |

### 6.3 Schema and writes

- `tasks.searchText: v.optional(v.string())` — `title + "\n" + plainText(description)`,
  capped at 8,000 chars; maintained in `createTask` / `updateTask` (`convex/tasks/write.ts`)
  wherever title or description change; use the existing `extractPlainText`
  (`lib/tiptap-utils.ts`). New index: `.searchIndex("search_text", { searchField:
  "searchText", filterFields: ["orgId", "projectId", "statusCategory"] })`. Keep
  `search_title` until the UI's own title search (`convex/tasks/queries.ts:238`,
  `tasks/lookup.ts:277`) is switched to `search_text` (do it in the same slice if it is a
  one-line change and the tests pass; otherwise leave `search_title` and say so).
- `comments.searchText: v.optional(v.string())` — plain text, capped 8,000; maintained in
  `convex/comments.ts` create/edit. Index `search_text` with `filterFields: ["orgId",
  "taskId"]`.
- `attachmentContents`: index `search_text` on the existing `text` field with
  `filterFields: ["orgId"]` (text is already capped at 50,000; Convex indexes the field
  as is — confirm the per-document limit holds, else cap a new `searchText` copy).
  `attachmentContents` has no task link: join through `attachments.fileId` /
  `commentAttachments.fileId` = `storageId` (add `by_fileId` indexes if missing; check
  schema).
- **Backfill:** `internal.search.backfillSearchText` (paged mutation, 200 docs per run,
  scheduler continuation; idempotent — skips docs that already have `searchText`),
  started once per deployment with `npx convex run` (dev yourself; prod only after the
  owner's yes, recorded in the runbook).

### 6.4 MCP search behaviour (`convex/lib/mcpSearch.ts`, `lib/mcp/registry.ts`)

- Task search with `query`: `withSearchIndex("search_text", q => q.search("searchText",
  query).eq("orgId", orgId))` `.take(SEARCH_HIT_CAP)` (e.g. 200), then the existing
  filter pipeline (status, assignee, mine, project, client, dates, external_ref…) and
  `filterReadableTasks`; plus attachment hits: `attachmentContents.search_text`
  `.take(100)` → their tasks (dedupe; a task already matched by text is not repeated;
  mark `matchedIn: "file <name>"`). Without `query` nothing changes.
- Comment search with `query`: `comments.search_text` `.take(cap)` instead of today's
  scan of `comment_added` activity rows; with a `task` filter keep today's per-task read.
- `incomplete: true` when a `.take` cap was hit, rendered as today ("more may exist").
- Description/help: `search.query` describe → `Full text over titles, descriptions,
  comments and attachment text (PDF, Word, text); results by relevance.` Snapshot update.
- Budget: count the ranges of a `query` search over tasks + attachments in
  `mcpBudgets.test.ts` and lock it.

### 6.5 Tests

- convex-test: a unique sentence in a description / in a comment / in an attachment's
  extracted text returns the task ref (and the comment row for the comment case); a
  member does not see hits on tasks they cannot read; filters AND with the query;
  `incomplete` set at the cap; backfill fills missing `searchText` and skips filled ones;
  updating a title or description updates `searchText`.
- `lib/mcp` tests: the `matched in file` marker renders; snapshot.

**Done when:** on dev, the agent finds a task by a phrase that occurs only in a PDF
attached to it, only in a comment, and only in the description; the UI's own task search
still works.

---

## 7. Item D — Deletion audit (P2, S)

### 7.1 Why

`activityLog` is append-only, but a task delete writes no event, so "who deleted ARLO-21
and when" cannot be answered in a dispute. Billing has its own `billingEvents`; roles
live in Clerk. The gap is deletions of tasks (with their sub-tasks and time entries).

### 7.2 Change

- New activity type `task_deleted` in `activityLogValidator` (`convex/tasks/model.ts`)
  with `metadata: { identifier, title (capped 200), projectCode?, subtaskCount,
  deletedTimeEntries: number }`. Written by `removeTask` (`convex/tasks/write.ts`) through
  `logActivity` **before** the records are deleted, with the deleted task's `taskId`
  (dangling afterwards — acceptable; the row is the record). `via` carries the agent
  attribution as for every write (D15). One row per deleted root task (not per child).
- Readers that join `activityLog.taskId` to a task must tolerate a missing task:
  `convex/lib/mcpChanges.ts` renders `task_deleted` from the metadata
  (`ARLO-21 · Adam · deleted task "Logo v2" (3 sub-tasks, 2 time entries) · via claude.ai`);
  `fetch("changes")` type filter accepts it; the task activity view in the app never
  sees it (the task is gone) — check `listTaskActivityForAuth` and the inbox code skip
  rows whose task is null without throwing.
- Scope note in the PRD: project and client deletions are refused unless nothing hangs
  off them (D-DELETEGUARD), so they are not audited in V1; comment deletions keep
  today's behaviour.

### 7.3 Tests

- convex-test: deleting a task (with a sub-task and a time entry, `deleteEntries: true`)
  writes exactly one `task_deleted` row with the metadata and `via`; the changes feed
  renders it; `fetch(ref)` of the deleted key says "not found" (unchanged); the inbox and
  task activity readers do not throw on the dangling row.
- Snapshot/renderer tests for the changes line.

**Done when:** after a `delete` through the MCP, `fetch("changes")` shows who deleted
what, and the row is still there 30 days later (nothing cleans `activityLog`).

---

## 8. Item E — Agent recipes (docs only)

Write `docs/agent-recipes.md` (English, terse, copy-pasteable into an agent's system
prompt) with three recipes. They use only existing tools; they are the alternative to
building email ingestion and a reminder engine in the app.

1. **Inbound email → task.** One thread = one task. Call `fetch("workspace")` once per
   session for exact statuses, members and project codes. For each thread:
   `save_tasks` with `externalRefs: ["gmail:<threadId>"]` (update-or-create, never search
   first), title from the subject, description from the latest message in markdown,
   assignee by email, due date from the request, project by code (omit `billingType`
   for a new project; set it later). Attach the source: `attach_file(ref, { inlineText:
   "<from/to/cc/subject/date + body>", filename: "source.md" })`; binary attachments via
   `create_upload` → POST → `attach_file(uploadId)`. Checklist items get their own refs
   (`gmail:<threadId>#1`). Skip noreply/newsletter senders by an allow/deny list in the
   agent's prompt. Use a fresh UUID as `idempotencyKey` per call; reuse it only to retry
   that exact call.
2. **Stale / overdue routine (daily).** `search` with `status: "Client review"` (and the
   other waiting statuses from the workspace) and `updated_to: <today − N days>`;
   `search` with `overdue: true`; `search` with `due_to: <tomorrow>`. For each hit:
   comment with an `@email` mention or message the assignee in the agent's own channel.
   Nothing is stored in the app beyond the comment.
3. **Webhook wake-up (after Item B).** On a `status_changed` or `comment_added` POST:
   verify the signature, dedupe on `id`, then `fetch(task.ref, include: ["comments",
   "subtasks"])` and act; fall back to `fetch("changes", { cursor })` on start-up or
   after any gap, so nothing is missed if a delivery failed.

---

## 9. Execution protocol

### 9.1 Branch, slices, commits

- Branch `agent-first` from the latest `main`. One slice per item (A, B-backend,
  B-UI after the mockup gate, C, D, E); small commits per slice with clear messages;
  end each commit message with the attribution line your harness specifies.
- Before each slice: re-read the item, record a short file/reuse/test plan, work
  test-first where it fits. After each slice: `npx tsc --noEmit` (root + `convex/`),
  touched tests, `npm test`, `npm run build` when a route or page changed; deploy to the
  shared dev deployment with `npx convex dev --once` only when your branch contains the
  latest `main`; run the slice's live check (§9.3); update `docs/prd-mcp.md`
  ("Decisions after D29" / §6 rows) and the runbook in the same slice.
- Keep a running status table at the end of this document (slice, commits, review,
  deviations), so the work can be resumed from it.

### 9.2 Owner gates (ask in Hungarian, short options, recommendation first)

1. Webhook settings UI mockup (before any component code).
2. Any deviation from W1–W8 / S1–S5 or a schema change beyond §5.3 / §6.3.
3. Backfill on production (Item C) and every other production command.
4. Push and merge of the branch (PR to `main`; the Vercel build deploys Convex
   production).

### 9.3 Dev environment and live checks

- Dev server: `npm run dev` (`next dev --experimental-https -p 3001`), MCP at
  `https://localhost:3001/mcp`. It is usually already running in the owner's terminal
  (check `lsof -nP -iTCP:3001 -sTCP:LISTEN` before starting another).
- Headless agent run (reuses the owner's stored OAuth token; if it is missing or
  expired, stop and ask — do not log in):
  ```bash
  cd /Users/tothadam/claude_code_projects/agency-flow-dev && \
  NODE_EXTRA_CA_CERTS="$HOME/Library/Application Support/mkcert/rootCA.pem" \
  claude -p "<task>" --allowedTools "mcp__agency-flow__*" \
    --disallowedTools Bash,Read,Grep,Glob,Edit,Write,WebFetch,WebSearch,Agent \
    --output-format json
  ```
  Run it **from the repository directory**: the `agency-flow` MCP is registered in the
  project-scoped Claude config (`--strict-mcp-config` from elsewhere finds no tools).
  Create throwaway data under a client with a `ZZ…` prefix and delete it at the end;
  prove the cleanup with searches.
- Dev data is dummy; production holds dummy data too, but production commands still
  need the owner's yes.

### 9.4 Definition of done (whole backlog)

- All four items' "Done when" checks passed on dev and are recorded in the status table.
- `npm test` green against the baseline (only the 3 known failures), tsc clean, build OK.
- `tools/list` size recorded before/after (the test prints it); within the bound.
- PRD, runbook and tenancy docs updated; `docs/agent-recipes.md` written.
- The owner has approved the push; after the merge, the production verification from the
  runbook plus: a real status change in the app reaches the owner's agent endpoint.

---

## 10. Status (fill in as you go)

| Slice | Status | Commits | Review | Notes / deviations |
|---|---|---|---|---|
| A upload docs + live check | **Done** 2026-10-25 | see git log `feat(mcp): state upload limits` | self-review; tsc root + convex clean, `npm test` 2141 pass / 3 known | tools/list 27,312 → 27,400 chars (bound 28,000). Blocked list matches the sentence (no change). Live check on dev (headless `claude -p`, 3 runs): ZZUP-1 under client:ZZUP; PNG (75 B) + PDF (605 B) via create_upload → curl 200 → attach_file; fetch files + attachment_text showed both and the PDF text; second attach_file with the same idempotencyKey "Replayed", still 2 files; task, project, client deleted, searches empty, fetch ZZUP-1 not found. Observed: attaching does not move "Last activity" (no activity row for attachments, D15 — by design). No Convex change, so no dev deploy |
| B webhooks backend | not started | | | |
| B webhooks UI (after mockup) | not started | | | |
| C full-text search | not started | | | |
| D deletion audit | not started | | | |
| E agent recipes | **Done** 2026-10-25 | with A | self-review against the registry (field names, filters, includes) | `docs/agent-recipes.md`; recipe 3 marked "available once webhooks are enabled" until B ships |
