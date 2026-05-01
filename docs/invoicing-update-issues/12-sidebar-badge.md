# 12 — Sidebar badge + `getInvoicingNavSignals`

**Type**: AFK
**Blocked by**: #09 (`getReadyToInvoiceUnified` exists; this query may compose it)
**Unblocks**: nothing

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Module Design #7 · User stories 1, 2, 3, 4

## What to build

Surface "what needs my attention" on the sidebar `Invoices` row.

### Backend

**Query: `getInvoicingNavSignals` (admin-only)**

```ts
returns: { toGenerateCount: number; hasOverdue: boolean }
```

Implementation: thin wrapper. `toGenerateCount` = `getReadyToInvoiceUnified().length`. `hasOverdue` = boolean count probe over invoices where `status === "overdue"`.

No tests required (thin composition over already-tested queries; correctness reduces to its inputs).

### UI (sidebar)

On the `Invoices` nav row:

- **Badge**: count pill on the right when `toGenerateCount > 0`. Hides at zero.
- **Calendar-clock icon** (Lucide `CalendarClock`): inline before/after the badge when `hasOverdue === true`. Hides when no overdue.
- **Tooltip on hover**: `"{toGenerateCount} ready to bill · {N} overdue"` (combined when both present, simplified copy when only one). Self-teaching — the icon meaning is explained on hover.
- **Clean state**: when `toGenerateCount === 0 && !hasOverdue`, neither badge nor icon renders. Just the nav label.

### Member visibility

Sidebar row is hidden for members entirely (handled by #01 — verify it's still hidden after this issue).

## Acceptance criteria

- [ ] `getInvoicingNavSignals` implemented + admin-only.
- [ ] Sidebar `Invoices` row renders badge when count > 0, hides at zero.
- [ ] Calendar-clock icon renders when `hasOverdue`, hides otherwise.
- [ ] Tooltip text matches user-story 3 wording.
- [ ] Member account: nav row not visible (regression check on #01).
- [ ] `npx tsc --noEmit` clean.

## Verification

1. Seed dummy data with 0 to-generate, 0 overdue → sidebar Invoices row has no badge, no icon, plain text.
2. Add 3 to-generate → badge shows `3`. Hover → tooltip `"3 ready to bill"`.
3. Add 2 overdue → calendar-clock icon appears. Tooltip → `"3 ready to bill · 2 overdue"`.
4. Mark all paid + delete to-generate sources → badge + icon disappear.
5. Member account → no nav row.

## User stories addressed

- 1 (sidebar badge with count)
- 2 (calendar-clock icon when overdue)
- 3 (tooltip wording)
- 4 (clean state — badge + icon both hide)

## Notes

- Use `lib/navigation.ts` for nav definition (per `CLAUDE.md` — single source of truth for sidebar).
- Use shadcn `Tooltip` — confirm API via `shadcn` skill.
- `useQuery` returns `undefined` while loading — render the nav row plain (no badge) during load, not a skeleton. The badge appearing is the signal; absence is silent.
