import { describe, expect, it } from "vitest"
import {
  AGENT_QUESTION_MARKER,
  answerSummary,
  buildAnsweredQuestionContext,
  buildPendingQuestionContext,
  formatAnswerTurn,
  isQuestionRefOutput,
  questionKeyAction,
  validateAnswer,
  type QuestionShape,
} from "./questions"
import { classifyParts, toolLabel, type MessagePartLike } from "./blocks"

const countdown: QuestionShape = {
  header: "Countdown",
  question: "What time should the countdown end?",
  options: [
    { label: "Use 23:59", recommended: true, description: "End of Friday" },
    { label: "Use 18:00" },
    { label: "I'll give the exact time", composerPrefix: "Countdown ends: " },
  ],
  multiSelect: false,
  allowOther: true,
}

describe("isQuestionRefOutput", () => {
  it("accepts the marker with a question id only", () => {
    expect(isQuestionRefOutput({ block: AGENT_QUESTION_MARKER, questionId: "q1" })).toBe(true)
    expect(isQuestionRefOutput({ block: AGENT_QUESTION_MARKER, questionId: "" })).toBe(false)
    expect(isQuestionRefOutput({ block: "agency-flow/proposals@1", questionId: "q1" })).toBe(false)
    expect(isQuestionRefOutput(null)).toBe(false)
  })
})

describe("validateAnswer", () => {
  it("normalizes a valid single pick", () => {
    expect(validateAnswer(countdown, { optionIndexes: [0] })).toEqual({
      ok: true,
      answer: { optionIndexes: [0] },
    })
  })
  it("rejects an index out of range or not an integer", () => {
    expect(validateAnswer(countdown, { optionIndexes: [3] })).toMatchObject({ ok: false })
    expect(validateAnswer(countdown, { optionIndexes: [-1] })).toMatchObject({ ok: false })
    expect(validateAnswer(countdown, { optionIndexes: [0.5] })).toMatchObject({ ok: false })
  })
  it("rejects several picks on a single-select and duplicates", () => {
    expect(validateAnswer(countdown, { optionIndexes: [0, 1] })).toEqual({
      ok: false,
      error: "Pick one option.",
    })
    expect(
      validateAnswer({ ...countdown, multiSelect: true }, { optionIndexes: [1, 1] }),
    ).toMatchObject({ ok: false })
  })
  it("sorts multi-select picks", () => {
    expect(
      validateAnswer({ ...countdown, multiSelect: true }, { optionIndexes: [2, 0] }),
    ).toEqual({ ok: true, answer: { optionIndexes: [0, 2] } })
  })
  it("takes free text only when allowOther, trimmed", () => {
    expect(validateAnswer(countdown, { optionIndexes: [], other: "  20:00 " })).toEqual({
      ok: true,
      answer: { optionIndexes: [], other: "20:00" },
    })
    expect(
      validateAnswer({ ...countdown, allowOther: false }, { optionIndexes: [], other: "20:00" }),
    ).toMatchObject({ ok: false })
  })
  it("requires a pick or text", () => {
    expect(validateAnswer(countdown, { optionIndexes: [], other: "   " })).toMatchObject({
      ok: false,
    })
  })
})

describe("formatAnswerTurn", () => {
  it("reads as header → quoted label, marking the recommended one", () => {
    expect(formatAnswerTurn(countdown, { optionIndexes: [0] })).toBe(
      "Countdown → “Use 23:59” (recommended)",
    )
  })
  it("joins several picks and appends free text", () => {
    expect(formatAnswerTurn(countdown, { optionIndexes: [0, 1], other: "both work" })).toBe(
      "Countdown → “Use 23:59” (recommended), “Use 18:00” — both work",
    )
  })
  it("is the free text alone when nothing was picked", () => {
    expect(formatAnswerTurn(countdown, { optionIndexes: [], other: "20:00 sharp" })).toBe(
      "Countdown → 20:00 sharp",
    )
  })
})

