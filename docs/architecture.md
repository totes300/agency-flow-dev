# Agency Flow architecture

This document records stable system boundaries. Inspect the implementation for
current routes, modules, and dependency versions.

## Application shell

- The application uses the Next.js App Router.
- `ClerkProvider` wraps the Convex provider because Convex authentication depends
  on Clerk context.
- `proxy.ts` protects non-public routes and provides route-level role checks.
  Backend authorization remains mandatory even when a route is guarded.
- Public and protected route groups live under `app/`. Treat the filesystem as the
  route inventory rather than maintaining a duplicate list here.
- Navigation metadata is centralized in `lib/navigation.ts`; route-access policy is
  centralized in `lib/route-access.ts` where applicable.

## Authentication and tenancy

- A Clerk Organization represents an Agency Flow tenant.
- Convex obtains identity through Clerk-issued JWTs configured in
  `convex/auth.config.ts`.
- Protected queries and mutations use the helpers in `convex/lib/auth.ts` to derive
  the current user, organization, and role.
- Tenant-owned records carry `orgId`. Collection queries should start from an
  organization-scoped index; direct document reads validate ownership after the
  lookup.
- See `docs/security/tenancy.md` for implementation and review requirements.

## Convex backend

- `convex/schema.ts` is the data-model source of truth.
- Public client-facing operations use Convex queries, mutations, and actions;
  internal-only operations use internal functions.
- Prefer bounded indexed queries. Avoid unbounded collections and post-query
  filtering when the schema can express the access path.
- User synchronization is implemented through the client provider and Clerk
  webhook flow. Inspect `components/convex-client-provider.tsx`, `convex/users.ts`,
  and `convex/http.ts` before changing it.

## Billing

Time tracking → reporting → invoicing runs on one model, the **close**
(`docs/prd-billing-refactor.md` is the source of truth; its invariants N1–N11
are enforced and tested).

- A `billingCloses` row is the committed decision "these entries settle period P
  of project X". `billingCloseEntries` is its immutable snapshot; an entry's
  `closeId` is only a lock and lookup key. `billingEvents` is the append-only
  audit trail of every billing state change.
- Pure modules own the rules: `convex/lib/billing/periods.ts` (the period grid),
  `scope.ts` (which open entries a period settles), `pricing.ts` (the only place
  minutes become money) and `money.ts` (integer minor units, rounding).
- Lifecycles own every write: `lib/billing/closeLifecycle.ts` (`commitClose`, the
  only way a retainer/T&M close or invoice comes into being, and `releaseClose`)
  and `lib/billing/invoiceLifecycle.ts` (finalize, revert, void, paid, delete
  draft, numbering). Public entry points are `convex/billingCloses.ts`,
  `convex/billingInvoices.ts` (fixed-fee invoices, draft line edits) and the
  status mutations in `convex/invoices.ts`.
- Readers go through `lib/billing/periodView.ts`: a period with a live close reads
  its snapshot, any other period is priced live from the scope rule. Views:
  `convex/billingViews.ts` (Close queue, badge, workspace) and
  `convex/billingReports.ts` (monthly report). `lib/billing/closeData.ts` is the
  only docs → model mapping.
- Money is stored only as integer minor units. Queries add decimal display
  amounts at the read boundary (`lib/billing/invoiceView.ts`); the UI formats
  them and never prices anything.
- Fixed-fee projects have no periods or closes; their entries never lock.

## Frontend boundaries

- `app/` owns routing and page composition.
- `components/ui/` contains shadcn/ui primitives.
- Feature components live under `components/<feature>/`; genuinely shared domain
  components live at the closest common component boundary.
- `lib/` contains shared domain logic, formatting, navigation, and hooks.
- Client components are used only where hooks, events, context, or browser APIs
  require them. Preserve server/client boundaries rather than adding `"use client"`
  broadly.

## State and data flow

- Convex is the source of truth for persisted application data.
- Shareable list state such as filters, search, sorting, grouping, and tabs should
  normally be represented in the URL.
- Local React state is for transient interaction state.
- Avoid duplicating server data or derived state in effects.

## UI consistency

- Domain concepts such as statuses, categories, people, clients, and project types
  should render consistently across features.
- Repeated behavior should be shared after its contract becomes clear; similarity
  alone is not sufficient reason to create an abstraction.
- Loading placeholders should preserve the geometry of the final content, and
  empty results should have an intentional feature-level empty state.
