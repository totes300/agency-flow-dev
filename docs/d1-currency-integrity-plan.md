# D1 — Currency Integrity Enforcement

**Status**: Planning
**Owner**: Adam
**Blocks**: Project Summary Card PRD (`docs/project-summary-prd.md`)
**Scope**: tests + guardrails + legacy cleanup + docs. **MVP project with dummy-only data — no audit or migration needed; all existing `timeEntries` can be freely truncated if they don't match the invariant.**

---

## 1. Problem

The Project Summary card (`api.projects.getSummary`) sums money amounts across entries without currency partitioning, trusting that **every entry on a project is denominated in the project's currency**. If this invariant were ever broken, the card would silently produce wrong numbers.

We need **confidence** that the invariant holds for historical data and continues to hold for all future data.

---

## 2. Current state (what I found in the codebase)

The invariant **is already enforced by construction** for new data. Concrete findings:

| Mechanism | Where | Status |
|---|---|---|
| Project currency = client currency | `convex/lib/orgHelpers.ts:17-26` (`getProjectCurrency`) | ✓ Derived, not duplicated canonically |
| `client.currency` immutable after creation | `convex/clients.ts:178` (comment: *"currency is immutable after creation — not accepted in update"*) | ✓ Enforced at mutation layer |
| `project.clientId` not mutable | `convex/projects.ts:230-271` (`update` mutation doesn't accept `clientId`) | ✓ Projects can't change client |
| `userRates` keyed per currency | `convex/schema.ts:340` (`by_orgId_userId_currency` index) | ✓ Per-currency lookup |
| `categoryRates` keyed per currency | `convex/schema.ts:352` (`by_orgId_workCategoryId_currency`) | ✓ Per-currency lookup |
| Rate resolution throws on missing rate | `convex/lib/rates.ts:35-40` | ✓ No silent zero-rate fallback |
| `timeEntries.rateCurrency` = `project.currency` | `convex/lib/orgHelpers.ts:47,106` (`rateCurrency: currency`) | ✓ Snapshotted at creation |

**Conclusion**: the runtime invariant `entry.rateCurrency == client.currency(project.clientId)` holds for every entry created through `timeEntries.create` or `timeEntries.update`.

### Residual risks (drift vectors)

1. **Legacy / imported data**: entries created before this enforcement existed may have mismatched `rateCurrency`. No automatic audit has run.
2. **Direct DB patches**: any `ctx.db.patch` on an entry bypassing `update` mutation is a hole. No existing code does this, but future code could.
3. **`projects.currency` legacy field**: still written during project creation (`projects.ts:180`) but flagged for removal (`schema.ts:182`). If this field is ever read authoritatively (instead of `getProjectCurrency`), and drift were possible, bad math would result. Current readers are clean, but this is a footgun.
4. **No regression tests**: `resolveRate` has a single test file (`convex/lib/rates.test.ts`, mentioned by Codex); no tests for the new-for-PRD scenario of "user has rate in wrong currency → throw".

---

## 3. Goal

Move from "invariant holds by construction" to "invariant **regression-proofed against future drift** and **not duplicated as a legacy field** ripe for desync."

Specifically:

- **(G1)** Prove the invariant via unit tests on `resolveRate` / `resolveRateSnapshot`.
- **(G2)** Codify the invariant in a schema-level comment so future devs don't violate it.
- **(G3)** Remove the legacy `projects.currency` field (single source of truth: `client.currency`).
- **(G4)** Surface config gaps proactively in the UI (admin sees "User X has no cost rate in EUR" in Project Settings before time logging fails).

G1–G3 are required to unblock the PRD. G4 is optional polish.

**MVP simplification**: since all current data is dummy and disposable, we skip the audit + repair migration paths that would be needed in a production system. If any legacy time entries exist with mismatched currency after implementation, the developer wipes them (`ctx.db.delete` in a one-shot seed-reset script) — no careful re-snapshot logic needed.

---

## 4. Required changes

### 4.1 Tests — required

Add `convex/lib/__tests__/rates.test.ts` (currently only `rates.test.ts` per Codex, unverified). Must cover:

- User has userRate only in USD, project in EUR → throws with `"Set a cost rate for this user in EUR"`.
- User has userRate in EUR, project in EUR → success, snapshot currency = EUR.
- Project billable, no `projectRateOverride`, no `categoryRate` in EUR → throws.
- Project billable, `projectRateOverride` exists → uses override regardless of categoryRate presence.
- Retainer billable → billableRate = 0 regardless of rates config.
- Non-billable entry on billable project → billableRate = 0, costRate from userRate.

Plus integration test for `resolveRateSnapshot`:
- Snapshot stores `rateCurrency == client.currency` for every successful resolution.
- If `client.currency` ≠ any user rate currency, throws before insert.

### 4.2 Schema-level invariant — required

Add a header comment block in `convex/schema.ts` above `timeEntries`:

```
// INVARIANT (D1): timeEntries.rateCurrency MUST equal client.currency(task.projectId.clientId).
//   Enforced at creation via resolveRateSnapshot (convex/lib/orgHelpers.ts).
//   Rationale: Project Summary card aggregates money without currency partition.
//   Drift vectors eliminated: client.currency is immutable, project.clientId is immutable.
//   Before adding a mutation that patches rateCurrency or clientId directly, read docs/d1-currency-integrity-plan.md.
```

### 4.3 `projects.currency` legacy field removal — required

The field is flagged TODO for removal (`schema.ts:182`). Use this D1 ticket to finish it.

**Since data is dummy**, we skip the widen-migrate-narrow dance and do a **direct narrow**:

1. Add `currency` as an explicit field on every query return shape that frontend components consume (e.g. `projects.get` already returns the doc; extend it to include `currency: await getProjectCurrency(ctx, project)` as a resolved string).
2. Grep all readers of `project.currency` in `convex/` and `components/` — replace with the query-provided currency or `getProjectCurrency(ctx, project)`.
3. Stop writing to `project.currency` in `projects.create` (`projects.ts:180`).
4. Drop `currency` from the `projects` schema field set.
5. Wipe any existing `timeEntries` in the dev Convex deployment if they cause issues (disposable dummy data).

**Frontend readers today** (based on PRD research — quick grep during implementation): `FixedOverview`, `TmOverview`, `RetainerOverview`, `ProjectDetailHeader`, and several invoice modals. Each should receive `currency` as a resolved string prop from its parent query result.

### 4.4 Proactive UX — optional (G4)

Two admin-facing config gap surfacings:

1. **Project Settings → Team tab**: when an admin adds a user to a project team, check if the user has a cost rate in the project currency. If not, show an inline warning:
   > ⚠ No cost rate set for this user in EUR. Time logging will fail until a rate is added. [Set rate →]

2. **Project Settings → Rates tab (T&M / Fixed)**: for each category that has a task assigned, check if a billable rate resolves (project override OR category default in project currency). If not, show:
   > ⚠ No billable rate for **Design** in EUR. Time logging for Design tasks will fail. [Set rate →]

These prevent the "time logger gets a cryptic error" UX. Can ship in same PR or a follow-up.

---

## 5. Implementation plan (single PR)

**File changes** (estimated):

1. `convex/lib/__tests__/rates.test.ts` — expand (~8 new test cases).
2. `convex/schema.ts` — add invariant comment; drop `currency` from `projects` table.
3. `convex/projects.ts` — drop `currency` write in `create` mutation; extend query return shapes (`get`, `list`, `getRetainerData`, upcoming `getSummary`) to include resolved `currency: string` field.
4. Grep + replace `project.currency` reads across `convex/` and `components/` with query-provided `currency` prop or `getProjectCurrency` (~10–20 sites).
5. Wipe `timeEntries` in dev Convex deployment if legacy dummy data causes type mismatches.

**If G4 (proactive UX) is in scope**: add warnings to `components/projects/project-team.tsx` and `components/projects/settings-rates.tsx` (~40 lines each).

### Execution order

1. Add unit tests to `convex/lib/__tests__/rates.test.ts` (§4.1).
2. Add schema-level invariant comment above `timeEntries` (§4.2).
3. Extend `projects.get` / `list` / `getRetainerData` return shapes with resolved `currency`.
4. Grep all `project.currency` readers in `convex/` + `components/`; replace with query-provided field. Run `npx tsc --noEmit` to confirm no stragglers.
5. Drop `currency` write in `projects.create`. Drop field from schema. If dev data breaks, wipe `timeEntries` + re-seed.
6. (Optional) Add G4 UX warnings in Project Settings.

---

## 6. Acceptance criteria

- [ ] `convex/lib/__tests__/rates.test.ts` covers all 8 scenarios listed in §4.1.
- [ ] `convex/schema.ts` contains the invariant comment block above `timeEntries`.
- [ ] `projects.currency` field **completely removed** from schema.
- [ ] Grep `project\.currency` across the repo returns zero hits.
- [ ] All query return shapes that components consume include a resolved `currency: string` field.
- [ ] `npm run lint` clean.
- [ ] `npx tsc --noEmit` clean.

---

## 7. Out of scope (explicit)

- **FX conversion** across currencies (cross-project reporting).
- **Multi-currency per project** (not supported, never will be per product direction).
- **Runtime currency partition in `getSummary`** (belongs to data integrity, not reporting).
- **Historical rate change tracking** (rate edits don't retroactively update existing entry snapshots — this is correct and intentional).
- **Client currency migration tooling** (clients are immutable-currency by product rule).
- **Draft-invoice currency mismatch detection** (invoices inherit project currency at creation; covered by same invariant).

---

## 8. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Removing `projects.currency` breaks a frontend reader not caught in grep | Medium | TypeScript will catch any `project.currency` access after schema change — fail-fast compile error |
| Dummy `timeEntries` in dev have legacy shape and break on schema change | Medium | Wipe via `ctx.db.delete` in a one-shot mutation or redeploy from a clean seed |
| Proactive UX warnings (G4) block admin if check logic is wrong | Medium | Make warnings non-blocking (inline, not modal); admin can still save config |

---

## 9. Dependencies

- **This plan has none.** It's fully self-contained and can execute before the Project Summary PRD.
- **The Project Summary PRD depends on this being §4.1 + §4.2 + §4.3 complete** (tests passing, invariant documented, legacy `projects.currency` removed and readers migrated to `currency` prop). §4.4 (G4) is optional polish and can be parallel / follow-up.

---

## 10. Decision log

- **Why no runtime currency partition in `getSummary`?** See §7. The runtime already enforces the invariant; partitioning would be patching a symptom.
- **Why skip audit + migration?** MVP with dummy-only data. Real-world migration care (re-snapshotting, freezing invoiced entries) is unnecessary overhead — we can simply wipe and re-seed.
- **Why skip the dev-only canary assertion?** With tests locking `resolveRate` behavior and the legacy `projects.currency` field removed, the invariant is enforced structurally. A canary is redundant; if a future dev adds a bypass, the tests (and schema comment) will catch it.
- **Why remove `projects.currency` instead of using it as source of truth?** Dual source of truth (project.currency vs client.currency) is a drift vector. The legacy field comment already flagged it for removal. Now is the time.
- **Why direct narrow instead of widen-migrate-narrow?** Dummy data, no production deployment to coordinate, no invoiced entries to protect. Schema change + code grep is enough.
