# Issue tracker

**Choice: local markdown** (chosen 2026-07-19, during the first wayfinder charting
session). Issues live as files under `.scratch/<effort>/` in this repo. The GitHub
remote exists but the owner opted to keep agent planning artifacts out of GitHub
Issues.

Full `/setup-matt-pocock-skills` (triage labels, domain docs) has NOT been run —
only the tracker choice is recorded here. Run the setup skill later to complete
the rest; keep this tracker choice unless the owner changes it.

## Layout

```
.scratch/<effort>/
  map.md            # wayfinder map (labels: wayfinder:map in frontmatter)
  tickets/NN-slug.md
  assets/           # artifacts linked from tickets (research notes, prototypes)
```

## Wayfinding operations

- **Map**: `.scratch/<effort>/map.md`, frontmatter `labels: [wayfinder:map]`.
- **Ticket**: one file per ticket under `tickets/`, named `NN-slug.md`. Frontmatter:
  `title`, `labels` (one `wayfinder:<type>`), `status: open|closed`,
  `assignee` (empty = unclaimed), `blocked-by` (list of ticket file names).
- **Name/link**: a ticket's name is its `title`; link it as
  `[Title](tickets/NN-slug.md)` (relative to the map).
- **Claim**: set `assignee` to the session's driver before any work.
- **Blocking**: `blocked-by` in frontmatter (no native relations in markdown).
- **Frontier query**: tickets with `status: open`, empty `assignee`, and every
  `blocked-by` entry `status: closed`. Grep frontmatter — no tracker UI exists,
  so keep frontmatter machine-greppable.
- **Resolution**: append a `## Resolution` section to the ticket body, set
  `status: closed`, then add the one-line gist to the map's Decisions so far.
