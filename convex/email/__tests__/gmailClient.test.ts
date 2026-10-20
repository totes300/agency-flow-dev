// @vitest-environment edge-runtime
//
// Email triage B3 (security review M5): the Gmail client's timeout covers the
// whole answer — headers AND body — and a 404 on history is an expired cursor.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGmailClient, GMAIL_REQUEST_TIMEOUT_MS, GmailApiError, type GmailTransport } from "../gmailClient";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Answers 200 at once, then never sends the body (until aborted). */
const stalledBody: GmailTransport = async (_url, init) =>
  new Response(
    new ReadableStream({
      start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("gmailClient timeouts (M5)", () => {
  it("a body that never arrives times out as transient", async () => {
    const client = createGmailClient("tok", stalledBody);
    const pending = client.getProfile().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(GMAIL_REQUEST_TIMEOUT_MS + 1);
    const err = await pending;
    expect(err).toBeInstanceOf(GmailApiError);
    expect((err as GmailApiError).kind).toBe("transient");
    expect((err as GmailApiError).message).toMatch(/timeout while reading/);
  });

  it("a stalled send body is an unknown outcome, never transient", async () => {
    const client = createGmailClient("tok", stalledBody);
    const pending = client.sendMessage({ raw: "eA" }).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await pending as GmailApiError).kind).toBe("unknown");
  });

  it("history 404 is an expired cursor; a raw 404 is a gone message", async () => {
    const notFound: GmailTransport = async () => Response.json({ error: { code: 404 } }, { status: 404 });
    const client = createGmailClient("tok", notFound);
    expect(await client.listHistory({ startHistoryId: "1" })).toEqual({ expired: true });
    expect(await client.getMessage("m1", "raw")).toBeNull();
  });
});
