"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery } from "convex/react"
import {
  CheckIcon,
  ChevronDownIcon,
  LockIcon,
  MailIcon,
  PaperclipIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { DraftView } from "@/convex/email/drafts"
import type { GateRow } from "@/convex/email/sendGate"
import {
  RECONNECT_HREF,
  UNDO_WINDOW_SECONDS,
  approvalLabel,
  draftVersionLabel,
  failedPrimary,
  failureFix,
  formatRecipients,
  parseRecipients,
  reapproveLabel,
  sameRecipients,
  secondsUntil,
  sendButtonLabel,
  sentLabel,
} from "@/lib/agents/emailDrafts"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useIsPrimaryDraft } from "./draft-primary"

/**
 * The email component (email-triage B8a; PRD §7.1 "email component", D9,
 * D20, D35, §5.4) — an embedded, LIVE draft on `emailDrafts`, read through
 * `email/drafts.getDraft` (the block stores only the draft id):
 *
 *   header   "E-mail" · "v2 · rewritten" / "edited by you"
 *   fields   Subject (locked for a reply in its Gmail thread) · From (the
 *            sending mailbox; a quiet menu among the mailboxes that hold the
 *            conversation) · To · Cc · the body edited in place · attachments
 *   footer   "Needs your approval ⌄" (where it goes, the 15 s undo, the
 *            warnings to acknowledge) · Discard · Send / Approve & send vN
 *
 * Edits save through ONE serialized queue of version-aware `updateDraft`
 * calls (autosave after a pause, on blur and on unmount; an edit by someone
 * else meanwhile is refused and the live version shows). Send awaits the
 * queue and approves the version it saved. Send passes
 * the acknowledged warnings; the queued countdown runs from `sendAt`, so it
 * survives a reload. Members see their draft saved for an admin, never Send.
 */
export function EmailDraftBlock({ draftId, readOnly = false }: { draftId: string; readOnly?: boolean }) {
  const draft = useQuery(api.email.drafts.getDraft, { draftId: draftId as Id<"emailDrafts"> })
  if (draft === undefined) return <EmailDraftSkeleton />
  if (draft === null) {
    return <p className="text-[13px] text-muted-foreground">This email draft is no longer available.</p>
  }
  if (draft.status === "discarded") return <DiscardedLine draft={draft} readOnly={readOnly} />
  return <EmailDraftCard key={draft._id} draft={draft} readOnly={readOnly} />
}

type Edits = { subject?: string; bodyText?: string; to?: string; cc?: string }

/** Body / subject autosave after this pause (and on blur) — few versions, nothing lost. */
export const AUTOSAVE_MS = 2_000
const GATE_STATES = new Set(["draft", "failed"])

