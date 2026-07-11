# PRD: Agentic Platform (Agents Workspace)

**Status:** Final — ready for slicing · **Owner:** Adam · **Supersedes:** `docs/agents-platform-v1-prd.md` (draft)
**Scope:** Platform V1 (Wave 1) with the full multi-wave vision designed in
**Interview date:** 2026-07-11

---

## Problem Statement

Agency Flow already holds all the operational truth of the agency — tasks, comments, time entries, rates, retainer cycles, invoices, planner schedules — and already computes every financial figure deterministically. But turning that truth into outcomes is still manual, repetitive knowledge work:

- Producing a client timesheet means collecting tasks, reading descriptions and comments, summarizing what was requested and delivered, and assembling a sheet — by hand.
- Closing a month means walking every retainer project item by item, spotting problems (unclosed entries, missing time, uninvoiced months), and clicking through multiple screens.
- A client email or a call transcript must be manually decomposed into tasks, assigned, and scheduled in the Planner.
- Knowing "what needs my attention" (mentions, stalled tasks, slipping projects) requires manually scanning the inbox and task lists.

There is no surface where the owner can *delegate* these jobs to a specialized assistant that works with the app's own functions and data, shows its work, and lets the human verify and approve the result without leaving the conversation. Generic external AI tools can't do it either — they don't have the app's deterministic functions, so their numbers can't be trusted, and their output lands outside the system of record.

## Solution

A dedicated, full-screen **Agents workspace** inside the app — a chat-first surface in the style of the Codex app / Claude desktop / Cursor — reached via a workspace switch at the top of the sidebar (app UI ⇄ agent workspace).

An admin creates **specialized agents** (Timesheet Generator, Monthly Closing, Task Creator, Mention Digest / PM…) as *data, not code*: each agent is a name, instructions, a whitelist of vetted tools, attached skills, and a run-permission setting. Anyone in the org can run the agents they're allowed to run.

Opening an agent starts a **multi-turn conversation**. The agent streams its activity — thoughts, tool calls, prose — into the thread as typed generative-UI blocks. Results appear *in the chat*: a live table, a timesheet artifact that opens in a right-side canvas as a sheet, a set of proposal cards. When an agent wants to **change** anything (create tasks, close a period, post a comment), it never writes directly: it emits **proposals** that render as per-item editable cards; the human edits, approves, or discards them, and only approval executes the real deterministic mutation — with the approving user's own permissions.

The platform is **connector-capable** from day one: an extensible framework (like Codex/Claude connectors) where a user authenticates an external account once (first: Gmail), and connected tools become available to agents — "read this week's emails from Pragmatico and make tasks from them."

The one law underneath everything, carried over from the draft and non-negotiable: **AI orchestrates, interprets, and writes prose; the app's deterministic functions produce every number and perform every write.** No figure is ever produced — or re-typed — by the model. Financial data and calculations always come from existing application logic.

When this is complete:

- Adam opens the Agents workspace, picks the Timesheet agent, types "Pragmatico, June 2026" — and watches it load the skill, call the deterministic collector, summarize each task, and render a per-task timesheet table + CSV he can open as a sheet in the canvas and export.
- (Wave 2) The Monthly Closing agent walks the month item by item, flags problems, and presents close-period proposals he approves one by one — the month gets closed from the chat.
- (Wave 3) He pastes a client email — or asks the Gmail-connected agent to fetch this week's emails from a client — and approves the proposed tasks with assignees and dates.
- (Wave 4) A scheduled Mention Digest greets him each morning with a to-do summary, and a PM agent flags stalled tasks.

---

## User Stories

### Workspace & navigation

1. As a user, I want a workspace switch at the top of the sidebar (two-icon toggle), so that I can flip between the normal app UI and the full-screen Agents workspace and back at any time.
2. As a user, I want the Agents workspace to be a dedicated full-screen layout — left rail (agents + recent threads), center chat, right canvas — so that the experience matches Codex/Claude desktop rather than a page inside the dashboard shell.
3. As a user, I want to see my agents listed in the left rail and my recent threads below them, so that I can resume any conversation with one click.
4. As a user, I want a "New chat" action per agent, so that starting a fresh conversation is one click.
5. As a user with no agents or threads yet, I want dedicated empty states (and content-aware skeletons while loading), so that the workspace follows the app's loading → empty → content convention.
6. As a member, I want to see only the agents I'm allowed to run, so that admin-only agents (e.g. financial ones) don't appear for me at all.

### Conversation & streaming

