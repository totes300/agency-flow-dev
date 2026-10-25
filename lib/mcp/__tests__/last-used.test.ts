// @vitest-environment node
//
// Connected apps (docs/prd-mcp.md D17): the /mcp route's in-process throttle
// for "last used" stamps — at most once an hour per org + user + client.

import { describe, it, expect } from "vitest";
import { connectionKey, createLastUsedThrottle, unverifiedOrgIdOf } from "../last-used";

const HOUR = 60 * 60 * 1000;

/** A JWT-shaped token with the given payload (signature irrelevant: the route verified it). */
function token(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256", typ: "at+jwt" })}.${part(payload)}.sig`;
}

describe("createLastUsedThrottle", () => {
  it("lets one stamp per key through per interval", () => {
    const throttle = createLastUsedThrottle({ intervalMs: HOUR, maxEntries: 10 });
    expect(throttle.due("a", 0)).toBe(true);
    expect(throttle.due("a", 1)).toBe(false);
    expect(throttle.due("a", HOUR - 1)).toBe(false);
    expect(throttle.due("b", 1)).toBe(true);
    expect(throttle.due("a", HOUR)).toBe(true);
    expect(throttle.due("a", HOUR + 5)).toBe(false);
  });

  it("a forgotten (failed) stamp is due again on the next request", () => {
    const throttle = createLastUsedThrottle({ intervalMs: HOUR, maxEntries: 10 });
    expect(throttle.due("a", 0)).toBe(true);
    throttle.forget("a");
    expect(throttle.due("a", 1)).toBe(true);
    expect(throttle.due("a", 2)).toBe(false);
  });

  it("forgets the oldest keys beyond maxEntries", () => {
    const throttle = createLastUsedThrottle({ intervalMs: HOUR, maxEntries: 2 });
    throttle.due("a", 0);
    throttle.due("b", 0);
    throttle.due("c", 0);
    expect(throttle.size()).toBe(2);
    expect(throttle.due("a", 1)).toBe(true);
    expect(throttle.due("c", 1)).toBe(false);
  });
});

describe("connectionKey", () => {
  it("keys on org + user + client, reading org_id from the verified token", () => {
    expect(unverifiedOrgIdOf(token({ org_id: "org_1" }))).toBe("org_1");
    expect(unverifiedOrgIdOf(token({}))).toBeNull();
    expect(unverifiedOrgIdOf("opaque")).toBeNull();
    expect(unverifiedOrgIdOf("a.%%%.c")).toBeNull();
    const one = connectionKey(token({ org_id: "org_1" }), "user_1", "client_1");
    expect(connectionKey(token({ org_id: "org_1", jti: "other" }), "user_1", "client_1")).toBe(one);
    expect(connectionKey(token({ org_id: "org_2" }), "user_1", "client_1")).not.toBe(one);
    expect(connectionKey(token({ org_id: "org_1" }), "user_2", "client_1")).not.toBe(one);
    expect(connectionKey(token({ org_id: "org_1" }), "user_1", "client_2")).not.toBe(one);
  });
});
