# 01 — Tracer: minimal agent chat loop

**Type:** HITL — architecture-validation feedback gate; dependents wait for sign-off
**Blocked by:** 00
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *System architecture*, *Schema changes*, *API contracts*

## What to build

**The tracer bullet.** The thinnest possible path through every layer of the platform: a user types a message in the workspace, a seeded agent runs a real tool-use loop against a real deterministic Convex function, and the streamed answer appears reactively in the thread. Ugly is fine; end-to-end is mandatory.

Scope:
- Install and configure `@convex-dev/agent` (verify current API via context7 first — PRD Open Q2 is resolved in this slice).
- Schema: `agents`, `agentThreads` (app-side metadata: componentThreadId, agentId, userId, title, status, lastActivityAt), `agentRuns` — all orgId-scoped, with the `trigger` field present from day one. (`skills`, `agentProposals`, `agentArtifacts`, `connectors` come in their own slices.)
- Tool-registry seed: the typed catalog shape (name, description, input schema, required scope, kind) with 1–2 read tools wrapping existing functions (e.g. clients list, projects list).
- One dev-seeded test agent using those tools.
- `startRun(threadId, message)`: permission check → record user message → agent loop → messages persisted; runs logged in `agentRuns`.
- Minimal UI in the workspace shell: rail lists the seeded agent + my threads; clicking the agent starts a thread; a bare composer (plain textarea) sends; messages render as raw text via the component's reactive hooks (no block renderers yet).

**Exit gate (the point of a tracer):** demo to Adam — "which clients do we have?" → tool call fires → streamed answer. Confirm the component fits (thread mapping, delta streaming, tool loop, orgId scoping) before slices 02–10 build on it. If the component doesn't fit, this is the cheapest moment to swap the spine.

## Acceptance criteria

- [ ] From `/agents`, starting a chat with the seeded agent creates an `agentThreads` row (orgId + owner set from auth) and shows up in the rail's Recent threads.
- [ ] Sending "which clients do we have?" triggers the agent loop; a real Convex query executes as the tool; the reply streams into the UI reactively (visible growth, not one-shot).
- [ ] Tool results reach the model and the final prose references actual client names from the DB; the numbers/names shown come from the tool result, not model memory.
- [ ] The run is recorded in `agentRuns` (user, agent, timings, status, token usage if available).
- [ ] A user without an org, or an unauthenticated user, cannot start a run (clean error).
- [ ] Two browser windows on the same thread both see the stream live (Convex reactivity proof).
- [ ] `npx tsc --noEmit` clean.
- [ ] **Gate:** Adam signs off on the architecture (component fit, streaming feel, schema mapping) before dependent slices start.

## User stories addressed

- US 3 (rail lists agents/threads), US 4 (new chat), US 7 (multi-turn thread), US 13 (ordered audit of messages), US 18 (numbers from deterministic functions — proven at tracer scale), US 53 (orgId scoping), US 55 (trigger field schema-ready)