7. As a user, I want a thread to be a continuable multi-turn conversation — follow-up questions, corrections, several jobs in sequence — so that I can iterate with the agent instead of restarting.
8. As a user, I want to see the agent's activity stream live — collapsible thoughts, each tool call as it fires, prose arriving in visible chunks (delta streaming) — so that I always know what it's doing and it feels alive.
9. As a user, I want tables of results rendered as read-only data grids inside the chat, with every number injected verbatim from the deterministic tool result, so that I can trust what I read.
10. As a user, I want a Stop button while a run is in progress, so that I can halt the agent; everything produced so far stays in the thread and the conversation remains continuable.
11. As a user, I want a clear error block in the thread when something fails mid-run (with a human explanation), and the conversation to remain usable afterwards, so that a failure never bricks a thread.
12. As a user without an AI key configured (and no operator fallback), I want the run to surface "configure AI in Settings → Integrations" instead of a cryptic error, so that I know how to fix it.
13. As a user, I want each of my messages and each agent response recorded in order with timestamps, so that the thread is a complete audit trail of the interaction.

### Composer

14. As a user, I want to type free text and paste long content (an email, a call transcript) into the composer, so that agents can work from arbitrary source material.
15. As a user, I want to attach files (txt, pdf, csv) in the composer, so that transcripts and documents can be inputs; the agent receives their extracted text content.
16. As a user, I want to @-mention tasks, projects, clients, and people in the composer (Tiptap mention picker, like in comments), so that the agent receives exact entity references instead of guessing from names — e.g. "look at @pragmatico's @website-issue task and ask @adamtoth to handle it."
17. As a user, if I attach an unsupported or unreadable file, I want an immediate, clear rejection message, so that I don't waste a run on it.

### Determinism & trust

18. As a user, I want every number (hours, amounts, counts, dates) in any agent output to come from a deterministic Convex function and be injected by code, so that a model error can never corrupt a figure.
19. As a user, I want AI-written prose (summaries, explanations) to be visually distinguishable from deterministic facts, so that I know which cells are guaranteed and which are reviewable interpretation.
20. As a user, I want an agent that encounters a task with logged time but no description or comments to flag the row rather than invent what was delivered (skill stop-condition), so that no plausible-sounding fiction reaches a client document.

### Proposals & approval (write actions)

21. As a user, I want any write the agent intends (create task, close period, post comment) to appear as a proposal card in the chat — never executed directly — so that I am always the one committing changes.
22. As a user, I want to edit a proposal inline before approving (title, assignee, date, etc.), so that I can fix details without another round-trip through the model.
23. As a user, I want to approve proposals item by item or all at once ("Approve all"), and discard individual items, so that a batch of 8 proposed tasks can be triaged in seconds.
24. As a user, I want approval to execute the real domain mutation with **my** permissions at that moment, so that an agent can never do something I couldn't do myself.
25. As a user, I want an approved proposal card to show its committed result (e.g. link to the created task), so that I can jump to the outcome.
26. As a user, I want a proposal whose referenced entity has meanwhile changed or disappeared (task deleted, period already closed) to fail validation at approve-time with a clear message — not to write stale data.
27. As a member, if I try to approve a proposal that requires admin rights (e.g. close a period), I want a clear permission error, so that the intersection rule is visible, not silent.
28. As a user, I want pending proposals to remain pending if I close the thread and return later, so that approval is never rushed.

### Timesheet Generator (Wave 1 agent)

29. As an admin, I want to give the Timesheet agent a client and a period (month or date range, optional project/category/billable filters) and receive a per-task timesheet — what was requested, what we delivered (AI prose), hours per work category and totals (deterministic) — so that a client-ready sheet takes one message.
30. As an admin, I want the timesheet rendered as an in-chat table and as a CSV artifact that opens in the canvas as a sheet with a totals row, so that I can review it without leaving the chat.
31. As an admin, I want Export CSV to download a file that matches the table exactly and opens cleanly in Excel/Sheets, so that the artifact is usable downstream.
32. As an admin, I want every hour cell to equal the deterministic query result (spot-checkable against the project overview), so that the timesheet is billing-grade.
33. As an admin, I want the timesheet's AI columns produced by the existing Phase 9 summarizer over the same task inputs (description, comments, subtasks, entry notes), so that the proven pipeline is reused, not rebuilt.

### Canvas & artifacts

34. As a user, I want an artifact block in the chat (name, kind, meta) with an Open action that slides in the right canvas, so that big outputs don't bloat the message stream.
35. As a user, I want the canvas to render a timesheet as a proper sheet (columns, totals row) and to offer the artifact's actions (Export CSV), so that review and action happen in one place.
36. As a user, I want to close the canvas and keep chatting, and reopen any artifact from its block later, so that the canvas is a viewer, not a mode.

