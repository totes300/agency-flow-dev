# Agency Flow — Multi-tenant B2B SaaS for Digital Agencies

## Tech Stack
- **Framework:** Next.js 16.1.6 (App Router, React 19.2.3)
- **Backend:** Convex 1.33.1 (real-time database, serverless functions)
- **Auth:** Clerk 7.0.4 (`@clerk/nextjs`) — authentication, user management, organizations
- **Styling:** Tailwind CSS v4 + shadcn/ui 4.0.7 (Radix UI primitives via `radix-ui` 1.4.3)
- **Icons:** Lucide React 0.577.0
- **Webhook validation:** Svix 1.88.0 (Clerk webhook signature verification)
- **Language:** TypeScript 5 (strict mode)

## Implementation Plan
Detailed phase-by-phase specs live in `docs/`. Read the relevant phase doc before starting work.

| Phase | Name | Depends on | Doc |
|-------|------|------------|-----|
| 0 | Foundation (orgSettings, statuses, roles) | Starter (done) | `docs/phase-0-foundation.md` |
| 1 | Work Categories (rates, colors) | Phase 0 | `docs/phase-1-work-categories.md` |
| 2 | Clients (directory, contacts, billing) | Phase 0 | `docs/phase-2-clients.md` |
| 3 | Projects Core (Fixed + T&M) | Phase 1 + 2 | `docs/phase-3-projects-core.md` |
| 4 | Projects Retainer (cycles, rollover) | Phase 3 | `docs/phase-4-projects-retainer.md` |
| 5 | Tasks Core (list, tabs, filters) | Phase 3 | `docs/phase-5-tasks-core.md` |
| 6 | Tasks Detail (modal, subtasks, rich text) | Phase 5 | `docs/phase-6-tasks-detail.md` |
| 7 | Time Tracking (timer, manual entry, rates) | Phase 5 | `docs/phase-7-time-tracking.md` |

Master overview: `docs/00-master.md`
Phase 1 & 2 can run in parallel. Phase 5, 6, 7 partially parallelizable.

## Key Architecture Decisions

