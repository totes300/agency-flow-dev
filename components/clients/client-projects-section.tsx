import Link from "next/link"
import { FolderIcon } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"

type ClientProject = { _id: string; name: string; billingType: BillingType }

/** The client detail page's active-projects list. */
export function ClientProjectsSection({
  projects,
}: {
  /** Undefined while loading. */
  projects: readonly ClientProject[] | undefined
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">Projects</h2>
        {projects && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {projects.length}
          </span>
        )}
      </div>
      {projects === undefined ? (
        <Skeleton className="h-24 w-full" />
      ) : projects.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No active projects for this client.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {projects.map((project) => (
            <li key={project._id}>
              <Link
                href={`/projects/${project._id}`}
                className="flex min-h-11 items-center gap-3 px-2 py-2 text-[13px] transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {project.name}
                </span>
                <BillingTypeBadge type={project.billingType} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
