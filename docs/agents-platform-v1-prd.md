# Agents Platform — V1 PRD

> **SUPERSEDED (2026-07-11):** replaced by `docs/agentic-platform/prd-v1.md` after the full platform interview. Kept for reference only.

**Status:** Superseded draft · **Scope:** V1 / prototype · **Owner:** Adam
**First agent:** Timesheet Generator · **Access:** admin-authored · **Risk:** read-only generator

---

## 1. TL;DR

We're building an **in-app agent workspace** — a chat-first surface (like the Codex app or Claude desktop) where an admin creates specialized agents that do one job well. You open a chat, the agent orchestrates the work: it talks to you, runs your Convex functions in the background, and streams what it's doing. Results come back **in the thread** as generative UI — a table you can read, a timesheet you can open as a sheet, an invoice you can approve — so you never leave the chat.

V1 ships **two things**: the generic workspace (so any number of agents can live in it) and **one agent end-to-end** — a Timesheet Generator.

The one rule underneath everything: **AI orchestrates and writes prose; your existing deterministic Convex functions do every calculation.** No number is ever produced — or even re-typed — by the model.

---

## 2. Goals & non-goals (V1)

**Goals**
- A working, generic chat workspace with streamed activity + generative-UI blocks.
- One agent, fully working: client + period → per-task timesheet (requests & delivery by AI, hours by Convex) as an in-chat table + CSV, openable in a canvas.
- A minimal admin builder so agents are data, not code — any number can be created.
- Prove the two pillars (determinism law + Skills) on the lowest-risk agent.

**Non-goals (deliberately deferred)**
- Scheduled / cron automations.
- Write-actions (invoice create/finalize) — the invoice agent comes later.
- XLSX export (CSV + in-chat table only).
- Token-by-token streaming (block-level streaming is enough).
- Memory system, eval/benchmark harness, inline question pause/resume.
- Multiple shipped agents (architecture supports N; we ship 1).

---

## 3. Core decisions (locked)

Everything we agreed, in one place.

| # | Decision | Why |
|---|----------|-----|
| **D1** | **The law:** AI configures, calls functions, and writes prose — never computes or re-types a number. Every figure comes from an existing Convex function; code injects the exact result. | 100% correct numbers come from the architecture, not the model. This is a billing product. |
| **D2** | **Skills** — plain-English SOPs that steer judgment and can hard-stop a run. Global or per-client (forkable). They change *which* records/grouping/when-to-stop, never *how a total is computed*. | Repeatable + auditable + flexible, without letting a bad skill corrupt arithmetic. |
| **D3** | **Chat-first workspace**, Codex/Claude-desktop layout: left rail (agents + runs), center chat, right canvas. | Matches the mental model the team already knows. |
| **D4** | **One thread per run.** | Clean audit; every run is self-contained. |
| **D5** | **Admin-authored agents.** Members run them, don't build them. | Safer in a financial app; simpler V1. |
| **D6** | **Permission = agent grants ∩ running user's org+role.** The agent never escalates above the user executing it. | Multi-tenant safety. |
| **D7** | **Generative UI = a stream of typed blocks**, one renderer each. Same set for every agent. | New agents get rich output for free. |
| **D8** | **Determinism split is user-visible** (Exact mode). Facts/hours are guaranteed; AI prose is labeled and reviewable. Invoices would be Exact-only. | Trust by transparency. |
| **D9** | **Reuse Phase 9.** The BYOK model pipeline, worksheet data collection, and AI summarizer are consumed, not rebuilt. | ~80% of the first agent already exists. |
| **D10** | **First agent is a read-only generator** (Timesheet). Writes (propose→commit) come later. | Lowest blast radius to prove the platform. |

---

## 4. System architecture

Read top-down as a request flowing from a click to the model and back.

```
SURFACE      Agent workspace — rail (agents + runs) · chat · canvas
                     │
RUNNER       Convex action running the Claude tool-use loop.
             Writes each step as a typed block. Enforces permission intersection.
                     │
BOUNDARY     ┌─ deterministic ─────────────┐   ┌─ AI ──────────────────┐
             │ your Convex functions        │   │ choose which fn to    │
             │ (filter · sum · rates ·      │   │ call · interpret text │
             │ group · create records)      │   │ · write prose         │
             └──────────────────────────────┘   └───────────────────────┘
                     │
CONTEXT      Convex data (relational, orgId-scoped) — no vector DB
                     │
MODEL        Claude via Phase 9 BYOK pipeline (per-org key → gateway → env)
             Sonnet 4.6 default; Opus for heavy synthesis
```

**The runner** is one generic `runAgent` Convex `action`. Each agent supplies its own system prompt (description + loaded skills), its **whitelist of tools** (your deterministic functions — the only way it can touch a number), and its permission scopes. The loop: model requests a tool → Convex executes the deterministic function → result stored + returned → model continues → emit blocks.

**Streaming.** No `@convex-dev/agent` or streaming component is installed today. **V1 approach:** hand-roll an `agentMessages` table + reactive `useQuery` — streaming, persistence, and multi-user come free from Convex reactivity; block-level streaming (append a block as each step finishes) is enough. Evaluate `@convex-dev/agent` as a fast-follow, not a V1 dependency. *Verify against Convex docs (context7) before committing.*

