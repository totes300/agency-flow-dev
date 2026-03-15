import Link from "next/link"
import { Show } from "@clerk/nextjs"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight">SaaS Starter</h1>
        <p className="max-w-md text-lg text-muted-foreground">
          A Next.js + Convex + Clerk starter template for building B2B SaaS
          applications.
        </p>
      </div>

      <div className="flex gap-4">
        <Show when="signed-in">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go to Dashboard
          </Link>
        </Show>
        <Show when="signed-out">
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign In
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center rounded-md border px-6 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Sign Up
          </Link>
        </Show>
      </div>
    </div>
  )
}
