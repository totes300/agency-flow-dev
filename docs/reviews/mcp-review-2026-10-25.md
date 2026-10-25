# MCP production-readiness review — 2026-10-25

Lead reviewer: Claude (orchestrator). Owner: Adam.

## Scope

- Branch `mcp` → `main`, PR #17. Review start commit: `9f37185` (merge-base with
  `origin/main`: `1d300e3`).
- In scope: the MCP server (`lib/mcp`, `convex/mcp`, `convex/lib/mcp*`,
  `app/mcp`, `.well-known`, `proxy.ts`, `convex/auth.config.ts`,
  `convex/lib/auth.ts`, `convex/lib/mcpAuth.ts`, supporting tables, Connected apps,
  the MCP tests, `docs/prd-mcp.md`, `docs/runbooks/mcp-deployment.md`).
- Billing hub / project page redesign: only where the MCP depends on it (plan + apply).
- Out of scope: the Linear-style restyle of lists; UI styling anywhere.
- Related branch `claude/admiring-spence-7ce03f` (`4dd2b0b`): read, not merged.

## Goals the review judges against

1. Efficiency (tokens per task, round trips).
2. Production readiness (security, tenancy, correctness, Convex limits, deploy,
   rollback).
3. Documentation (PRD = code, executable runbook, agent-facing docs).
4. Usability for a real agent.

Locked owner decisions D1–D29 are not reopened without evidence of a security hole,
data loss, a broken deploy or a clear failure of one of the four goals.

## Baseline (before any fix)

Recorded at `9f37185` before any fix:

| Check | Result |
|---|---|
| `npx tsc --noEmit` (root) | clean |
| `npx tsc --noEmit` (convex/) | clean |
| `npm run lint` | 0 errors in the repository proper; 3,932 errors reported, all inside `.claude/worktrees/**` (eslint does not ignore agent worktrees — pre-existing, not MCP) |
| `npm test` | 130 files, 2,077 passed, 3 failed — the known `lib/format-activity-timestamp.test.ts` failures |
| `npm run build` | OK |
| `tools/list` size (from the slice-8 snapshot) | ~27.9k characters |

## Team

| # | Lens | Status |
|---|---|---|
| 1 | MCP design & token efficiency (DESIGN) | spawned |
| 2 | Staff engineer: architecture & maintainability (ARCH) | spawned |
| 3 | Security & multi-tenancy (SEC) | spawned |
| 4 | Convex correctness & performance (CVX) | spawned |
| 5 | Domain & billing correctness (DOM) | spawned |
| 6 | Agent dogfooder (DOG) | spawned |
| 7 | Docs & operations readiness (DOCS) | spawned |
| — | Orchestrator's own pass: auth + write-path ownership | done, see below |

### Orchestrator's own pass (auth and write-path ownership)

Read: `convex/lib/mcpAuth.ts`, `convex/lib/auth.ts`, `convex/auth.config.ts`,
`app/mcp/route.ts`, `lib/mcp/handler.ts`, `lib/mcp/config.ts`,
`convex/mcp/connections.ts`, `convex/lib/mcpConnections.ts`, `convex/lib/mcpRefs.ts`,
`convex/lib/mcpWrites.ts`, `convex/mcp/write.ts`, plus every raw `ctx.db.get` /
`normalizeId` site in `convex/lib/mcp*.ts` outside the resolver.

- `getMcpAuthContext`: kill switch → identity → `client_id` discriminator → `org_id`
  → `users.byExternalId` → `orgMembers` (role only from there) → `mcpConnections`
  status, fail-closed on missing/revoked. Actions go through the internal query.
  `getSessionIdentity` returns null for any identity carrying `client_id`, so the UI
  side of I4 holds for every caller of `getAuthContext*`.
- Route: Clerk `authenticateRequest(acceptsToken: "oauth_token", audience)`, then
  `touch` is awaited before the first handled request; a `ConvexError` from `touch`
  is swallowed and the tool call is refused by Convex itself.
- Resolver (`mcpRefs.ts`): every `byId` branch checks `orgId` and the type's access
  rule (task read access, member-visible time entries, admin-only invoices, own/admin
  daily notes); other-org and unreadable records are "not found".
- Raw-ID sites outside the resolver all re-check: inbox notification (`orgId` +
  `recipientId`), file delete (`orgId` + task read access), billing invoice
  (`orgId`), billing commit token (`orgId` + `userId` + `clientId`, replay before
  expiry, fingerprint recomputed).
