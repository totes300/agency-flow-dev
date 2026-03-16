---
name: shared-components-rule
description: UI elements that represent domain concepts (badges, pills, avatars) must be shared components from the start, never inline in feature files
type: feedback
---

Domain-level UI elements (badges, pills, status indicators, category labels, user avatars, etc.) must always be created as shared components in `components/` from the very first use. Never define them inline inside a feature file like `settings-statuses.tsx`.

**Why:** These elements represent core domain concepts that will inevitably appear across multiple features (tasks, projects, time entries, reports). Defining them inline leads to duplicated, inconsistent implementations that drift apart over time. The user had to manually catch that StatusPill and CategoryPill had different font sizes and weights because they were defined separately.

**How to apply:** When building any UI that renders a domain concept visually (a status, a category, a user, a client, a project type), immediately create a shared component in `components/` with a clear name like `StatusBadge`, `CategoryBadge`, `UserAvatar`. Then import it wherever needed. This applies even if there's currently only one usage — the second usage is inevitable.
