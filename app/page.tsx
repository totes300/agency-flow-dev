import Link from "next/link"
import { Show } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"

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
          <Button asChild>
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </Show>
        <Show when="signed-out">
          <Button asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/sign-up">Sign Up</Link>
          </Button>
        </Show>
      </div>
    </div>
  )
}
