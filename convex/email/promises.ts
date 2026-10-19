import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { runLlmStep } from "../lib/agentJobs";
import { getOrgSettings } from "../lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import { addCalendarDays, addWorkingDays, localDateOf, weekdayOf } from "../lib/workingDays";
import { isEmailTriageEnabled } from "./gate";
import { extractPromisesJob, type ExtractPromisesOutput } from "./jobs";
import { extractDates } from "./model";

/**
 * What we told the client, with a date — `emailPromises` (docs/prd-email-
 * triage.md §4.1, §6.1 kickoff "we'll get back by …", §6.8.3, I8).
 *
 * I8: rows are written ONLY from an approved draft that Gmail accepted, and
 * only from the SENT text: `recordSendSuccess` schedules
 * `extractPromisesForMessage` with the outbound message. Never from a draft,
 * never from an inbound message, never from a reply written in Gmail (D33).
 *
 * The llm_step `extractPromises` (cheap model, untrusted-input framing)
 * names each promise by an exact quote and a relative or absolute time;
 * code keeps a promise only when the quote is really in the sent text and
 * resolves the date itself: "N working days" with `lib/workingDays.ts` from
 * the send time in the org timezone, weekdays / dates with the same
 * deterministic date reader the inbound side uses (`model.extractDates`).
 * The drafting agent's `promiseCandidates` are hints: one counts only when
 * its text is in the sent body. A model failure leaves the candidates; any
 * failure here never touches the send.
 */

const PROMISES_CAP = 10;
const BODY_CAP = 20_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const collapse = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

export type ResolvedPromise = { text: string; dueDate: string };

/** The first unambiguous date in a phrase (weekday words, explicit dates, holnap …) on or after today. */
function dateInPhrase(text: string, sentAt: number, tz: string, today: string): string | null {
  for (const d of extractDates(text, sentAt, tz)) {
    if (d.date && !d.ambiguous && d.date >= today) return d.date;
  }
  return null;
}

/**
 * Model output + hints → the promises to store. Pure. A promise is kept
 * only when its quote occurs (whitespace-normalised) in the sent body and
 * its due date resolves to today or later.
 */
export function resolvePromises(args: {
  output: ExtractPromisesOutput | null;
  candidates: ReadonlyArray<{ text: string; dueDate?: string }>;
  body: string;
  sentAt: number;
  tz: string;
}): ResolvedPromise[] {
  const body = collapse(args.body);
  const today = localDateOf(args.sentAt, args.tz);
  const out: ResolvedPromise[] = [];
  const add = (text: string, dueDate: string | null) => {
    if (!dueDate || !isValidDate(dueDate) || dueDate < today) return;
    // One promise per sentence: a quote inside (or around) one already kept is the same promise.
    if (out.some((p) => p.text.includes(text) || text.includes(p.text))) return;
    if (out.length < PROMISES_CAP) out.push({ text, dueDate });
  };

  for (const p of args.output?.promises ?? []) {
    const quote = collapse(p.quote);
    if (!quote || !body.includes(quote)) continue; // I8: only what was really sent
    let due: string | null = null;
    if (p.workingDays !== null) due = addWorkingDays(args.sentAt, p.workingDays, args.tz);
    else if (p.calendarDays !== null) due = addCalendarDays(today, p.calendarDays);
    else due = dateInPhrase(quote, args.sentAt, args.tz, today) ?? (p.date && isValidDate(p.date) ? p.date : null);
    add(quote, due);
  }
  for (const c of args.candidates) {
    const text = collapse(c.text);
    if (!text || !body.includes(text)) continue;
    add(text, c.dueDate && isValidDate(c.dueDate) ? c.dueDate : dateInPhrase(text, args.sentAt, args.tz, today));
  }
  return out;
}

export type PromiseInput = {
  orgId: string;
  threadId: Id<"emailThreads">;
  taskId?: Id<"tasks">;
  body: string;
  sentAt: number;
  tz: string;
  candidates: Array<{ text: string; dueDate?: string }>;
};

