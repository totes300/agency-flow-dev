/**
 * The question block (A5; PRD D16, D18, §6.6, I7, I11) — the pure half:
 * the tool-output marker, the stored shapes, answer validation, the
 * readable answer turn, the run-context lines and the block's key handling.
 *
 * Shared by the Convex side (`convex/agentQuestions.ts`, `agentRunner.ts`)
 * and the renderer (`components/agents/blocks/question-block.tsx`), so the
 * server and the block can never disagree on what a valid answer is.
 *
 * Pure module — no React, no Convex.
 */

/** Tool-output marker of `askUser` — the classifier keys the block on it. */
export const AGENT_QUESTION_MARKER = "agency-flow/question@1";

/** Registry name of the ask tool (the runner's stop condition keys on it). */
export const ASK_USER_TOOL_NAME = "askUser";

/** The per-run tool that settles a pending question from a typed message. */
export const SETTLE_QUESTION_TOOL_NAME = "settleQuestion";

/** Refusal for an answer to a question of an outdated plan revision (I11). */
export const QUESTION_STALE_MESSAGE = "This changed — see the new plan";

// Input caps (the tool schema and the server agree).
export const QUESTION_HEADER_MAX = 40;
export const QUESTION_TEXT_MAX = 300;
export const QUESTION_WHY_MAX = 200;
export const QUESTION_OPTION_LABEL_MAX = 80;
export const QUESTION_OPTION_DESCRIPTION_MAX = 200;
export const QUESTION_COMPOSER_PREFIX_MAX = 80;
export const QUESTION_OPTIONS_MIN = 2;
export const QUESTION_OPTIONS_MAX = 4;
export const QUESTION_OTHER_MAX = 2000;

export type QuestionOptionEffect = "email_client" | "answer_here";

export type QuestionOption = {
  label: string;
  description?: string;
  recommended?: boolean;
  effect?: QuestionOptionEffect;
  composerPrefix?: string;
};

export type QuestionStatus = "pending" | "answered" | "later" | "superseded";

export type QuestionAnswer = { optionIndexes: number[]; other?: string };

/** The fields the pure helpers read off a stored question. */
export type QuestionShape = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
};

export type QuestionRefOutput = {
  block: typeof AGENT_QUESTION_MARKER;
  questionId: string;
};

export function isQuestionRefOutput(output: unknown): output is QuestionRefOutput {
  if (typeof output !== "object" || output === null) return false;
  const candidate = output as Record<string, unknown>;
  return (
    candidate.block === AGENT_QUESTION_MARKER &&
    typeof candidate.questionId === "string" &&
    candidate.questionId.length > 0
  );
}

// ─── Answer validation ──────────────────────────────────────────────────────

export type AnswerValidation =
  | { ok: true; answer: QuestionAnswer }
  | { ok: false; error: string };

/**
 * Validate a submitted answer against its question: option indexes in range
 * and unique, several only when `multiSelect`, free text only when
 * `allowOther` (trimmed, capped), and at least one of the two. Returns the
 * normalized answer (indexes sorted, empty `other` dropped).
 */
export function validateAnswer(
  question: Pick<QuestionShape, "options" | "multiSelect" | "allowOther">,
  input: { optionIndexes: number[]; other?: string | null },
): AnswerValidation {
  const indexes = input.optionIndexes;
  for (const i of indexes) {
    if (!Number.isInteger(i) || i < 0 || i >= question.options.length) {
      return { ok: false, error: "That option doesn't exist." };
    }
  }
  if (new Set(indexes).size !== indexes.length) {
    return { ok: false, error: "An option was picked twice." };
  }
  if (indexes.length > 1 && !question.multiSelect) {
    return { ok: false, error: "Pick one option." };
  }
  const other = input.other?.trim() ?? "";
  if (other && !question.allowOther) {
    return { ok: false, error: "This question takes one of its options." };
  }
  if (other.length > QUESTION_OTHER_MAX) {
    return { ok: false, error: "That answer is too long." };
  }
  if (indexes.length === 0 && !other) {
    return { ok: false, error: "Pick an option or type an answer." };
  }
  return {
    ok: true,
    answer: {
      optionIndexes: [...indexes].sort((a, b) => a - b),
      ...(other ? { other } : {}),
    },
  };
}

// ─── The readable answer turn ───────────────────────────────────────────────

function quotedLabel(option: QuestionOption): string {
  return `“${option.label}”${option.recommended ? " (recommended)" : ""}`;
}