- Idempotency: key scoped by org + user index, bound to the SHA-256 request
  fingerprint; a different request with the same key is refused.

No blocker found in this pass; items the specialists raise are judged below.

## Findings, verdicts and triage

Seven specialists returned 73 findings (0 blockers, 13 majors). Deduped groups:
PRD §9 token (DOCS-2 = SEC-6 = DOM-2), route throttle (CVX-5 = ARCH-1), error handling
(DOG-1 + DESIGN-7 + ARCH-2), serial search (CVX-10 = ARCH-12), PRD drift
(DOCS-1/3/4/5/6/7/8/13, DESIGN-13, ARCH-8). Full texts: the reviewers' reports are kept
in the orchestrator's scratch (`findings/*.md`); the table below is the record.

Verdicts: CONFIRMED = reproduced or clearly true from the code; PLAUSIBLE = likely, not
reproduced; REJECTED = contradicted by the code. Decisions: NOW = fixed in this review;
LATER = follow-up; WONT = not worth it or locked.

### Majors

| id | claim | verdict | decision | effort |
|---|---|---|---|---|
| SEC-1 | App UI `attachments.save` / `commentAttachments.save` accept any `_storage` id (fix exists on `claude/admiring-spence-7ce03f` 4dd2b0b, not on `mcp`) | CONFIRMED (convex/attachments.ts:215) | OWNER: merge 4dd2b0b | S |
| CVX-1 | Org-wide comment search scans the newest 500 `activityLog` rows of any type → blind in a busy org | CONFIRMED (mcpSearch.ts:636, schema by_org only) | NOW (index `by_org_type`) | S |
| CVX-2 | `delete` of 25 tasks re-reads every org member per task; 25×(29+M) ranges > 4,096 at M ≥ 135 | CONFIRMED (tasks/write.ts:1191) | NOW (`users.by_timerTaskId`, one range per task) | S |
| CVX-3 | Offset cursors over a `lastActivityAt` sort duplicate/skip rows when a write lands between pages | CONFIRMED (cursor.ts, mcpSearch.ts:114) | LATER (keyset cursor; rare in agent use, pages > 1 were never requested in 21 dogfood runs) | M |
| DESIGN-1 | Changes feed repeats `[KEY](link) · title` on every line (60 % of each line; D22's own example carries neither) | CONFIRMED (render.ts:1110) | NOW (−47 %) | S |
| DESIGN-2 | Report rows repeat the project link per row (close_queue 43–54 % of each row) | CONFIRMED (report-render.ts:636) | NOW (legend once per report, −39 %) | S |
| DESIGN-3 | 60k-char budget may exceed Claude Code's 25k-token cap on Hungarian + ID-heavy output | PLAUSIBLE (no tokenizer; Claude Code's own cap check may be chars/4) | LATER (measure with a real tokenizer first) | S/M |
| DOG-1 | A transient non-Convex failure in a multi-ref fetch reaches the model as bare "Internal error." | CONFIRMED (message, registry.ts:225); cause PLAUSIBLE (dev log not reachable) | NOW (wrap execute, retry reads once, actionable text + log ref id) | S |
| DOG-2 | `external_ref` is single-valued and exact; a 25-email triage costs 25 probing searches | CONFIRMED (registry.ts:298) | NOW (array, OR; "no need to search first") | S |
| DOCS-1 | PRD §6 lists pre-build billing actions | CONFIRMED | NOW (docs slice) | S |
| DOCS-2 | PRD §9 describes a signed token; built: stored row id bound to org+user+client | CONFIRMED | NOW | S |
| DOCS-3 | PRD says the client gets a `storageId`; built: `uploadId` | CONFIRMED | NOW | S |
| DOCS-9 | Rollback: non-empty new tables would block a pre-MCP schema push | REJECTED — Convex validates only the tables listed in the schema (convex schema.d.ts:390); absent tables are allowed. The "fix forward" advice (DOCS-10) is kept | — | — |

### Minors and nits (decisions)

