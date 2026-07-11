# 04 — Skills system

**Type:** AFK
**Blocked by:** 01
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *D2*, *Module 7*, *Schema changes › skills*

## What to build

The skills layer end-to-end: schema, resolution, runner integration, and a minimal admin editing surface. A skill is a plain-English SOP (global or per-client) attached to agents; it steers judgment and can declare a hard stop-condition the runner enforces. Skills never change how a total is computed.

Scope:
- `skills` table (orgId, name, instruction, scope global|client + clientId, isStopCondition, createdBy/At) + agent↔skill attachment.
- `resolveSkills(agent, clientContext?)`: deterministic ordering (global first, then client-specific), returns instructions + stop-conditions; injected into the agent's system prompt; a `system` block ("skill loaded: …") appears in the stream.
- Stop-condition enforcement in the runner: when the agent signals a stop-condition hit, the run halts with a clear system/error block explaining which skill stopped it.
- Minimal admin CRUD for skills (list/create/edit/archive) — a simple admin-gated surface in the workspace (final placement polish can wait for slice 09's builder area).
- Vitest: resolution/ordering logic (pure).

## Acceptance criteria

- [ ] An admin can create a global skill and a client-scoped skill; a member cannot.
- [ ] Running an agent with an attached skill visibly changes behavior (e.g. a tone/grouping instruction is followed) and emits a "skill loaded" system block.
- [ ] A run concerning client X automatically picks up X's client-scoped skills; other clients' skills are not loaded.
- [ ] A stop-condition skill halts the run with an explanatory block (verifiable with a dev skill like "if the period is empty, stop").
- [ ] Resolution ordering (global → client) covered by passing Vitest tests.
- [ ] `npx tsc --noEmit` clean.

## User stories addressed

- US 48 (author skills), US 49 (stop-conditions enforced), US 50 (per-client skills auto-apply)
