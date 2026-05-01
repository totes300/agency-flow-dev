# 06 — Payment instructions block on invoice document

**Type**: AFK
**Blocked by**: #03 (`paymentInstructions` field)
**Unblocks**: nothing

## Parent PRD

[`docs/invoicing-update-prd.md`](../invoicing-update-prd.md) — User story 41

## What to build

Render a read-only "Payment instructions" block on every invoice document, sourced from `orgSettings.paymentInstructions`.

Position: **above** the `<InvoiceMessageBlock />` (#05). Shown on draft, invoiced, paid, and void docs.

Render nothing if `paymentInstructions` is unset or empty.

Component: `components/invoices/payment-instructions-block.tsx` — small, presentational, reads pre-fetched org settings via prop.

## Acceptance criteria

- [ ] Component lives at `components/invoices/payment-instructions-block.tsx`.
- [ ] Renders org `paymentInstructions` as plain text (preserve newlines via `whitespace-pre-line` or similar).
- [ ] Renders nothing when value is unset/empty (no header, no border, no padding).
- [ ] Always read-only — no edit affordance per-invoice.
- [ ] Wired into the invoice document layout above the message block.
- [ ] `npx tsc --noEmit` clean.

## Verification

1. Set `paymentInstructions` in Settings (#03), save.
2. Open any invoice document → block renders above the message block.
3. Clear `paymentInstructions`, save. Open invoice → block is gone, no empty space.

## User stories addressed

- 41 (org-level payment instructions on every doc)

## Notes

- Markdown rendering is **not required** for this PRD — plain text with preserved newlines is enough. Defer Markdown if it adds dependencies.
- The block is positioned above the message because the PRD treats payment-info as the "system" voice and the message as the "personal" voice, in that reading order on the doc.
