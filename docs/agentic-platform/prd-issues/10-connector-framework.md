# 10 — Connector framework

**Type:** AFK
**Blocked by:** 01 (tool-registry integration), 00 (workspace settings surface)
**Parent PRD:** `docs/agentic-platform/prd-v1.md` → *Implementation Decisions › Connector framework*, *Module 4*, *Schema changes › connectors*

## What to build

The extensible connector chassis — everything except a real provider (Gmail is Wave 3). The platform must be connector-capable from day one so provider work later is pure addition, not surgery.

Scope:
- `connectors` table: orgId, userId (per-user auth only in V1), type, status (connected | expired | error | revoked), encrypted credentials (same AES-GCM/KEK pattern as the AI key — reuse the existing crypto helpers), scopes, connectedAt, lastUsedAt.
- Connector type catalog (code-level, like the tool registry): type, display name, auth kind, tool set. Ship one **dev/mock connector** ("Echo" — trivial auth, one tool) to exercise the full lifecycle without external OAuth.
- Connectors surface in the workspace settings area: list available types, connect / disconnect, status display; credentials never reach the client after save.
- Registry integration: connector-backed tools resolve the **running user's** connection at run time (`resolveConnection(userId, type)`); when absent/expired, the tool returns a self-explaining result the agent relays ("connect X in Settings → Connectors") — the run does not crash.
- Vitest: status/resolution logic (pure); encryption round-trip rides the existing crypto coverage.

## Acceptance criteria

- [ ] The Connectors surface lists the dev connector; connect → status connected; disconnect → revoked; states render clearly.
- [ ] Credentials are stored encrypted (ciphertext in the DB, mask in the UI) and are never included in any client-facing query result or model context.
- [ ] An agent with the dev connector's tool works for a user who connected it, and for a user who didn't, replies with the exact "connect X in Settings" guidance mid-conversation.
- [ ] Connections are strictly per-user: user A's connection is never used by user B's runs (verified with two accounts).
- [ ] Expired/errored status flips are reflected in the surface and in tool behavior.
- [ ] Resolution/status logic covered by passing Vitest tests; `npx tsc --noEmit` clean.

## User stories addressed

- US 37 (connectors surface), US 38 (per-user connect), US 39 (disconnect + status), US 40 (self-explaining missing connector), US 42 (encrypted credentials)
