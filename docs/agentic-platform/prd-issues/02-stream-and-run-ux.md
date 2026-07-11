# 02 — Stream & run UX

**Type:** HITL — design-review gate (the no-slop bar is checked here)
**Blocked by:** 01
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *UX decisions* (stream density, rail, first-run, thread titles/search), *API contracts › Block vocabulary*, *Error/stop model*

## What to build

Turn the tracer's raw text dump into the designed chat experience. This slice implements the block-renderer registry (one renderer per block type, shared by all agents) and the run-state ergonomics.

Scope:
- **Block renderers:** `text` (streamed prose, delta-smooth), `reasoning` (streams muted → auto-collapses to one-line "Thought for Ns", re-expandable), `tool-call` (quiet ghost row: filled icon + verb + deterministic result summary, expandable to raw args/result — no card, no border, no pill), `error` (message + hint), `system` (run started/stopped, skill loaded).
- **Stop:** cooperative cancel flag checked between loop steps; Stop button; partial output stays; thread continuable after stop or error.
- **Run-state composer:** send disabled during a run, send button swaps in-place to Stop; non-editable agent chip above the composer (agent fixed per thread).
- **Thread titles:** auto-generated from the first user message (truncated), stored on the thread record.
- **Rail final form:** two stacked flat sections (pinned Agents; flat cross-agent Recent threads with agent icon + auto-title + relative time), title-search input above Recent threads (client-side).
- **First-run:** workspace empty state with agent identity + 3–4 clickable example-prompt chips that pre-fill the composer; admin sees a subtle "+ New agent" placeholder affordance.
- **AI-unavailable path:** missing key → error block with "configure AI in Settings → Integrations".
- Determinism visual token decided and documented here (AI prose = standard styling; deterministic values = tabular-nums treatment) — consumed by slice 03's table renderer.

**Exit gate:** design review with Adam against the Codex/Claude reference — density, collapse behavior, ghost rows, chips.

## Acceptance criteria

- [ ] A long run renders as: collapsed thought one-liners + quiet tool rows + streamed prose — no bordered cards, no pills anywhere in the stream.
- [ ] Reasoning expands/collapses on click; tool rows expand to raw args/result.
- [ ] Stop mid-run: the run halts within one step, partial blocks remain, a follow-up message works in the same thread.
- [ ] During a run the composer is visible, send disabled, Stop shown in-place; after the run send returns.
- [ ] New threads get a sensible auto-title; rail search filters own threads by title.
- [ ] First-run empty state shows example chips; clicking one pre-fills the composer.
- [ ] Missing AI key produces the settings-hint error block; the app elsewhere keeps working.
- [ ] `npx tsc --noEmit` clean; block-schema guards unit-tested (pure).
- [ ] **Gate:** Adam approves the visual density (no-slop check).

## User stories addressed

- US 5 (empty states), US 8 (live activity stream), US 10 (Stop), US 11 (error block, thread continues), US 12 (AI-key hint), US 19 (determinism visual language — token decided)
