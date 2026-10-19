import { describe, expect, it } from "vitest";
import { InvalidModelSlugError, parseModelSlug } from "./modelSlug";

describe("parseModelSlug", () => {
  it.each([
    // current generation — gateway form, bare form, API alias, dated snapshot
    ["anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-4.6", "claude-sonnet-4-6"],
    ["claude-sonnet-4.6", "anthropic/claude-sonnet-4.6", "claude-sonnet-4-6"],
    ["claude-sonnet-4-6", "anthropic/claude-sonnet-4.6", "claude-sonnet-4-6"],
    ["claude-haiku-4-5", "anthropic/claude-haiku-4.5", "claude-haiku-4-5"],
    ["claude-haiku-4-5-20251001", "anthropic/claude-haiku-4.5", "claude-haiku-4-5-20251001"],
    ["claude-opus-4-1-20250805", "anthropic/claude-opus-4.1", "claude-opus-4-1-20250805"],
    ["anthropic/claude-sonnet-4", "anthropic/claude-sonnet-4", "claude-sonnet-4-0"],
    ["claude-sonnet-4-0", "anthropic/claude-sonnet-4", "claude-sonnet-4-0"],
    ["claude-sonnet-4-20250514", "anthropic/claude-sonnet-4", "claude-sonnet-4-20250514"],
    // Claude 3.x — undated → the known snapshot, dated → kept
    ["anthropic/claude-3.5-sonnet", "anthropic/claude-3.5-sonnet", "claude-3-5-sonnet-20241022"],
    ["claude-3-5-sonnet", "anthropic/claude-3.5-sonnet", "claude-3-5-sonnet-20241022"],
    ["claude-3-5-sonnet-latest", "anthropic/claude-3.5-sonnet", "claude-3-5-sonnet-20241022"],
    ["claude-3-5-sonnet-20240620", "anthropic/claude-3.5-sonnet", "claude-3-5-sonnet-20240620"],
    ["claude-3-5-haiku-20241022", "anthropic/claude-3.5-haiku", "claude-3-5-haiku-20241022"],
    ["claude-3-7-sonnet-20250219", "anthropic/claude-3.7-sonnet", "claude-3-7-sonnet-20250219"],
    ["claude-3-opus-20240229", "anthropic/claude-3-opus", "claude-3-opus-20240229"],
    ["claude-3-haiku", "anthropic/claude-3-haiku", "claude-3-haiku-20240307"],
    // trims + lowercases
    ["  Anthropic/Claude-Opus-4.1 ", "anthropic/claude-opus-4.1", "claude-opus-4-1"],
  ])("maps %j to gateway %j and API id %j", (raw, gatewaySlug, anthropicModelId) => {
    expect(parseModelSlug(raw)).toEqual({ gatewaySlug, anthropicModelId });
  });

  it.each([
    "",
    "   ",
    "gpt-5",
    "openai/gpt-5",
    "google/gemini-2.5-pro",
    "anthropic/gpt-5",
    "anthropic/",
    "/claude-sonnet-4.6",
    "a/b/c",
    "anthropic/claude sonnet",
    "anthropic/claude-sonnet-4.6!",
    // unknown / unmappable Claude ids are rejected, never guessed
    "claude-sonnet-9-9",
    "claude-3-6-sonnet",
    "claude-3-5-opus",
    "claude-sonnet-4-6-2025",
    "claude-instant-1.2",
    "claude-2.1",
    `anthropic/claude-${"x".repeat(120)}`,
  ])("rejects %j with the fixable hint", (raw) => {
    expect(() => parseModelSlug(raw)).toThrow(InvalidModelSlugError);
    expect(() => parseModelSlug(raw)).toThrow(/anthropic\/claude-sonnet-4\.6/);
  });
});