/** The SENT message of a sent draft, or null (not sent, not ours, already extracted, feature off). */
export const loadPromiseInput = internalQuery({
  args: { draftId: v.id("emailDrafts"), messageId: v.id("emailMessages") },
  handler: async (ctx, args): Promise<PromiseInput | null> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "sent" || draft.sentMessageId !== args.messageId || !draft.approval) return null;
    const message = await ctx.db.get(args.messageId);
    if (!message || message.orgId !== draft.orgId || message.direction !== "outbound") return null;
    if (!(await isEmailTriageEnabled(ctx, draft.orgId))) return null;
    const existing = await ctx.db
      .query("emailPromises")
      .withIndex("by_orgId_threadId", (q) => q.eq("orgId", draft.orgId).eq("threadId", message.threadId))
      .take(200);
    if (existing.some((p) => p.messageId === message._id)) return null;
    const tz = (await getOrgSettings(ctx, draft.orgId))?.timezone || ORG_TIMEZONE_FALLBACK;
    return {
      orgId: draft.orgId,
      threadId: message.threadId,
      taskId: draft.taskId,
      body: message.bodyText.slice(0, BODY_CAP),
      sentAt: message.sentAt,
      tz,
      candidates: draft.promiseCandidates ?? [],
    };
  },
});

export const writePromises = internalMutation({
  args: {
    draftId: v.id("emailDrafts"),
    messageId: v.id("emailMessages"),
    promises: v.array(v.object({ text: v.string(), dueDate: v.string() })),
  },
  handler: async (ctx, args): Promise<{ written: number }> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "sent" || draft.sentMessageId !== args.messageId) return { written: 0 };
    const message = await ctx.db.get(args.messageId);
    if (!message || message.orgId !== draft.orgId || message.direction !== "outbound") return { written: 0 };
    const existing = await ctx.db
      .query("emailPromises")
      .withIndex("by_orgId_threadId", (q) => q.eq("orgId", draft.orgId).eq("threadId", message.threadId))
      .take(200);
    if (existing.some((p) => p.messageId === message._id)) return { written: 0 }; // idempotent
    const now = Date.now();
    let written = 0;
    for (const p of args.promises.slice(0, PROMISES_CAP)) {
      if (!isValidDate(p.dueDate)) continue;
      await ctx.db.insert("emailPromises", {
        orgId: draft.orgId,
        threadId: message.threadId,
        messageId: message._id,
        taskId: draft.taskId,
        text: p.text.slice(0, 300),
        dueDate: p.dueDate,
        status: "open",
        createdAt: now,
      });
      written++;
    }
    return { written };
  },
});

/** Scheduled by `recordSendSuccess` (I8). Never throws: a failure here never affects the send. */
export const extractPromisesForMessage = internalAction({
  args: { draftId: v.id("emailDrafts"), messageId: v.id("emailMessages") },
  handler: async (ctx, args): Promise<{ written: number }> => {
    try {
      const input: PromiseInput | null = await ctx.runQuery(internal.email.promises.loadPromiseInput, args);
      if (!input) return { written: 0 };
      const today = localDateOf(input.sentAt, input.tz);
      let output: ExtractPromisesOutput | null = null;
      try {
        output = await runLlmStep(ctx, {
          job: extractPromisesJob,
          orgId: input.orgId,
          anchor: { type: "emailThread", id: input.threadId },
          input: {
            sentAt: new Date(input.sentAt).toISOString(),
            today,
            weekday: WEEKDAYS[weekdayOf(today)],
            email: input.body,
            hints: input.candidates.map((c) => c.text),
          },
        });
      } catch {
        output = null; // audited by runLlmStep; the hints still count when they were sent
      }
      const promises = resolvePromises({
        output,
        candidates: input.candidates,
        body: input.body,
        sentAt: input.sentAt,
        tz: input.tz,
      });
      if (promises.length === 0) return { written: 0 };
      return await ctx.runMutation(internal.email.promises.writePromises, { ...args, promises });
    } catch (err) {
      console.warn(`[email/promises] extraction skipped: ${(err instanceof Error ? err.name : "error")}`);
      return { written: 0 };
    }
  },
});