NOW: CVX-4 (member search redundant edge checks), CVX-5/ARCH-1 (route throttle forgets
refused stamps), CVX-8 (range-counting budget test), CVX-10/ARCH-12 (parallel per-type
search), SEC-7 (`mcpFileUploads.clientId` required), SEC-2 (docs wording),
DOM-1 (number-moved message), DOM-3 (same-target previews supersede), DOM-4 (closed
sub-task stays closed), ARCH-4 (legacy prefix heals), ARCH-5 (N9 into `planTransition`),
ARCH-6 (dead report wrappers), ARCH-9 (invariants scan robustness), DESIGN-4 (strip
bounds from advertised schemas, −8.6 % tools/list), DESIGN-6 (cap activity titles),
DESIGN-8 ("Did you mean KEY-N"), DESIGN-10 (preview description), DOG-3 (idempotencyKey
wording), DOG-4 (unrecognized-ref hint), DOG-5 (weekday in Today), DOG-6 (project
Team line), DOG-7 (include note on non-task), DOG-8 (matched external ref named),
DOG-10 (`status: any` no-op on non-task types), DOCS-4/5/6/7/8/10/11/12/13/14/15/16/17/18,
SEC-5 (cache metadata failures; firewall note), SEC-8 (instructions: titles are data).

LATER: CVX-3, DESIGN-3, CVX-6 (counters on hot docs), CVX-7 (`Date.now()` in reused
report cores), CVX-9 (`returns` validators), ARCH-3 (one `withIdempotency` helper),
ARCH-7 (remaining duplicated rules), ARCH-10 (fingerprint test matrix), ARCH-11
(`operations` table), ARCH-13, ARCH-15, DESIGN-9 (sub-task filter), DESIGN-12
(structuredContent), SEC-3 (positive session marker needs a Clerk template change),
SEC-4 (SVG/XML upload type; raw storage URLs in output), SEC-5 (Vercel rate rules).

WONT: DESIGN-11 (timer status is in §6), ARCH-14 (offset reload at MVP size),
DOCS-9 (rejected).

REOPENS: DESIGN-5 → D10 (template link line instead of per-row URLs in list rows,
−23 % on search pages). Owner decision.

### Owner decisions (gate, 2026-10-25)

