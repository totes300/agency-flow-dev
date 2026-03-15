# Project: Next.js + Convex + Clerk B2B SaaS Starter

## Tech Stack
- **Framework:** Next.js 16 (App Router, React 19)
- **Backend:** Convex (real-time database, serverless functions)
- **Auth:** Clerk (authentication, user management, organizations)
- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix UI primitives)
- **Icons:** Lucide React
- **Language:** TypeScript (strict mode)

## Project Structure
```
app/                    # Next.js App Router pages
  page.tsx              # Landing page (auth-aware)
  not-found.tsx         # Custom 404 page
  (auth)/               # Auth route group (public) — sign-in, sign-up
  (dashboard)/          # Dashboard route group (protected)
    layout.tsx          # Sidebar + dynamic breadcrumbs
    error.tsx           # Error boundary with retry
    dashboard/
      page.tsx          # Dashboard home (shows Convex user data)
      settings/page.tsx # Org settings (Clerk OrganizationProfile)
components/             # React components
  ui/                   # shadcn/ui components (do not edit manually)
  convex-client-provider.tsx  # ConvexProviderWithClerk wrapper + user sync
  app-sidebar.tsx       # Sidebar with team switcher + navigation
  team-switcher.tsx     # Clerk organization switcher (self-contained)
  nav-main.tsx          # Main navigation links
  nav-user.tsx          # User menu with Clerk profile/signout
convex/                 # Convex backend
  schema.ts             # Database schema (users table)
  users.ts              # User queries (current) + mutations (syncUser)
  auth.config.ts        # Clerk auth config for Convex
  _generated/           # Auto-generated types (do not edit)
hooks/                  # Custom React hooks
lib/                    # Utility functions
proxy.ts           # Clerk auth proxy (protects routes, Next.js 16 "proxy" replaces "middleware")
```

## Key Architecture Decisions