### Connectors

37. As a user, I want a Connectors surface (in the workspace settings area) listing available connector types, so that I can see what the platform can plug into.
38. As a user, I want to authenticate a connector for **my own account** (per-user, e.g. my Gmail via OAuth), so that agents run by me can use my connected services; nobody else's runs can.
39. As a user, I want to disconnect a connector at any time and see its status (connected/expired/error), so that access is always under my control.
40. As a user running an agent whose tools need a connector I haven't connected, I want the agent to tell me exactly which connector to connect and where, so that the failure is self-explaining.
41. (Wave 3) As a user, I want to ask "read this week's emails from Pragmatico and create tasks from them," and have the Gmail tools fetch the emails and the agent propose tasks, so that email-driven work enters the system without copy-paste.
42. As an admin, I want connector credentials stored encrypted (same AES-GCM/KEK pattern as the AI key) and never exposed to the model or the client, so that tokens are safe at rest.

### Agent builder (admin)

43. As an admin, I want to create and edit agents in a minimal builder — name, description/instructions, tool checklist (from the vetted registry), attached skills, who can run it (admins / everyone), model choice — so that new agents are configuration, not code.
44. As an admin, I want the Timesheet agent to arrive pre-seeded so there's value on day one, but fully editable like any other agent.
45. As a member, I want no access to the builder (create/edit agents is admin-gated), so that agent capabilities stay controlled.
46. As an admin, I want to archive an agent so it disappears from runners' rails without deleting its historical threads, so that history survives lineup changes.
47. As an admin, I want the tool checklist to show only registry-vetted tools with human descriptions and their required scopes, so that I can't accidentally grant something unvetted.

### Skills

48. As an admin, I want to write skills — plain-English SOPs, global or per-client — and attach them to agents, so that judgment (grouping, tone, when to stop) is steerable without touching code.
49. As an admin, I want a skill to be able to declare a hard stop-condition the runner enforces, so that a bad situation halts the run instead of producing garbage.
50. As an admin, I want per-client skills to apply automatically when a run concerns that client, so that client-specific conventions (e.g. timesheet format) are respected without me remembering them.

### Visibility, audit & tenancy

51. As a user, I want to see my own threads only in the rail, so that my conversations (possibly containing rate/financial data from my runs) are mine.
52. As an admin, I want a separate view listing all org threads/runs (who, which agent, when, status, token usage), so that I can audit everything that happened.
53. As an org member, I want every agent-related record orgId-scoped from the authed session, so that no cross-tenant leakage is possible — same rule as everywhere in the app.
54. As an admin, I want every run logged (agent, user, timings, token counts, outcome), so that cost and behavior are observable.

### Scheduling (designed now, built Wave 4)

55. As an admin, I want agents to carry a trigger field (manual now; scheduled later), so that the schema doesn't need migration when scheduled runs arrive.
56. (Wave 4) As a user, I want a scheduled agent's result to arrive as a new thread plus an inbox notification, so that proactive work surfaces in my normal attention flow.

---

## Implementation Decisions

### Locked platform laws (carried from draft, reaffirmed)

- **D1 — The determinism law.** AI configures, selects tools, interprets text, and writes prose. Every number comes from an existing deterministic Convex function; code injects results verbatim into blocks and artifacts. Applies to every agent, every wave, no exceptions. Financial documents (timesheets, closings, invoices) are Exact-mode only.
- **D2 — Skills.** Plain-English SOPs, global or per-client, attachable to agents; may declare stop-conditions the runner enforces. Skills change *which/how-grouped/when-to-stop*, never *how a total is computed*.
- **D6 — Permission intersection.** A run executes as the running user: the runner action is invoked with the user's Convex auth identity, so every wrapped function's own `getAuthContext`/`requireAdmin` enforcement applies naturally. The agent's own grants (tool whitelist, run-permission) can only narrow, never escalate.

### New decisions (this interview)

- **Propose→approve→commit is a core platform layer**, not a later phase. Agents never call domain write mutations. Write intent becomes a proposal record; proposal cards render in-chat, per-item editable; an approve mutation validates the (possibly edited) payload against current data and executes the real domain mutation as the approving user. Batch "Approve all" supported. Stale proposals fail validation with a clear error. Wave 1 ships the engine; Wave 2 (Monthly Closing) is its first consumer.
  - *Card UX:* cards render **expanded with key fields inline-editable** (no separate edit mode); per-card Approve + Discard; a sticky "Approve all (N)" above the batch. Destructive kinds (closePeriod / closeCycle) require a confirm step even under Approve-all. Approved cards collapse to a compact committed row linking the affected record; failed/stale cards flip to an inline error state with reason + Retry. Pending cards persist across thread close/reopen.
