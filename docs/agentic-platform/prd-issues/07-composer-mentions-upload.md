# 07 — Composer: Tiptap + mentions + upload

**Type:** AFK
**Blocked by:** 01
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Implementation Decisions › Composer*, *US 14–17*

## What to build

Upgrade the tracer's plain textarea to the designed composer: Tiptap-based, with @-mentions of tasks / projects / clients / users and file attachments. Mentions serialize to **typed entity references** passed to the agent as structured context — exact IDs, no name-guessing (this is a determinism feature, not sugar).

Scope:
- Tiptap composer (reuse the existing editor + mention-suggestion infrastructure); Enter sends, Shift+Enter newline; long paste (email/transcript) works.
- Mention picker across the four entity types; on send, mentions become a structured `mentions` array (type + id + label) alongside the text; the runner injects them as authoritative context ("the user explicitly referenced these records").
- File attachments: txt + csv extracted to text server-side and handed to the agent as content; pdf if a Convex-action-compatible extraction is straightforward (PRD Open Q1) — otherwise reject pdf with a clear message and note the deferral in `docs/backlog.md`.
- Unsupported/unreadable files rejected immediately with a clear message (no run wasted).
- Keep the slice-02 run-state behavior intact (send→Stop swap, agent chip above the composer).

## Acceptance criteria

- [ ] "@" in the composer opens the picker; task/project/client/user mentions render as chips in the input and as styled references in the sent message.
- [ ] "nézd meg @pragmatico @website-issue taskját" → the agent's tool calls use the exact mentioned IDs (verify in the tool-call args), not name-based lookup.
- [ ] A pasted multi-paragraph email survives intact and the agent can work from it.
- [ ] Attaching a .txt transcript: content reaches the agent; a run can reference specifics from it.
- [ ] Attaching an unsupported file type is rejected inline with a clear message before any run starts.
- [ ] Composer keyboard behavior: Enter sends, Shift+Enter newline, Escape clears focus; send→Stop swap still works during runs.
- [ ] `npx tsc --noEmit` clean.

## User stories addressed

- US 14 (free text + paste), US 15 (file attachments), US 16 (@-mentions as exact entity refs), US 17 (unsupported-file rejection)
