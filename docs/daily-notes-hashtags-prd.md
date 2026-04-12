# Daily Notes Hashtags — Inline Document Tags

> **One-liner**: Inline `#hashtag` markers in daily notes that work like `@mentions` — type `#`, pick from your saved tags or create a new one, and the tag renders as a tinted pill in the text. Helps structure free-form notes without rigid templates.
>
> **Depends on**: Daily Notes V1 (done)
> **Scope**: TipTap extension + tag persistence + autocomplete + Settings UI

---

## Problem

Daily notes are free-form text. Without structure, the PM scanning 5 team members' notes can't quickly find "what blocked people today" vs "what shipped." Templates are too rigid — people ignore them after day 2. Hashtags give lightweight, voluntary structure: write naturally, drop a `#standup` or `#blocker` where it fits, and now the note is scannable.

## Solution

A TipTap inline node (like `@mention`) triggered by `#`. When the user types `#`, a dropdown appears with their saved tags. They pick one or create a new one. The tag renders as a tinted pill in the editor. Tags are persisted per-user (not re-extracted from notes every time). The admin seeds org-level default tags in Settings.

---

## User Stories

| # | As a... | I want to... | So that... |
|---|---------|-------------|------------|
| 1 | Team member | type `#` and see my tags in a dropdown | I can quickly categorize sections of my note |
| 2 | Team member | create a new tag from the dropdown | I can extend my vocabulary organically |
| 3 | Team member | see tags as tinted pills in my text | I can visually scan my note structure |
| 4 | Admin | define default tags for the org | new team members start with useful tags like #standup, #blockers |
| 5 | Team member | manage my tags in Settings | I can rename or delete tags I no longer use |
| 6 | PM/Admin | scan a member's note and see tag pills | I can quickly jump to the #blockers section without reading everything |

---

## UX Flow

### Typing a tag

```
1. User types "#"
2. Dropdown appears below cursor (same pattern as @mention)
3. Dropdown shows:
   - Search/filter input (auto-focused)
   - Matching tags from user's saved list
   - "Create #xyz" option at bottom if no exact match
4. User clicks or presses Enter to select
5. Tag inserts as an inline pill node in the editor
6. Cursor moves after the tag, user continues typing
```

### Dropdown content

```
┌─────────────────────────┐
│ #stand                  │  ← filter text
├─────────────────────────┤
│ #standup                │  ← existing tag match
│ #standby                │  ← existing tag match
├─────────────────────────┤
│ + Create #stand         │  ← create new
└─────────────────────────┘
```

- Fuzzy match on tag name
- Most recently used tags first (when no filter)
- "Create" option appears when typed text doesn't exactly match any existing tag
- Creating adds the tag to the user's persisted list immediately

### Tag pill rendering

The tag renders inline, identical style to `@mention` but with `#` prefix:

```
[#standup]  Reggeli sync megvolt. [@ Toth Adam] átadta...
```

- Background: `bg-primary/10` (same as mention)
- Text: `text-primary/60` (same as mention)
- Border radius, small padding
- Non-editable node (click selects, backspace deletes)
- Rendered in the same `.mention` CSS class family

---

## Schema

### `noteTags` table

```typescript
noteTags: defineTable({
  orgId: v.string(),
  userId: v.id("users"),      // whose tag list
  name: v.string(),            // "standup", "blockers" (without #)
  isOrgDefault: v.boolean(),   // true = seeded by admin, visible to all
  usageCount: v.number(),      // how many times used (for sorting)
  lastUsedAt: v.number(),      // last time this tag was inserted
  createdAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_orgId_isOrgDefault", ["orgId", "isOrgDefault"])
```

**Why a separate table (not embedded in user doc)?**
- Tags grow unboundedly — Convex best practice says no unbounded arrays in documents
- Need efficient queries: "all my tags" and "all org default tags"
- `usageCount` + `lastUsedAt` for smart sorting in dropdown

### How org defaults work

When admin creates an org default tag:
- A single record with `isOrgDefault: true` is created (the "template")
- When a user first types `#` and sees org defaults, those defaults appear alongside their personal tags
- If the user selects an org default, a personal copy is created for them with `isOrgDefault: false`
- This way each user has their own tag list, but org defaults bootstrap it