- SEC-1: merge `claude/admiring-spence-7ce03f` into `mcp` → done, fast-forward to
  `4dd2b0b` (the branch's parent was the review-start commit).
- DESIGN-5 (REOPENS D10): rejected by the owner; list rows keep their per-row deep link.
- All five fix slices approved.
- Orchestrator adjustment after the gate: ARCH-6 (delete seven `internalQuery` report
  wrappers) moved to WONT — the wrappers are the app-side oracles of the MCP report
  equivalence tests (`convex/__tests__/mcpReports.test.ts`), so deleting them weakens the
  proof the review relies on.

### Fix slices

All five slices are committed (see "What was fixed").

| slice | scope | files (owner) |
|---|---|---|
| F1 Docs | PRD drift, runbook, tenancy/development notes, connect help text, env error messages | docs/**, components/connected-apps/connect-help.tsx, convex/auth.config.ts, lib/mcp/config.ts |
| F2 Renderers | DESIGN-1/2/6, DOG-5/6/7/8, DOM-4 | lib/mcp/render.ts, report-render.ts, their tests, convex/lib/mcpRecords.ts, mcpSaveTasks.ts, mcpWriteResults.ts |
| F3 Backend hardening | CVX-2/4/8, SEC-7, ARCH-4/6/9, schema indexes (incl. the `by_org_type` index F5 uses) | convex/schema.ts, tasks/write.ts, tasks/lookup.ts, tasks/access.ts, lib/mcpDelete.ts, mcpFileUploads.ts, clients.ts, lib/mcpSaveClients.ts, reports.ts, timesheets.ts, invoices.ts, billingViews.ts, lib/reports/views.ts, __tests__ |
| F4 Billing | DOM-1/3, ARCH-5, DESIGN-10 text | convex/lib/mcpBilling.ts, lib/billing/invoiceLifecycle.ts, schema (mcpBillingPreviews), mcpBilling.test.ts |
| F5 Tool surface & errors (after F3) | DOG-1/2/3/4/10, ARCH-2, DESIGN-4/7/8, CVX-1 query, CVX-5, CVX-10, DOCS-12/13/14/17, SEC-5 cache, SEC-8 line | lib/mcp/registry.ts, handler.ts, advertise.ts, instructions.ts, refs.ts, auth-server-metadata.ts, app/mcp/route.ts, convex/mcp/search.ts, lib/mcpSearch.ts, lib/mcpRefs.ts, tests + snapshot |

## What was fixed (commits on `mcp`, review start `9f37185`)

| commit | slice | findings |
|---|---|---|
| `4dd2b0b` | merge of `claude/admiring-spence-7ce03f` (fast-forward) | SEC-1: app UI uploads bound to the uploader |
| `3b06b16` | F1 docs | DOCS-1/2/3/4/5/6/7/8/10/11/12/13/14/15/16/18, SEC-2, SEC-6, DOM-2, DESIGN-13, ARCH-8, DOG-9, SEC-5 (runbook note) |
| `f33d4e0` | F4 billing | DOM-1, DOM-3, ARCH-5, DESIGN-10 (Convex text) |
| `946a30d` | F3 Convex hardening | CVX-2, CVX-4, CVX-8, SEC-7, ARCH-4, ARCH-9, CVX-1 (index) |
| `dbf5dcf` | F2 renderers | DESIGN-1, DESIGN-2, DESIGN-6, DOG-5, DOG-6, DOG-7, DOG-8, DOM-4 |
| `a53c74d` | F5 tool surface & errors | DOG-1, DOG-2, DOG-3, DOG-4, DOG-10, ARCH-2, DESIGN-4, DESIGN-7, DESIGN-8, DESIGN-10 (description), CVX-1 (query), CVX-5/ARCH-1, CVX-10/ARCH-12, DOCS-12/13/14/17, SEC-5 (metadata cache), SEC-8 |
| `76cc00e` | final-review follow-ups | FINAL-1/2/3/4/5/6 |
| `8e01413` | dogfood follow-up | DOG2-1 (client labelled in report legends) |
| `25635a7` | F3 follow-up | SEC-7 adjusted: `mcpFileUploads.clientId` stays optional; a row without a client is refused (the required field blocked the dev deploy on a pre-slice-7b row) |

Orchestrator adjustments during the build: client_monthly's task table became a required
part (D25: it carries each task's deep link; F2 flagged that an optional table could leave
the raw material unlinked); the idempotencyKey description was shortened (it is repeated
in twelve schemas).

## Before / after

| measure | before (`9f37185`) | after |
|---|---|---|
| `tools/list` result | 27,905 chars (~7.0k tokens) | 25,955 chars (~6.5k tokens), −7 % with new description text included; schemas alone −2.3k |
| server instructions | 1,319 chars | 1,398 chars (titles/names named as data; idempotencyKey wording) |
| changes feed, 11-line sample | 2,211 chars | 1,233 chars (−44 %) |
| report close_queue, 8 periods / 2 projects | ≈ 2,906 chars | ≈ 2,658 chars (−8.5 %; the legend breaks even at ~4 rows and saves ~39 % on the 24-row live sample) |
| MCP `delete` of 25 tasks, 50-member org | 1,850 index ranges (fails at ~140 members) | 600 (independent of members) |
| member task search, 600 parents × 2 sub-tasks | 3,001 index ranges (fails at ~820 parents) | 1,201 (the 4,096 budget is now beyond ASSIGNEE_EDGE_CAP) |
| org-wide comment search in a busy org | blind behind 500 rows of other activity | reads `comment_added` rows only |
| 25-email triage, pre-check searches | one `external_ref` search per thread | one search (array) or none |
| tests | 2,077 passed, 3 known failures | 2,112 passed (+35 new), the same 3 known failures |
| tsc / lint / build | clean / 0 repo errors / OK | clean / 0 repo errors (the 3,932 errors are all under `.claude/worktrees/**`, as before) / OK |

Dogfood re-run (post-fix): 12 headless runs on the same prompts as the baseline (report
`DOG2.md` in the orchestrator's scratch). Workflows 1–7: 35 → 20 MCP calls; real tool
errors 5 → 2 (both expected, both with an actionable hint); the identical re-run of the
5-email triage made 0 writes and 0 errors (was: an idempotency-key refusal); "log my
time" 6 → 3 calls; the sloppy-ref prompt 7 → 3 calls and 72 s → 13 s with
"Did you mean ZZRC-8? Keys go up to ZZRC-8"; close_queue 8.6k → 7.1k chars. No hallucinated
data, no duplicate cards, nothing written outside the throwaway client; all test data
deleted and verified gone. Each baseline finding (DOG-1…7, DOG-10) is fixed in the run
traces, except DOG-1's retry path, which no concurrent writer triggered. New: DOG2-1
(legend line read as a summary) fixed in `8e01413`; DOG2-2/3/4 are follow-ups.

Final fresh-context review of `git diff 9f37185..mcp`: no blocker, no major; 4 minors and 4 nits.
FINAL-1 (preview scan unbounded after the supersede change), FINAL-2 (PRD §9 cap wording),
FINAL-3 (runbook misses the `fileUploads` table, the app upload cron and `/upload`),
FINAL-4 (per-call log line shows refusals as `error`), FINAL-5 (comment-scan cap no longer
tested) and FINAL-6 (reads retried after deterministic errors) fixed in `76cc00e`.
FINAL-7 (a superseded token says "expired") and FINAL-8 (a fixable refusal re-tries the
connection stamp per request, ≤ 2× amplification) accepted as is. The reviewer verified,
with file:line, that the member-search skip is readable by construction, the billing
fingerprint is byte-identical, retries wrap queries only, logs carry no arguments or
user content, and no test was weakened beyond exact text → regex for the random ref.

## Follow-ups (FIX LATER, in the PRD's words)

- CVX-3 keyset search cursors (offset cursors over a `lastActivityAt` sort can duplicate
  or skip a row when a write lands between pages; rare in agent use).
- DESIGN-3 measure real token counts of the largest outputs with a tokenizer before
  touching `OUTPUT_BUDGET_CHARS` (60k chars).
- CVX-6 task-number counters on `projects` / `orgSettings` contend with every write in
  the org under heavy agent batches (dedicated counter table).
- CVX-7 four reused report cores read `Date.now()` inside queries (pass `now`).
- CVX-9 `returns` validators on the MCP public functions.
- ARCH-3 one `withIdempotency` helper instead of twelve copies; ARCH-7 remaining
  duplicated rules (admin pre-checks, rollover, `stateAfterRelease`, comment-author
  predicate); ARCH-10 fingerprint test matrix; ARCH-11 the `operations` table vs
  `execute`; ARCH-13 inline-text blob stored before the replay check; ARCH-15 labels
  composed in Convex.
- DESIGN-9 a `subtasks: include|exclude|only` search filter; DESIGN-12
  `structuredContent` for machine tokens (measure client rendering first).
- SEC-3 a positive session marker claim (needs a Clerk JWT template change); SEC-4
  SVG/XML upload types and raw storage URLs in output; SEC-5 Vercel Firewall rate rules
  before public exposure.
- DOG2-2 the client record shows no billing fields (billingEmail, currency, …), so a
  save_clients write cannot be verified by reading it back; DOG2-3 sub-task rows omit
  their external refs; DOG2-4 the search description does not say whether archived
  records are included.
- Lint: eslint scans `.claude/worktrees/**` (3,932 errors there, none in the repo);
  add it to `globalIgnores`.

## Production-readiness verdict

**Ready after the runbook's production setup.** No blocker was found by seven reviewers,
the orchestrator's own pass or the final fresh-context review of the whole fix diff.
Every major was fixed or deferred with a stated reason; tsc, lint (repository), tests
and build are green against the baseline; the dev deployment runs the fixed functions
and the post-fix dogfood runs are cleaner on every workflow.

What still needs the owner, in order (`docs/runbooks/mcp-deployment.md`):
1. `MCP_RESOURCE_URL` in three places before the merge (Convex production, Convex
   Preview defaults, Vercel Production); canonical domain only.
2. The Clerk production instance: register the MCP resource with CIMD and the `aud`
   claim; confirm the webhook delivers organization-membership events.
3. Push `mcp`, merge PR #17; the Vercel build deploys Convex.
4. The attachment extraction backfill and the §6 verification list.
5. Before public exposure beyond the owner's own agents: Vercel Firewall rate rules for
   `/mcp`, `/.well-known/*`, `/mcp-upload` and `/upload` (follow-up).

## Production rollout (2026-10-25, orchestrated after the review)

Owner's one yes covered: Convex production `MCP_RESOURCE_URL`, Vercel env (Production +
Preview), the Clerk production MCP resource (`configure_mcp_server` turned on CIMD and the
`aud` claim; DCR stays off), PR #17 merged (`7eee5bd`), Convex deployed by the Vercel
build. Verified: `/.well-known/oauth-protected-resource/mcp` (resource, issuer
`https://clerk.konverted.io`, scopes), 401 + `WWW-Authenticate` on `/mcp` (also on the
`*.vercel.app` URL), Clerk discovery check all MUSTs passed (one SHOULD warning: no scope
hint in the Bearer challenge), 45 `mcp/*` functions and the cleanup functions live.
Skipped by owner decision: the extraction backfill (dummy data). Open: Convex Preview
default env var (dashboard), first real-client connect (owner, consent screen), Clerk
webhook delivery of organization-membership events (check after the first team change).