/**
 * The user turn an answer posts (and the next run's input): readable, not a
 * payload — `Countdown → “Use 23:59” (recommended)`, several picks joined
 * with commas, free text as typed (after the picks, separated by " — ").
 */
export function formatAnswerTurn(
  question: Pick<QuestionShape, "header" | "options">,
  answer: QuestionAnswer,
): string {
  const picks = answer.optionIndexes
    .map((i) => question.options[i])
    .filter((o): o is QuestionOption => o !== undefined)
    .map(quotedLabel)
    .join(", ");
  const other = answer.other?.trim() ?? "";
  const body = picks && other ? `${picks} — ${other}` : picks || other;
  return `${question.header} → ${body}`;
}

/**
 * The block's settled one-liner: `You chose “Use 23:59”`, `Ádám chose …`,
 * `You answered “…”` (free text only) or `Answered in the conversation`
 * (settled by the agent from a typed message — no picks).
 */
export function answerSummary(
  question: Pick<QuestionShape, "options">,
  answer: QuestionAnswer | null,
  who: string,
  settledInConversation = false,
): string {
  if (!answer || settledInConversation) return "Answered in the conversation";
  const picks = answer.optionIndexes
    .map((i) => question.options[i]?.label)
    .filter((l): l is string => typeof l === "string")
    .map((l) => `“${l}”`)
    .join(", ");
  const other = answer.other?.trim() ?? "";
  if (picks && other) return `${who} chose ${picks} — “${other}”`;
  if (picks) return `${who} chose ${picks}`;
  return `${who} answered “${other}”`;
}

// ─── Run context ────────────────────────────────────────────────────────────

function optionLines(question: Pick<QuestionShape, "options">): string {
  return question.options
    .map(
      (o, i) =>
        `  ${i + 1}. ${o.label}${o.recommended ? " (recommended)" : ""}` +
        (o.description ? ` — ${o.description}` : ""),
    )
    .join("\n");
}

/**
 * Context for the run an answer started: which question the user's message
 * answers, so the model continues instead of asking again.
 */
export function buildAnsweredQuestionContext(
  question: Pick<QuestionShape, "header" | "question" | "options">,
  turn: string,
): string {
  return [
    "Question answered: the user's latest message answers the question you asked —",
    `"${question.header}: ${question.question}"`,
    "Options were:",
    optionLines(question),
    `Their answer: ${turn}`,
    "Continue from this answer. Do not ask the same question again.",
  ].join("\n");
}

/**
 * Context for a composer turn that arrives while a question is pending
 * (PRD §6.6): classify the message first.
 */
export function buildPendingQuestionContext(
  questionId: string,
  question: Pick<QuestionShape, "header" | "question" | "options">,
): string {
  return [
    `Pending question (questionId: ${questionId}): you asked the user "${question.header}: ${question.question}" and it is still open. Options:`,
    optionLines(question),
    "Classify the user's new message first:",
    `- It answers the question → call ${SETTLE_QUESTION_TOOL_NAME} with outcome "answered" (put their answer in note), then continue with that answer.`,
    `- It is a new instruction that replaces the plan the question was about → call ${SETTLE_QUESTION_TOOL_NAME} with outcome "superseded" (or ask a new question with ${ASK_USER_TOOL_NAME}, which replaces it).`,
    "- It is a question to you or an unrelated instruction → handle it and leave the pending question open.",
  ].join("\n");
}

// ─── Keyboard (F10) ─────────────────────────────────────────────────────────

export type QuestionKeyAction =
  | { type: "pick"; index: number }
  | { type: "submit" }
  | null;

/**
 * What a key press means to a FOCUSED question block (PRD §7.7, F10):
 * `1`–`4` pick that option (never while focus is in an editable field), and
 * Enter submits a multi-select — only from the block itself or a checkbox
 * (`targetSubmits`); Enter on a button (Later, a prefix option) is that
 * button's own. Modifier chords are never ours.
 */
export function questionKeyAction(
  event: {
    key: string;
    metaKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    targetEditable: boolean;
    /** Focus is on the block container or one of its checkboxes. */
    targetSubmits?: boolean;
  },
  question: { optionCount: number; multiSelect: boolean },
): QuestionKeyAction {
  if (event.targetEditable) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (/^[1-4]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    return index < question.optionCount ? { type: "pick", index } : null;
  }
  if (event.key === "Enter" && question.multiSelect && event.targetSubmits) {
    return { type: "submit" };
  }
  return null;
}