### TipTap JSON representation

The tag is stored as a TipTap node in the document JSON (same structure as mention):

```json
{
  "type": "noteTag",
  "attrs": {
    "id": "standup",
    "label": "standup"
  }
}
```

- `id`: the tag name (lowercase, no spaces)
- `label`: display name (as typed by user)
- No reference to `noteTags._id` — the tag is self-contained in the document

---

## Queries & Mutations

### `noteTags.list`
List all tags for the current user + org defaults they haven't personalized yet.

**Returns**: Merged list sorted by `lastUsedAt` DESC, org defaults at end if unused.

**Auth**: Own tags only. Admin sees their own tags (not other members').

### `noteTags.create`
Create a new personal tag.

**Args**: `name: string`
**Behavior**:
- Normalizes name (lowercase, trim, no spaces → hyphens)
- Checks uniqueness per user
- Sets `usageCount: 1`, `lastUsedAt: now`
- Returns the created tag

### `noteTags.incrementUsage`
Bump `usageCount` and `lastUsedAt` when user inserts a tag.

**Args**: `name: string`
**Behavior**: Find by userId + name, increment count, update timestamp.

### `noteTags.update`
Rename a tag.

**Args**: `id: Id<"noteTags">`, `name: string`
**Auth**: Own tags only.

### `noteTags.remove`
Delete a tag from user's list.

**Args**: `id: Id<"noteTags">`
**Auth**: Own tags only. Does NOT remove the tag from existing notes (the document JSON is self-contained).

### `noteTags.createOrgDefault` (admin only)
Create an org-level default tag visible to all members.

**Args**: `name: string`
**Auth**: Admin only.

### `noteTags.removeOrgDefault` (admin only)
Remove an org-level default tag.

**Args**: `id: Id<"noteTags">`
**Auth**: Admin only. Does NOT remove personal copies or tags from existing notes.

---

## Components

### TipTap Extension: `noteTagExtension`

Custom TipTap Node extension (follows the same pattern as the existing `mentionExtension`):

**File**: `components/tasks/note-tag-extension.tsx`

- **Node type**: `noteTag` — inline, non-editable atom
- **Trigger**: `#` character
- **Rendering**: Tinted pill using `.mention` CSS class (reuse existing styles)
- **Attributes**: `id` (string), `label` (string)
- **Suggestion plugin**: Uses `@tiptap/suggestion` (same lib as mention)

### Tag suggestion dropdown: `useNoteTagSuggestion`

**File**: `components/tasks/use-note-tag-suggestion.tsx`

- Queries `noteTags.list` for user's tags
- Filters by typed text after `#`
- Shows "Create #xyz" option when no exact match
- On select: inserts `noteTag` node + calls `noteTags.incrementUsage` (or `noteTags.create` for new)
- Dropdown UI: reuses the same popover pattern as `@mention`

### Settings: Note Tags management

**File**: `components/settings/settings-note-tags.tsx`
**Route**: Settings > Note Tags tab

**For members:**
- List of personal tags with usage count
- "Add tag" button
- Delete button per tag (with confirmation)
- Rename inline edit

**For admin (additional section):**
- "Org Default Tags" section
- Add/remove org-level defaults
- These appear for all members when they type `#`

---

## Edge Cases

| Case | Behavior |
|------|----------|
| User types `#` then space | No tag created, `#` stays as plain text |
| User types `#123` (number-only) | Valid tag, no restriction on numbers |
| User types `#very-long-tag-name-that-exceeds-limit` | Truncate at 30 chars |
| User creates tag that matches existing one (different case) | Normalize to lowercase, reject duplicate |
| Admin deletes an org default | Personal copies remain, tag disappears from new users' dropdowns |
| User deletes a tag from Settings | Tag removed from their list. Existing notes still show the pill (self-contained JSON). |
| Two users create the same tag name independently | Each has their own record. No conflict. |
| User has 100+ tags | Dropdown shows top 8 by `lastUsedAt`, with scroll. Filter narrows results. |

---

## Tag name rules

- Lowercase only (auto-normalized)
- No spaces (replaced with `-`)
- Max 30 characters
- Allowed: `a-z`, `0-9`, `-`, `_`
- No `#` stored (added visually)
- Examples: `standup`, `blockers`, `daily-wins`, `client_feedback`

---

## Out of Scope (V1)

| Feature | Why deferred |
|---------|-------------|
| Tag colors | Adds complexity. All tags same tinted pill style for now. |
| Cross-note tag search ("show all #blockers notes") | Needs search index on TipTap JSON content. V2 feature. |
| Tag analytics ("most used tags this week") | Nice-to-have, needs aggregation query. V2. |
| Tag in task descriptions | Daily Notes only for now. Extend to tasks when proven. |
| Tag categories/groups | Over-engineering for 3-8 person teams. |

---

## Acceptance Criteria

### Inline Tag
- [ ] Typing `#` triggers suggestion dropdown
- [ ] Dropdown shows user's saved tags filtered by typed text
- [ ] "Create #xyz" option appears when no exact match
- [ ] Selecting a tag inserts a tinted pill inline node
- [ ] Tag pill styled identically to `@mention` (bg-primary/10, border-radius)
- [ ] Tag is non-editable inline node (backspace deletes whole tag)
- [ ] Tag pill shows `#` prefix visually

### Autocomplete
- [ ] Tags sorted by `lastUsedAt` DESC (most recent first)
- [ ] Org default tags shown when user has no personal tags yet
- [ ] Creating a new tag persists it to user's tag list
- [ ] Inserting an existing tag bumps its `usageCount` and `lastUsedAt`
- [ ] Dropdown closes on Escape, click outside, or selection

### Persistence
- [ ] `noteTags` table with user-scoped records
- [ ] Tag names normalized (lowercase, no spaces, max 30 chars)
- [ ] No duplicate tag names per user
- [ ] Deleting a tag from Settings does not affect existing notes

### Settings UI
- [ ] Members see their personal tags with usage count
- [ ] Members can add, rename, delete personal tags
- [ ] Admin sees additional "Org Default Tags" section
- [ ] Admin can add/remove org defaults
- [ ] Org defaults appear in all members' dropdowns

### Schema
- [ ] `noteTags` table: orgId, userId, name, isOrgDefault, usageCount, lastUsedAt, createdAt
- [ ] Indexes: `by_userId`, `by_orgId_isOrgDefault`

---

## Implementation Phases

### Phase H1: Schema + Backend (TDD)
> Tag CRUD + org defaults

- [ ] Tests first: create, list, delete, rename, org defaults, auth
- [ ] `noteTags` table in schema
- [ ] `convex/noteTags.ts` with all queries/mutations
- [ ] Tag name validation + normalization

### Phase H2: TipTap Extension (TDD)
> `#` trigger + inline node rendering

- [ ] Tests first: node renders, trigger fires, insertion works
- [ ] `noteTagExtension` — custom TipTap Node
- [ ] Reuse `.mention` CSS styles for pill rendering
- [ ] Wire into `DailyNotesEditor` extensions

### Phase H3: Autocomplete Dropdown (TDD)
> Suggestion popup with filter + create

- [ ] Tests first: dropdown shows, filter works, create flow
- [ ] `useNoteTagSuggestion` hook (mirrors `useMentionSuggestion`)
- [ ] Suggestion dropdown component
- [ ] Wire `noteTags.create` and `noteTags.incrementUsage`

### Phase H4: Settings UI
> Tag management in Settings

- [ ] Tests first: list renders, add/delete/rename work
- [ ] "Note Tags" tab in Settings page
- [ ] Member view: personal tags CRUD
- [ ] Admin view: org default tags management
- [ ] Seed org defaults on first visit (or migration)

### Phase dependency graph

```
H1 (Schema + Backend)
|
H2 (TipTap Extension) ←── depends on H1
|
H3 (Autocomplete) ←── depends on H1 + H2
|
H4 (Settings UI) ←── depends on H1, independent of H2/H3
```

**H1 and H4 can be partially parallelized** (H4 only needs the backend, not the TipTap extension).
