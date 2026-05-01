# 03 — Org-level invoice template settings

**Type**: AFK
**Blocked by**: none
**Unblocks**: #04 (template seeded into createInvoice), #06 (payment instructions block reads from here)

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — § Schema changes · User stories 37, 41

## What to build

### Schema (`convex/schema.ts`)

Add two optional fields to `orgSettings`:

```ts
paymentInstructions: v.optional(v.string()),
invoiceMessageTemplate: v.optional(v.string()),
```

`invoicePrefix` already exists — leave it untouched (still gated by existing `hasAnyInvoice` lock).

### Backend

Update the existing `orgSettings` update mutation (or add fields to whichever mutation maintains org settings) to accept and persist both fields. Admin-only (use existing `requireAdmin`).

### UI

Add two `Textarea` (shadcn/ui) fields to the Settings → General tab:

- **Payment instructions** — multiline. Hint: "Renders on every invoice document. IBAN, Stripe link, terms, etc."
- **Default message to client** — multiline. Hint: "Seeded into every new invoice's message block. You can edit per-invoice."

Use the existing settings save flow (whatever pattern Settings → General already uses for other fields). Both fields are optional — empty values must persist as `undefined`, not empty string, to keep the `v.optional` semantics clean.

## Acceptance criteria

- [ ] Schema accepts both new fields.
- [ ] Settings → General renders the two textareas and persists changes.
- [ ] Empty input clears the field (stored as `undefined` or removed from doc).
- [ ] Admin-only — non-admin can't render or call the mutation.
- [ ] `npx tsc --noEmit` clean. `npm run lint` clean.
- [ ] No data backfill needed (MVP, dummy data — see memory `project_mvp_dummy_data`).

## Verification

1. Sign in as admin → Settings → General. See two new textareas, blank.
2. Type into both, save. Refresh. Values persist.
3. Clear both, save. Refresh. Values are gone.
4. Sign in as member → can't see Settings page anyway (existing behavior). Direct mutation call rejected.

## User stories addressed

- 37 (template-seeded message)
- 41 (payment instructions on every doc)

## Notes

- Use the `shadcn` skill before writing the textareas — confirm current shadcn `Textarea` API.
- Per `CLAUDE.md`: domain settings UI elements are shared if they appear elsewhere; for now this is settings-only so inline composition is fine.
