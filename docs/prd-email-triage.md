# PRD — Email Triage: client emails → tasks → approved replies

Status: **in implementation on branch `email-triage` — see `docs/prd-email-triage-implementation-plan.md`
for the phase plan** · Owner: Ádám · Written 2026-10-18 ·
Revised 2026-10-18 (consolidation after canvas v5–v7) and 2026-10-19 (Codex engineering review: platform
foundation, request ledger, send states, sync, gate table; Codex prototype details; kickoff reply; widgets;
chat attachments; standup notes and call transcripts in the Agents workspace) and 2026-10-19 (owner
grilling: D23–D37 — V1 for our agency only, what enters Triage, the Triage item table, list lifecycle, snooze,
decline, merge, undo Create, approve without email, client approval → done, Gmail-side replies, first
sync, sending mailbox, polling sync, working-hour clocks) and 2026-10-19 (implementation review, accepted
as E1–E4: fact fixes against the real codebase; platform primitives instead of email-specific ones —
actor layer + background runs, job registry, thread visibility + anchor, four proposal kinds, `agentItems`,
`agentChecks`, `connectors.sync`, three notification types; §9 replaced by milestones A–D). No owner
decision D1–D37 / O1–O10 and no UI behaviour changed; O1 is refined by E2 (§11). Superseded items are
logged in §12.

Terms: "owner" is Ádám (the persona); "admin" is the org role `isAdmin` — only `admin | member` exist
(`convex/schema.ts`, `convex/lib/auth.ts`), so every "owner/admin" rule below means an org admin.

Scope: the email flow (Triage → task → Reviews → reply) **and** the shared assistant pieces it needs and
that the Agents workspace reuses — conversation kit, widgets, chat attachments, change lists (§6.9–6.10,
§7.1). Triage is only for email (D22).