---

## 5. UI / UX

A dedicated, full-height workspace at `/agents`, reached from a top-level **Agents** item in the app sidebar. Reference: the interactive UI mock.

**Three zones**
- **Left rail** — your agents at the top; **Recent** runs below (one thread per run); *New chat* starts a run.
- **Center chat** — the run: streamed activity (thoughts + tool-calls), the agent's message, and generative-UI blocks. Composer to talk back.
- **Right canvas** — slides in when you *Open* an artifact: the timesheet as a sheet, an invoice to approve. Review and act (Export / Approve) without leaving the chat.

**Generative-UI block vocabulary** (the runner↔UI contract)

| Block | Renders | Convex side |
|-------|---------|-------------|
| `thought` | Streamed reasoning, collapsible | a row; purely visual |
| `tool_call` | A deterministic function firing | runs your function; result stored |
| `message` | Agent prose | a text row |
| `table` | Live, read-only data grid | query result rendered |
| `artifact` | Openable result (timesheet/invoice) | a draft record; opens in canvas |
| `action` | Export / Approve / Post button | gated by permission (audit-logged) |
| `question` | Inline picker that pauses the run *(later)* | suspends run until answered |

**Loading → empty → content** follows the app convention: content-aware skeleton while a run boots; a dedicated empty state for "no agents yet" / "no runs yet"; then the thread.

**Defaulted UI choices (confirm):** dedicated workspace (rail replaces app nav, app strip stays for context) · canvas = slide-in panel (optional full-screen toggle) · clicking an agent opens its run history; *New chat* starts a run.

---

## 6. Data model (new tables)

All `orgId`-scoped, following the app's existing tenancy pattern (`getAuthContext` → filter every doc by `orgId`).

| Table | Key fields | Notes |
|-------|-----------|-------|
| `agents` | `orgId, name, description, tools: string[], skillIds: Id[], accessScopes: string[], actionScopes: string[], trigger, createdBy` | admin-managed; `tools` reference vetted Convex fns |
| `skills` | `orgId, name, instruction, scope: "global"\|"client", clientId?, isStopCondition, createdBy` | plain-English SOPs |
| `agentThreads` | `orgId, agentId, title, status, createdBy, createdAt` | one per run |
| `agentMessages` | `orgId, threadId, role, kind, payload, order, createdAt` | the typed blocks; `kind` drives the renderer |
| `agentArtifacts` | `orgId, threadId, kind: "csv", storageId\|inline, meta` | the exportable output |
| `agentRuns` | `orgId, threadId, agentId, status, tokens, startedAt, finishedAt` | audit / cost log |

Indexes: `by_orgId` on all; `agentThreads.by_orgId_agentId`; `agentMessages.by_threadId_order`.

---

## 7. The first agent — Timesheet Generator

**Job.** Given a **client** + a **period**, read every task's requests, comments, and activity, and produce a per-task timesheet: what was requested, what we delivered, and hours broken down by work category — as an in-chat table + a downloadable CSV, openable in the canvas.

**Input.** client + period (month or date range); optional project / category / billable filter.

**Determinism split — on real functions**

| Timesheet column | Producer | Real symbol |
|------------------|----------|-------------|
| Date range (first–last worked) | **Convex** | `collectWorksheetData` row fields |
| Task (title) | **Convex** | `tasks.getDetail` / row.title |
| Client / Project | **Convex** | `projects.list({clientId})` |
| Activity count (comments + entries) | **Convex** | `comments.byTask` · entryCount |
| **What was requested** | **AI** | `summarizeTaskWithAI` → `taskSummary` |
| **What we delivered** | **AI** | `summarizeTaskWithAI` → `whatWeDid` |
| Hours per category (Design / Dev / PM …) | **Convex** *(pivot: new)* | `snapshotCategoryId` · `buildCategoryGroups` |
| Total hours | **Convex** | Σ `durationMinutes` |

> The reference sheet's email columns (Sender / Subject / #Emails) map to task-based equivalents — the app is task-centric, not email-centric.

**Orchestration.** Resolve the client's projects → call `collectTimesheetData(clientId, period)` (new wrapper over the existing per-project collector, adding the category→columns pivot) → send each task's `aiInput` to the summarizer → assemble the table → emit a CSV artifact. It reasons about *which* functions to call and writes the two prose columns. It computes **nothing**.

**Default skill — `timesheet-format`.** Governs tone + a stop-condition: *"If a task has logged time but no description or comments, flag the row — never invent what was delivered."*

**Output.** `table` block (per-task preview) + `artifact` block (CSV) that opens in the canvas as a sheet with a totals row. `action`: Export CSV.

---

## 8. Reuse vs. net-new

