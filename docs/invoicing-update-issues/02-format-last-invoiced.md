# 02 — `formatLastInvoiced` helper

**Type**: AFK
**Blocked by**: none
**Unblocks**: #07 (banner subline), #08 (breakdown header dates). Also reused by Inbox row sublines in #09.

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Time, dates, and cycle close · § Module Design #9

## What to build

Add a single shared date-formatting helper to `lib/format.ts` (alongside existing `formatCurrency`). Returns relative wording for fresh dates, absolute wording for older dates.

```ts
export function formatLastInvoiced(
  date: number | Date | null,
  now: Date = new Date()
): string;
```

Rules:
- `null` → `""` (empty)
- `< 14 days` → relative ("today", "yesterday", "3 days ago", "13 days ago")
- `≥ 14 days` → absolute ("Mar 1, 2026")

## Acceptance criteria

- [ ] Function exported from `lib/format.ts`.
- [ ] Unit tests cover: `null`, today (0d), yesterday (1d), 13d ago, 14d ago boundary, 60d ago, 1 year ago.
- [ ] Tests run via the project's test runner (mirror prior art in `convex/lib/__tests__/retainerBalance.test.ts`).
- [ ] `npx tsc --noEmit` clean.

## Verification

`npm test` (or equivalent) — all `formatLastInvoiced` cases green.

## User stories addressed

- Supports 16 (last-invoiced subline), 26 (cadence chip threshold)

## Notes

- Pure function. Single source of truth — banner subline, Inbox row subline, cadence-chip threshold all read from this. Do not duplicate this logic anywhere.
- Cadence chip threshold (`daysSinceLastInvoice ≥ 30`) lives in component logic but reuses this helper's `now` argument for testability.