### Auth Flow
- `ClerkProvider` wraps `ConvexProviderWithClerk` in root layout (Convex needs Clerk context)
- `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`) uses `createRouteMatcher` to protect all routes except `/`, `/sign-in`, `/sign-up`
- Sign-in/sign-up use Clerk's pre-built `<SignIn>` and `<SignUp>` components with catch-all routes
- Use `useConvexAuth()` from `convex/react` (not Clerk's `useAuth()`) to check if auth token is validated with the Convex backend
- Use `<Authenticated>`, `<Unauthenticated>`, `<AuthLoading>` from `convex/react` for conditional rendering around Convex queries
- Use `<Show when="signed-in">` / `<Show when="signed-out">` from `@clerk/nextjs` for Clerk-only UI checks (Clerk Core 3 replaced `<SignedIn>`/`<SignedOut>` with `<Show>`)
- Use `<Show when={{ role: 'admin' }}>` or `<Show when={{ permission: 'org:billing:manage' }}>` for role/permission-based UI

### Convex Backend
- Auth config in `convex/auth.config.ts` connects Clerk JWT issuer to Convex
- Access user identity in Convex functions via `ctx.auth.getUserIdentity()`
- `convex/schema.ts` defines a `users` table indexed by `externalId` (Clerk user ID)
- `convex/users.ts` exports `syncUser` mutation (called automatically on auth) and `current` query
- Use `getCurrentUser(ctx)` / `getCurrentUserOrThrow(ctx)` helpers in other Convex functions
- Run `npx convex dev` during development (watches for changes)
- Run `npx convex deploy` for production deployments

### User Sync Pattern
- Client-side sync: `ConvexClientProvider` calls `syncUser` mutation via `useEffect` when `isAuthenticated` becomes true
- The `syncUser` mutation upserts a user record by matching `identity.subject` to the `externalId` field
- For production, supplement with Clerk webhooks (see README "Production Hardening")

### Organization Support
- `TeamSwitcher` component uses `useOrganizationList()` + `useOrganization()` from Clerk — no props needed
- Switch orgs via `setActive({ organization: orgId })`, set `null` for personal account
- Settings page embeds `<OrganizationProfile />` for full org management
- Clerk Organizations must be enabled in the Clerk dashboard

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

## Routes
- `/` — Landing page (public, auth-aware)
- `/sign-in`, `/sign-up` — Clerk auth pages (public)
- `/dashboard` — Dashboard home (protected)
- `/dashboard/settings` — Organization settings (protected)

## Conventions
- Use `cn()` from `@/lib/utils` for conditional class names
- Convex functions go in `convex/` directory as queries, mutations, or actions
- Protected pages go in `app/(dashboard)/`, public pages in `app/(auth)/` or root
- When adding new protected routes, they are automatically protected by the proxy
- When adding new public routes, add them to the `isPublicRoute` matcher in `proxy.ts`
- When adding new dashboard routes, add a label in `routeLabels` in `app/(dashboard)/layout.tsx` for breadcrumbs
- When adding new nav items, update `navItems` in `components/app-sidebar.tsx`

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root: ./.next-docs|STOP. What you remember about Next.js is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: npx @next/codemod agents-md --output CLAUDE.md|01-app:{04-glossary.mdx}|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx,03-layouts-and-pages.mdx,04-linking-and-navigating.mdx,05-server-and-client-components.mdx,06-cache-components.mdx,07-fetching-data.mdx,08-updating-data.mdx,09-caching-and-revalidating.mdx,10-error-handling.mdx,11-css.mdx,12-images.mdx,13-fonts.mdx,14-metadata-and-og-images.mdx,15-route-handlers.mdx,16-proxy.mdx,17-deploying.mdx,18-upgrading.mdx}|01-app/02-guides:{analytics.mdx,authentication.mdx,backend-for-frontend.mdx,caching.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,data-security.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,json-ld.mdx,lazy-loading.mdx,local-development.mdx,mcp.mdx,mdx.mdx,memory-usage.mdx,multi-tenant.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,prefetching.mdx,production-checklist.mdx,progressive-web-apps.mdx,public-static-pages.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,single-page-applications.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx,videos.mdx}|01-app/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|01-app/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|01-app/02-guides/upgrading:{codemods.mdx,version-14.mdx,version-15.mdx,version-16.mdx}|01-app/03-api-reference:{07-edge.mdx,08-turbopack.mdx}|01-app/03-api-reference/01-directives:{use-cache-private.mdx,use-cache-remote.mdx,use-cache.mdx,use-client.mdx,use-server.mdx}|01-app/03-api-reference/02-components:{font.mdx,form.mdx,image.mdx,link.mdx,script.mdx}|01-app/03-api-reference/03-file-conventions/01-metadata:{app-icons.mdx,manifest.mdx,opengraph-image.mdx,robots.mdx,sitemap.mdx}|01-app/03-api-reference/03-file-conventions:{default.mdx,dynamic-routes.mdx,error.mdx,forbidden.mdx,instrumentation-client.mdx,instrumentation.mdx,intercepting-routes.mdx,layout.mdx,loading.mdx,mdx-components.mdx,not-found.mdx,page.mdx,parallel-routes.mdx,proxy.mdx,public-folder.mdx,route-groups.mdx,route-segment-config.mdx,route.mdx,src-folder.mdx,template.mdx,unauthorized.mdx}|01-app/03-api-reference/04-functions:{after.mdx,cacheLife.mdx,cacheTag.mdx,connection.mdx,cookies.mdx,draft-mode.mdx,fetch.mdx,forbidden.mdx,generate-image-metadata.mdx,generate-metadata.mdx,generate-sitemaps.mdx,generate-static-params.mdx,generate-viewport.mdx,headers.mdx,image-response.mdx,next-request.mdx,next-response.mdx,not-found.mdx,permanentRedirect.mdx,redirect.mdx,refresh.mdx,revalidatePath.mdx,revalidateTag.mdx,unauthorized.mdx,unstable_cache.mdx,unstable_noStore.mdx,unstable_rethrow.mdx,updateTag.mdx,use-link-status.mdx,use-params.mdx,use-pathname.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,use-selected-layout-segment.mdx,use-selected-layout-segments.mdx,userAgent.mdx}|01-app/03-api-reference/05-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,appDir.mdx,assetPrefix.mdx,authInterrupts.mdx,basePath.mdx,browserDebugInfoInTerminal.mdx,cacheComponents.mdx,cacheHandlers.mdx,cacheLife.mdx,compress.mdx,crossOrigin.mdx,cssChunking.mdx,devIndicators.mdx,distDir.mdx,env.mdx,expireTime.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,htmlLimitedBots.mdx,httpAgentOptions.mdx,images.mdx,incrementalCacheHandlerPath.mdx,inlineCss.mdx,isolatedDevBuild.mdx,logging.mdx,mdxRs.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactCompiler.mdx,reactMaxHeadersLength.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,sassOptions.mdx,serverActions.mdx,serverComponentsHmrCache.mdx,serverExternalPackages.mdx,staleTimes.mdx,staticGeneration.mdx,taint.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,turbopackFileSystemCache.mdx,typedRoutes.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,viewTransition.mdx,webVitalsAttribution.mdx,webpack.mdx}|01-app/03-api-reference/05-config:{02-typescript.mdx,03-eslint.mdx}|01-app/03-api-reference/06-cli:{create-next-app.mdx,next.mdx}|02-pages/01-getting-started:{01-installation.mdx,02-project-structure.mdx,04-images.mdx,05-fonts.mdx,06-css.mdx,11-deploying.mdx}|02-pages/02-guides:{analytics.mdx,authentication.mdx,babel.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,lazy-loading.mdx,mdx.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,post-css.mdx,preview-mode.mdx,production-checklist.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx}|02-pages/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|02-pages/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|02-pages/02-guides/upgrading:{codemods.mdx,version-10.mdx,version-11.mdx,version-12.mdx,version-13.mdx,version-14.mdx,version-9.mdx}|02-pages/03-building-your-application/01-routing:{01-pages-and-layouts.mdx,02-dynamic-routes.mdx,03-linking-and-navigating.mdx,05-custom-app.mdx,06-custom-document.mdx,07-api-routes.mdx,08-custom-error.mdx}|02-pages/03-building-your-application/02-rendering:{01-server-side-rendering.mdx,02-static-site-generation.mdx,04-automatic-static-optimization.mdx,05-client-side-rendering.mdx}|02-pages/03-building-your-application/03-data-fetching:{01-get-static-props.mdx,02-get-static-paths.mdx,03-forms-and-mutations.mdx,03-get-server-side-props.mdx,05-client-side.mdx}|02-pages/03-building-your-application/06-configuring:{12-error-handling.mdx}|02-pages/04-api-reference:{06-edge.mdx,08-turbopack.mdx}|02-pages/04-api-reference/01-components:{font.mdx,form.mdx,head.mdx,image-legacy.mdx,image.mdx,link.mdx,script.mdx}|02-pages/04-api-reference/02-file-conventions:{instrumentation.mdx,proxy.mdx,public-folder.mdx,src-folder.mdx}|02-pages/04-api-reference/03-functions:{get-initial-props.mdx,get-server-side-props.mdx,get-static-paths.mdx,get-static-props.mdx,next-request.mdx,next-response.mdx,use-params.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,userAgent.mdx}|02-pages/04-api-reference/04-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,assetPrefix.mdx,basePath.mdx,bundlePagesRouterDependencies.mdx,compress.mdx,crossOrigin.mdx,devIndicators.mdx,distDir.mdx,env.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,httpAgentOptions.mdx,images.mdx,isolatedDevBuild.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,serverExternalPackages.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,webVitalsAttribution.mdx,webpack.mdx}|02-pages/04-api-reference/04-config:{01-typescript.mdx,02-eslint.mdx}|02-pages/04-api-reference/05-cli:{create-next-app.mdx,next.mdx}|03-architecture:{accessibility.mdx,fast-refresh.mdx,nextjs-compiler.mdx,supported-browsers.mdx}|04-community:{01-contribution-guide.mdx,02-rspack.mdx}<!-- NEXT-AGENTS-MD-END -->