**Reuse as-is (Phase 9)**
- `worksheetsHelpers.collectWorksheetData` — project+period → per-task rows with hours, category, first/last worked, and `aiInput` (flattened description, comments, subtasks, notes).
- `worksheetAi.summarizeTasksWithAI` / `summarizeTasksWithBoundedConcurrency` — the two AI columns, bounded concurrency, Sonnet 4.6.
- `aiIntegration.loadDecryptedKey` + BYOK lifecycle — per-org key, gateway fallback.
- `lib/csv.ts` — CSV with formula-injection guard.
- `getAuthContext` / `requireAdmin`, `projects.list({clientId})`.

**Net-new**
- The chat/agent layer: the six tables, the `runAgent` runner, block renderers.
- `collectTimesheetData(clientId, period)` — client-level (cross-project) aggregation + category→columns pivot.
- In-chat table + canvas; minimal admin builder.

---

## 9. Permissions, tenancy & safety

- **orgId everywhere** — derived from the authed session, applied in every read and write. Never trusted from the model.
- **Admin-only builder** — creating/editing agents (their tools, skills, permissions) is admin-gated (`requireAdmin`).
- **Permission intersection** — a run executes with `agent.actionScopes ∩ running user's org+role`; it never escalates above the user.
- **Audit** — every run logged in `agentRuns` (who, agent, tokens, timings).
- **Errors** — every mutation/action `.catch(toastError)`; AI-unavailable surfaces "configure AI in Settings" and the rest of the app keeps working.
- **Read-only V1** — the Timesheet agent writes nothing to domain data; worst case is a bad prose cell a human ignores.

---

## 10. Build plan (slices — each shippable)

Ordered so the deterministic data path is proven before AI and UI go on top. Tracer bullet reaches "table on screen" by slice 4.

1. **Schema + runner skeleton** — the six tables; a generic `runAgent` action that loops Claude tool-calls and appends blocks; seed the Timesheet agent. *(net-new · foundation)*
2. **Deterministic tool: `collectTimesheetData`** — client+period across projects, reusing `collectWorksheetData`; add the category→columns pivot. Verify hours vs `projectOverview`. *(reuses Phase 9)*
3. **AI summarization step** — wire `summarizeTasksWithAI` as the summarize tool; BYOK via `loadDecryptedKey`. AI writes only the two prose columns. *(reuses Phase 9)*
4. **Chat UI + block renderers** — thread list, message stream, composer; renderers for thought / tool-call / message / table; live `useQuery`. *(net-new · the surface)*
5. **CSV artifact + canvas** — assemble CSV via `lib/csv.ts`; in-chat table + artifact card + slide-in canvas sheet. *(reuses lib/csv.ts)*
6. **Minimal admin builder** — form to create/edit an agent: name, description, tool checklist, skills, permissions, trigger. Admin-only. *(net-new · enables N agents)*
7. **Permissions, audit & errors** — intersection in the runner, `agentRuns` log, `.catch(toastError)`, AI fallback. *(net-new · hardening)*

Backlog: add this feature to `docs/backlog.md` with task-level checkboxes and a "TODOs deferred to later phases" section (per repo convention).

---

## 11. Acceptance criteria (V1 done means)

- [ ] An admin opens **Agents**, starts the Timesheet agent, picks a client and April 2026.
- [ ] The thread streams activity: loaded skill → called `collectTimesheetData` → summarized N tasks.
- [ ] An in-chat table shows per-task rows: requested & delivered (AI) + hours per category + total (Convex).
- [ ] Every hour cell equals the deterministic query — spot-checked against `projectOverview`.
- [ ] *Export CSV* downloads a file matching the table; it opens cleanly in Excel / Sheets.
- [ ] *Open* slides in the canvas with the timesheet as a sheet + totals row.
- [ ] Everything `orgId`-scoped; a non-admin cannot create agents; the run respects the user's permissions.
- [ ] The AI output contains only the two text columns — verifiably no model-produced number.
- [ ] `npx tsc --noEmit` clean; every mutation has error handling.

---

## 12. Future (post-V1)

Scheduled automations (cron) · the Invoice Prep write-agent (propose → approve → finalize) · XLSX export · inline `question` pause/resume · memory (process-only, filter out amounts) · eval/benchmark harness · more agents via the builder · optional semantic search.

---

## 13. Open questions (defaulted — confirm)

1. **Client + period (cross-project)** as the V1 input? → *default: yes* (matches the ask; costs a project loop). Alt: ship project+period first.
2. **CSV only for V1, XLSX later?** → *default: CSV + in-chat table.*
3. **Minimal builder in V1, or seed the agent only?** → *default: ship the minimal builder.* If scope must be cut, this is the trim.
4. **Streaming infra:** hand-rolled `agentMessages` + `useQuery` → *default: yes;* evaluate `@convex-dev/agent` later.

---

## 14. Risks / notes

- **Category pivot is net-new** — grouping primitives exist (`buildCategoryGroups`, `minutesByCategory`) but no pivot-to-columns builder; small but new.
- **No client/date index on time entries** — reads fan out project→tasks→`by_taskId`, date filtered in memory. Fine at MVP scale; revisit if slow.
- **Model streaming** — Phase 9 uses non-streaming `generateText` with a two-line contract; V1 streams at block level, not token level. Token streaming is a later polish.
- **Verify Convex agent/streaming components** via context7 before building the runner.