function EmailDraftCard({ draft, readOnly }: { draft: DraftView; readOnly: boolean }) {
  const updateDraft = useMutation(api.email.drafts.updateDraft)
  const setFromMailbox = useMutation(api.email.drafts.setFromMailbox)
  const markReviewed = useMutation(api.email.drafts.markDraftReviewed)
  const discardDraft = useMutation(api.email.drafts.discardDraft)
  const approveAndSend = useMutation(api.email.send.approveAndSend)
  const undoSend = useMutation(api.email.send.undoSend)
  const retrySend = useMutation(api.email.send.retrySend)

  const isAdmin = draft.viewerIsAdmin
  const status = draft.status
  const canEdit = !readOnly && draft.viewerCanEdit && (status === "draft" || status === "failed")
  const gate = useQuery(
    api.email.send.previewSendGate,
    !readOnly && GATE_STATES.has(status) ? { draftId: draft._id, version: draft.version } : "skip",
  )

  // ─── Local edits: ONE serialized save queue (version-aware) ────────────
  //
  // Saves chain on a single promise; each runs with the version the previous
  // one returned, and reads the edits AT ITS TURN, so typing during a slow
  // save is never lost (it is saved by the next link). The body and subject
  // autosave after a pause and on blur; recipients on blur (a half-typed
  // address is never validated). Send / Approve awaits the queue first and
  // approves exactly the version it returned (D9).
  const [edits, setEdits] = useState<Edits>({})
  const [busy, setBusy] = useState(false)
  const editsRef = useRef(edits)
  const draftRef = useRef(draft)
  /** The version the local edits build on: the last save's, else the live draft's. */
  const baseVersionRef = useRef(draft.version)
  const inFlightRef = useRef(0)
  const queueRef = useRef<Promise<number | null>>(Promise.resolve(draft.version))
  const updateRef = useRef(updateDraft)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    editsRef.current = edits
    draftRef.current = draft
    updateRef.current = updateDraft
    // Idle (nothing typed, nothing saving): follow the live version.
    if (inFlightRef.current === 0 && Object.keys(edits).length === 0) baseVersionRef.current = draft.version
  })

  /** One link of the queue: save what is pending NOW (`which` = which fields). */
  const saveOnce = useCallback(async (which: "text" | "all"): Promise<number | null> => {
    const all = editsRef.current
    const pending: Edits = which === "all" ? { ...all } : { subject: all.subject, bodyText: all.bodyText }
    for (const key of Object.keys(pending) as Array<keyof Edits>) {
      if (pending[key] === undefined) delete pending[key]
    }
    const current = draftRef.current
    const patch: {
      subject?: string
      bodyText?: string
      to?: Array<{ name?: string; email: string }>
      cc?: Array<{ name?: string; email: string }>
    } = {}
    if (pending.subject !== undefined) patch.subject = pending.subject
    if (pending.bodyText !== undefined) patch.bodyText = pending.bodyText
    if (pending.to !== undefined) {
      const to = parseRecipients(pending.to, current.to)
      if (!sameRecipients(to, current.to)) patch.to = to
    }
    if (pending.cc !== undefined) {
      const cc = parseRecipients(pending.cc, current.cc)
      if (!sameRecipients(cc, current.cc)) patch.cc = cc
    }
    // Drop the edits this link saved — unless they were typed over meanwhile.
    const settle = () =>
      setEdits((cur) => {
        const next = { ...cur }
        for (const key of Object.keys(pending) as Array<keyof Edits>) {
          if (cur[key] === pending[key]) delete next[key]
        }
        editsRef.current = next
        return next
      })
    if (Object.keys(patch).length === 0) {
      settle()
      return baseVersionRef.current
    }
    inFlightRef.current++
    try {
      const { version } = await updateRef.current({ draftId: current._id, version: baseVersionRef.current, ...patch })
      baseVersionRef.current = version
      settle()
      return version
    } catch (err) {
      // The live draft is the truth (e.g. it changed meanwhile — D9): drop the edits.
      toastError(err, "Couldn't save the email")
      editsRef.current = {}
      setEdits({})
      baseVersionRef.current = draftRef.current.version
      return null
    } finally {
      inFlightRef.current--
    }
  }, [])

  /** Queue a save after the ones in flight; resolves to the version it left. */
  const enqueue = useCallback(
    (which: "text" | "all"): Promise<number | null> => {
      const next = queueRef.current.then(() => saveOnce(which))
      queueRef.current = next
      return next
    },
    [saveOnce],
  )

  const flush = useCallback(
    (which: "text" | "all" = "all") => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      return enqueue(which)
    },
    [enqueue],
  )

  // Unmount: save what is still pending (fire and forget).
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (Object.keys(editsRef.current).length > 0) void enqueue("all")
    },
    [enqueue],
  )

  const edit = (patch: Edits, autosave: boolean) => {
    editsRef.current = { ...editsRef.current, ...patch }
    setEdits((cur) => ({ ...cur, ...patch }))
    if (timerRef.current) clearTimeout(timerRef.current)
    if (autosave) timerRef.current = setTimeout(() => void flush("text"), AUTOSAVE_MS)
  }

  const subject = edits.subject ?? draft.subject
  const bodyText = edits.bodyText ?? draft.bodyText
  const toText = edits.to ?? formatRecipients(draft.to)
  const ccText = edits.cc ?? formatRecipients(draft.cc)

  // ─── Gate: blocks explain a disabled Send; warnings must be acknowledged ──
  const warnings = gate?.warnings ?? []
  const blocks = (gate?.blocks ?? []).filter((b) => b.key !== "not_admin" && b.key !== "review_again")
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set())
  const unacknowledged = warnings.filter((w) => !acknowledged.has(gateLabel(w)))
  const [infoOpen, setInfoOpen] = useState<boolean | null>(null)
  const showInfo = infoOpen ?? warnings.length > 0

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const onSend = () =>
    run(async () => {
      const before = draftRef.current.version
      // Save what is still pending first; approve exactly the version saved (D9).
      const version = await flush()
      if (version === null) return
      const args = {
        draftId: draft._id,
        version,
        acknowledgedWarnings: warnings.map(gateLabel),
      }
      try {
        // Retry only an untouched failed send whose approval still binds it. A
        // save just now moved it back to `draft` (a new version) → a fresh
        // approval; so does an approval that no longer binds (after Reconnect).
        const latest = draftRef.current
        const saved = version !== before
        const retry = !saved && latest.status === "failed" && latest.retryable
        const result = retry ? await retrySend(args) : await approveAndSend(args)
        if (!result.ok) toast.error(result.blocks[0]?.text ?? "The email can't be sent yet")
      } catch (err) {
        toastError(err, "The email can't be sent")
      }
    })

  const onDiscard = () =>
    run(() => discardDraft({ draftId: draft._id }).catch((err) => toastError(err, "Couldn't discard the draft")))

  const onUndo = () =>
    run(() => undoSend({ draftId: draft._id }).catch((err) => toastError(err, "Too late to undo")))

  const onReviewed = () =>
    run(() =>
      markReviewed({ draftId: draft._id, version: draft.version }).catch((err) =>
        toastError(err, "Couldn't mark the draft reviewed"),
      ),
    )

  const onFrom = (connectorId: Id<"connectors">) =>
    run(() =>
      setFromMailbox({ draftId: draft._id, version: draft.version, connectorId }).catch((err) =>
        toastError(err, "Couldn't switch the mailbox"),
      ),
    )

  // Not disabled while saving: Send itself awaits the save queue.
  const sendDisabled =
    busy || gate === undefined || (gate?.blocks.length ?? 0) > 0 || unacknowledged.length > 0
  const isPrimary = useIsPrimaryDraft(draft._id, primaryActionOf(draft, readOnly) !== null)
  const stale = draft.stale && GATE_STATES.has(status) ? draft.stale : null
  const inThread = Boolean(draft.threadId)
  const mailbox = draft.fromMailbox?.email ?? "the sending mailbox"

  return (
    <Card role="region" aria-label="Email draft" className="gap-0 px-[18px] pb-3 pt-3.5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground">
          <MailIcon className="size-[15px]" aria-hidden />
        </span>
        <span className="text-sm font-medium">E-mail</span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground/70">{draftVersionLabel(draft.version, draft.lastEdit)}</span>
      </div>

      {stale && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[13px] text-muted-foreground">
          <span className="min-w-0 flex-1">{stale.reason} — this version may be out of date.</span>
          {isAdmin && !readOnly && (
            <Button size="xs" variant="ghost" disabled={busy} onClick={onReviewed}>
              Review again
            </Button>
          )}
        </div>
      )}

      {/* Subject */}
      <label
        className="flex items-center gap-1.5 pb-1.5 pt-3"
        title={draft.subjectLocked ? "Reply in the original Gmail thread — the subject stays" : undefined}
      >
        <span className="sr-only">Subject</span>
        <input
          value={subject}
          readOnly={!canEdit || draft.subjectLocked}
          onChange={(e) => edit({ subject: e.target.value }, true)}
          onBlur={() => void flush()}
          className="-ml-1.5 min-w-0 flex-1 rounded-lg bg-transparent px-1.5 py-1 text-[17px] font-semibold leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 read-only:focus-visible:ring-0"
        />
        {draft.subjectLocked && (
          <LockIcon
            className="size-3.5 shrink-0 text-muted-foreground/60"
            aria-label="Subject locked — the reply stays in the Gmail thread"
            role="img"
          />
        )}
      </label>

      {/* From */}
      <div className="grid min-h-10 grid-cols-[64px_minmax(0,1fr)] items-center border-b border-border/60 text-sm">
        <span className="text-muted-foreground">From</span>
        <div className="flex min-w-0 items-center gap-1.5">
          {isAdmin && draft.mailboxOptions.length > 1 && canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="-ml-2.5 max-w-full font-normal" disabled={busy}>
                  <span className="truncate">{mailbox}</span>
                  <ChevronDownIcon data-icon="inline-end" className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  {draft.mailboxOptions.map((option) => (
                    <DropdownMenuItem
                      key={option.connectorId}
                      onSelect={() => {
                        if (option.connectorId !== draft.fromConnectorId) void onFrom(option.connectorId)
                      }}
                    >
                      <span className="truncate">{option.email ?? "Mailbox"}</span>
                      {option.ownerName && <span className="text-muted-foreground">{option.ownerName}</span>}
                      {option.connectorId === draft.fromConnectorId && <CheckIcon className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="truncate">{mailbox}</span>
          )}
          {draft.fromMailbox && !draft.fromMailbox.connected && (
            <span className="shrink-0 text-xs text-muted-foreground">· not connected</span>
          )}
        </div>
      </div>

      <RecipientField
        label="To"
        value={toText}
        inputRef={toRef}
        readOnly={!canEdit}
        onChange={(value) => edit({ to: value }, false)}
        onBlur={() => void flush()}
      />
      <RecipientField
        label="Cc"
        value={ccText}
        readOnly={!canEdit}
        placeholder={canEdit ? "name@example.com" : undefined}
        onChange={(value) => edit({ cc: value }, false)}
        onBlur={() => void flush()}
      />

      {/* Body */}
      <label className="-mx-2.5 mt-2.5 block">
        <span className="sr-only">Message</span>
        <textarea
          value={bodyText}
          readOnly={!canEdit}
          onChange={(e) => edit({ bodyText: e.target.value }, true)}
          onBlur={() => void flush()}
          rows={3}
          className="field-sizing-content block max-h-[32rem] w-full resize-none rounded-xl bg-transparent px-2.5 py-2.5 text-[14.5px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40 read-only:focus-visible:ring-0"
        />
      </label>

      {draft.attachments.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-1.5 pt-1.5">
          {draft.attachments.map((file, i) => (
            <li key={`${i}-${file.label}`}>
              {file.url ? (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <PaperclipIcon className="size-3" aria-hidden />
                  <span className="max-w-48 truncate">{file.label}</span>
                </a>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                  <PaperclipIcon className="size-3" aria-hidden />
                  <span className="max-w-48 truncate">{file.label}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Blocks that keep Send disabled (the fix is the line itself) */}
      {!readOnly && isAdmin && blocks.length > 0 && GATE_STATES.has(status) && (
        <ul className="flex flex-col gap-1 pt-2.5">
          {blocks.map((b) => (
            <li key={gateLabel(b)} className="flex items-start gap-1.5 text-[13px] text-warning">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">{b.text}</span>
              {b.key === "reconnect" && (
                <Link href={RECONNECT_HREF} className="shrink-0 text-foreground underline-offset-2 hover:underline">
                  Reconnect
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Footer */}
      <Footer
        draft={draft}
        readOnly={readOnly}
        busy={busy}
        mailbox={mailbox}
        inThread={inThread}
        warnings={warnings}
        showInfo={showInfo}
        onToggleInfo={() => setInfoOpen(!showInfo)}
        acknowledged={acknowledged}
        onAcknowledge={(label, checked) =>
          setAcknowledged((cur) => {
            const next = new Set(cur)
            if (checked) next.add(label)
            else next.delete(label)
            return next
          })
        }
        sendDisabled={sendDisabled}
        onSend={onSend}
        onDiscard={onDiscard}
        onUndo={onUndo}
        onEditRecipients={() => toRef.current?.focus()}
        isPrimary={isPrimary}
      />
    </Card>
  )
}

/** The recorded form of a warning (`email/sendGate.ts` warningLabel). */
const gateLabel = (w: GateRow) => `${w.key}: ${w.text}`

/**
 * The draft's primary action for the viewer now: Send / Approve & send
 * (`send`), Retry, a fresh Approve & send of a failed draft (`approve`), or
 * none (queued, sent, a member, the fix is the person's).
 */
function primaryActionOf(draft: DraftView, readOnly: boolean): "send" | "retry" | "approve" | null {
  if (readOnly || !draft.viewerIsAdmin) return null
  if (draft.status === "draft") return "send"
  if (draft.status !== "failed") return null
  return failedPrimary({
    kind: draft.failure?.kind ?? null,
    mailboxConnected: draft.fromMailbox?.connected === true,
    retryable: draft.retryable,
  })
}

function RecipientField({
  label,
  value,
  readOnly,
  placeholder,
  inputRef,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  readOnly: boolean
  placeholder?: string
  inputRef?: React.Ref<HTMLInputElement>
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <label className="grid min-h-10 grid-cols-[64px_minmax(0,1fr)] items-center border-b border-border/60 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="-ml-2 min-w-0 rounded-lg bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/40 read-only:focus-visible:ring-0"
      />
    </label>
  )
}

function Footer({
  draft,
  readOnly,
  busy,
  mailbox,
  inThread,
  warnings,
  showInfo,
  onToggleInfo,
  acknowledged,
  onAcknowledge,
  sendDisabled,
  onSend,
  onDiscard,
  onUndo,
  onEditRecipients,
  isPrimary,
}: {
  draft: DraftView
  readOnly: boolean
  busy: boolean
  mailbox: string
  inThread: boolean
  warnings: GateRow[]
  showInfo: boolean
  onToggleInfo: () => void
  acknowledged: ReadonlySet<string>
  onAcknowledge: (label: string, checked: boolean) => void
  sendDisabled: boolean
  onSend: () => void
  onDiscard: () => void
  onUndo: () => void
  onEditRecipients: () => void
  /** The screen's one dark primary (the latest actionable draft); else outline. */
  isPrimary: boolean
}) {
  const status = draft.status
  const isAdmin = draft.viewerIsAdmin

  if (status === "sent") {
    return (
      <div className="flex items-center gap-1.5 pt-2.5 text-[13.5px] text-success">
        <CheckIcon className="size-3.5" aria-hidden />
        {sentLabel(inThread, draft.to)}
      </div>
    )
  }
  if (status === "queued") return <QueuedLine sendAt={draft.sendAt ?? null} canUndo={isAdmin && !readOnly} busy={busy} onUndo={onUndo} />
  if (status === "dispatching") return <WorkingLine text="Sending…" />
  if (status === "unknown") return <WorkingLine text="Checking whether it went out…" />

  const failed = status === "failed" && draft.failure ? draft.failure : null
  const fix = failed ? failureFix(failed.kind) : null
  const mailboxConnected = draft.fromMailbox?.connected === true
  const primary = primaryActionOf(draft, readOnly)

  return (
    <div className="flex flex-col pt-2.5">
      {failed && (
        <div className="flex items-start gap-1.5 pb-2 text-[13px] text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Not sent: {failed.message}</span>
          {!readOnly && isAdmin && fix === "reconnect" && !mailboxConnected && (
            <Link href={RECONNECT_HREF} className="shrink-0 text-foreground underline-offset-2 hover:underline">
              Reconnect
            </Link>
          )}
          {!readOnly && isAdmin && fix === "recipients" && (
            <button type="button" onClick={onEditRecipients} className="shrink-0 text-foreground underline-offset-2 hover:underline">
              Edit recipients
            </button>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        {isAdmin ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 font-normal text-muted-foreground"
            aria-expanded={showInfo}
            onClick={onToggleInfo}
          >
            {approvalLabel(warnings.length)}
            <ChevronDownIcon data-icon="inline-end" className={cn(showInfo && "rotate-180")} />
          </Button>
        ) : (
          <span className="text-[13px] text-muted-foreground">Saved for an admin — only an admin can send it.</span>
        )}
        <span className="flex-1" />
        {!readOnly && draft.viewerCanEdit && (
          <Button variant="ghost" className="h-9 rounded-full px-3.5 text-muted-foreground" disabled={busy} onClick={onDiscard}>
            Discard
          </Button>
        )}
        {primary !== null && (
          <Button
            variant={isPrimary ? "default" : "outline"}
            className="h-9 rounded-full px-5"
            disabled={sendDisabled}
            // Triage's ⌘↵ presses the item's send button (B8b) — the block keeps the logic.
            data-email-primary={draft._id}
            // Keep focus in the field: its blur must not eat this click (Send flushes the saves itself).
            onMouseDown={(e) => e.preventDefault()}
            onClick={onSend}
          >
            {busy && <Spinner data-icon="inline-start" />}
            {primary === "retry"
              ? "Retry"
              : primary === "approve"
                ? reapproveLabel(draft.version)
                : sendButtonLabel(draft.kind, draft.version)}
          </Button>
        )}
      </div>
      {isAdmin && showInfo && (
        <div className="flex flex-col gap-1.5 pt-1.5 text-[12.5px] text-muted-foreground">
          <p>
            Nothing leaves the app until you press Send · then you have {UNDO_WINDOW_SECONDS} s to undo ·{" "}
            {inThread ? `it goes out in the original Gmail thread from ${mailbox}` : `it starts a new conversation from ${mailbox}`}
          </p>
          {warnings.length > 0 && (
            <ul aria-label="Warnings" className="flex flex-col gap-1">
              {warnings.map((w) => {
                const label = gateLabel(w)
                return (
                  <li key={label}>
                    <label className="flex items-start gap-2 text-foreground/80">
                      <Checkbox
                        className="mt-px"
                        checked={acknowledged.has(label)}
                        disabled={readOnly}
                        onCheckedChange={(checked) => onAcknowledge(label, checked === true)}
                        aria-label={`Acknowledge: ${w.text}`}
                      />
                      <span>{w.text}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** "Sending in N s · Undo", counted down from `sendAt` (survives a reload). */
function QueuedLine({
  sendAt,
  canUndo,
  busy,
  onUndo,
}: {
  sendAt: number | null
  canUndo: boolean
  busy: boolean
  onUndo: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  const left = sendAt === null ? 0 : secondsUntil(sendAt, now)
  if (left === 0) return <WorkingLine text="Sending…" />
  return (
    <div className="flex items-center gap-2 pt-2.5">
      <Spinner className="size-3.5 text-muted-foreground" />
      <span className="text-[13.5px] text-muted-foreground tabular-nums">Sending in {left} s</span>
      <span className="flex-1" />
      {canUndo && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy} onClick={onUndo}>
          Undo
        </Button>
      )}
    </div>
  )
}

function WorkingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 pt-2.5 text-[13.5px] text-muted-foreground">
      <Spinner className="size-3.5" />
      {text}
    </div>
  )
}

function DiscardedLine({ draft, readOnly }: { draft: DraftView; readOnly: boolean }) {
  const restoreDraft = useMutation(api.email.drafts.restoreDraft)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
      <span className="min-w-0 flex-1">Draft discarded — nothing was sent</span>
      {!readOnly && (
        <Button
          variant="ghost"
          size="sm"
          className="text-foreground"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            restoreDraft({ draftId: draft._id })
              .catch((err) => toastError(err, "Couldn't restore the draft"))
              .finally(() => setBusy(false))
          }}
        >
          Restore
        </Button>
      )}
    </div>
  )
}

function EmailDraftSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border px-[18px] py-3.5">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}
