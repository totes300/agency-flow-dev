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