### Auth Flow
- `ClerkProvider` wraps `ConvexProviderWithClerk` in root layout (Convex needs Clerk context)
- `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`) uses `createRouteMatcher` to protect all routes except `/`, `/sign-in`, `/sign-up`
- Sign-in/sign-up use Clerk's pre-built `<SignIn>` and `<SignUp>` components with catch-all routes
- Use `useConvexAuth()` from `convex/react` (not Clerk's `useAuth()`) to check if auth token is validated with the Convex backend
- Use `<Authenticated>`, `<Unauthenticated>`, `<AuthLoading>` from `convex/react` for conditional rendering around Convex queries
- Use `<Show when="signed-in">` / `<Show when="signed-out">` from `@clerk/nextjs` for Clerk-only UI checks (Clerk Core 3 replaced `<SignedIn>`/`<SignedOut>` with `<Show>`)
- Use `<Show when={{ role: 'admin' }}>` or `<Show when={{ permission: 'org:billing:manage' }}>` for role/permission-based UI

### Multi-tenancy
- Clerk Organization = tenant — every data record scoped by `orgId`
- Roles from Clerk JWT: `admin` | `member` (not custom fields)
- `TeamSwitcher` component uses `useOrganizationList()` + `useOrganization()` from Clerk
- Switch orgs via `setActive({ organization: orgId })`, set `null` for personal account
- Settings page embeds `<OrganizationProfile />` for full org management

### Convex Backend
- Auth config in `convex/auth.config.ts` connects Clerk JWT issuer to Convex
- Access user identity in Convex functions via `ctx.auth.getUserIdentity()`
- `convex/schema.ts` defines the data model — `users` table indexed by `externalId` (Clerk user ID)
- `convex/users.ts` exports `syncUser` mutation (called automatically on auth) and `current` query
- Use `getCurrentUser(ctx)` / `getCurrentUserOrThrow(ctx)` helpers in other Convex functions
- Run `npx convex dev` during development (watches for changes)
- Run `npx convex deploy` for production deployments

### User Sync Pattern
- Client-side sync: `ConvexClientProvider` calls `syncUser` mutation via `useEffect` when `isAuthenticated` becomes true
- Webhook sync: Clerk → Convex via `POST /clerk-users-webhook` (`convex/http.ts`, svix signature validation)
- The `syncUser` mutation upserts a user record by matching `identity.subject` to the `externalId` field

### Component Patterns
- shadcn/ui components live in `components/ui/` — add new ones with `npx shadcn@latest add <component>`
- Path alias `@/` maps to project root
- `"use client"` directive required for components using hooks or browser APIs

## Commands
- `npm run dev` — Start Next.js dev server
- `npx convex dev` — Start Convex dev server (run alongside Next.js)
- `npm run build` — Production build
- `npm run lint` — ESLint with Convex plugin

## Environment Variables
Copy `.env.example` to `.env.local` and fill in values. Required:
- `NEXT_PUBLIC_CONVEX_URL` — Convex deployment URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — Clerk publishable key
- `CLERK_SECRET_KEY` — Clerk secret key
- `CLERK_JWT_ISSUER_DOMAIN` — Clerk Frontend API URL (for Convex auth)
- `CLERK_WEBHOOK_SECRET` — Svix webhook secret (for Clerk → Convex user sync)

## Routes
- `/` — Landing page (public, auth-aware)
- `/sign-in`, `/sign-up` — Clerk auth pages (public)
- `/dashboard` — Dashboard home (protected)
- `/tasks` — Tasks list (protected, everyone)
- `/clients` — Clients list (protected, admin only)
- `/projects` — Projects list (protected, admin only)
- `/reports` — Reports (protected, admin only)
- `/my-time` — Personal time tracking (protected, everyone)
- `/settings` — Org settings with tabs: General, Team, Statuses (protected, admin only)

## Conventions
- **shadcn/ui: always check docs before building.** When adding or modifying any shadcn/ui component, run the `shadcn` skill first to review current API, props, and composition patterns. Do not rely on training data — shadcn/ui ships breaking changes frequently.
- **Library docs: use Context7 MCP, not training data.** Before using or modifying code that touches **shadcn/ui**, **Tiptap**, or **dnd-kit**, fetch the latest docs via the `context7` MCP tool (`resolve-library-id` → `query-docs`). These libraries evolve fast — stale knowledge causes subtle bugs.
- **Loading skeletons must be content-aware.** Never use generic placeholder boxes. Every `loading.tsx` and every `dynamic()` import `loading` fallback must mirror the actual content layout (same column structure, same element shapes/sizes, same spacing). If a page shows a table, the skeleton shows table rows. If a page shows a form with labels, the skeleton shows label+input pairs. No exceptions.
- **Domain UI elements are always shared components.** Any visual representation of a domain concept (status badge, category badge, user avatar, client logo, project type indicator, etc.) must be a shared component in `components/` from the first use — never defined inline in a feature file. These elements appear across multiple features and must have identical typography, sizing, and spacing everywhere. Examples: `components/status-badge.tsx`, `components/category-badge.tsx`.
- **Same interaction pattern across pages = shared hook + shared atom.** When two or more pages implement the same user interaction (inline add, inline edit, drag-to-reorder, search-filter, expand/collapse, etc.), extract it immediately — don't wait for a third occurrence. Split into: (1) a **hook** in `lib/hooks/` for the shared behavior/state (e.g. `useInlineAdd` handles active toggle, title, Enter/Escape, blur, rapid-fire), and (2) a **presentational component** in `components/` for any shared visual element (e.g. `InlineAddButton` renders the pill trigger). Each page then composes these with its own layout and submit logic. Never copy-paste interaction code between features — if the behavior is the same, the code must be the same.
- **Page files are thin orchestrators.** A `page.tsx` must NEVER contain inline component definitions. Every section, form, table, or card that has its own state or logic goes in its own file under `components/<feature>/`. The page file only imports, composes, and passes props. Target: page files under 200 lines. Example: `projects/[id]/page.tsx` imports from `components/projects/fixed-overview.tsx`, `components/projects/settings-general.tsx`, etc.
- **Helpers go in `lib/`, not inline.** Formatting functions (`formatCurrency`), date helpers, etc. live in `lib/` files and accept all context as parameters — never hardcode values like currency codes. Example: `lib/format.ts` exports `formatCurrency(amount, currency)`.
- **TypeScript must be 0 errors at all times.** Run `npx tsc --noEmit` before considering any task done. Currency values from state must be cast with `as Currency` when passed to Convex mutations. Never leave "pre-existing" errors — fix them immediately.
- **Derived state: compute, never sync.** Never use `useEffect` to set stateB when stateA changes — that's a sync loop waiting to break. Instead compute during render (`const x = derive(a, b)`), use `useMemo` if expensive, or reset in the same event handler that changes the source state. The only valid `useEffect` targets are external systems (DOM, timers, subscriptions, analytics). If your effect has a `setState` call and no external API call, it's wrong.
- **Every mutation must handle errors.** Never fire-and-forget a Convex mutation. Every `mutate()` call must have a `.catch()` or `try/catch` with `toastError()`. If the mutation has optimistic UI, the catch must also rollback. Pattern: `void doThing(args).catch((err) => toastError(err, "Failed to …"))`.
- **Filterable views persist state in URL.** Tabs, search, sort, groupBy, and filters on any list page must be stored in URL search params (`useSearchParams` / `router.push`), not `useState`. This ensures: back button works, links are shareable, page refresh preserves state. Only ephemeral UI state (open/closed dropdowns, hover, selection) stays in component state.
- **Consistent loading → empty → content flow.** Every list/table page must follow the same three-phase pattern in this order: (1) **Loading**: if data is `undefined`, return the content-aware skeleton. (2) **Empty**: if data is loaded but the collection is empty, render a dedicated `<XEmptyState />` component. (3) **Content**: render the list/table. Never mix inline empty `<p>` tags with dedicated empty state components — always use a shared empty state component per feature. One pattern, every page.
- **Backlog tracking is mandatory.** Every implemented phase must be written into `docs/backlog.md` with task-level checkboxes, verification section, and a "TODOs deferred to later phases" section listing every stub/placeholder and which phase will implement it.
- Use `cn()` from `@/lib/utils` for conditional class names
- Convex functions go in `convex/` directory as queries, mutations, or actions
- Protected pages go in `app/(dashboard)/`, public pages in `app/(auth)/` or root
- When adding new protected routes, they are automatically protected by the proxy
- When adding new public routes, add them to the `isPublicRoute` matcher in `proxy.ts`
- Navigation is defined in `lib/navigation.ts` — single source of truth for sidebar, breadcrumbs, and active states
- When adding new modules: add a `NavGroup` to `lib/navigation.ts`, create the page at `app/(dashboard)/<url>/page.tsx` — sidebar and breadcrumbs update automatically

## React Performance Rules
- **Measure before optimizing.** Use React DevTools Profiler, not intuition. Renders are normal — only optimize when you see actual slowness.
- **`React.memo` only when props are actually stable.** Never add memo without also stabilizing callbacks (`useCallback`) and objects (`useMemo`) on the parent. Convex queries return new object references every update — memo on components receiving raw query objects is only useful for non-data re-renders (selection, modals, search).
- **Prefer structural patterns over memo.** `props.children`, lifting state down, and context provider isolation (`{children}` inside provider) often eliminate unnecessary renders without any memoization API.
- **State is immutable and batched.** Always create new references when updating state. Multiple `setState` calls in one tick batch into a single render. You cannot read the new value immediately after `setState` — it's a snapshot.

Convex doesn't allow hyphens in filenames.


<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root: ./.next-docs|STOP. What you remember about Next.js is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: npx @next/codemod agents-md --output CLAUDE.md|01-app:{04-glossary.mdx}|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx,03-layouts-and-pages.mdx,04-linking-and-navigating.mdx,05-server-and-client-components.mdx,06-cache-components.mdx,07-fetching-data.mdx,08-updating-data.mdx,09-caching-and-revalidating.mdx,10-error-handling.mdx,11-css.mdx,12-images.mdx,13-fonts.mdx,14-metadata-and-og-images.mdx,15-route-handlers.mdx,16-proxy.mdx,17-deploying.mdx,18-upgrading.mdx}|01-app/02-guides:{analytics.mdx,authentication.mdx,backend-for-frontend.mdx,caching.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,data-security.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,json-ld.mdx,lazy-loading.mdx,local-development.mdx,mcp.mdx,mdx.mdx,memory-usage.mdx,multi-tenant.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,prefetching.mdx,production-checklist.mdx,progressive-web-apps.mdx,public-static-pages.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,single-page-applications.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx,videos.mdx}|01-app/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|01-app/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|01-app/02-guides/upgrading:{codemods.mdx,version-14.mdx,version-15.mdx,version-16.mdx}|01-app/03-api-reference:{07-edge.mdx,08-turbopack.mdx}|01-app/03-api-reference/01-directives:{use-cache-private.mdx,use-cache-remote.mdx,use-cache.mdx,use-client.mdx,use-server.mdx}|01-app/03-api-reference/02-components:{font.mdx,form.mdx,image.mdx,link.mdx,script.mdx}|01-app/03-api-reference/03-file-conventions/01-metadata:{app-icons.mdx,manifest.mdx,opengraph-image.mdx,robots.mdx,sitemap.mdx}|01-app/03-api-reference/03-file-conventions:{default.mdx,dynamic-routes.mdx,error.mdx,forbidden.mdx,instrumentation-client.mdx,instrumentation.mdx,intercepting-routes.mdx,layout.mdx,loading.mdx,mdx-components.mdx,not-found.mdx,page.mdx,parallel-routes.mdx,proxy.mdx,public-folder.mdx,route-groups.mdx,route-segment-config.mdx,route.mdx,src-folder.mdx,template.mdx,unauthorized.mdx}|01-app/03-api-reference/04-functions:{after.mdx,cacheLife.mdx,cacheTag.mdx,connection.mdx,cookies.mdx,draft-mode.mdx,fetch.mdx,forbidden.mdx,generate-image-metadata.mdx,generate-metadata.mdx,generate-sitemaps.mdx,generate-static-params.mdx,generate-viewport.mdx,headers.mdx,image-response.mdx,next-request.mdx,next-response.mdx,not-found.mdx,permanentRedirect.mdx,redirect.mdx,refresh.mdx,revalidatePath.mdx,revalidateTag.mdx,unauthorized.mdx,unstable_cache.mdx,unstable_noStore.mdx,unstable_rethrow.mdx,updateTag.mdx,use-link-status.mdx,use-params.mdx,use-pathname.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,use-selected-layout-segment.mdx,use-selected-layout-segments.mdx,userAgent.mdx}|01-app/03-api-reference/05-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,appDir.mdx,assetPrefix.mdx,authInterrupts.mdx,basePath.mdx,browserDebugInfoInTerminal.mdx,cacheComponents.mdx,cacheHandlers.mdx,cacheLife.mdx,compress.mdx,crossOrigin.mdx,cssChunking.mdx,devIndicators.mdx,distDir.mdx,env.mdx,expireTime.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,htmlLimitedBots.mdx,httpAgentOptions.mdx,images.mdx,incrementalCacheHandlerPath.mdx,inlineCss.mdx,isolatedDevBuild.mdx,logging.mdx,mdxRs.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactCompiler.mdx,reactMaxHeadersLength.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,sassOptions.mdx,serverActions.mdx,serverComponentsHmrCache.mdx,serverExternalPackages.mdx,staleTimes.mdx,staticGeneration.mdx,taint.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,turbopackFileSystemCache.mdx,typedRoutes.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,viewTransition.mdx,webVitalsAttribution.mdx,webpack.mdx}|01-app/03-api-reference/05-config:{02-typescript.mdx,03-eslint.mdx}|01-app/03-api-reference/06-cli:{create-next-app.mdx,next.mdx}|02-pages/01-getting-started:{01-installation.mdx,02-project-structure.mdx,04-images.mdx,05-fonts.mdx,06-css.mdx,11-deploying.mdx}|02-pages/02-guides:{analytics.mdx,authentication.mdx,babel.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,lazy-loading.mdx,mdx.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,post-css.mdx,preview-mode.mdx,production-checklist.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx}|02-pages/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|02-pages/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|02-pages/02-guides/upgrading:{codemods.mdx,version-10.mdx,version-11.mdx,version-12.mdx,version-13.mdx,version-14.mdx,version-9.mdx}|02-pages/03-building-your-application/01-routing:{01-pages-and-layouts.mdx,02-dynamic-routes.mdx,03-linking-and-navigating.mdx,05-custom-app.mdx,06-custom-document.mdx,07-api-routes.mdx,08-custom-error.mdx}|02-pages/03-building-your-application/02-rendering:{01-server-side-rendering.mdx,02-static-site-generation.mdx,04-automatic-static-optimization.mdx,05-client-side-rendering.mdx}|02-pages/03-building-your-application/03-data-fetching:{01-get-static-props.mdx,02-get-static-paths.mdx,03-forms-and-mutations.mdx,03-get-server-side-props.mdx,05-client-side.mdx}|02-pages/03-building-your-application/06-configuring:{12-error-handling.mdx}|02-pages/04-api-reference:{06-edge.mdx,08-turbopack.mdx}|02-pages/04-api-reference/01-components:{font.mdx,form.mdx,head.mdx,image-legacy.mdx,image.mdx,link.mdx,script.mdx}|02-pages/04-api-reference/02-file-conventions:{instrumentation.mdx,proxy.mdx,public-folder.mdx,src-folder.mdx}|02-pages/04-api-reference/03-functions:{get-initial-props.mdx,get-server-side-props.mdx,get-static-paths.mdx,get-static-props.mdx,next-request.mdx,next-response.mdx,use-params.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,userAgent.mdx}|02-pages/04-api-reference/04-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,assetPrefix.mdx,basePath.mdx,bundlePagesRouterDependencies.mdx,compress.mdx,crossOrigin.mdx,devIndicators.mdx,distDir.mdx,env.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,httpAgentOptions.mdx,images.mdx,isolatedDevBuild.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,serverExternalPackages.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,webVitalsAttribution.mdx,webpack.mdx}|02-pages/04-api-reference/04-config:{01-typescript.mdx,02-eslint.mdx}|02-pages/04-api-reference/05-cli:{create-next-app.mdx,next.mdx}|03-architecture:{accessibility.mdx,fast-refresh.mdx,nextjs-compiler.mdx,supported-browsers.mdx}|04-community:{01-contribution-guide.mdx,02-rspack.mdx}<!-- NEXT-AGENTS-MD-END -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