describe("answerSummary", () => {
  it("names who chose what", () => {
    expect(answerSummary(countdown, { optionIndexes: [1] }, "You")).toBe("You chose “Use 18:00”")
    expect(answerSummary(countdown, { optionIndexes: [0] }, "Ádám")).toBe("Ádám chose “Use 23:59”")
    expect(answerSummary(countdown, { optionIndexes: [], other: "20:00" }, "You")).toBe(
      "You answered “20:00”",
    )
  })
  it("never quotes the agent's note as the user's words", () => {
    expect(
      answerSummary(countdown, { optionIndexes: [], other: "user said 20:00" }, "You", true),
    ).toBe("Answered in the conversation")
  })
})

describe("run context", () => {
  it("names the answered question and the answer", () => {
    const text = buildAnsweredQuestionContext(countdown, "Countdown → “Use 23:59”")
    expect(text).toContain("Countdown: What time should the countdown end?")
    expect(text).toContain("Their answer: Countdown → “Use 23:59”")
    expect(text).toContain("1. Use 23:59 (recommended) — End of Friday")
  })
  it("tells the model how to classify a turn while a question is pending", () => {
    const text = buildPendingQuestionContext("q_123", countdown)
    expect(text).toContain("questionId: q_123")
    expect(text).toContain("settleQuestion")
    expect(text).toContain("leave the pending question open")
  })
})

describe("questionKeyAction (F10)", () => {
  const single = { optionCount: 3, multiSelect: false }
  const plain = { targetEditable: false }
  it("maps 1–4 to the option, within range", () => {
    expect(questionKeyAction({ key: "1", ...plain }, single)).toEqual({ type: "pick", index: 0 })
    expect(questionKeyAction({ key: "3", ...plain }, single)).toEqual({ type: "pick", index: 2 })
    expect(questionKeyAction({ key: "4", ...plain }, single)).toBeNull()
    expect(questionKeyAction({ key: "5", ...plain }, { optionCount: 4, multiSelect: false })).toBeNull()
  })
  it("never fires from an editable field or with a modifier", () => {
    expect(questionKeyAction({ key: "1", targetEditable: true }, single)).toBeNull()
    expect(questionKeyAction({ key: "1", metaKey: true, ...plain }, single)).toBeNull()
    expect(questionKeyAction({ key: "1", ctrlKey: true, ...plain }, single)).toBeNull()
  })
  it("Enter submits a multi-select only, from the block or a checkbox", () => {
    const multi = { optionCount: 3, multiSelect: true }
    expect(questionKeyAction({ key: "Enter", ...plain, targetSubmits: true }, multi)).toEqual({
      type: "submit",
    })
    // On Later or a prefix option, Enter is that button's own.
    expect(questionKeyAction({ key: "Enter", ...plain, targetSubmits: false }, multi)).toBeNull()
    expect(questionKeyAction({ key: "Enter", ...plain, targetSubmits: true }, single)).toBeNull()
  })
})

describe("classifier", () => {
  it("expands askUser's marker into a question block after its ghost row", () => {
    const parts: MessagePartLike[] = [
      {
        type: "tool-askUser",
        state: "output-available",
        input: {},
        output: { block: AGENT_QUESTION_MARKER, questionId: "q1", note: "…" },
      },
    ]
    const blocks = classifyParts(parts)
    expect(blocks.map((b) => b.kind)).toEqual(["tool", "question"])
    expect(blocks[1]).toEqual({ kind: "question", questionId: "q1" })
    expect(toolLabel("askUser", "done")).toBe("Asked a question")
  })
  it("a failed ask renders no question block", () => {
    const blocks = classifyParts([
      { type: "tool-askUser", state: "output-error", input: {}, errorText: "Give 2–4 options." },
    ])
    expect(blocks.map((b) => b.kind)).toEqual(["tool"])
  })
})