- **Runner is built on `@convex-dev/agent`** (the official Convex agent component), not hand-rolled: it provides thread/message persistence, the AI-SDK tool-loop, multi-turn history, delta streaming to React, and usage tracking. An app-side thread metadata table maps component threads to orgId/agentId/user/status for tenancy, rail listing, and audit. Verified via current docs; re-verify API details at build time (context7).
- **Streaming fidelity: block-level + prose deltas.** Tool calls, tables, proposals appear as complete blocks via Convex reactivity; agent prose streams in chunks (component delta streaming + smooth text rendering). Token-perfect streaming is not a goal.
- **Multi-turn threads.** A thread is a continuable conversation with one agent. Each agent response cycle is recorded as a run (audit unit) within the thread. One-thread-per-run (draft D4) is retired.
- **Thread visibility: own threads + admin-sees-all.** Rail lists the current user's threads; a separate admin audit view lists all org threads/runs. Data access inside a run is already bounded by the runner user's permissions.
- **Everyone can run; admins build.** Agents carry a run-permission setting (admins-only / everyone); the builder and skills editing are admin-gated. Financial agents (Timesheet, Monthly Closing) default to admins-only because their underlying collectors are admin-gated anyway.
- **Connector framework ships in Wave 1; Gmail ships in Wave 3.** The framework = connector schema (per-user, orgId-scoped, encrypted credentials via the existing AES-GCM/KEK pattern), a Connectors settings surface with connect/disconnect/status, and tool-registry integration (connector-backed tools resolve the running user's connection; missing connection → self-explaining agent message). Per-user auth only in V1; per-org shared connectors are out of scope.
- **Composer: Tiptap-based** with three input capabilities: free text + paste; file attachments (txt/pdf/csv → extracted text handed to the agent); @-mentions of tasks/projects/clients/users reusing the existing mention infrastructure — mentions serialize to typed entity references passed to the agent as structured context (exact IDs, no name-guessing). Voice dictation and slash commands are out of scope (roadmap).
- **Error/stop model.** Stop button cancels the active run cooperatively (a cancel flag the loop checks between steps); partial output stays; thread continues. Failures append an error block with a human explanation; missing AI key surfaces the standard "configure AI in Settings" path. No automatic checkpoint/resume in V1.
  - *Run-state ergonomics:* during an active run the composer stays visible with send disabled; the send button swaps in-place to Stop. No message queueing in V1 (out of scope). The bound agent shows as a non-editable chip above the composer — the agent is fixed per thread; switching agents = new chat.
- **Full-screen workspace with a workspace switch.** The `/agents` route gets its own layout outside the dashboard shell (route-group split). The workspace switch is a compact **two-icon segmented toggle at the very top of the sidebar** (above the team switcher), present symmetrically in *both* shells so the return path is always visible; it does not appear inside modals/drawers and does not fork the navigation source of truth (layout-level chrome, not a nav item).
- **Canvas behavior.** The canvas is a docked right flex-sibling panel (~520px fixed with an Expand-to-wide toggle; subscriptions stay warm). It **auto-opens the first time an artifact is produced in a run**; thereafter it opens manually via each artifact block's Open action. It does **not** collapse the agent rail (deliberate divergence from the inbox choreography — the rail is primary nav here); it narrows the chat instead. Esc/X closes; chat stays live.
- **Model policy.** Default Claude Sonnet (current: Sonnet 4.6) via the Phase 9 BYOK resolution chain (per-org key → gateway → env). Per-agent model override in the builder for heavy-synthesis agents. The key never reaches the client or the model context.
- **Scheduling is schema-ready, not built.** Agents carry `trigger: "manual" | "scheduled"` (+ future schedule config); the cron path (a registered cron that starts runs with a service context) is designed in Wave 4, deliberately after the manual flow proves out.
- **PRD location & docs.** This document lives at `docs/agentic-platform/prd-v1.md` and supersedes the draft. Implementation must be tracked in `docs/backlog.md` per repo convention (task-level checkboxes, verification, deferred-TODOs section).

### UX decisions (design-review round, 2026-07-11)

Reviewed against Codex / Claude desktop / Cursor patterns and the app's standing design rules (quiet ghost rows, no bordered pills, Notion/Linear polish). All confirmed by Adam.

- **Rail structure:** two stacked flat sections — pinned **Agents** (runnable-only per user) above a flat **Recent threads** list across all agents, newest-first; each thread row shows agent icon + auto-title + relative time. Clicking an agent opens a new pre-selected chat; clicking a thread resumes it. No agent-nesting, no two-column layout.
- **Thread titles:** auto-generated from the first user message (truncated, e.g. "Pragmatico — June 2026"), stored on the thread record. No manual rename in V1 (deferred).
- **Thread search:** a single title-search input above Recent threads (client-side over the user's own threads). No faceted rail filter in V1. The admin audit view gets its own URL-persisted filters (agent / user / status / date) as a separate table.
- **Stream density:** reasoning streams as muted live text, then auto-collapses to a one-line "Thought for Ns" summary (re-expandable). Tool calls render as single quiet ghost rows — filled icon + verb + deterministic result summary ("Collected timesheet data · 42 tasks") — no card, no border, no pill; expandable to raw args/result on demand.
- **First-run:** the center pane shows a workspace empty state with the selected agent's identity, one line on what it does, and 3–4 clickable example-prompt chips that pre-fill the composer. Recent-threads empty state: "No threads yet — pick an agent to start." Admins additionally see a subtle "+ New agent" affordance. All via the shared empty-state component + content-aware skeletons.
- **Builder placement:** a full-page, single-column form inside the workspace layout (admin-only "Manage agents" entry in the rail footer) — not a dashboard Settings tab, not a modal. The tool checklist is grouped by scope, each row showing the human description + required scope.
- **Formatting:** all numbers/dates/currency render via the existing shared format helpers, never model-produced strings (D1 enforced at render level too). Financial artifacts use absolute dates; rail/run timestamps use relative time. Hours display matches the project-overview convention so cells are spot-checkable.
- **Determinism visual language (US 19):** AI prose renders in standard message styling; deterministic values get a subtly distinct treatment (e.g. tabular-nums in table cells) — the concrete token is decided in the first UI slice and shared by every block renderer (no per-renderer improvisation).
- **Mobile posture:** `/agents` is desktop-first; on mobile it is read-mostly — rail becomes a drawer, canvas becomes a full-screen sheet (reusing the inbox sheet variant). Composing/approving on phone is a V1 non-goal.

### Wave plan

| Wave | Contents | Proves |
|------|----------|--------|
| **1 (V1)** | Platform: schema, runner on `@convex-dev/agent`, tool registry, proposal engine, block renderers, full-screen workspace, composer (text/paste/upload/mentions), canvas, CSV artifacts, connector framework (no connector yet), minimal admin builder, skills, seeded **Timesheet Generator** | The chassis + determinism law on the lowest-risk agent |

Wave 1 starts with an explicit **Slice 0 — the dashboard-shell split**: route-group separation, the `/agents` full-screen layout shell, the workspace switch in both shells, and the empty rail — built and verified **before any agent logic**. This is the load-bearing structural refactor (no current page escapes the shared shell) and must not be folded silently into a later slice.
| **2** | **Monthly Closing agent** — walks retainer months/cycles, flags problems (unclosed entries, running timers, uninvoiced months, mismatched billable), proposes close-period / close-cycle actions as approval cards | Propose→approve on real, existing deterministic close mutations |
| **3** | **Gmail connector** (per-user OAuth, read-scope tools: search/list/get messages) + **Task Creator agent** (paste/upload/email → proposed tasks with assignees, due dates, planner segments) | Connector framework live; multi-item proposal batches |
| **4** | **Mention Digest / PM Status agent** + **scheduled runs** (cron trigger, results as new thread + inbox notification); small net-new "mentions since" query | Proactive agents |

### Schema changes (all orgId-scoped, string orgId from auth context)

- `agents` — name, description, instructions, tools (registry names), skillIds, runPermission (admins/everyone), model?, trigger, archived, createdBy/At.
- `skills` — name, instruction, scope (global | client + clientId), isStopCondition, createdBy/At.
- `agentThreads` — app-side metadata: componentThreadId, agentId, userId (owner), title, status (idle | running | error), lastActivityAt. (Message storage itself lives in the `@convex-dev/agent` component.)
- `agentRuns` — threadId, agentId, userId, status, startedAt/finishedAt, token usage, error?.
- `agentProposals` — threadId, runId, kind (discriminated union per write type: createTask, closePeriod, closeCycle, postComment, createSegment…), payload (typed draft), status (pending | approved | discarded | failed), editedPayload?, committedRef? (id of created/affected record), decidedBy/At.
- `agentArtifacts` — threadId, kind (csv | sheet), storageId or inline data, name, meta (columns, totals).
- `connectors` — userId, type (gmail | …), status (connected | expired | error | revoked), encrypted credentials (ciphertext, same KEK pattern as AI keys), scopes, connectedAt, lastUsedAt.
- Indexes: by_orgId on all; agentThreads by_orgId_userId and by_orgId_agentId; agentProposals by_threadId_status; connectors by_orgId_userId_type.

### API contracts (platform layer)

- **Tool registry (code, not data):** a typed catalog mapping tool name → { description for the model, input schema, required scope (member | admin), execute wrapper that calls the existing Convex function }. Agents reference tools by name; the builder can only check registry entries. Read tools return data verbatim; "write-intent" tools create proposals and return the proposal id — they never touch domain tables.
- **`startRun(threadId, message, attachments?, mentions?)`** — validates run permission + thread ownership, records the user message, executes the agent loop, streams blocks. Returns when the run settles (stream observed reactively).
- **`stopRun(runId)`** — sets cancel flag; loop exits at next step boundary.
- **`approveProposal(proposalId, editedPayload?)` / `approveAll(threadId)` / `discardProposal(proposalId)`** — validate against current data, execute the mapped domain mutation as the caller, record outcome on the proposal.
- **Block vocabulary (renderer contract):** text (streamed prose, standard message styling), reasoning (streams muted, auto-collapses to a one-line "Thought for Ns" summary, re-expandable), tool-call (single quiet ghost row: filled icon + verb + deterministic result summary; expandable to raw args/result; no card/border/pill), table (columns + rows, rendered read-only, deterministic cells in the shared determinism treatment, e.g. tabular-nums), proposal (references a proposal record; card renderer per kind), artifact (references an artifact record; Open action), error (message + hint), system (skill loaded, run started/stopped). Mapped onto the component's message parts; every block type has exactly one renderer, shared by all agents.

### Timesheet agent specifics (reaffirmed from draft)

- Input: client + period (+ optional project/category/billable filters).
- Net-new deterministic tool `collectTimesheetData(clientId, period, filters?)`: loops the client's projects over the existing per-project worksheet collector and adds a category→columns pivot; every hours cell verifiable against project overview.
- AI columns (requested / delivered) via the existing bounded-concurrency summarizer over the existing per-task AI input; model writes only those two columns.
- Default skill `timesheet-format`: tone + the stop-condition "task has logged time but no description or comments → flag the row, never invent."
- Output: table block + CSV artifact (existing CSV helpers, formula-injection guard, BOM) + canvas sheet with totals row.

---

## Module Design

**1. Agent Runtime (runner)**
- **Responsibility:** everything between "user sends a message" and "blocks appear": the tool loop on `@convex-dev/agent`, prose delta streaming, stop handling, error blocks, run audit records, permission gate at entry.
- **Interface:** `startRun`, `stopRun`; reactive thread/message queries for the UI. Failure modes: permission denied (before any model call), AI unavailable (error block + settings hint), tool failure (error block, run settles, thread continuable), cancel (partial output kept).
- **Stable:** the block vocabulary and startRun/stopRun signatures. **Volatile:** internal loop mechanics (component API details re-verified at build time).
- **Tested:** no (integration-shaped; covered by acceptance checklist). Pure helpers it uses (block schema guards) — yes.

**2. Tool Registry**
- **Responsibility:** the single vetted catalog of what agents *can* do; the determinism boundary. Wraps existing Convex functions; enforces scope requirements; distinguishes read tools from write-intent (proposal-creating) tools; resolves connector-backed tools against the runner's connections.
- **Interface:** `getToolsForAgent(agent, authContext) → AI-SDK tool set`; registry entries: name, description, schema, scope, kind (read | propose | connector). Failure modes: scope not met → tool absent from the set (agent can't even attempt it); connector missing → tool present but returns a self-explaining "connect X in Settings" result.
- **Stable:** entry shape, scoping rule. **Volatile:** the tool list itself (grows every wave).
- **Tested:** yes — scope filtering and read/propose classification (pure).

**3. Proposal Engine**
- **Responsibility:** the only path from agent intent to domain writes. Proposal records, per-kind payload validation, approve/discard/approve-all, execution of the mapped domain mutation as the approving user, outcome recording.
- **Interface:** `approveProposal(id, editedPayload?)`, `discardProposal(id)`, `approveAll(threadId)`; proposal queries for cards. Failure modes: stale reference (entity gone/changed) → failed status + reason; permission denied at approve-time → clear error, proposal stays pending; partial batch failure → per-item outcomes, no all-or-nothing rollback.
- **Stable:** proposal lifecycle (pending → approved | discarded | failed) and the approve contract. **Volatile:** the kind union (grows per wave).
- **Tested:** yes — payload validation and kind→mutation mapping (pure parts).

**4. Connector Framework**
- **Responsibility:** connector type catalog, per-user encrypted credential lifecycle (connect/refresh/disconnect/status), and exposing connector tools to the registry. Gmail (Wave 3) is the first concrete type.
- **Interface:** Settings surface (list, connect, disconnect, status); `resolveConnection(userId, type) → live credentials | absent`. Failure modes: expired/revoked token → status flips, dependent tools return the self-explaining message; credentials never reach client or model.
- **Stable:** connector record shape, resolution contract. **Volatile:** OAuth mechanics per provider.
- **Tested:** yes — credential encryption round-trip reuses the already-proven crypto helpers (existing coverage); status/resolution logic (pure) gets tests.

**5. Workspace UI**
- **Responsibility:** the full-screen `/agents` surface: workspace switch, rail (agents + my threads), chat stream with one renderer per block type, Tiptap composer (text/paste/upload/mentions), docked canvas (sheet renderer + artifact actions), admin audit view, empty states + content-aware skeletons.
- **Interface:** consumes reactive thread/message/proposal/artifact queries; emits startRun/stopRun/approve mutations. Reuses the app's chat-stream, docked-panel, mention, and table-token patterns.
- **Stable:** three-zone layout, block-renderer registry. **Volatile:** visual polish, canvas interactions.
- **Tested:** no (UI; manual + acceptance checklist).

**6. Timesheet Agent (Wave 1 vertical)**
- **Responsibility:** the seeded agent config + the net-new `collectTimesheetData` deterministic tool (client-level aggregation + category pivot) + CSV artifact assembly.
- **Interface:** tool: (clientId, period, filters?) → per-task rows with per-category minutes, totals, and AI-input payloads. Failure modes: no data in period → agent says so, no empty artifact; summarizer unavailable → deterministic columns still delivered, AI columns marked unavailable.
- **Stable:** row/pivot shape. **Volatile:** prose/skill tuning.
- **Tested:** yes — the category→columns pivot and totals (pure; billing-grade math).

**7. Skills**
- **Responsibility:** skill records, admin editing, scope resolution (global + matching client), prompt assembly, stop-condition surfacing to the runner.
- **Interface:** CRUD (admin), `resolveSkills(agent, clientContext?) → ordered instructions + stop conditions`. Failure mode: conflicting skills → deterministic order (global first, then client-specific), documented.
- **Tested:** yes — resolution/ordering (pure).

**8. Admin Builder**
- **Responsibility:** minimal create/edit form: name, description/instructions, tool checklist (registry-fed, scope-grouped), skills, run permission, model override, archive. Admin-gated. Lives as a full-page form inside the workspace layout ("Manage agents" entry in the rail footer) — not a Settings tab, not a modal.
- **Interface:** agent CRUD mutations + registry listing query. Failure mode: referencing a removed registry tool → flagged in the form, tool dropped at runtime with a system block.
- **Tested:** no (form UI over simple CRUD).

---

## Testing Decisions

- **What makes a good test here:** external behavior of pure, money/write-critical logic — given inputs, exact outputs. No mocking of the model; the AI boundary is excluded from unit tests by design (its outputs are prose-only per D1).
- **Tested modules:** Tool Registry (scope filtering, read/propose classification), Proposal Engine (payload validation, kind mapping), Timesheet pivot + totals, Skills resolution, block-schema guards, connector status/resolution logic.
- **Not tested:** runner loop, UI, builder (manual verification + the acceptance checklist below).
- **Prior art:** Vitest is configured in the repo (unit level, jsdom for hooks); follow the existing pure-helper test style used for lib-level logic.
- **Acceptance checklist (V1 done means):** admin opens Agents via the workspace switch → starts Timesheet agent → client + month → stream shows skill load, tool call, N tasks summarized → in-chat table where every hour cell equals the deterministic query → CSV export matches and opens cleanly → artifact opens in canvas as a sheet with totals → Stop works mid-run and the thread continues → a member sees neither admin-only agents nor other users' threads → a proposal card (from a dev-seeded write agent or the engine's test harness) can be edited, approved (executes as the approver), and discarded → `npx tsc --noEmit` clean, every mutation error-handled, everything orgId-scoped.

---

## Out of Scope (this PRD's V1 / Wave 1)

- Gmail (or any) concrete connector — framework only; Gmail is Wave 3.
- Monthly Closing, Task Creator, Mention Digest / PM agents — designed at wave level here, specified in their own briefs when their wave starts.
- Scheduled/cron-triggered runs (Wave 4); the trigger field exists from day one.
- Voice dictation and slash-commands in the composer (roadmap).
- XLSX export (CSV + canvas sheet only).
- Token-perfect streaming (deltas are the ceiling for V1).
- Memory system, eval/benchmark harness, semantic/vector search.
- Per-org (shared) connectors — per-user only.
- Auto-commit writes of any kind — every write goes through proposals, no exceptions in any wave currently planned.
- Member access to the builder or skills editing.
- Editing past threads' content, thread sharing/handoff between users.
- Mobile run/approve — `/agents` is desktop-first; mobile is read-mostly (rail as drawer, canvas as full-screen sheet). No composing or approving on phone in V1.
- Message queueing during an active run (composer send is disabled while a run streams).
- Manual thread rename (titles are auto-generated in V1).
- Faceted thread filtering in the rail (title search only; the admin audit view has its own filters).

---

## Open Questions

1. **PDF text extraction** for composer uploads — which extraction approach runs inside Convex actions within runtime limits (plain-text and CSV are trivial; PDF needs a library decision). *Owner: implementation slice for the composer. Path: evaluate at build time; if awkward, ship txt/csv first and add pdf behind the same interface.*
2. **`@convex-dev/agent` fit details** — exact mapping of our typed blocks onto its message parts, and whether its built-in tool-approval primitive can back our proposal cards or stays unused in favor of the proposal engine. *Owner: runner slice. Path: context7 verification at build start (repo convention for fast-moving libs); the proposal engine is the contract either way.*
3. **Gmail OAuth app verification** — Google review lead time for restricted scopes may gate Wave 3 timing. *Owner: Adam (Google Cloud console). Path: start verification paperwork during Wave 2.*
4. ~~**Workspace switch placement/affordance**~~ — **Resolved (design review 2026-07-11):** two-icon segmented toggle at the very top of the sidebar, symmetric in both shells; see UX decisions.

---

## Further Notes

- **Reuse map (verified against the codebase):** Phase 9 worksheet collector + AI summarizer + BYOK key lifecycle are consumed as-is for the Timesheet agent; the existing chat/activity-feed stack (message grouping, batched audit rows, live reactivity) is the direct precedent for the thread stream; the docked inbox panel is the precedent for the canvas; the existing mention suggestion system backs composer mentions; CSV helpers with formula-injection guard back artifacts; the AES-GCM secret crypto backs connector credentials; deterministic close mutations for retainer periods/cycles already exist and are what Wave 2's Monthly Closing agent will propose against.
- **The dashboard-shell split is the main structural refactor:** no current page escapes the shared shell; `/agents` will be the first. Sequenced as the explicit **Slice 0** in the wave plan — built and verified before any agent logic.
- **Determinism visual language is a shared design primitive:** the AI-prose vs deterministic-fact treatment (US 19) is a single token decision made in the first UI slice and consumed by every block renderer — per-renderer improvisation here is the most likely place the app's no-slop design bar would slip.
- **Canvas deliberately diverges from the inbox choreography:** reuse the docked panel's flex-sibling/warm-subscription mechanics, but do *not* collapse the rail when the canvas opens — in the workspace the rail is the primary navigation.
- **Financial-data caution:** timesheet/closing collectors are admin-gated at the function level; the agent layer must not add any bypass. Member-run agents simply cannot reach those tools (scope filtering) — this must hold even if an admin misconfigures an agent's run permission, because the underlying functions enforce admin themselves.
- **Repo conventions that bind this feature:** 0 TS errors at all times; every mutation `.catch(toastError)`; content-aware skeletons; dedicated empty-state components; page files as thin orchestrators; shared domain components; URL-persisted filter state where applicable; backlog tracking in `docs/backlog.md`; shadcn/Tiptap/dnd-kit docs via context7 before building on them.
- **Reference UX:** Codex app / Claude desktop / Cursor agent surfaces (screenshots reviewed 2026-07-11): left rail with recents, streamed thoughts + "ran a command" rows, progress/context side panel, artifact chips that open a document pane. Our block vocabulary and canvas mirror that mental model.
