"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { BillingTypeBadge } from "@/components/billing-type-badge"
import { RowActionMenu } from "@/components/row-action-menu"
import { ArchivedBadge } from "@/components/archived-badge"
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  PencilIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
} from "lucide-react"
import type { Doc } from "@/convex/_generated/dataModel"

type ProjectWithClient = Doc<"projects"> & { clientName: string }

interface ProjectsTableProps {
  projects: ProjectWithClient[]
  onArchive: (project: ProjectWithClient) => void
  onRestore: (project: Doc<"projects">) => void
  onDelete: (project: Doc<"projects">) => void
}

export function ProjectsTable({
  projects,
  onArchive,
  onRestore,
  onDelete,
}: ProjectsTableProps) {
  const router = useRouter()

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="w-24">Code</TableHead>
            <TableHead className="w-20">Type</TableHead>
            <TableHead>Client</TableHead>
            <TableHead className="w-20">Currency</TableHead>
            <TableHead className="w-20">Last activity</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow
              key={project._id}
              className="cursor-pointer transition-colors hover:bg-muted/50"
              onClick={() => router.push(`/projects/${project._id}`)}
            >
              <TableCell>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/projects/${project._id}`}
                      className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {project.name}
                    </Link>
                    {project.archivedAt && <ArchivedBadge />}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
              </TableCell>
              <TableCell>
                <BillingTypeBadge type={project.billingType} />
              </TableCell>
              <TableCell>
                <span className="text-sm">{project.clientName}</span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{project.currency}</Badge>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted-foreground">&mdash;</span>
              </TableCell>
              <TableCell>
                <RowActionMenu>
                  <DropdownMenuItem onClick={() => router.push(`/projects/${project._id}?tab=settings`)}>
                    <PencilIcon className="size-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {project.archivedAt ? (
                    <DropdownMenuItem onClick={() => onRestore(project)}>
                      <ArchiveRestoreIcon className="size-4" />
                      Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => onArchive(project)}>
                      <ArchiveIcon className="size-4" />
                      Archive
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onDelete(project)}
                  >
                    <Trash2Icon className="size-4" />
                    Delete
                  </DropdownMenuItem>
                </RowActionMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
