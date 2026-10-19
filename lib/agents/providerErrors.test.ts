import { describe, expect, it } from "vitest"
import { APICallError, LoadAPIKeyError, RetryError } from "ai"
import {
  AI_SETTINGS_LOCATION,
  classifyProviderError,
  cleanErrorText,
  describeErrorForLog,
  genericRunError,
  isModelCallError,
} from "./providerErrors"

const anthropicBody = (type: string, message: string) =>
  JSON.stringify({ type: "error", error: { type, message } })

function apiError(statusCode: number, type: string, message: string) {
  return new APICallError({
    message,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
    responseBody: anthropicBody(type, message),
    isRetryable: statusCode === 429 || statusCode >= 500,
  })
}

const CREDIT =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."

describe("classifyProviderError", () => {
  it("credit balance too low → top-up hint naming the AI settings", () => {
    const result = classifyProviderError(apiError(400, "invalid_request_error", CREDIT))
    expect(result).toEqual({
      kind: "credit_balance",
      message: "The AI provider has no credit left.",
      hint: `Top up the key in ${AI_SETTINGS_LOCATION} (or the gateway account), then send a follow-up message to retry.`,
    })
  })

  it("the raw Convex-wrapped string from the screenshot classifies the same", () => {
    const raw = `Uncaught Error: ${CREDIT}\n    at processChunk (../node_modules/ai/dist/index.mjs:5878:12)\n    at async consume (../node_modules/ai/dist/index.mjs:8440:3)`
    expect(classifyProviderError(raw).kind).toBe("credit_balance")
    expect(classifyProviderError(new Error(raw)).kind).toBe("credit_balance")
  })

  it("gateway insufficient funds and HTTP 402 are credit problems too", () => {
    expect(classifyProviderError(new Error("Insufficient funds on your AI Gateway account")).kind).toBe("credit_balance")
    expect(classifyProviderError({ statusCode: 402, message: "Payment Required" }).kind).toBe("credit_balance")
  })

  it("invalid key → check-the-key hint", () => {
    const result = classifyProviderError(apiError(401, "authentication_error", "invalid x-api-key"))
    expect(result.kind).toBe("invalid_key")
    expect(result.message).toBe("The AI provider rejected the API key.")
    expect(result.hint).toContain(AI_SETTINGS_LOCATION)
    expect(classifyProviderError({ status: 403, message: "Forbidden" }).kind).toBe("invalid_key")
  })

  it("rate limit (also wrapped in a RetryError after the SDK's retries)", () => {
    const rate = apiError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit")
    expect(classifyProviderError(rate).kind).toBe("rate_limit")
    const retry = new RetryError({ message: "Failed after 3 attempts.", reason: "maxRetriesExceeded", errors: [rate, rate, rate] })
    expect(classifyProviderError(retry)).toMatchObject({
      kind: "rate_limit",
      message: "The AI provider is rate-limiting requests right now.",
    })
  })

  it("overloaded (Anthropic 529) and 503", () => {
    expect(classifyProviderError(apiError(529, "overloaded_error", "Overloaded")).kind).toBe("overloaded")
    expect(classifyProviderError({ statusCode: 503, message: "upstream" }).kind).toBe("overloaded")
  })

  it("finds the reason in a cause chain", () => {
    const err = new Error("Request failed", { cause: apiError(400, "invalid_request_error", CREDIT) })
    expect(classifyProviderError(err).kind).toBe("credit_balance")
  })

  it("generic errors keep their own message, cleaned, with the retry hint", () => {
    expect(classifyProviderError(new Error("Uncaught Error: Task not found\n    at handler (convex/tasks.ts:12:3)"))).toEqual({
      kind: "generic",
      message: "Task not found",
      hint: "You can send a follow-up message in this thread to retry.",
    })
    expect(classifyProviderError("boom").message).toBe("boom")
    expect(classifyProviderError(42).message).toBe("Unknown error")
    expect(classifyProviderError({ message: "plain object" }).message).toBe("plain object")
  })

  it("an app message that merely mentions capacity is not an overload", () => {
    expect(classifyProviderError(new Error("Retainer capacity exceeded for June")).kind).toBe("generic")
  })
})

describe("cleanErrorText", () => {
  it("strips the Convex wrapper and every stack frame", () => {
    const raw =
      "[CONVEX A(agentRunner:startRun)] [Request ID: abc123] Server Error\nUncaught Error: Something broke\n    at foo (../node_modules/ai/dist/index.mjs:1:1)\n    at bar"
    expect(cleanErrorText(raw)).toBe("Something broke")
  })

  it("strips single-line \" at fn (path:line:col)\" frames", () => {
    expect(cleanErrorText("Uncaught Error: Task not found at handler (../convex/tasks.ts:12:3)")).toBe("Task not found")
    expect(cleanErrorText("Boom at async run (node_modules/ai/dist/index.mjs:5878:12) at ../x.js:1:1")).toBe("Boom")
    expect(cleanErrorText("Due at 5 pm, see the brief")).toBe("Due at 5 pm, see the brief")
  })

  it("strips a leading error-class prefix and collapses whitespace", () => {
    expect(cleanErrorText("TypeError:   cannot   read x")).toBe("cannot read x")
    expect(cleanErrorText("Run timed out")).toBe("Run timed out")
  })

  it("caps long text and never returns empty", () => {
    expect(cleanErrorText("x".repeat(1000)).length).toBeLessThanOrEqual(300)
    expect(cleanErrorText("   ")).toBe("Something went wrong.")
  })
})

describe("isModelCallError / genericRunError", () => {
  it("recognises provider, retry, key-loading and gateway errors by their SDK marker", () => {
    expect(isModelCallError(apiError(400, "invalid_request_error", CREDIT))).toBe(true)
    const rate = apiError(429, "rate_limit_error", "rate limit")
    expect(isModelCallError(new RetryError({ message: "x", reason: "maxRetriesExceeded", errors: [rate] }))).toBe(true)
    expect(isModelCallError(new LoadAPIKeyError({ message: "Anthropic API key is missing." }))).toBe(true)
    const gatewayLike = Object.assign(new Error("Insufficient funds"), { [Symbol.for("vercel.ai.gateway.error")]: true })
    expect(isModelCallError(gatewayLike)).toBe(true)
  })

  it("a tool / app error is not a model-call error, whatever it says", () => {
    expect(isModelCallError(new Error(CREDIT))).toBe(false)
    expect(isModelCallError({ statusCode: 429, message: "rate limit" })).toBe(false)
    expect(isModelCallError("rate limit")).toBe(false)
    expect(isModelCallError(null)).toBe(false)
    // …and keeps its own (cleaned) message.
    expect(genericRunError(new Error("Uncaught Error: Retainer budget too low\n    at f (x.ts:1:2)"))).toEqual({
      kind: "generic",
      message: "Retainer budget too low",
      hint: "You can send a follow-up message in this thread to retry.",
    })
  })
})

describe("describeErrorForLog", () => {
  it("keeps the raw provider detail but never the request body, and redacts keys", () => {
    const err = new APICallError({
      message: "invalid x-api-key sk-ant-api03-abcdefghijkl",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: { messages: [{ role: "user", content: "Kovács Réka titkos levele" }] },
      statusCode: 401,
      responseBody: anthropicBody("authentication_error", "invalid x-api-key"),
    })
    const line = describeErrorForLog(err)
    expect(line).toContain("status 401")
    expect(line).toContain("authentication_error")
    expect(line).not.toContain("titkos levele")
    expect(line).not.toContain("abcdefghijkl")
  })
})
