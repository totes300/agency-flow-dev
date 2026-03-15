# Next.js + Convex + Clerk B2B SaaS Starter

A production-ready starter template for building B2B SaaS applications with **Next.js 16**, **Convex**, and **Clerk**.

## Tech Stack

- **Framework:** Next.js 16 (App Router, React 19)
- **Backend:** Convex (real-time database, serverless functions)
- **Auth:** Clerk (authentication, organizations, roles)
- **Styling:** Tailwind CSS v4 + shadcn/ui

## Features

- Clerk authentication with sign-in/sign-up flows
- Organization support (create, switch, manage members)
- Convex backend with user sync (Clerk → Convex)
- Protected dashboard with sidebar navigation
- Organization settings page (members, roles, invitations)
- Landing page with auth-aware navigation
- Error boundaries and 404 page

## Quick Start

### Prerequisites

- Node.js 18+
- A [Clerk](https://clerk.com) account
- A [Convex](https://convex.dev) account

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd nextjs-convex-starter
npm install
```

### 2. Set Up Environment Variables

Copy `.env.example` to `.env.local` and fill in values:

```bash
cp .env.example .env.local
```

Required variables:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | Convex deployment URL |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `CLERK_JWT_ISSUER_DOMAIN` | Clerk Frontend API URL (for Convex auth) |

### 3. Configure Clerk

1. Go to your Clerk dashboard
2. **Enable Organizations** under "Organization settings"
3. Copy your API keys to `.env.local`
4. Set your Frontend API URL as `CLERK_JWT_ISSUER_DOMAIN`

### 4. Set Up Convex (must run before Next.js)

> **Important:** You must run `npx convex dev` before starting the Next.js dev server. This generates the `convex/_generated/` directory containing type definitions and the `api` object. Without it, Next.js will fail with `Module not found: Can't resolve '@/convex/_generated/api'`.

```bash
npx convex dev
```

This will:
- Prompt you to create a Convex project (or link an existing one)
- Set `NEXT_PUBLIC_CONVEX_URL` in your `.env.local`
- Generate `convex/_generated/` (required for the app to build)
- Deploy your schema and functions

Keep this terminal running — it watches for changes to your `convex/` files.

### 5. Run Next.js Dev Server

In a second terminal:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You should now have **two terminals running**: `npx convex dev` and `npm run dev`.

## Project Structure

```
app/
  page.tsx                          # Landing page
  not-found.tsx                     # 404 page
  (auth)/                           # Auth pages (public)
    sign-in/[[...sign-in]]/         # Clerk sign-in
    sign-up/[[...sign-up]]/         # Clerk sign-up
  (dashboard)/                      # Protected pages
    layout.tsx                      # Sidebar + breadcrumbs
    error.tsx                       # Error boundary
    dashboard/
      page.tsx                      # Dashboard home
      settings/page.tsx             # Org settings (Clerk OrganizationProfile)
components/
  app-sidebar.tsx                   # Sidebar with nav + team switcher
  team-switcher.tsx                 # Clerk organization switcher
  nav-main.tsx                      # Main navigation links
  nav-user.tsx                      # User menu (Clerk)
  convex-client-provider.tsx        # Convex + Clerk provider with user sync
  ui/                               # shadcn/ui components
convex/
  schema.ts                         # Database schema (users table)
  users.ts                          # User queries + mutations
  auth.config.ts                    # Clerk auth config
proxy.ts                            # Route protection (Next.js 16 proxy)
```

## How User Sync Works

When a user signs in, the `ConvexClientProvider` automatically calls the `syncUser` mutation, which:

1. Reads the authenticated user's identity from the Clerk JWT
2. Looks up the user by `externalId` (Clerk user ID) in Convex
3. Creates or updates the user record

This client-side approach works immediately with no extra setup.

## What to Build Next

- Add tables to `convex/schema.ts` for your domain data
- Create queries and mutations in `convex/`
- Add pages under `app/(dashboard)/dashboard/`
- Update navigation in `components/app-sidebar.tsx`

## Production Hardening

### Webhook-Based User Sync

For production, supplement the client-side sync with Clerk webhooks to handle events like user deletion:

1. Create `convex/http.ts` with an `httpRouter`
2. Add an `internalMutation` for user upsert/delete
3. Verify webhooks using `@clerk/nextjs/webhooks` `verifyWebhook`
4. See: [Convex Database Auth Docs](https://docs.convex.dev/auth/database-auth)

### Deployment

```bash
npx convex deploy        # Deploy Convex to production
npm run build            # Build Next.js
```

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npx convex dev` | Start Convex dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |

## License

MIT