Visual source: Design canvas https://claude.ai/artifact/UytexDtPAJNrrMxv5ZVDwE —
**page "v7 · Chat-first"** for Triage and the conversation pattern (boards "Triage · inbox + conversation +
draft on demand", "Assistant · one conversation per client thread" and "Agents workspace · standup note → task
changes"); **page "v6"** for what v7 does not
cover yet: Reviews (board 2), the colleague's task view (board 3), the owner's daily digest (board 4).
Pages v1–v5 are history. This document is the behavioural and technical source; where it and the canvas
disagree, this document wins and the canvas gets fixed.

Read first: `AGENTS.md`, `convex/_generated/ai/guidelines.md` (note: it targets Convex `^1.44`, the
installed package is `1.34.1` — do not use APIs newer than 1.34, see §11 O9), `docs/prd-tasks-refactor.md`
(the task model this builds on — merged in #13; do not fork `convex/tasks/*`, write only through the
`convex/tasks/write.ts` entry points), `docs/agentic-platform/prd-v1.md` (agent runner, tool registry,
proposals, connectors), `docs/prd-email-triage-implementation-plan.md` (review findings F1–F12, S1–S9,
P1–P6, decisions E1–E4, phase plan). `docs/agents-platform-v1-prd.md` is superseded history.

---

## 1. Problem statement

Clients send most work by email (Gmail). Today nothing in Agency Flow sees those emails: the owner reads
Gmail, retypes the request as a task, assigns it, later reads the finished work, writes the reply in Gmail,
and when the client answers with "one more thing" the task stays closed unless someone notices. Four
costs: double entry, lost requests, replies written from memory instead of the task, and no record on the
task of what the client was actually told.

The task drawer today has the tabs Overview / Time / Files (`components/task-detail/task-detail.tsx`). This
PRD adds an **Emails** tab and the email thread around the task.

## 2. Goals and non-goals

Goals (owner's words, 2026-10-18):

1. A client email becomes work prepared by the agent (client, project, assignee, due, priority, category,
   an actionable **description** and the requests as **subtasks**); the owner decides in **Triage**, the
   colleagues are notified.
2. When the colleague finishes, the agent drafts the client reply **from the task** (description,
   subtasks, comments, activity, files, the whole thread) and checks it before the owner sees it.
3. The owner sends the reply from the app, in the original Gmail thread. Never from Gmail.
4. A client reply that contains any request, instruction or change **reopens** the work and adds the
   requests as subtasks. Pure thanks does not. No request may stay hidden — measured, not assumed (§8).
5. The agent is the owner's **personal assistant and project manager** (§6.8): it prepares, checks,
   watches, drafts and tells — like a Claude Code / Codex conversation, light and calm.
6. Anything else the owner hands the assistant — a standup note, a client-call transcript, screenshots,
   documents — becomes prepared task changes and drafts in the **Agents workspace**, each checked and
   approved in the task drawer (D22, §6.9–6.10).

Non-goals (V1): shared team inbox for non-client mail; marketing or bulk email; calendar;
emails sent without a person pressing Send (the kickoff reply, D21, is drafted, never sent automatically); editing the Gmail thread itself (labels, archive) beyond what sending
requires; the agent producing deliverables (§6.8); external systems (Figma, Shopify, Webflow, staging
pages, cloud drives) beyond link previews; mobile layout polish.

## 3. Decisions

Locked by the owner unless marked *amended* (then the newer wording is binding; the old one is in §12).

### 3.1 Flow

- **D1 Always Triage.** Every new inbound client email creates a Triage item. No task exists before the
  owner presses Create. The agent prepares everything; the owner decides.
- **D2 No automatic email.** *(amended 2026-10-19 by D21)* The only email that ever leaves the app is one a
  person explicitly sends (a Triage reply or kickoff reply, Reviews "Approve & send", Task "Send").
- **D3 Reviews = tasks in the Admin-review status.** *(amended: "Admin review" means the status with
  `workflowRole: "admin_review"`, not a status name — §4.2, §11 O7.)* Two kinds: *email ready* (a draft
  exists) and *review only* (no client email). `Send back` = the owner's note turned into subtasks the
  owner ticks (so the gate in D7 holds the task) + a comment + status back to the started default.
- **D4 Follow-ups on a known thread** *(amended 2026-10-18 by §11 O2 and 2026-10-19)*. Every client
  reply is classified by intent — **add, clarify, replace, cancel, approve, ask, acknowledge** (§6.3) — and
  shown in Inbox with the reason. Add / clarify / replace / cancel, and an approval that asks for an action
  ("mehet élesbe"), become a **change proposal** on the linked task: new subtasks, amended or cancelled
  ones, and a reopen when the task was in review or done. It sits at the top of Triage as "Reply on
  ‹task›" until decided; meanwhile the task cannot enter review and its drafts cannot be sent (I9). An
  *ask* that can be answered without new work gets a reply draft, not a reopen. *Acknowledge* changes
  nothing. Hard triggers (question mark, instruction words such as kérnénk / lehetne / még / mehet /
  kellene / javítsátok, an attachment, a link, a new recipient) never let a reply pass as "no action"
  silently: with a trigger but no recognised change it becomes a Triage item "needs a look". When unsure,
  propose. A reply that cannot be linked goes to Triage.
- **D5 Separation by intent:** Triage = decide · Reviews = approve · Inbox = be informed. *(amended
  2026-10-18: the detail of each is a conversation with the agent — D12.)*
- **D6 One email = one task by default.** Each request is a subtask with its own assignee. A split by
  discipline is **suggested** when the requests span work categories with different owners; the owner
  takes it by answering the agent's question or by telling it. Never automatic.
- **D7 No new task primitives.** The description → `tasks.description` (TipTap JSON). Each client request
  → a subtask (`parentTaskId`, `subtaskCount` / `subtaskDoneCount`). The Admin-review gate reads
  `subtaskDoneCount === subtaskCount`. Reopen = new subtasks + status change + activity.
- **D8 Partial delivery** *(amended 2026-10-19)*. The colleague may hand over with open subtasks only
  through "Hand over partially": they pick which open subtasks move to a follow-up and say why (stored with
  the hand-over check). In Reviews the draft must say what is not done and when it comes;
  `Send & create follow-up…` shows the follow-up task (title, assignee, due). The follow-up is created
  only when Gmail accepts the email — Undo before that creates nothing.
- **D9 Exact version, undo window, stale drafts.** The email component shows From · To · Cc · subject ·
  version. For a reply in an existing Gmail thread the **subject is locked** (Gmail threads by subject +
  headers); changing it means starting a new conversation, explicitly. Approving binds a **snapshot** —
  subject, From, To, Cc, body, attachments, version — and any edit after that voids the approval. Send
  opens a 15 s undo window that survives a reload; once dispatch to Gmail has started, Undo is no longer
  offered. A relevant client message or a change on the thread's tasks makes the version stale. A failed
  send keeps the draft and offers the fix that matches the error (Reconnect only when the mailbox is
  disconnected); an unknown outcome is checked against the mailbox before any retry, so nothing is sent
  twice.
- **D10 Inbox only informs.** Rows: open, mark read, snooze. Decisions live in Triage or Reviews; a
  watcher signal (§6.8.3) points to where its prepared item waits. Exception: approving or dismissing a
  learned-rule proposal in the daily digest (§6.8.4).
- **D11 Role (locked 2026-10-18):** personal assistant + project manager, never a worker — §6.8.
- **D18 Ask only when it matters (2026-10-19).** Before asking, the agent reads the sources and applies
  confirmed rules (project routing, client defaults, skills). It asks only when the answer changes scope,
  the done condition, a promise to the client, who does it, or a step that is blocked; otherwise it fills
  the value and says so in "Why these suggestions?". One question at a time.
- **D19 Language (2026-10-19).** Task text (titles, descriptions, subtasks) is in the team's language,
  keeping the client's exact terms where they matter. Outbound email is in the client's language (of the
  latest relevant message), overridable per draft; dates, amounts, links and sizes are carried over
  verbatim.
- **D20 Prepare freely, commit once (2026-10-19).** Until Create or Send, the agent edits its own plan and
  its own drafts directly — each change is one line in the conversation with Undo. Create (or Send) commits
  and re-checks against current data. Tone rewrites show a one-line summary; a diff only when facts change
  or when asked.
- **D21 Always touch the client after Create (owner, 2026-10-19).** Right after Create (and after Merge or
  an applied change proposal) the agent drafts a **kickoff reply** in the same conversation: thanks, the
  work has started, when we get back (from the plan's due dates — "within 1–2 working days" or "by
  Wednesday"), the answer to anything the client asked that we can answer now, and our open questions to
  the client. It is the next step on screen; the Triage item stays "Kickoff ready" until it is sent or
  discarded. Client questions chosen before Create ("Ask Réka") go into this one email, not a separate
  one. It never promises more than the plan says.
- **D22 Triage is for email; everything else goes to the Agents workspace (owner, 2026-10-19).** Triage
  holds only work that arrives by client email. Meeting notes, standup and client-call transcripts,
  screenshots and documents are given to the general assistant in the **Agents workspace** (`/agents`,
  Agency Copilot) — one ordinary conversation per paste, no separate section, view or item type per input
  kind ("client call", "standup", …), and nothing from there creates a Triage item. Both places use the
  same conversation kit, widgets, proposals, drafts in the drawer and change lists; only the entry point
  differs.

**Owner grilling, 2026-10-19 (D23–D37).**

- **D23 V1 is for our agency only.** The Google OAuth client is an *Internal* app on our Workspace, so only
  our users can connect Gmail. `orgSettings.emailTriageEnabled` (default off; set on our org by an internal
  mutation, no UI) gates Triage, Reviews, the Gmail connector row and every email cron. Other tenants never
  see any of it. An External app (Google verification + restricted-scope security assessment) is a separate,
  later decision.
- **D24 What enters Triage.** Three layers (§5.2): (1) skip — read only `INBOX`; skip Gmail's Promotions,
  Social, Updates and Forums categories, spam, auto-replies and bulk mail (`List-Unsubscribe`, `Precedence:
  bulk`, `Auto-Submitted`); (2) known client — a contact email, a client domain or a reply on a tracked
  thread → Triage; (3) unknown sender — in an **admin's** mailbox one short agent check ("a work request from
  a possible new client?") → yes: a "new sender" item, no: the quiet **Filtered** view of Triage, from which
  the owner can promote it; in a **member's** mailbox it is never stored. Filtered messages are deleted after
  30 days unless promoted.
- **D25 One open Triage item per conversation.** A Triage item is an `agentItems` row with `source:
  "email"`, anchored on the email thread (§4.1). A new
  message on a conversation that already has an open item joins that item: the agent re-reads the whole
  thread and makes a new plan revision (the owner's edits survive unless the new email changes them); the
  row says "Updated · 2 emails". A new item opens only after the previous one is done.
- **D26 The Triage list holds only what needs you.** An item leaves the list when its last step is done
  (Created or Merged and the kickoff sent or discarded, Declined, reply sent, Mark done / Keep). Two quiet
  views behind the list header: **Snoozed** and **Done** (last 30 days); plus **Filtered** (D24). The
  sidebar badge counts only open items.
- **D27 Snooze** — Tomorrow 9:00 · Next Monday 9:00 · Pick a date. A new client message on the thread wakes
  the item early.
- **D28 Decline** needs no reason. Its open ledger rows become `dismissed` ("declined"). A later email on
  the thread opens a new item.
- **D29 Merge = a change proposal.** `Merge into…` builds the same `updateTask` proposal (source email) as a
  client reply on a linked task (new subtasks, plus a reopen when the task is in review or done) — one code
  path, the same gates (I9).
- **D30 Undo after Create.** A 10 s toast "Created PRG-132 · Undo". Undo deletes the task and its subtasks
  and returns the item to its plan; assignee notifications and the kickoff draft wait until the toast ends
  (`tasks/write.ts` `createTask` with `deferNotifications`; the notification is scheduled for the toast's end
  and cancelled by Undo).
- **D31 Approve without email.** In Reviews a *review only* task gets `Approve` → the default status of the
  done category (a small menu offers "Approve → Client review"); an *email ready* task also gets a quiet
  `Approve without email` (discards the draft, → done).
- **D32 Client approval closes the loop by one click.** A client reply with intent *approve* without an
  action on a task in the `client_review` role becomes a light Triage item "Réka approved PRG-132" with
  `Mark done` (⌘↵) / `Keep in Client review`. A plain *acknowledge* only informs (Inbox); the task stays.
- **D33 Replies written in Gmail count.** An outbound message a team member sends from Gmail on a tracked
  thread is synced into the thread: open drafts on it become stale ("You replied in Gmail at 14:05"), a
  pending kickoff item closes as "Replied in Gmail", `waitingOn: "client"`. No promise is extracted from it
  (I8).
- **D34 First connect starts from now.** No backfill into Triage; `Resync last 7 days` stays as a manual
  recovery button (§7.6).
- **D35 Sending mailbox.** When the conversation lives in several mailboxes, the reply goes from the sending
  admin's own mailbox if it holds the thread, otherwise from the mailbox the client wrote to. The From line
  shows it and can switch among the mailboxes that hold the thread; when an admin sends from a colleague's
  mailbox, that colleague gets an Inbox note. (Refines O3.)
- **D36 Polling sync in V1.** Each mailbox is synced every minute from its Gmail history cursor — no Gmail
  push / Pub/Sub in V1 (no extra Google Cloud setup, no webhook to secure). Push comes later, when many
  mailboxes make it worth it. (Supersedes Q2.)
- **D37 Working-hour clocks.** "Client waiting 24 h", the 3-day nudge and the 2-working-hour reopen signal
  count working days only (weekends skipped, org timezone), like the default due date: a Friday 16:00 email
  is flagged Monday 16:00.

### 3.2 UI and interaction (owner, 2026-10-18 — replaces the v4 UI list, see §12)

- **D12 Chat-first details.** Each Triage item is a conversation in the style of Claude Code / Codex:
  agent prose without bubbles, the user's turns as quiet bubbles, the agent's work as **one collapsed line**
  (a live step list with done / working / pending marks and an elapsed timer while it runs), compact
  inline blocks only where needed — a plain plan list, a question with options, an email draft, a diff of
  a change, an event line — and buttons only for the decision at hand. One composer with 2–3 suggestions.
  Structured panels, property grids and card kits are **not** the pattern (memory:
  feedback-chat-first-agent-ui). Reviews is a conversation too (§11 O5); Inbox stays a list with the daily
  digest.
- **D13 Description and subtasks.** The description is plain document text in the drawer's own style: a
  short paragraph (goal and context) and a "Kész, ha" bullet list; materials, scope and related tasks only
  when they matter. **Subtask titles explain themselves** — what, sizes / dates / where, and the done
  condition in one sentence — so nobody has to open a subtask to do it. No label grids, no per-fact
  source tags in the text (sources are in "Why these suggestions?" and the run steps).
- **D14 The original email.** The whole email is shown first, Gmail-style (subject, sender line, every
  paragraph untouched, attachment cards). Once the agent has turned it into a plan it folds to one line
  ("Kovács Réka — Black Friday… · Show the original email"); one click shows all of it again.
- **D15 Drafts in the real drawer.** Before creation a task is opened in the task drawer in a Draft state
  (title, property chips under the title, description, subtasks — no tabs) and edited there. Nothing exists
  until Create.
- **D16 Questions as a generative block.** When the agent needs a decision it asks with a question block
  (Claude / Codex style): one question, 2–4 numbered options with a short description, one marked
  recommended, free text ("or just type"), optionally several choices, and "Later". Keys 1–4 pick. The
  answer appears as the user's turn and the agent continues (§6.6).
- **D17 Gmail for every user (owner, 2026-10-18).** Every user can connect their own Gmail in Settings ›
  Connectors. What colleague mailboxes feed and who sends from which address: §11 O6.
- Visual base unchanged: Linear/Notion light theme, Inter, one dark primary button per screen, sidebar
  counts via `sidebar-count-badge.tsx`, no pill badges, quiet ghost secondary buttons.

## 4. Data model

All new tables are `orgId`-scoped and read through organization-scoped indexes (`AGENTS.md`). Validators
live in `convex/lib/validators.ts`. MVP data is dummy data: schema changes are direct, no migrations.

### 4.1 New tables

```ts
emailThreads: defineTable({
  orgId: v.string(),
  connectorId: v.id("connectors"),          // the mailbox the thread lives in (§11 O6)
  gmailThreadId: v.string(),                // provider id, unique per connector
  subject: v.string(),
  clientId: v.optional(v.id("clients")),    // resolved from sender domain / contact
  contactId: v.optional(v.id("clientContacts")),
  participants: v.array(v.object({ name: v.optional(v.string()), email: v.string() })),
  lastMessageAt: v.number(),
  lastInboundAt: v.optional(v.number()),
  lastOutboundAt: v.optional(v.number()),
  waitingOn: v.union(v.literal("us"), v.literal("client"), v.literal("none")),
  createdAt: v.number(), updatedAt: v.number(),
})
  .index("by_orgId", ["orgId"])
  .index("by_connector_gmailThreadId", ["connectorId", "gmailThreadId"])
  .index("by_orgId_waitingOn_lastInboundAt", ["orgId", "waitingOn", "lastInboundAt"]),

emailThreadTasks: defineTable({             // a thread ↔ its tasks (split, merge) — replaces emailThreads.taskId
  orgId: v.string(),
  threadId: v.id("emailThreads"),
  taskId: v.id("tasks"),
  role: v.union(v.literal("created"), v.literal("split"), v.literal("merged")),
  createdAt: v.number(),
})
  .index("by_threadId", ["threadId"])
  .index("by_orgId_taskId", ["orgId", "taskId"]),

agentItems: defineTable({                   // platform attention queue (P5); Triage = `source: "email"` (D25, D26)
  orgId: v.string(),
  source: v.union(v.literal("email"), v.literal("watch"), v.literal("job")),
  // what the item is about; email items anchor on the conversation: { type: "emailThread", id }.
  // At most one `open` / `snoozed` item per anchor (I13). Ownership is verified after the id read.
  anchor: v.object({ type: v.string(), id: v.string() }),
  kind: v.union(v.literal("request"), v.literal("change"), v.literal("question"), v.literal("approval"),
                v.literal("needs_look"), v.literal("waiting"), v.literal("attention"), v.literal("new_sender")),
  status: v.union(v.literal("open"), v.literal("snoozed"), v.literal("done"), v.literal("filtered")),
  // the row label (Preparing… / A question for you / N tasks ready / Kickoff ready …) is derived from the
  // linked run, question, proposal and draft — not stored
  outcome: v.optional(v.union(v.literal("created"), v.literal("merged"), v.literal("declined"),
                              v.literal("replied"), v.literal("replied_in_gmail"), v.literal("marked_done"),
                              v.literal("kept"), v.literal("applied"), v.literal("not_a_change"))),
  messageIds: v.optional(v.array(v.id("emailMessages"))),   // email items: every message covered ("Updated · 2 emails")
  agentThreadId: v.optional(v.id("agentThreads")),  // the item's conversation
  taskId: v.optional(v.id("tasks")),        // linked task (change / approval / waiting) or the created one
  proposalId: v.optional(v.id("agentProposals")),
  draftId: v.optional(v.id("emailDrafts")), // reply / kickoff
  snoozedUntil: v.optional(v.number()),     // D27; a new client message wakes it early
  decidedBy: v.optional(v.id("users")), decidedAt: v.optional(v.number()),
  createdAt: v.number(), updatedAt: v.number(),
})
  .index("by_orgId_source_status_updatedAt", ["orgId", "source", "status", "updatedAt"])
  .index("by_orgId_anchor_status", ["orgId", "anchor.type", "anchor.id", "status"])
  .index("by_status_snoozedUntil", ["status", "snoozedUntil"]),

emailMessages: defineTable({
  orgId: v.string(),
  threadId: v.id("emailThreads"),
  connectorId: v.id("connectors"),          // the mailbox it arrived in (provenance)
  gmailMessageId: v.string(),              // provider id — unique per connector, not org-wide
  rfcMessageId: v.string(),                 // Message-ID header — the same email in two colleagues' mailboxes
  direction: v.union(v.literal("inbound"), v.literal("outbound")),
  from: v.object({ name: v.optional(v.string()), email: v.string() }),
  to: v.array(v.object({ name: v.optional(v.string()), email: v.string() })),
  cc: v.array(v.object({ name: v.optional(v.string()), email: v.string() })),
  subject: v.string(),
  bodyText: v.string(),                     // quoted history stripped (§5.2) — what the agent reads
  bodyHtml: v.optional(v.string()),         // full body for the Gmail-style view (sanitised on render)
  attachments: v.array(v.object({ name: v.string(), mime: v.string(), size: v.number(),
                                  storageId: v.optional(v.id("_storage")) })),
  sentAt: v.number(),
  classification: v.optional(v.object({     // inbound only (§6.3)
    intents: v.array(v.union(v.literal("add"), v.literal("clarify"), v.literal("replace"), v.literal("cancel"),
                             v.literal("approve"), v.literal("ask"), v.literal("acknowledge"))),
    triggers: v.array(v.string()),          // hard triggers hit (D4)
    reasons: v.array(v.string()),           // the Inbox reason line
  })),
  // Processing stage (replaces the old 2-minute rule): each stage retries on its own. What the message led
  // to is not stored here — the agentItem, proposal or draft carries it (S7).
  stage: v.union(v.literal("received"), v.literal("extracted"), v.literal("classified"),
                 v.literal("handled"), v.literal("failed")),
  stageError: v.optional(v.object({ stage: v.string(), message: v.string(), attempts: v.number() })),
  createdAt: v.number(),
})
  .index("by_threadId", ["threadId", "sentAt"])
  .index("by_connectorId_gmailMessageId", ["connectorId", "gmailMessageId"])
  .index("by_orgId_rfcMessageId", ["orgId", "rfcMessageId"])
  .index("by_orgId_stage", ["orgId", "stage"]),

emailDrafts: defineTable({                  // agent-drafted outbound email awaiting a person
  orgId: v.string(),
  taskId: v.optional(v.id("tasks")),        // absent for a Triage reply / question with no task yet
  threadId: v.optional(v.id("emailThreads")),  // absent for a new conversation (recap, §6.10) until sent
  agentThreadId: v.optional(v.id("agentThreads")),  // the conversation it was drafted in
  kind: v.union(v.literal("completion"), v.literal("kickoff"), v.literal("recap"), v.literal("reply"), v.literal("question"),
                v.literal("nudge"), v.literal("interim"), v.literal("follow_up")),
  version: v.number(),                      // D9: approval applies to exactly this version
  to: v.array(v.object({ name: v.optional(v.string()), email: v.string() })),
  cc: v.array(v.object({ name: v.optional(v.string()), email: v.string() })),
  subject: v.string(),
  bodyText: v.string(),
  attachments: v.array(v.object({ label: v.string(), url: v.optional(v.string()),
                                  storageId: v.optional(v.id("_storage")) })),
  sourceSummary: v.string(),
  // the pre-send review of a version is an `agentChecks` row (subject draft, kind presend, revision = version)
  stale: v.optional(v.object({ reason: v.string(), at: v.number() })),
  subjectLocked: v.boolean(),               // true for a reply in an existing Gmail thread (D9)
  fromConnectorId: v.id("connectors"),       // the sending mailbox
  // queued = in the 15 s undo window · dispatching = handed to Gmail, no undo · unknown = Gmail outcome
  // not confirmed (checked against the mailbox before any retry)
  status: v.union(v.literal("draft"), v.literal("queued"), v.literal("dispatching"), v.literal("sent"),
                  v.literal("failed"), v.literal("unknown"), v.literal("discarded")),
  approval: v.optional(v.object({           // snapshot the approval is bound to (D9)
    version: v.number(), hash: v.string(),  // hash of subject, from, to, cc, body, attachments
    userId: v.id("users"), at: v.number(),
  })),
  sendAt: v.optional(v.number()),
  scheduledFnId: v.optional(v.id("_scheduled_functions")),
  followUp: v.optional(v.object({           // D8: created only when Gmail accepts the email
    title: v.string(), assigneeIds: v.array(v.id("users")), dueDate: v.optional(v.string()),
    subtaskIds: v.array(v.id("tasks")),
  })),
  failure: v.optional(v.object({
    kind: v.union(v.literal("disconnected"), v.literal("permission"), v.literal("recipient"),
                  v.literal("quota"), v.literal("transient"), v.literal("unknown")),
    message: v.string(),
  })),
  sentMessageId: v.optional(v.id("emailMessages")),
  createdBy: v.union(v.literal("agent"), v.id("users")),
  createdAt: v.number(), updatedAt: v.number(),
})
  .index("by_orgId_task", ["orgId", "taskId"])
  .index("by_orgId_status", ["orgId", "status"]),

emailPromises: defineTable({                // what we told the client, with a date (§6.8.3)
  orgId: v.string(),
  threadId: v.id("emailThreads"),
  messageId: v.id("emailMessages"),         // the outbound message that made the promise
  taskId: v.optional(v.id("tasks")),
  text: v.string(),                         // "a visszaszámláló hétfőn élesedik"
  dueDate: v.string(),                      // YYYY-MM-DD (org timezone)
  status: v.union(v.literal("open"), v.literal("kept"), v.literal("broken"), v.literal("cancelled")),
  createdAt: v.number(), resolvedAt: v.optional(v.number()),
})
  .index("by_threadId", ["threadId"])
  .index("by_orgId_status_dueDate", ["orgId", "status", "dueDate"]),

clientRequests: defineTable({               // the request ledger: nothing the client asked can get lost (§6.1)
  orgId: v.string(),
  clientId: v.optional(v.id("clients")),
  // where it was asked: an email, or a transcript / note given to the assistant (§6.10)
  threadId: v.optional(v.id("emailThreads")),
  messageId: v.optional(v.id("emailMessages")),
  chatFileId: v.optional(v.id("agentChatFiles")),
  agentThreadId: v.optional(v.id("agentThreads")),  // pasted text: the conversation it was pasted into
  text: v.string(),                         // the request in the client's words
  constraints: v.optional(v.array(v.object({ kind: v.string(), value: v.string() }))),  // "size": "1200×628"
  disposition: v.union(v.literal("open"), v.literal("covered"), v.literal("answered"),
                       v.literal("question_pending"), v.literal("dismissed"), v.literal("superseded")),
  taskId: v.optional(v.id("tasks")), subtaskId: v.optional(v.id("tasks")),
  supersededBy: v.optional(v.id("clientRequests")),   // "use 15% instead of 20%"
  dismissedReason: v.optional(v.string()),
  createdAt: v.number(), updatedAt: v.number(),
})
  .index("by_threadId", ["threadId"])
  .index("by_agentThreadId", ["agentThreadId"])
  .index("by_orgId_disposition", ["orgId", "disposition"]),

agentQuestions: defineTable({               // the question block (D16, §6.6)
  orgId: v.string(),
  agentThreadId: v.id("agentThreads"),
  runId: v.optional(v.id("agentRuns")),
  askedUserId: v.id("users"),               // who must answer
  header: v.string(),                       // short label, e.g. "Countdown"
  question: v.string(),
  options: v.array(v.object({ label: v.string(), description: v.optional(v.string()),
                              recommended: v.optional(v.boolean()) })),
  multiSelect: v.boolean(),
  allowOther: v.boolean(),
  proposalRevision: v.optional(v.number()), // the plan revision the question belongs to
  blocks: v.optional(v.object({ requestId: v.optional(v.id("clientRequests")),
                                taskId: v.optional(v.id("tasks")), subtaskId: v.optional(v.id("tasks")) })),
  status: v.union(v.literal("pending"), v.literal("answered"), v.literal("later"), v.literal("expired")),
  answer: v.optional(v.object({ optionIndexes: v.array(v.number()), other: v.optional(v.string()) })),
  answeredAt: v.optional(v.number()),
  createdAt: v.number(),
})
  .index("by_agentThreadId_status", ["agentThreadId", "status"])
  .index("by_orgId_askedUserId_status", ["orgId", "askedUserId", "status"]),

agentChatFiles: defineTable({               // files dropped or pasted into an assistant conversation (D1)
  orgId: v.string(),
  threadId: v.id("agentThreads"),
  userId: v.id("users"),                    // who added it; only readable where the thread is readable
  storageId: v.id("_storage"),
  name: v.string(), mimeType: v.string(), size: v.number(),
  createdAt: v.number(),
})
  .index("by_threadId", ["threadId"]),

attachmentContents: defineTable({           // what the agent can read inside a file (T2) — keyed by the file (S5)
  orgId: v.string(),
  // one row per stored file, no FK to the referencing row: read access comes from the task, comment, email
  // or chat file that references this storageId, re-checked at read time
  storageId: v.id("_storage"),
  mimeType: v.string(),
  status: v.union(v.literal("pending"), v.literal("done"), v.literal("unsupported"), v.literal("failed")),
  text: v.optional(v.string()),             // PDF / DOCX / TXT / MD, capped (e.g. 50 000 chars)
  pageCount: v.optional(v.number()),
  width: v.optional(v.number()), height: v.optional(v.number()),   // images
  error: v.optional(v.string()),
  extractedAt: v.optional(v.number()),
})
  .index("by_storageId", ["storageId"])     // unique: one row per file
  .index("by_orgId_status", ["orgId", "status"]),

oauthStates: defineTable({                  // one-time OAuth state for connector sign-in (PKCE)
  orgId: v.string(), userId: v.id("users"), connectorType: v.string(),
  state: v.string(), codeVerifier: v.string(), createdAt: v.number(), expiresAt: v.number(),
})
  .index("by_state", ["state"]),

agentChecks: defineTable({                  // one QA result shape (S3): hand-over QA (§6.8.1), pre-send review (§6.7)
  orgId: v.string(),
  subject: v.union(v.object({ type: v.literal("task"), id: v.id("tasks") }),
                   v.object({ type: v.literal("draft"), id: v.id("emailDrafts") })),
  kind: v.union(v.literal("handover"), v.literal("presend")),
  revision: v.number(),                     // presend: the draft version; handover: the task revision checked
  runId: v.optional(v.id("agentRuns")),
  results: v.array(v.object({
    key: v.string(), state: v.union(v.literal("ok"), v.literal("warn"), v.literal("block"), v.literal("info")),
    text: v.string(), detail: v.optional(v.string()), evidence: v.optional(v.array(v.string())),
  })),
  submittedAnyway: v.optional(v.object({ note: v.string(), userId: v.id("users"), at: v.number() })),
  partial: v.optional(v.object({            // handover only — D8 "Hand over partially"
    followUpSubtaskIds: v.array(v.id("tasks")), reason: v.string(), userId: v.id("users"), at: v.number(),
  })),
  createdAt: v.number(),
})
  .index("by_orgId_subject_kind", ["orgId", "subject.id", "kind", "createdAt"]),
```

One renderer and one gate reader for both kinds; later QA agents (e.g. a check before an invoice) write here
too.

### 4.2 Reused tables (extended, not replaced)

- **`orgSettings`** — add `emailTriageEnabled: v.optional(v.boolean())` (D23; off when unset, no UI),
  `ignoredEmailDomains: v.optional(v.array(v.string()))` (§5.2) and
  `emailDefaultDueWorkingDays: v.optional(v.number())` (default 2 when unset; §6.1). The last two are edited
  in Settings (§7.6).

- **`statuses`** — add `workflowRole: v.optional(v.union(v.literal("admin_review"), v.literal("client_review"), v.literal("blocked")))`,
  at most one status per role per org; the seed sets it on Admin review, Client review and Stuck. Every rule in
  this PRD that says "Admin review" / "Client review" reads the role, never the name (tasks refactor D3:
  business logic never reads a status name). Added by this PRD on top of the merged tasks refactor — §11 O7.
- **`agentThreads`** — add `visibility: "private" | "admins"` and optional `anchor: { type: "emailThread" |
  "task" | "project" | …, id }` (P3, S9). `private` keeps today's rule (only the thread's user). An `admins`
  thread may be read, written and decided in by any org admin (§11 O3); the Triage conversation of one email
  thread is `admins` + anchor `emailThread`. A member's assistant conversation about one task is `private` +
  anchor `task` — never the admin conversation (I10). This visibility policy replaces today's
  `requireOwnedThread` / `requireOwnProposal` owner-only rules (`agentThreads.ts`, `agentProposals.ts`).
  Per-thread run lock (I11).
- **`agentRuns`** — store the run's actor (P1): `actor: { userId, isAdmin, via: "user" | "background",
  jobRunId? }`, computed from `ctx.auth` by `beginRun` for interactive runs and loaded from a stored record
  (re-checked at run time) for background runs. Tools read it with `resolveRunActor(ctx)`; activity rows
  written by a background run carry `via: "agent"` + `agentRunId` (§11 O1, E2).
- **`agents`** — the existing `model` override is honoured through the job registry (§5.1, F11); today the
  runner ignores it.
- **`agentProposals`** — four payload kinds in `convex/lib/proposalValidators.ts` (S2), shared by Triage, the
  Agents workspace and the Task Drafter; email specifics live in `source`, never in the kind name. Ids inside
  payloads stay plain strings, normalised at approve time (today's rule).
  ```ts
  { kind: "createTask",                           // exists (Task Drafter); extended
    title, description?, descriptionJson? /* TipTap */, projectId?, clientId?, assigneeIds?, priority?,
    dueDate?, workCategoryId?, labelIds?,
    subtasks?: [{ title /* self-explaining, D13 */, assigneeIds, dueDate?, requestIds? }],
    source?: { kind: "email", threadId, messageId, requestIds: Id<"clientRequests">[] }   // ledger rows covered (§6.1)
           | { kind: "agentThread", agentThreadId, requestIds?: Id<"clientRequests">[] }, // Agents workspace (§6.9–6.10)
    grouping?: { planId, mode: "one" | "byDiscipline" | "custom", suggested: "one" | "byDiscipline",
                 index, of },                     // a split plan = N createTask proposals sharing planId ("Task N of M")
    fieldReasons?: Record<string, { reason: string; confidence: "sure" | "unsure" }>,   // "Why these suggestions?"
    similarTaskIds?: Id<"tasks">[],
    openQuestionIds?: Id<"agentQuestions">[],
    newClient?: { name, domain, contact: { name, email } },
    replyDraftId?: Id<"emailDrafts">              // question-kind email: reply instead of a task
  }
  { kind: "updateTask", taskId, source?,          // D4 change proposals, Merge (D29), standup changes, files (D1)
    fields?: { title?, statusId?, assigneeIds?, dueDate?, priority?, workCategoryId?, labelIds? },
    reopen?: { statusId },                        // reopen when the task held a review role or was done
    subtasks?: { add?: [{ title, assigneeIds, dueDate?, requestIds? }],
                 amend?: [{ subtaskId, title?, assigneeIds?, dueDate?, requestIds? }],
                 cancel?: [{ subtaskId, reason }],
                 tick?: Id<"tasks">[] },
    attachFiles?: Id<"agentChatFiles">[],         // chat files → task attachments (D1), re-checked on approve
    fieldReasons? }
  { kind: "postComment", taskId, bodyJson, source? }
  { kind: "proposeSkill", … }                     // §6.8.4
  ```
  Every proposal carries a `revision`; approving an older revision fails with "this changed — review again"
  (I11). `editedPayload` keeps the owner's edits; the agent's original payload stays for audit (revision
  count is shown as "Rev N · M edits by you"). One shared decision policy (who may decide: the proposal's
  user, or any admin on an `admins` thread). Approve → `tasks/write.ts`: a `createTask` group creates the
  task(s) + subtasks in one mutation (`deferNotifications` for D30), an `updateTask` goes through
  `updateTask` (I3 gate), then write `emailThreadTasks` (email source), log activity, notify assignees.
- **`notifications`** — `taskId` becomes optional and a general `subject?: { type, id }` ref is added (a
  digest, a watcher signal or "Mailbox not syncing" is not tied to a task). Three new `type`s (S8):
  `email_event` with a `subtype` (`reopened` | `subtasks_added` | `no_action` | `unlinked` | `review_ready` |
  `sent` | `send_failed` | `client_waiting_24h` | `sent_from_your_mailbox`), `agent_signal` with `signal`
  (`stuck` | `promise_at_risk` | `quiet_task` | `waiting_internal` | `overdue_open` | `undecided_request`;
  §6.8.3), and `daily_digest`. Add `threadId?`, `messageId?`, `reasonText?`. A new signal is a new `signal`
  value, not a schema change; the Inbox renderer is the same for all.
- **`activityLog`** — new kinds: `email_received`, `email_sent`, `task_created_from_email`,
  `reopened_from_email`, `subtasks_added_from_email`, `sent_back`, `send_failed`, `handover_check`; each
  carries `messageId?` / `threadId?`. Agent-made rows carry `via: "agent"` and `agentRunId` (§11 O1).
- **`clients`** — add optional `emailDomains: string[]`, `defaultProjectId`, `replyCcEmails: string[]`.
  Routing reuses the existing **`projects.defaultAssignees`** (work category → user) first.
- **`connectors`** — catalog type `gmail` in `lib/agents/connectors.ts` (`authKind: "oauth"`; scopes
  `gmail.readonly` + `gmail.send`); access + refresh token encrypted with `convex/lib/secretCrypto.ts`;
  status flips to `expired` when refresh fails. One per user (D17). Add `sync?: { cursor, lastSyncAt,
  lastFullSyncAt, error }` (S4) — for Gmail the cursor is the history id, set to "now" on first connect
  (D34); any later polling connector syncs the same way.
- **`tasks`** — no change. The threads of a task are read through `emailThreadTasks.by_orgId_taskId` (S6).

### 4.3 Invariants

- I1 One `emailThreads` row per Gmail thread per connector; one `emailMessages` row per Gmail message per
  connector (idempotent on `connectorId` + `gmailMessageId`). The same email in two colleagues' mailboxes
  (same `rfcMessageId`) makes **one** Triage item; both copies are kept for provenance.
- I2 A thread may link to several tasks and a task to several threads, through `emailThreadTasks` (split,
  merge); the primary thread is the `emailThreadTasks` row with role `created`. A draft answers exactly one thread, takes its
  participants from that thread only, and never claims work of a linked task that is still open.
- I3 A task cannot move to the `admin_review` role while it has open subtasks, unless the hand-over is
  partial (D8) and names every open subtask; enforced in `convex/tasks/write.ts` `updateTask` (so
  `bulkUpdate`, which goes through it, is covered too), not in the UI.
- I4 Outbound mail is sent only from a `queued` draft whose `approval.hash` still matches its content and
  whose `sendAt` has passed; the send action claims the draft (`queued` → `dispatching`) in one mutation
  before calling Gmail, so a send can never start twice. An unconfirmed result becomes `unknown` and is
  checked against the mailbox (by Message-ID) before any retry.
- I5 Every inbound message moves through `received → extracted → classified → handled`; a failed stage is
  retried on its own (3 attempts), then surfaces as attention in Triage. A message is never dropped, and an
  unreadable attachment stays visibly unresolved.
- I6 Only an org admin may decide Triage proposals, approve and send replies, or see Triage and
  Reviews; members see their tasks, their Inbox, their own assistant on their tasks, and may create drafts
  for the owner (§5.5, §11 O3).
- I7 An `agentQuestions` row ends its run; only `askedUserId` (or an admin) answers it; an answer is bound
  to the question and the plan revision and starts the next run exactly once.
- I8 `emailPromises` rows are written only from an approved, sent draft — never from model output alone.
- I9 While a change proposal (D4) is pending on a task, the task cannot move to the `admin_review` role and
  no draft for it can be approved or sent.
- I10 A member never reads an admin or shared transcript: their assistant runs in their own `private` thread
  anchored on the task, and every tool read, cited source and attachment is re-authorized for them at read time.
- I11 Runs on one agent thread are serialized (per-thread run lock); every proposal and question carries a revision, and a
  decision on an outdated revision is refused.
- I12 Every `clientRequests` row has a disposition other than `open` before Create (in Triage or an Agents
  conversation) and before Send (Reviews); `dismissed` needs a reason.
- I13 At most one `open` or `snoozed` `agentItems` row per anchor — for email, per conversation (D25); a new
  message joins it.
  Nothing from a member's mailbox is stored unless it is from a known client or on a tracked thread (D24).
- I14 Every email feature checks `orgSettings.emailTriageEnabled` on the server — routes, queries, mutations
  and crons — not only in the UI (D23).
- I15 A background run acts only through a stored actor that is re-checked (membership, role) at run time;
  there is no public "run as user" entry point; only registry tools marked `background: true` are available
  to it (P1).

## 5. Backend architecture

### 5.1 Module layout

**Platform layer — no email code; email is its first consumer** (implementation plan §3 P1–P6). Monthly
Close, the PM watcher, standups and scheduled runs build on the same pieces.

```
convex/agentRunner.ts       (exists) P1: `beginRun` computes the actor from `ctx.auth` and stores it on the
                            `agentRuns` row; tools read it with `resolveRunActor(ctx)` and call internal
                            queries with that explicit actor — one code path for interactive and background
                            runs. BYOK key (`aiIntegration.ts`) and `connectors.resolveForRun` get actor-based
                            variants. Per-thread run lock (I11).
convex/agentBackground.ts   P1: `internal.agentBackground.start(job, anchor, actingUserId)` — loads the actor
                            from a stored record and re-checks membership and role at run time (I15); no
                            public "run as" entry point. Only registry entries marked `background: true` run
                            here — migrated incrementally, first the read tools the email jobs need
                            (listClients, listProjects, listTeamMembers, listWorkCategories, listStatuses,
                            findTasks, getTaskDetail); no finance tools.
convex/lib/agentJobs.ts     P2: code-defined jobs, like the tool registry:
                            `{ name, tier, instructions, tools, stages, outputSchema, model }`.
                            tier `llm_step` — one structured model call (`generateText` + output schema, as
                            `worksheetAi.ts` does), no agent thread, no tool loop, one light audit row:
                              classifyInbound, checkCompleteness, screenSender, extractPromises.
                            tier `agent_run` — a runner run on an agent thread, tools inside fixed stages:
                              prepareTask, draftReply (modes kickoff · completion · reply · nudge · interim ·
                              recap), presendReview, handoverQA.
                            `stages` is the §6.5 fixed stage list the run line renders; `model` wires the
                            `agents.model` override (unused by the runner today, F11).
convex/agentThreads.ts      (exists) P3: visibility policy (`private` | `admins`) + `anchor`, replacing
                            `requireOwnedThread`; revisions on proposals and questions (I11)
convex/agentProposals.ts    (exists) P4: the four kinds (§4.2) with one shared decision policy, replacing
                            `requireOwnProposal`; approve-as-approver path unchanged
convex/agentItems.ts        P5: the attention queue (open / join / snooze / wake / done / filtered) for every
                            source; Triage reads `source: "email"`
convex/agentChecks.ts       P4: write and read QA results (handover, presend); the gate reader of §6.7
convex/agentReads.ts        T3, T9–T13 read tools' backing queries (wrap comments.byTask, activityLog.byTask,
                            attachments.byTask, commentAttachments.byTask, tasks.getSubtasks; actor-checked)
convex/agentQuestions.ts    ask (internal, from the runner), answer / later (public), list for a thread
convex/attachmentContents.ts  "use node" extraction action (PDF, DOCX, TXT/MD, image size) scheduled on upload
convex/agentChatFiles.ts    D1: upload URL, record per thread, list for the run, re-checked when an
                            `updateTask` with `attachFiles` is approved
convex/oauth.ts + http.ts   connector OAuth start / callback routes (PKCE, `oauthStates`), token refresh
convex/lib/workingDays.ts   new, pure: working-day arithmetic in the org timezone (D37 clocks, §6.1 default
                            due). The client helper `lib/planner.ts` stays client-only.
lib/agents/blocks.ts        (exists) P6: every new block (question, email draft, change list, task card,
                            request checklist, retainer card) is a marker-keyed block kind; blocks store
                            references and render through a reactive query with the viewer's access (§7.1)
```

**Email domain** (`convex/email/*`): Gmail sync / ingest / filter, `emailThreads` / `emailMessages` /
`emailDrafts`, `emailThreadTasks`, the `clientRequests` ledger, `emailPromises`, the send pipeline, the
dispatch table.

```
convex/email/
  gmail.ts        actions: history sync from `connectors.sync.cursor` (D36), fetch thread/message, send
                  (In-Reply-To / References), confirm by Message-ID, attachment download to _storage
  ingest.ts       upsert thread + message (stage `received`), strip quoted history, link client/contact/task
                  (§5.2), then attachment extraction (`extracted`); `screenSender` for unknown senders (D24)
  classify.ts     llm_step "classifyInbound" (§6.3) → intents + ledger rows (`classified`) → dispatch (§5.3)
  requests.ts     the request ledger (`clientRequests`): add, cover, answer, supersede, dismiss; the
                  completeness pass (llm_step "checkCompleteness", §6.1)
  triage.ts       email `agentItems` (open / join / snooze / wake / done, D25–D27), the `createTask` proposal
                  with source email (job "prepareTask" §6.1), create (+ 10 s undo, D30) / decline / snooze /
                  merge (D29), reply from Triage, approval → Mark done (D32), Filtered promote
  changes.ts      D4 on linked tasks: builds the `updateTask` proposal with source email (add / amend /
                  cancel subtasks, reopen), applies it on approve, escalates an undecided one (§6.8.3)
  drafts.ts       emailDrafts versions, approval snapshot, pre-send review (job "presendReview" →
                  `agentChecks`), queue (15 s), undo, dispatch, confirm, failure, stale (§5.4)
  promises.ts     llm_step "extractPromises" on the approved draft at send time (I8), resolve kept / broken
  watch.ts        hourly watcher signals + 9:00 digest (§6.8.3)
  reviews.ts      read model for Reviews (tasks in the admin_review role joined with drafts and checks)
  model.ts        pure helpers: hard triggers (HU + EN), quoted-history stripping, address parsing,
                  domain → client matching, subject normalisation, date extraction. 100% unit-tested.
convex/crons.ts   new (no crons file exists today): 1 min: history sync per mailbox (D36) and wake snoozed
                  items · 5 min: retry failed stages, confirm `unknown` sends · hourly: watcher · 9:00: digest ·
                  daily: delete Filtered messages older than 30 days (D24). Every job skips orgs without
                  `emailTriageEnabled` (I14).
```
Task writes go through `convex/tasks/write.ts` (refactor PRD §5.1; `tasksWriteBoundary.test.ts` enforces
it). Entry points: `createTask` gains a `deferNotifications` option (D30 — assignees are notified by a
scheduled function when the undo toast ends) and creates a task + subtask tree in one mutation; `updateTask`
holds the I3 / I9 gate on `workflowRole` (so `bulkUpdate` is covered); add `sendBack` and
`handOverPartially`. Never write `tasks`, `taskAssignees` or counters from `convex/email/*` or the agent
modules.

### 5.2 Ingestion and linking

1. **Sync (D36).** Every minute, per mailbox, `gmail.ts` reads the history since `connectors.sync.cursor` and
   advances the cursor only after the messages are stored. On first connect the cursor starts at "now" —
   no backfill (D34). An expired cursor triggers a bounded resync (last 7 days) that is idempotent through
   I1. A sync error shows on the connector row (§7.6) and in Triage as "Mailbox not syncing". No Gmail push
   in V1.
2. **Filter (D24).** Read only `INBOX` and our own sent mail. Skip Gmail categories Promotions / Social /
   Updates / Forums, spam, auto-replies and bulk mail (`List-Unsubscribe`, `Precedence: bulk`,
   `Auto-Submitted`), and domains in `orgSettings.ignoredEmailDomains`. Then:
   - **known client** (contact email, client domain, or a tracked thread) → continue;
   - **unknown sender, admin's mailbox** → one short check (llm_step `screenSender`); a possible new client → continue as a
     "new sender" item, otherwise store as a `filtered` item (deleted after 30 days unless promoted);
   - **unknown sender, member's mailbox** → not stored (I13).
   A message whose sender is a team member is stored for the thread as outbound; on a tracked thread it
   applies D33 (drafts stale, kickoff closed as "Replied in Gmail", `waitingOn: "client"`).
3. Store (`received`). The same email reaching two connected mailboxes (same `rfcMessageId`) makes one
   Triage item (I1); a message on a conversation with an open item joins that item (D25, I13).
4. Strip quoted history into `bodyText` (`model.stripQuoted`: Gmail quote markers, "On … wrote:",
   "… írta:", `>` lines, signatures); keep the full body in `bodyHtml` for the Gmail-style view.
5. Link thread → client: existing thread, else contact email, else `clients.emailDomains`, else unknown
   sender (Create also creates client + contact).
6. Link thread → task: `emailThreadTasks` of the thread; else a task identifier in the subject (`PRG-131`)
   belonging to the same client; else unlinked → Triage.
7. Download attachments → extraction (`attachmentContents`) → `extracted` → classify → `classified` →
   dispatch → `handled`. Each stage retries on its own; after 3 failures the message is `failed` and shows
   in Triage with the stage and a Retry (I5).

### 5.3 Dispatch after classification

| Thread state | Intents (§6.3) | Result |
|---|---|---|
| unlinked | add, or no clear intent | Triage item (`createTask` proposal, source email), the agent prepares the plan |
| unlinked | ask only | Triage item with a reply draft; "Make it a task instead" stays possible |
| unlinked | acknowledge only, no hard trigger | Inbox `email_event` · `no_action` with reasons |
| linked | add / clarify / replace / cancel, or approve with an action ("mehet élesbe" → "Élesítés …") | `updateTask` proposal (source email) as a top-of-Triage "Reply on ‹task›" item (reopen when the task held the `admin_review` / `client_review` role or was done); Inbox informs; the task's drafts become stale (D9); I9 until decided |
| linked | ask only, answerable from the task | reply draft → Triage "Reply ready" |
| linked, task in the `client_review` role | approve without an action, no hard trigger | Triage item kind `approval` "Réka approved ‹task›" → `Mark done` / `Keep in Client review` (D32) |
| linked | approve without an action (task not in `client_review`), or acknowledge, no hard trigger | Inbox `email_event` · `no_action` "checked for…" reasons; `waitingOn: none` |
| any | hard trigger, nothing recognised | Triage item "needs a look" (D4) |
| conversation already has an open / snoozed item | any | joins that item: new plan revision, snoozed item wakes (D25, D27) |
| linked, no answer from us > 24 working hours (D37) | — | Triage item with a drafted reply; Inbox `email_event` · `client_waiting_24h` |
| linked, our last mail unanswered > 3 working days (D37) | — | `emailDrafts` kind `nudge` → Reviews |

With several tasks on a thread, each new request is routed to the task whose work category fits; when
unclear the agent asks (D16, D18).

### 5.4 Sending

```
draft ──Approve & send──▶ queued (15 s, Undo) ──▶ dispatching ──▶ sent
  ▲                         │ Undo / edit            │ error ──▶ failed (draft kept)
  └─────────────────────────┘                        └ no answer ──▶ unknown ──confirm──▶ sent | failed
```

- **Sending mailbox (D35).** `fromConnectorId` defaults to the sending admin's own mailbox when it holds
  the conversation, else the mailbox the client wrote to; it can switch only among mailboxes that hold the
  conversation. Sending from a colleague's mailbox leaves that colleague an Inbox note (`email_event` ·
  `sent_from_your_mailbox`).
- **Approve & send** stores `approval` (version + hash of subject, From, To, Cc, body, attachments), sets
  `queued`, `sendAt = now + 15 000` and schedules the send. The countdown is read from `sendAt`, so it
  survives a reload. Undo or any edit before `sendAt` → `draft`, approval cleared.
- **Dispatch** claims the draft in one mutation (`queued` → `dispatching`, I4) after re-checking the hash,
  I9 and staleness; then the action sends in the original thread (subject locked, In-Reply-To /
  References) — or, for a recap (§6.10), as a new conversation whose `emailThreads` row is created when
  Gmail accepts it. No Undo from here on.
- **Sent**: store the outbound `emailMessages` row, log `email_sent`, extract `emailPromises` (llm_step `extractPromises`, I8), mark the
  answered ledger rows, move the task to the `client_review` role (completion kind), `waitingOn: "client"`;
  for a partial hand-over (D8) create the follow-up task now from `followUp`.
- **Failed**: `failure.kind` decides the fix shown — `disconnected` → Reconnect; `permission` → reconnect
  with the send scope; `recipient` → edit To/Cc; `quota` / `transient` → Retry (automatic once). The draft
  stays.
- **Unknown** (timeout, no Gmail answer): the cron looks for the Message-ID in the mailbox's Sent folder;
  found → `sent`, not found after 10 min → `failed` with Retry. Never resent blindly.

### 5.5 Access policy

| Action | admin | member |
|---|---|---|
| see Triage, decide proposals (create / decline / snooze / merge) | ✓ | ✗ |
| see Reviews, approve, send, send back | ✓ | ✗ |
| create `emailDrafts` for the owner from a task | ✓ | ✓ (own task) |
| see email messages on a task | ✓ | ✓ if they can read the task |
| the shared email conversation (`visibility: "admins"`, anchor `emailThread`) | ✓ any admin | ✗ |
| assistant on a task (`visibility: "private"`, anchor `task`, own thread) | — | their assigned tasks only (I10) |
| answer an `agentQuestions` row | own + any (admin) | own |
| Inbox notifications | own | own |
| connect / disconnect Gmail | own mailbox | own mailbox (D17; what it feeds: §11 O6) |

## 6. Agent behaviour (prompts in `convex/email/prompts.ts`, tools in `agentToolRegistry.ts`)

Every email job is an entry in the job registry (`convex/lib/agentJobs.ts`, §5.1). **`llm_step` jobs**
(`classifyInbound`, `checkCompleteness`, `screenSender`, `extractPromises`) are one structured model call
each — no conversation, no tool loop, no agent thread — validated against the job's output schema, with a
light audit row. **`agent_run` jobs** (`prepareTask`, `draftReply`, `presendReview`, `handoverQA`) go
through the existing runner (`agentRunner.ts`) as a system agent "Email assistant" seeded per org — the
Triage and Reviews jobs on one shared `agentThreads` row (`visibility: "admins"`, anchor `emailThread`) per
email thread, `handoverQA` on the task (audit in `agentRuns`); their structured results come from a final tool call (`submitTriageProposal`, `submitDraft`),
never parsed from prose. Runs on one thread are serialized (I11).

**Background actor (E2, refines §11 O1).** Automatic runs start through `internal.agentBackground.start`
(P1, I15). Gmail access stays with the connector owner (whose mailbox the email came to). A run on an
`admins` thread (the Triage conversation) reads at admin level, on behalf of a designated admin of the org,
so the admin-only blocks (retainer card) are complete even for an email that arrived in a member's
mailbox; its rows carry `via: "agent"` + `agentRunId`.

### 6.1 prepareTask (Triage)

Input: the stripped message and thread history, attachment texts (T2), client defaults and project
routing (T3), the client's last 20 tasks, team members and their recent categories, work categories,
statuses. Output (`createTask` proposals with `source: { kind: "email" }`, one per task):

- `title` — short, in the team's language (D19), no "Re:".
- `descriptionJson` — D13: a short paragraph (goal, context, what from similar past work applies), then
  "Kész, ha" bullets; materials / scope / related tasks only when they matter. Written for the assignee,
  not the client. TipTap JSON via `lib/tiptap-utils.ts`, never raw HTML.
- `subtasks[]` — **self-explaining title** (D13), assignee (routing → similar tasks → default), due, and
  the `requestIds` it covers.
- **Due dates** (task and subtasks): a date in the email wins (resolved in code, org timezone); otherwise
  the email's arrival + `orgSettings.emailDefaultDueWorkingDays` working days (default 2, weekends
  skipped — Friday 15:00 → Tuesday). Urgent emails ("élesben hibás", "minél előbb") get today. A defaulted
  date is not a question (D18); "Why these suggestions?" says "No deadline in the email — default 2
  working days". The task's due is its latest subtask due.
- **Request ledger.** `classifyInbound` writes one `clientRequests` row per request (with its constraints:
  sizes, %, dates, links). The plan must give every row a disposition — covered by a subtask, answered in
  a reply, waiting on a question, or dismissed with a reason (I12). Code checks it, plus that every
  constraint appears verbatim in the covering subtask. A failed check sends the run back once to fix it,
  then shows the gap to the owner instead of guessing.
- **Completeness pass.** A second, short model call (llm_step `checkCompleteness`) reads the email against the ledger only: "anything
  asked that has no row?" New rows go through the same check. This is what goal 4 measures (§8).
- `fieldReasons` — one line per agent-filled field, for "Why these suggestions?".
- grouping — `one` by default (D6); `grouping.suggested: byDiscipline` when the subtasks span work
  categories with different owners, asked as a question (D16).
- open questions — only per D18; a question names the request or subtask it blocks.
- `newClient` — unknown sender. Question-kind email: a reply draft instead of tasks.

**After Create: the kickoff reply (D21).** The `draftReply` job in `kickoff` mode (no new tools) writes an
`emailDrafts` row kind `kickoff` in the thread, in the client's language (D19), from data already in the
plan: a thank-you line; one sentence on what we started (not the subtask list); when we get back — the
earliest subtask due date, worded as "within N working days" or the weekday; every `clientRequests` row
with intent `ask` that the plan or the sources can answer now (marked `answered` when sent); every
`question_pending` row the owner chose to ask the client (one numbered list, the shortest wording). It
contains no prices, estimates or internal names unless the client asked and the plan holds the answer.
The "we'll get back by …" sentence becomes an `emailPromises` row when sent (I8), so the watcher notices if
it slips. Sending follows §5.4 like any draft.

### 6.2 draftReply · completion (Reviews)

Triggered when a linked task reaches the `admin_review` role with all subtasks done (or with open
subtasks via D8 — then the draft says what is not done and when it comes). Input: description, subtasks,
comments, activity, files and attachment texts, the whole thread with all linked tasks (T12), open
promises, the owner's tone samples (T6), applied rules (§6.8.4). Output: `emailDrafts` kind `completion`,
version 1: `to` = thread contact, `cc` = `clients.replyCcEmails` + anyone the client copied, subject =
thread subject, body in the client's language, attachments = the deliverables found on the task,
`sourceSummary`. When the draft deliberately holds something back (a date not yet known, work not yet
done), the agent's message says so in one sentence ("I didn't promise a date — the texts aren't approved
yet"). It then runs the pre-send review (`presendReview`, §6.7), stored as an `agentChecks` row (presend) for the
version.

### 6.3 classifyInbound (llm_step)

Deterministic first (`model.ts`): hard triggers (HU + EN) and the `acknowledge` shortcut, which is only
possible when **no** trigger fires and the text is short and matches a thanks pattern. Then the model
returns the message's intents and its requests:

| Intent | Example | Ledger effect |
|---|---|---|
| add | "és kérnénk egy story méretet is" | new row |
| clarify | "a 20% csak a webshopra vonatkozik" | constraint added to an existing row |
| replace | "mégis 15% legyen" | new row, old row `superseded` |
| cancel | "a hírlevél mégsem kell" | row `dismissed` (reason: client cancelled) |
| approve | "mehet élesbe" | an action → new row ("Élesítés …"); no action → nothing |
| ask | "mikorra lesz kész?" | row answered by a reply draft |
| acknowledge | "köszönjük!" | nothing |

A message may carry several intents. When the model is unsure between acknowledge and anything else, it is
not acknowledge. The intents decide the dispatch row (§5.3).

### 6.4 Tools: what exists, what is missing

Read tools call the read layers with the run's actor (`resolveRunActor`, P1) — the running user's access, or
the stored, re-checked actor of a background run. No tool sends email.

**Reused as-is** (`convex/lib/agentToolRegistry.ts`, 27 tools today): `listClients`, `listProjects`,
`listTeamMembers`, `listWorkCategories`, `listStatuses`, `findTasks`, `getTaskDetail`, `proposeCreateTasks`,
the time and retainer tools. Background runs get only the entries migrated to the actor layer and marked
`background: true` (A1: the read tools above; no finance tools).

**To build** (gap → what the agent cannot do without it; phase in §9):

| # | Tool | Reads | Without it | Phase |
|---|---|---|---|---|
| T1 | `getEmailThread` | `emailThreads` + `emailMessages` | no input at all | B6 |
| T2 | `getAttachmentText` | `attachmentContents` | sees file names, not content | A6 |
| T3 | `getProjectRouting` | `projects.defaultAssignees`, client defaults | guesses assignees from history | A3 |
| T4 | `getTeamLoad` | `planSegments` + open tasks per user, next 10 working days | may pick the busiest person | D2 |
| T5 | `askUser` | writes `agentQuestions`, ends the run | can only guess or stop | A5 |
| T6 | `getOwnerToneSamples` | the sender's last 10 sent messages to this client | generic replies | C1 |
| T7 | `findSimilarTasksForClient` | V1 `findTasks` + category/title ranking; V2 embeddings | "like PRG-118" only on matching titles | B6 / later |
| T8 | `submitTriageProposal`, `submitDraft` | — structured results of `agent_run` jobs (`llm_step` jobs return their output schema directly) | results parsed from prose | B6, C1 |
| T9 | `getTaskComments` | comments + mentions + comment attachments (task and subtasks) | misses blockers and open questions | A3 |
| T10 | `getTaskActivity` | status / assignment changes, reopenings, time entries with notes | can't tell what changed or why | A3 |
| T11 | `getTaskFiles` | attachments with type, size, image size (T2), uploader, time; link previews | can't check deliverables | A3 |
| T12 | `getThreadWork` | all tasks of a thread with status, subtasks, sent emails, open promises | contradicts earlier replies, claims too much | C1 |
| T13 | `getClientHistory` | the client's threads and tasks, last 6 months | no memory of how this client works | C3 |
| T14 | `getTaskBundle` | one call: task + subtasks + last comments + recent activity + files (digest) | many round trips, step budget burnt | A3 |
| T15 | `getThreadRequests` | `clientRequests` of an email thread or an Agents conversation, with disposition and the covering subtask | can't show what the client asked so far | B8 |

`getTaskDetail` today returns title, description, properties, minutes and subtasks only. T9–T11 and T14
serve every agent, not only email.

### 6.5 Run shape: fixed stages, free tool use inside

Each job (`prepareTask`, `draftReply`, `classifyInbound`, `presendReview`, `handoverQA`) has a **fixed
stage list in code** — the `stages` of its job registry entry (P2); the UI's step list renders these
stages from real `agentRuns` events, never from a script. Inside a stage the model chooses which tools to call. Code, not the model: date resolution,
coverage, counts, permissions, writes.

### 6.6 Asking the user (question block)

The platform has no pause/resume. `askUser` writes an `agentQuestions` row and **ends the run**; the block
renders in the conversation (D16). The answer — option(s), free text or "Later" — is stored on the row,
shown as the user's turn, and starts the next run in the same agent thread with the answer as input (I7).
"Later" keeps the question open on the created task and blocks only the request or subtask it names.
While a question is pending, a composer turn is classified first: an **answer** (to the pending question),
an **instruction** ("divide it into two tasks" — a new plan revision; the old question closes as
superseded) or a **question** to the assistant (answered; the pending question stays). An answer to a
question of an outdated revision is refused with "this changed — see the new plan" (I11).

### 6.7 Full-context assistant and pre-send review

**One assistant, every surface.** The same Email assistant sits in Triage, Reviews and the task drawer,
bound to what is on screen (the thread and all its linked tasks) and able to read anything else the
running user can read. Answers cite their sources (comment, activity event, email, file) as links.
Examples: "what has Réka asked for so far?", "why is the countdown late?", "rewrite the reply more
formally", "split this", "add a subtask for Bence: …".

**Read freely, write through proposals, never send.** Writes on existing data: `updateTask` (fields,
subtasks, status), `postComment`, and a split of an existing task as `updateTask` (subtasks moved out) +
`createTask` (the new task, `grouping`), each approved by a click. Its **own plan and drafts** it edits directly
(D20). There is no automatic domain write (§11 O2).

**Pre-send review** (`presendReview`, after the completion draft and again on every change to the thread or its tasks):

| Check | Reads | Example |
|---|---|---|
| Every client request answered or delivered | all inbound messages, subtasks | "Réka's 14:05 answer (00:00) isn't reflected" |
| No claim without evidence | done subtasks, files, comments | "Draft says PNGs attached — 3 found, 4 sizes asked" |
| No contradiction with internal notes | comments, activity | "Frances: 'a FB verzión még javítok' — after the draft" |
| Earlier promises kept | `emailPromises` | "Monday was promised for the countdown; the draft is silent" |
| Linked tasks | T12 | "PRG-133 still open — the draft must not say the campaign is done" |
| Deliverables reachable | files, link previews | "Figma link needs login — unverified" (never "broken" unless it 404s) |
| Recipients and language | participants, `replyCcEmails`, D19 | "Gábor was on Cc and is missing" |
| Owner-only facts | time, estimate, retainer | "5:10 of 4h" (never put into the email) |

Deterministic where possible; the model only for meaning. A check that flips marks the version stale.

**What blocks and what only warns** (one table for the whole flow):

| Condition | Create (Triage) | Move to Admin review | Approve & send |
|---|---|---|---|
| a ledger row still `open` (I12) | blocks | — | blocks |
| open subtasks (I3) | — | blocks, unless partial (D8) | — |
| pending change proposal (I9) | — | blocks | blocks |
| outdated plan revision / stale draft version (I11, D9) | blocks — review again | — | blocks — review again |
| sending mailbox disconnected | — | — | blocks — Reconnect |
| a pending question | blocks only what it names | warning | warning |
| any other QA or pre-send finding | warning | warning — `Submit anyway` + note | warning — choice logged |

**Limits.** 12 steps for automatic runs; chat turns and reviews up to 20 (§11 O4). Long histories are read
through T14 digests first. Email, comment and chat-file text (and text inside screenshots) is untrusted
input: it can make the agent propose things, never send, approve or change permissions.

**Many files at once (D1).** The user can drop or paste a pile of screenshots and documents and say
"update the tasks from these". The agent reads them (text via `attachmentContents`, images as image input
to the model), matches them to tasks with `findTasks` / T14, and answers with the change lists of §6.9 —
`updateTask` (fields, subtasks added or ticked, `attachFiles`), `createTask`, `postComment` — each with the
file it came from,
opened and approved one by one in the task drawer. Nothing changes before approval; a file it cannot
match is listed, not guessed.

### 6.8 Role: personal assistant and project manager, not a worker (owner, 2026-10-18 — locked)

The agent helps people do their work; it does not do the work. It **prepares** tasks, **checks** work
before it moves on, **watches** for things that slip or get stuck, **drafts** emails and comments, and
**tells** the right person. It never produces a deliverable (no copy suggestions in the client's docx, no
estimates, no designs, no code) and never acts on its own beyond its own drafts and notifications.
Everything else is a proposal a human approves. An autonomy setting per action type is deferred.

#### 6.8.1 Hand-over QA (before Admin review)

The `handoverQA` job runs when the assignee opens `Move to Admin review` and on every change while the task
is in review; stored as an `agentChecks` row (subject task, kind handover) and reused by the pre-send review.

| Check | How (V1) | Example |
|---|---|---|
| All subtasks done | counters (I3 — blocks unless "Hand over partially", D8) | "1 subtask open" |
| Deliverables match "Kész, ha" | `attachmentContents` metadata: type, size, image width × height | "4 sizes asked · 3 PNGs · 1200×628 missing" |
| Links reachable | link preview fetch status; login walls are "unverified", not errors | "Figma link needs login — unverified" |
| Open questions resolved | pending `agentQuestions` on the task | "Countdown time still open" |
| Nothing from the client unanswered | inbound messages since the task started vs subtasks and comments | "Réka's 14:05 email isn't reflected" |
| Mentions answered | comments @mentioning the assignee without a reply | "Ádám asked on Oct 20" |

Warnings never block (gates: §6.7 table): `Submit anyway` with a note, which Reviews shows next to the warning.
The assistant may draft the reply to a mention; the colleague posts it.

#### 6.8.2 The same assistant on the colleague's side

Members get the assistant in the task drawer, in their own `private` thread anchored on the task (I10), scoped to their
assigned tasks: "what exactly did the client
ask?", "what's left before review?", "what changed since yesterday?", the hand-over QA on demand, and
"draft an email for Ádám" (an `emailDrafts` row in Reviews — members never send). Writes are proposals on
their own task within the member edit policy. It never shows Triage, Reviews, other clients or finance.

#### 6.8.3 Watching: "tell me when something gets stuck"

An hourly watcher computes **deterministic** signals; the model only words the message and drafts the fix.
Each signal is an Inbox notification with a reason line and, where a decision is needed, a prepared item
in Triage or Reviews.

| Signal | Rule (defaults) | Prepared for the owner |
|---|---|---|
| Stuck | status with `workflowRole: "blocked"` > 1 working day | the blocker in one line, from the last comment |
| Waiting on the client internally | a comment says we wait for the client and no email asked for it | draft email to the client → Triage |
| Promise at risk | an open `emailPromises` row due ≤ 1 day and the task not in review | draft interim update → Reviews |
| Quiet task | no activity for 2 working days and due within 2 days | proposed internal comment to the assignee |
| Due passed with open subtasks | due < today, subtasks open | Inbox only |
| Undecided client request | a reopen proposal pending > 2 working hours | immediate signal, the item stays at the top of Triage |
| Client waiting | §5.3 (24 h, 3-day nudge) | as there |

Urgent signals (promise broken, live-site bug) arrive immediately; the rest in one 9:00 digest. The
assignee gets a plain reminder about their own overdue or quiet task without approval (§11 O10).

#### 6.8.4 Learning, visibly

- Sources: the diff between a draft and the email actually sent; send-back notes; a QA warning repeating
  on the same client; Triage corrections (assignee changed, split chosen or undone).
- Output: `proposeSkill` to the existing `skills` table (client-scoped or global), with the evidence —
  "In 3 of the last 3 Pragmatico replies you added the Figma link. Save as a Pragmatico rule?" — approved,
  edited or dismissed in the chat or the digest.
- Use: approved rules load into runs like any skill; the run's step list says "Applied rule: …". Rules are
  listed and deletable in Settings › Skills.
- Never learned: amounts, prices, personal data, anything from a single email; a dismissal suppresses the
  same suggestion for 30 days.

Sections 6.9 and 6.10 describe behaviour of the general assistant in the Agents workspace (D22), not
Triage; they reuse the email flow's tools and blocks.

### 6.9 Meeting notes → task changes (standup, owner 2026-10-19)

The morning standup is recorded with Granola; the owner pastes the note (or drops the .md / .txt) into a
conversation in the Agents workspace and says "update the tasks from this". Same rules as the rest:
the agent prepares, a person approves, nothing changes before that.

1. **Read.** The note, the team (`listTeamMembers`), each person's open tasks (`findTasks`, T14), projects.
2. **Match.** Every item in the note becomes one of: a change on an existing task (status, assignee, due,
   a subtask added or ticked), a comment (blocker, decision, "waiting on the client"), or a new task (with
   project, assignee, due — the default due rule of §6.1 when the note gives no date). Matching is by person +
   title / project words; a weak match is never applied silently.
3. **Ask only when it matters** (D18). "Bence: a checkout még nem kész" with two open checkout tasks → one
   question block ("Which checkout task?"); everything else is prepared meanwhile.
4. **Answer with three separate blocks** (§7.1 change list), never one mixed list and never a blind bulk
   apply (owner, 2026-10-19): **Changes to existing tasks**, **New tasks**, **Comments**. Every row opens
   in the real task drawer, editable, and is approved there one by one:
   - *a change* opens the existing task with the proposed values in place and highlighted ("Status was In
     progress"); the owner can change any value or untick a subtask, then `Apply change` or `Skip`;
   - *a new task* opens as a Draft (D15) — title, properties, description editable — then `Create task`;
     the block also offers `Open as draft` and `Create N tasks` after review, like Triage;
   - *a comment* opens the task with recent activity and the comment as an editable draft → `Post comment`.
   The drawer footer shows the note line it came from; after each approval it moves to the next open item of
   the same block. Each approval runs the normal proposal approve path (as the approving user, logged;
   assignees notified) and leaves one event line in the conversation.
5. **Leftovers stay visible.** Items it could not place are listed under the set ("Not placed: 'Gábor
   szabadságon csütörtökön' — no task change"); nothing is dropped silently.

Proposal kinds used: `createTask` (source `agentThread`), `updateTask` (status, assignees, due, priority,
subtasks added or ticked), `postComment` — the same kinds email change proposals use (§4.2); no
meeting-specific primitive. The agent never invents work that is not in the note and never changes a task nobody mentioned.

### 6.10 Client call transcript → tasks (owner 2026-10-19)

The same capability, not a new feature: after a call the owner pastes the transcript (Granola, Meet, Zoom
— text or a file) into a conversation in the Agents workspace (D22). The agent reads it the way it reads a
client email, but everything happens in that conversation, not in Triage:

1. **Who and what.** It tells the client's speakers from ours, finds the client (names, company, domain in
   the transcript; an @mention wins; asks only if two clients fit — D18).
2. **Requests.** Every request the client made becomes a `clientRequests` row tied to the transcript, with
   its constraints verbatim (sizes, %, dates); the completeness pass runs as for email (I12). Things *we*
   promised on the call ("hétfőre küldünk egy vázlatot") are noted separately as promises to keep.
3. **Plan.** The same plan the email flow builds (§6.1), shown in the Agents conversation: one task by default with self-explaining subtasks, split
   offered by discipline, owners from routing, due dates from the call or the default rule, and a
   description that briefs the assignee — goal, what the client said and why, the agreed constraints, "Kész,
   ha" — written for someone who was not on the call; key client sentences quoted verbatim. Shown as the
   plan list; each task opens as a Draft in the drawer (D15); `Create` commits. Requests that touch
   existing tasks come as the change lists of §6.9, reviewed one by one.
4. **Recap email.** After Create the agent drafts a short recap to the client (D21 applies): what we
   understood, what happens next and by when, open questions. It starts a new Gmail conversation from the
   owner's mailbox (subject editable — not an in-thread reply), and is sent only when the owner sends it;
   the "by when" becomes an `emailPromises` row.

A standup note and a client call use the same tools and blocks; the agent decides from the content
which outputs apply (mostly changes for a standup, mostly new work + recap for a client call) and says
which in its first line.

## 7. Frontend

Reuse first (memory: never hand-roll when a shared component exists). The agent UI pieces live in
`components/agents/blocks/` next to the existing `tool-call-block.tsx` and `proposal-block.tsx`.

### 7.1 Conversation kit (shared by Triage, Reviews, the drawer assistant, the Agent workspace)

| Block | What it shows | Notes |
|---|---|---|
| run line | collapsed "Read the email, 2 attachments and 3 related tasks · 6s ›"; while running a step list (done / spinning / dashed) + live "Doing X… 4s" line | rendered from `agentRuns` events (§6.5); extends `tool-call-block.tsx` |
| agent text | plain prose, no bubble | markdown subset |
| user turn | quiet grey bubble, right-aligned | |
| plan list | per task: bold title (opens the draft drawer) with meta right-aligned (category · owner · due), then the subtasks as a quiet aligned table — # · subtask (the full D13 title, wrapping) · owner (avatar + first name) · due, thin row dividers, a muted header row, no cell boxes; a missing value shows "open" in amber in its column; a gap from the ledger check shows as one amber line ("Not covered: story size") | from the proposal payload |
| question block | D16: header, question, one muted line saying why it asks ("Réka wrote Friday, but no time"), numbered options with description and "recommended", a small trailing icon telling what the option does (↗ drafts an email to the client, ↵ answers here), multi-select, Later; an option like "I'll give the exact time" puts a prefix into the composer ("Countdown ends: ") and focuses it — no extra input field; keys 1–4; answered → one muted line | new `question-block.tsx` on `agentQuestions` |
| email component | an embedded, live card (owner, 2026-10-18 — like ChatGPT's email draft): "E-mail" header with version ("v2 · rewritten" / "edited by you"); subject (locked with a lock icon for a reply in an existing thread — "Start a new conversation" is the only way to change it, D9); From (the thread's mailbox); editable To and Cc; the body edited in place (focus ring); attachments as file chips inside the card, under the body; footer "Needs your approval ⌄" (opens what will happen: original thread, 15 s undo, open warnings), `Discard`, `Send` / `Approve & send vN`; queued "Sending in N s · Undo" (from `sendAt`, survives a reload); dispatching "Sending…" (no Undo); then "Sent in ‹name›'s thread"; failed → the fix for the error (§5.4); unknown → "Checking whether it went out…"; discarded → one line with Restore. A chat instruction ("írd át formálisabbra", "legyen rövidebb") rewrites the **same** card into a new version (D20: one line with Undo; a diff only when facts change or on request); a hand edit marks the version "edited by you"; approval always applies to the version shown (D9) | one component for completion drafts, kickoff and recap emails, replies, questions to the client, nudges and interim updates; members see `Save draft for Ádám` instead of Send |
| diff block | +/− lines of a draft change | new |
| request checklist (widget) | "Réka asked 5 things": one row per `clientRequests` row — the request in the client's words, its state (in a subtask → link · answered · waiting on the client · dismissed with reason) | from T15; shown when the user asks what the client wanted, in Reviews before the draft, and on demand |
| task status card (widget) | title + key, status, "3/5 subtasks", owners, due, the last event ("Frances uploaded 3 PNGs · 2h ago"), open questions; opens the drawer | from T14; for "hol tart…?" questions and next to a reply draft |
| retainer card (widget, owner only) | the client's retainer for the current period: used of budget and left, raw values, no rounding | from the existing retainer report tool; in Triage next to the plan when the client has a retainer, and on demand |
| change list | the answer to many proposals (§6.9, also "update the tasks from these files", D1): one block per kind — **Changes to existing tasks** (key · title · the change, e.g. "In progress → Done"), **New tasks** (title · project · owner · due), **Comments** (task · the comment) — each row with owner avatar and state (Review › / Applied / Created / Posted / Skipped / needs your answer); a row opens the task drawer with the proposal in place, editable, highlighted where it differs, and `Apply change` / `Create task` / `Post comment` · `Skip` in its footer; New tasks also get `Open as draft` · `Create N tasks`; a pending question greys only its row | one component for any batch of proposals; > 5 proposals always render as change lists |
| attachments in the composer | paste (⌘V) a screenshot, drag and drop, or pick files — images, PDF, DOCX, TXT/MD/CSV; chips with Remove before sending; in the user's turn as thumbnails / file chips | D1 |
| event line | ✓ one sentence ("Created PRG-132 · Frances notified") | |
| composer | input, send, 2–3 suggestion chips for the current state | |

Widgets are fixed components filled from a read tool's result (the `table@1` pattern): the model decides
when to call the tool, code renders the numbers (platform law D1 — the model never types a figure). No
free-form generated UI, no charts in V1.

**Always live data, never text written into the page.** The canvas shows sample data; in the product no
widget carries text of its own. The tool call stores only references (task id, thread id, client and
period) in the block; the block renders through a reactive Convex query with the viewer's access, so it
shows the current state every time it is on screen — a task card opened tomorrow shows tomorrow's status,
a request row flips to "answered" when the reply is sent. Labels are UI strings; every value (titles,
statuses, owners, dates, counts, hours) comes from the database. Change lists read their `agentProposals`
records the same way (the existing proposal cards already do). If a referenced record is gone or no longer
readable, the block says so in one muted line instead of showing old data.

**Everywhere, not only in Triage.** Each widget (and the question block and the email component) is a
block kind in the shared classifier `lib/agents/blocks.ts`, keyed on the tool's output marker. So it
renders in every assistant conversation — Triage, Reviews, the task drawer and the Agents workspace —
whenever the agent has the tool: T14 / T15 and the retainer tool are added to the seeded Agency Copilot
and Flow Assistant (reseed), and any agent built in the builder gets them by ticking the tool. Access
follows the tool's own scope: members see the task card and checklist only for tasks they can read, and
never the retainer card.

### 7.2 Triage (`app/(dashboard)/triage/`, owner only — canvas v7 Triage board)

- **Left: Triage inbox.** One row per email: client · sender, time, title (bold while new), state with a
  small dot (amber = waits on you, green = done, grey = in progress) — New / Preparing… (live dots) / A
  question for you / N tasks ready / Reply ready / Kickoff ready / Created / Merged / Declined / Snoozed. The title is the
  email subject until the agent has a plan, then the proposed task title (from the proposal; no new
  field); "Updated · N emails" when later messages joined the item (D25). J/K move. The list shows only
  open items (D26); quiet views behind the header: **Snoozed**, **Done** (last 30 days), **Filtered** (D24,
  each row with `Move to Triage`). The sidebar badge counts open items only.
- **Middle: the conversation.** The whole email Gmail-style (D14), then the run line, the agent's plan,
  questions, Create. Folds the email after the plan; "Show the original email" restores it.
- **Right: the draft drawer, on demand** (D15): clicking a plan task or "Open as draft" opens the task
  drawer in Draft state — editable title, property chips under the title (status, priority, assignee
  picker, category, due, project), description, subtasks; "Task N of M" when split. No tabs. For a reply
  or a change on a linked task the same panel shows that existing task. A panel icon in the conversation
  header toggles it, `Esc` closes it. Today the drawer (`task-detail.tsx`) opens only existing tasks and
  creation is `TaskFormModal`, so the Draft state needs a drawer source abstraction (task | proposal
  payload; edits land in `editedPayload`) — its own phase, B7 (F5).
- **Layout when the drawer opens:** the Triage inbox column hides and the conversation and drawer share
  the space; the app sidebar stays. Closing the drawer brings the inbox back. Reviews behaves the same.
- **Under the composer, quiet:** `Merge into…` (the agent asks which open task of the client; builds a
  `updateTask` proposal, D29) · `Decline` (no reason, D28) · `Snooze` (Tomorrow 9:00 · Next Monday ·
  Pick a date, D27), with Undo. `Create` lives in the conversation (⌘↵).
- **After Create** a 10 s toast "Created PRG-132 · Undo" (D30); when it ends, assignees are notified and the
  conversation shows the event line ("Created PRG-132 · Frances, Lili, Bence notified") and directly under it
  the kickoff reply as the email component with `Send` as the primary action (D21); `Discard` is the quiet
  way out.
- **Item types:** request (plan → Create → kickoff reply), "Reply on ‹task›" (a change proposal on a linked task, pinned to
  the top → Apply / Not a change), approval ("Réka approved ‹task›" → Mark done / Keep in Client review,
  D32), question (reply draft → Send reply / Make it a task instead), "needs a
  look" (hard trigger, nothing recognised), urgent (one urgent task), new sender (Create also creates
  client + contact), attention (a failed processing stage or a mailbox that stopped syncing → Retry /
  Reconnect).

### 7.3 Reviews (`app/(dashboard)/reviews/`, owner only — conversation per §11 O5; canvas v6 board 2 for the content until a v7 Reviews board exists)

Same three-part layout as Triage: the review list on the left (tasks in the `admin_review` role + nudges
and interim updates, with state), the conversation in the middle, the task on demand on the right. In the
conversation: who handed it over (with the hand-over QA result and any "submitted anyway" note), the run
line for the pre-send review, the findings as the agent's message (what is fine, what to look at, with
sources; when nothing needs a look, one green line instead — "3/3 subtasks done · exports attached · no
open questions"), the draft as an email block with header and version, a fix as a diff and a new version, then
`Approve & send vN · K warnings` / `Send back` (note → subtasks to tick), with a quiet `Approve without
email` (draft discarded, task → done). A *review only* task has `Approve` → the default status of the done
category, and a small menu "Approve → Client review" (D31). Sending / stale / crossed / failed
appear as event lines with Undo / Reconnect (D9).

### 7.4 Inbox (`components/inbox/*` — a list, §11 O5; canvas v6 board 4)

Reuse the notifications UI. The three new types (`email_event`, `agent_signal`, `daily_digest`, §4.2)
share one renderer and render a quote, the reason line and "where it waits". The 9:00
digest is one row whose detail lists the watcher signals (each with what was prepared and an open link)
and learned-rule proposals (Save rule / Dismiss for 30 days).

### 7.5 Task drawer / page

New **Emails** tab (the thread, To/Cc, attachments, quoted history collapsed); email events inline in
Activity; owner composer tab `Email to ‹contact›`, member `Draft email for Ádám`; the assistant in the
composer area (§6.8.2); hand-over QA panel from `Move to Admin review` (canvas v6 board 3); "New" marker on
subtasks added from a client email.

### 7.6 Settings

**Settings › General**, a small "Email triage" group (admins): default due date for email tasks
(working days, number input, default 2) and ignored sender domains (a list). Nothing else.

**Settings › Connectors**

Extend `components/agents/connectors/connectors-view.tsx`: Gmail row per user — Connect (OAuth redirect),
connected address, status (connected / expired / error), Disconnect, last sync and the sync error if any,
`Resync last 7 days`.

### 7.7 Keyboard

Triage: `J/K` move, `⌘↵` Create (or Send reply), `2` Merge, `3` Decline, `H` Snooze, `1–4` answer the
focused question, `⌘Z` undo the last plan change (D20). The digits never mean two things at once (F10):
while a question block has focus, `1–4` belong to the question and `2` / `3` do not Merge / Decline;
otherwise `2` Merge and `3` Decline. Reviews: `⌘↵` approve, `R` send back. Keys never
fire while focus is in an editable field (the email component, the composer). Task pages keep their
bindings.

## 8. Testing

- Unit (`convex/email/__tests__/model.test.ts`): quoted-history stripping (Gmail, Outlook, Apple Mail,
  "írta:"), hard triggers (HU + EN), domain → client matching, subject identifiers, date extraction.
- Classification fixtures (≥ 30 real-shaped Hungarian emails): thanks never produce a request; every
  request fixture produces ≥ 1 subtask; "mehet élesbe" on a done task becomes a change proposal with a subtask. Deterministic layer in CI;
  model layer behind an env flag.
- Ledger: a plan leaving a row `open` or dropping a constraint fails the check; the completeness pass
  adds the missing row; intents add / clarify / replace / cancel / approve / ask / acknowledge each have
  fixtures (replace supersedes, cancel dismisses).
- Kickoff reply: drafted after every Create / Merge / applied change; answers every answerable `ask` row;
  lists every client question the owner chose; its return date never earlier than the plan allows; nothing
  is sent without Send; the promise row is written only after it is sent.
- Change lists (§6.9–6.10): nothing is written before a row is approved; what gets written is the edited
  value shown in the drawer, not the agent's original; a pending question blocks only its row; a weak match
  is a question, never a change; an Agents conversation never creates a Triage item (D22); fixtures: 3
  standup notes, 2 client-call transcripts (HU).
- **Release metrics** (fixtures, model layer on): request recall ≥ 98 % (every request in the fixture set
  ends as a ledger row), acknowledge precision 100 % (no real request ever classified acknowledge),
  duplicate sends 0, dropped messages 0. Recall below the bar blocks the release.
- End-to-end scenarios (`convex-test` with a fake Gmail): two mailboxes receive the same email (one
  item); a sync run fails (the next minute catches up, no duplicates); a cursor expires (bounded resync, no duplicates);
  a send times out (unknown → confirmed, not resent); Undo after reload; an edit during the countdown voids
  the approval; a change proposal arrives during the countdown (dispatch refused, I9); partial hand-over →
  follow-up created only after Gmail accepts; a member asks the assistant about a task and cannot reach
  the admin conversation (I10); two admins answer the same question (one run, I7/I11); three emails on one
  thread before a decision (one item, one plan revision per email, D25); a newsletter / Google notice /
  vendor invoice never reaches Triage, an unknown sender in a member's mailbox is not stored (D24); a
  snoozed item wakes on a client reply (D27); Undo within 10 s after Create deletes the task and sends no
  notification (D30); a reply written in Gmail stales the open draft and closes the kickoff item (D33);
  client "így jó" on a Client-review task → approval item → Mark done (D32); an org without
  `emailTriageEnabled` gets nothing from any email query, mutation or cron (I14).
- Convex tests (`convex-test`): ingest idempotency (I1), linking, dispatch table, multi-task threads (I2),
  change proposal on done, the gate table (§6.7), send states and approval hash (I4, D9), promises only
  from sent drafts (I8), question answer starts exactly one run (I7), stage retries (I5), access matrix
  (§5.5), read tools respect member scope, background runs re-check membership and have no public entry point
  (I15), an `llm_step` job runs against a fake model, admin B decides in admin A's `admins` thread, I3 holds
  through `bulkUpdate`, attachment
  extraction states, OAuth state expiry and token refresh.
- Component tests: question block (keys, multi-select, free text, Later), run line states, composer
  header, undo toast, approve gate.
- Manual sweep with a real Gmail test account before release (`docs/runbooks/email-triage.md`).

## 9. Phases (milestones A–D; detail and orchestration in `docs/prd-email-triage-implementation-plan.md` §4–§5)

Branch `email-triage`, one PR per milestone (A, B, C, D) into `main` (E3); the milestone is the PR unit.
One writing agent at a time — most phases touch `convex/schema.ts`. Each phase: `npx tsc --noEmit`,
`npm run lint`, `npm test`, and `npm run build` for UI phases; report what ran; keep the status table below
current. Touch `convex/tasks/*` only through the `convex/tasks/write.ts` entry points of §5.1; no public
"run as" endpoint; no secret in logs or fixtures. Convex phases stay on 1.34 APIs (O9).

**Milestone A — Agent platform** (no email code; the existing agents gain from it too)

| Phase | Content | Done means | Depends on |
|---|---|---|---|
| A1 Actor + background runs | P1: actor fields on `agentRuns`, `resolveRunActor`, `internal.agentBackground.start` + membership re-check, actor variants for BYOK and connector resolution, `background` flag in the registry; the read tools the email jobs need migrated (listClients, listProjects, listTeamMembers, listWorkCategories, listStatuses, findTasks, getTaskDetail) | convex-test: a background run completes with a fake model; a removed member is refused; no public path exists; existing interactive runs unchanged (regression) | — |
| A2 Threads + jobs | P3 (visibility, anchor, run lock, revisions) + P2 job registry (`llm_step` and `agent_run` tiers, `agents.model` wired) | admin B decides in admin A's `admins` thread; a parallel run is refused; an old revision is refused; an `llm_step` is testable with a fake model | A1 |
| A3 Read layer | T3, T9, T10, T11, T14 on the actor, with member-scope tests | a member sees only tasks they can read; T14 is one call | A1 |
| A4 Proposal consolidation | S2: `createTask` extended (subtasks, descriptionJson, source, fieldReasons, grouping), `updateTask` and `postComment` kinds, shared decision policy; `tasks/write.ts` entry points (`deferNotifications`; the I3 gate on `workflowRole` in `updateTask`) | one approve creates the task + subtask tree in one mutation; I3 holds on `bulkUpdate`; the existing Task Drafter still works | A2 |
| A5 Question block | `agentQuestions`, T5 `askUser` (ends the run), answer / later, exactly one next run, `question-block.tsx` | I7 test: two admins answer at once → one run | A2 |
| A6 Attachment contents | `attachmentContents` keyed by `storageId` (S5), `unpdf` / `mammoth` / `image-size` node action, T2 | PDF / DOCX / image states; unreadable = visibly unresolved | — |

A3 and A6 could run beside A2, but all three touch `convex/schema.ts`, so they run one after another.

**Milestone B — Email in → Triage → task (+ kickoff send)**

| Phase | Content | Done means | Depends on |
|---|---|---|---|
| B1 Gmail connect | `gmail` catalog type, OAuth (PKCE, `oauthStates`, http routes), token refresh, Settings › Connectors row, `connectors.sync` (S4) | a real account connects, disconnects, and expired → reconnect works | Google OAuth client (owner, E4) |
| B2 Email schema + pure model | email tables (narrowed by S5–S7), `agentItems` (P5), `statuses.workflowRole` + seed, `emailTriageEnabled` + I14 helper, `convex/lib/workingDays.ts`, `convex/crons.ts` scaffold, `email/model.ts` fully unit-tested (stripQuoted HU/EN, triggers, domain match, subject, dates) | model tests green; the seed loads the canvas scenarios (Réka 5 requests, Gábor price bug, Péter question, Judit new sender, Anna thanks) | A2 |
| B3 Sync + ingest + filter | no LLM: 1-min history sync, start from now, bounded resync, D24 filter, `rfcMessageId` dedupe, stages + retry (I5), D33 Gmail-side replies, attachment download → A6 | fake-Gmail E2E: two mailboxes → one item; a missed sync catches up; expired cursor; a newsletter never gets in | B1, B2, A6 |
| B4 Classify + ledger + dispatch | `classifyInbound`, `checkCompleteness`, `screenSender` as `llm_step` jobs, `clientRequests`, the dispatch table (§5.3), `agentItems` open / join / snooze / wake, `email_event` notifications | deterministic layer in CI; 30 fixtures on the model layer behind an env flag | B3, A2 |
| B5 Send pipeline (backend) | the core of old slice 3, moved ahead for the kickoff (F9): `emailDrafts`, versions, approval hash, queued → dispatching → sent / failed / unknown, 15 s undo (`sendAt`), Message-ID generation + confirmation, sending-mailbox rule (D35, the rule first) | E2E: timeout → unknown → confirmed, never sent twice; an edit during the countdown voids the approval; undo after reload | B1, B2 |
| B6 prepareTask + Triage backend | `prepareTask` `agent_run` job, ledger check + completeness, questions, create (+10 s undo, D30) / merge (`updateTask` proposal, D29) / decline / snooze, approval → Mark done (D32), new client, kickoff via `draftReply` (D21) | I12 gate holds; Undo sends no notification; Merge takes the same code path as a reply change | B4, B5, A4, A5 |
| B7 Drawer Draft mode | D15: drawer source abstraction (task \| proposal payload), Draft state without tabs, existing pickers | editing a proposal in the drawer writes `editedPayload`; an existing task is unchanged | A4 |
| B8 Conversation kit + Triage UI | §7.1 blocks (run line from job stages, plan list, email component, event line, widgets T15 / T14 / retainer), `/triage` (list + views, layout, keys per §7.7), sidebar badge | the canvas scenarios (Réka, Gábor, Péter, Judit, Anna) played through in the browser | B6, B7 |

First real value: at the end of milestone B our own Gmail feeds Triage, emails become tasks, and the kickoff
goes out.

**Milestone C — Reply out (Reviews) + task side**

| Phase | Content | Done means | Depends on |
|---|---|---|---|
| C1 Completion draft + pre-send review | `draftReply` in completion mode, `presendReview` → `agentChecks` (presend), the gate table (§6.7), T6, T12, `emailPromises` at send (I8) | the gate table holds in tests; a check that flips stales the version; promises only from sent drafts | B8 |
| C2 Reviews UI | `/reviews` conversation, Approve & send / Approve / Approve without email (D31) / Send back → subtasks, D8 partial hand-over + follow-up only when Gmail accepts | Reviews scenarios played through in the browser; Undo before acceptance creates no follow-up | C1 |
| C3 Task drawer Emails tab + colleague side | Emails tab, activity events, the member's `private` task-anchored assistant (I10 negative test with retainer data), `handoverQA` → `agentChecks` (handover), T13 | a member cannot reach the admin conversation or retainer data; hand-over warnings show in Reviews | C1 |

**Milestone D — Agents workspace + watching + hardening + learning**

| Phase | Content | Done means | Depends on |
|---|---|---|---|
| D1 Change lists + chat attachments | old M-1 (three change-list blocks for the four kinds, drawer "proposed change" and comment-draft states, §6.9 meeting-notes behaviour in the platform prompt, §6.10 call transcripts with ledger rows and the recap email) + old I-5 (composer paste / drop / pick: images, PDF, DOCX, TXT/MD/CSV, ≤ 10 per message, ≤ 25 MB each; `agentChatFiles`; extraction through A6; images as model input; `updateTask` with `attachFiles`), starting with a tracer: image input on `@convex-dev/agent` 0.6.4 (F12) | the tracer passes before anything builds on it; nothing is written before a row is approved; 3 standup + 2 call-transcript fixtures | A4, B7 |
| D2 Watching | deterministic signals on working-hour clocks (D37), 9:00 digest, assignee reminders, nudges / interim drafts, T4 | signals fire on working days only; digest lists every signal with its prepared item | C2 |
| D3 Hardening | ≥ 30 HU/EN fixtures + release metrics (recall ≥ 98 %, acknowledge precision 100 %), E2E, access matrix, send-failure drills, runbook, `docs/architecture.md` | release metrics met (§8); all §8 E2E scenarios green | D1, D2 |
| D4 Learning | `proposeSkill` from draft→sent diffs, send-backs, repeated QA warnings, Triage corrections; "Applied rule" in run steps; 30-day dismiss | a repeated pattern yields one rule proposal; a dismissal suppresses it for 30 days | C2 |

Old slice ids (history): P-0 → A1 / A2 · I-1 → A3 · I-2 → A5 · I-3 → A6 · I-4 → B1 · 0 → B2 · 1 → B3 / B4 ·
2 → B6 / B7 / B8 · 3 → B5 / C1 / C2 · 4 → C3 · M-1 + I-5 → D1 · 5 → D2 · 6 → D3 · 7 → D4. A4 is new.

## 10. Resolved questions (defaults — change only with the owner)

- Q1 *(superseded by D17)* — see §12.
- Q2 *(superseded by D36)* — polling every minute from the history cursor; no push in V1. See §12.
- Q3 Language: D19; UI strings English.
- Q4 Undo window: 15 s, not configurable in V1.
- Q5 Nudge 3 working days; waiting 24 working hours (D37); quiet task 2 working days; stuck 1 working day.
  Per-org later.
- Q6 Attachments: stored in `_storage`, max 25 MB each; larger ones linked. Extracted text capped.
- Q7 A question-kind email sends a reply in the thread, logged on the referenced task; no task unless the
  owner asks for one.
- Q8 Merge into…: the agent asks which open task of the same client; the merge is an `updateTask`
  proposal (source email) on it (new subtasks, reopen when in review or done — D29) and the thread links to it
  (`emailThreadTasks.role = "merged"`). Replies still answer one thread each (I2).

## 11. Owner decisions (all answered 2026-10-18)

| # | Question | Decision | Affects |
|---|---|---|---|
| O1 | Who does an automatic agent run act as? | **The connector owner** (whose mailbox the email came to); rows carry `via: "agent"` + `agentRunId`, the UI shows "Agent …". *Refined 2026-10-19 by E2:* Gmail access stays with the connector owner; a run on an `admins` thread (Triage) reads at admin level on behalf of a designated admin (`via: "agent"`) | A1, B4, B6 |
| O2 | May the D4 reopen write without approval? | **No — it is a proposal.** A request on a linked or done task becomes a top-of-Triage "Reply on ‹task›" item (proposed subtasks + status change); I9 holds the task out of review and freezes its drafts until decided; undecided > 2 working hours → immediate signal | B4, B6 |
| O3 | Who decides Triage proposals; from which address does a reply go? | **Any org admin decides; the reply goes from the mailbox the thread lives in** | A2, B5, B6, C2 |
| O4 | Step budget for chat turns and reviews | **20** (automatic runs stay 12) | A3, B6 |
| O5 | Reviews and Inbox as conversations too? | **Reviews: yes** (§7.3); **Inbox: a list** with the daily digest | C2, D2 |
| O6 | Do colleagues' mailboxes feed Triage? | **Yes, into the shared org Triage** (admins only); replies go from the mailbox the thread lives in; members draft, never send | B1, B3 |
| O7 | What do the review / stuck rules read instead of status names? | **`statuses.workflowRole`** (`admin_review`, `client_review`, `blocked`), set by the seed, editable in status settings | B2 |
| O8 | Packages for attachment extraction | **Approved:** `unpdf`, `mammoth`, `image-size` | A6 |
| O9 | Convex: guidelines target `^1.44`, installed `1.34.1` | **Build on 1.34 APIs now; the upgrade is a separate task** | — |
| O10 | Automatic reminders to assignees about their own overdue / quiet tasks | **Yes, automatically** — a notification only, nothing changes on the task | D2 |

**Owner actions (not decisions):** create a Google Cloud OAuth client (Internal app on the Workspace),
add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to the Convex environment, register the redirect URL the
B1 phase prints. Started during milestone A (E4); blocks B1.

**Implementation review decisions (owner, 2026-10-19 — "mehet", all as recommended):**

- **E1** The platform generalisations (implementation plan §2 S1–S9, §3 P1–P6) are accepted; §4, §5.1, §6,
  §9 follow them. UI decisions unchanged.
- **E2** Background runs: Gmail access belongs to the connector owner, but a run on an `admins`-visibility
  thread (the Triage conversation) reads at admin level on behalf of a designated admin (`via: "agent"`).
  Refines O1.
- **E3** Branch `email-triage`, one PR per milestone (A, B, C, D) into `main`.
- **E4** The owner creates the Google OAuth client during milestone A; B1 waits for it.

## 12. Superseded decisions (kept for history)

| Was | Replaced by | When |
|---|---|---|
| Visual source: canvas page v4 (artboards 1, 1b, 2–5) | v7 for Triage and the conversation pattern; v6 for Reviews, colleague view, digest | 2026-10-18 |
| Read first `docs/agents-platform-v1-prd.md` | `docs/agentic-platform/prd-v1.md` | 2026-10-18 |
| §3.2 v4 UI: Triage detail = property panel with reasons as second lines; long email with numbered highlighted passages ↔ numbered subtasks; split offer line; structured brief (Cél / Határidő / Kész, ha grid) | D12 conversation, D13 plain description + self-explaining subtasks, D14 untouched Gmail-style email that folds, D15 draft in the real drawer | 2026-10-18 |
| Description "3–6 sentences" | D13 | 2026-10-18 |
| `sourcePassage` offsets for numbered highlights | `requests[]` + `requestIndex` for coverage only; the email is shown untouched | 2026-10-18 |
| I2 "a thread links to at most one task" and `emailThreads.taskId` | `emailThreadTasks` (split, merge), new I2 | 2026-10-18 |
| Rules keyed on the status names "Admin review" / "Client review" (I3, D3, D4, §5.3, §5.4) | `statuses.workflowRole` (§11 O7) | 2026-10-18 |
| D3 Send back = a comment + status | note → subtasks the owner ticks + comment + status | 2026-10-18 |
| `emailMessages.promises` field | `emailPromises` table (I8) | 2026-10-18 |
| Q1 "only the owner's Gmail; colleagues never connect mail in V1" | D17 every user connects their own Gmail; consequences §11 O6 | 2026-10-18 |
| Keyboard `⌘↵` accept · `2` decline | `⌘↵` Create · `2` Merge · `3` Decline · `1–4` answer | 2026-10-18 |
| "The task drawer already has an Emails tab (coming soon)" | the tab no longer exists after the tasks-refactor slice 6; this PRD adds it | 2026-10-18 |
| Build order "T1 + T8 in slice 0–1 … T5 in slice 2 …" | §9 infrastructure slices I-1 … I-4 first | 2026-10-18 |
| D4 reopen as the one automatic domain write, with "Not a request — undo" | a reopen proposal in Triage + I9 (O2) | 2026-10-18 |
| Reviews detail as the v6 structured view | a conversation like Triage (O5) | 2026-10-18 |
| D2 "No auto-acknowledgement"; "Ask Réka" as a separate question email before Create | D21 kickoff reply drafted after every Create (sent only by a person), client questions inside it | 2026-10-19 |
| Triage row shows the raw subject | the proposed task title once a plan exists (§7.2) | 2026-10-19 |
| Classification `kind` request / thanks / question / approval / unclear + `confidence < 0.7` | intents add / clarify / replace / cancel / approve / ask / acknowledge (§6.3) | 2026-10-19 |
| `requests[]` + `requestIndex` inside the proposal | `clientRequests` ledger + I12 + completeness pass | 2026-10-19 |
| "mehet élesbe" as no-action approval (§5.3) vs reopen (§6.3) | approve with an action → change proposal (D4, §5.3) | 2026-10-19 |
| `reopen.ts` / reopen proposal (subtasks + status) | `changes.ts` / `changeFromEmail` (add, amend, cancel, reopen) | 2026-10-19 |
| Draft status `sending` + `approvedVersion`; "Reconnect" for every failure | queued / dispatching / unknown + approval snapshot hash; error-specific fixes (§5.4) | 2026-10-19 |
| `Send & create follow-up` creates the follow-up when the send is scheduled | created only when Gmail accepts (D8) | 2026-10-19 |
| Editable subject on every draft | locked for in-thread replies (D9) | 2026-10-19 |
| `emailMessages` unique per org on `gmailMessageId` | unique per connector + `rfcMessageId` dedupe (I1) | 2026-10-19 |
| "2-minute rule" / poll only as a slice-5 fallback | processing stages with retry (I5); sync in slice 1 (§5.2) | 2026-10-19 |
| "Only the I3 gate and a stale version block Approve" | the gate table in §6.7 (adds I9, I12, revisions, mailbox) | 2026-10-19 |
| §6.9 one mixed change set with per-row checkboxes and `Apply N changes`; "Approve all" for many files | three change lists, every item opened, editable and approved in the task drawer (§6.9, §7.1) | 2026-10-19 |
| One owner-private agent thread per email thread | `agentThreads.scope` (shared email thread, member_task threads, I10) | 2026-10-19 |
| Q2 Gmail push (Pub/Sub watch) + 2-min poll from slice 1; daily watch renewal; `mailboxSync.watchExpiresAt` | 1-min history-cursor polling, no push in V1 (D36) | 2026-10-19 |
| Filter = `ignoredEmailDomains` + team senders only; every colleague mailbox fully stored | Gmail categories / bulk skipped, known clients, vetted unknowns in admin mailboxes, nothing unknown from member mailboxes, Filtered view (D24) | 2026-10-19 |
| One Triage item per inbound message; item states with no storage | `triageItems`, one open item per conversation (D25, I13) | 2026-10-19 |
| Created / Merged / Declined rows stay in the Triage list | list = open items only; Snoozed / Done / Filtered views (D26) | 2026-10-19 |
| Merge only adds subtasks | Merge = `changeFromEmail` proposal, reopen when in review or done (D29) | 2026-10-19 |
| Client approval without an action → Inbox only, task stays in Client review | approval Triage item → Mark done / Keep (D32) | 2026-10-19 |
| Reply mailbox = "the mailbox the thread lives in" (O3) with no rule for several | D35 sending-mailbox rule | 2026-10-19 |
| 24 h / 3 d wall-clock | working-hour clocks (D37) | 2026-10-19 |
| Available to every org | V1 for our agency only, `emailTriageEnabled` (D23, I14) | 2026-10-19 |
| Status "ready for implementation — start with slice P-0" | in implementation on branch `email-triage`, phase plan in `docs/prd-email-triage-implementation-plan.md` | 2026-10-19 |
| "owner/admin" as a role | org admin (`isAdmin`); only `admin \| member` exist (F4) | 2026-10-19 |
| "Coordinate with the open tasks-refactor slices (7b)" / "owned by the tasks refactor" | the refactor is merged (#13); write only through `tasks/write.ts` entry points (F7) | 2026-10-19 |
| P-0 `agentBackground.ts` as one small addition, `startBackgroundRun(actingUserId, threadId, kind)` | actor layer through the whole runner (`agentRuns` actor, `resolveRunActor`, internal queries with an explicit actor, `background: true` tools) + `internal.agentBackground.start(job, anchor, actingUserId)` (P1, F1, I15) | 2026-10-19 |
| Background runs act purely as the connector owner (O1) | Gmail access as the connector owner; `admins` threads read at admin level for a designated admin (E2) | 2026-10-19 |
| `agentThreads.scope: "private" \| "email" \| "member_task"` + `emailThreadId` / `taskId` | `visibility: "private" \| "admins"` + `anchor?: { type, id }`; policy replaces `requireOwnedThread` / `requireOwnProposal` (P3, S9, F2) | 2026-10-19 |
| `classifyInbound`, completeness pass, unknown-sender check, promise extraction as agent runs; `submitClassification` tool | `llm_step` jobs (one structured call, no agent thread) in the job registry `convex/lib/agentJobs.ts`; `agent_run` only for prepareTask, draftReply, presendReview, handoverQA (P2, S1) | 2026-10-19 |
| `draftKickoff`, `draftCompletion` runs | the `draftReply` job with modes kickoff / completion / reply / nudge / interim / recap | 2026-10-19 |
| `agents.model` override unused by the runner | wired through the job registry (F11) | 2026-10-19 |
| `triageItems` table (`threadId`) | platform table `agentItems` (`source: "email" \| "watch" \| "job"`, `anchor`); Triage = email-sourced items, UI unchanged (P5) | 2026-10-19 |
| Proposal kinds `createTaskFromEmail`, `changeFromEmail`, `editTask`, `addSubtasks`, `tickSubtask`, `regroupTasks`, `attachFiles` (+ `postComment`, `proposeSkill`) | four kinds: `createTask` (extended: subtasks, descriptionJson, `source`, fieldReasons, grouping, …), `updateTask` (fields, subtasks add / amend / cancel / tick, status / reopen, attachFiles), `postComment`, `proposeSkill` (S2) | 2026-10-19 |
| `tasks/write.ts` entry points `createFromEmail`, `changeFromEmail` | `createTask` (+ `deferNotifications`, subtask tree) and `updateTask` (I3 / I9 gate) used by the proposal approve path; `sendBack`, `handOverPartially` stay (F8) | 2026-10-19 |
| I3 enforced in `tasks/model.ts` | in `convex/tasks/write.ts` `updateTask`, covering `bulkUpdate` (F7) | 2026-10-19 |
| D30 notifications "wait" with no mechanism (`createTask` notifies synchronously) | `createTask` `deferNotifications` + a scheduled notification cancelled by Undo (F8) | 2026-10-19 |
| `handoverChecks` table + `emailDrafts.checks` | one `agentChecks` table (subject task \| draft, kind handover \| presend, revision) (S3) | 2026-10-19 |
| `mailboxSync` table (`historyId`) | `connectors.sync: { cursor, lastSyncAt, lastFullSyncAt, error }` (S4) | 2026-10-19 |
| `attachmentContents.source` + four optional FKs | keyed by `storageId` only; access from the referencing row (S5) | 2026-10-19 |
| `tasks.emailThreadId` read cache | dropped; `emailThreadTasks.by_orgId_taskId` (S6) | 2026-10-19 |
| `emailMessages.handling` | dropped; the agentItem / proposal / draft carries the outcome (S7) | 2026-10-19 |
| Ten notification types (`email_reopened`, `email_subtasks_added`, `email_no_action`, `email_unlinked`, `review_ready`, `email_sent`, `email_send_failed`, `client_waiting_24h`, `watch_signal`, `daily_digest`); `notifications.taskId` required | `email_event` (+ `subtype`), `agent_signal` (+ `signal`), `daily_digest`; `taskId` optional + `subject` ref (S8, F3) | 2026-10-19 |
| Server-side working days / crons assumed to exist | new `convex/lib/workingDays.ts` (org timezone) and `convex/crons.ts` (F6) | 2026-10-19 |
| Kickoff reply (D21) in slice 2, send pipeline only in slice 3 | send pipeline core moved ahead to B5, before the Triage backend B6 (F9) | 2026-10-19 |
| Keyboard `2` Merge / `3` Decline and `1–4` answer on the same screen | `1–4` belong to a focused question block; otherwise `2` Merge, `3` Decline (F10) | 2026-10-19 |
| I-5 assumed image input works on `@convex-dev/agent` 0.6.4 | D1 starts with an image-input tracer (F12) | 2026-10-19 |
| D15 Draft state assumed in the existing drawer | drawer source abstraction (task \| proposal payload) as its own phase B7 (F5) | 2026-10-19 |
| §9 slices P-0, I-1 … I-5, 0–7, M-1 and their status table | milestones A–D, phases A1–A6, B1–B8, C1–C3, D1–D4 (§9; mapping there) | 2026-10-19 |

---

### Phase status

| Phase | Name | Status | Commit | Notes |
|---|---|---|---|---|
| A1 | Actor + background runs | done | (this commit) | actor on agentRuns, internal agentBackground.start, 8 tools on the actor path, single role source (orgMembers); reviewed |
| A2 | Threads + jobs | in progress | | A2a done: visibility + anchor, one access policy, proposal revisions, queued background runs, stale-run cron (reviewed); A2b job registry next |
| A3 | Read layer | pending | | |
| A4 | Proposal consolidation | pending | | |
| A5 | Question block | pending | | |
| A6 | Attachment contents | pending | | |
| B1 | Gmail connect | pending | | waits on the Google OAuth client (E4) |
| B2 | Email schema + pure model | pending | | |
| B3 | Sync + ingest + filter | pending | | |
| B4 | Classify + ledger + dispatch | pending | | |
| B5 | Send pipeline (backend) | pending | | independent code review |
| B6 | prepareTask + Triage backend | pending | | |
| B7 | Drawer Draft mode | pending | | |
| B8 | Conversation kit + Triage UI | pending | | |
| C1 | Completion draft + pre-send review | pending | | |
| C2 | Reviews UI | pending | | independent code review |
| C3 | Task drawer Emails tab + colleague side | pending | | |
| D1 | Change lists + chat attachments | pending | | today the composer takes only .txt / .csv; canvas v7 "Standup" board |
| D2 | Watching | pending | | |
| D3 | Hardening | pending | | |
| D4 | Learning | pending | | |
