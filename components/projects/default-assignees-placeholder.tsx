import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"

export function DefaultAssigneesPlaceholder() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Default Assignees</CardTitle>
            <CardDescription>
              Pre-fill the assignee when creating tasks for this project.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="text-xs">Coming soon</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Member selection will be available when task assignment is implemented.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
