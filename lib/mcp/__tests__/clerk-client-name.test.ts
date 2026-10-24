// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const list = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ oauthApplications: { list } }),
}));

import { loadRegisteredClientNames, resetClientNameCache, resolveClientName } from "../clerk-client-name";

/** A fake list API over `total` applications, paged like Clerk's. */
function fakeApps(total: number) {
  const apps = Array.from({ length: total }, (_, i) => ({ clientId: `client_${i}`, name: `App ${i}` }));
  return async ({ limit, offset }: { limit: number; offset: number }) => ({
    data: apps.slice(offset, offset + limit),
    totalCount: total,
  });
}

beforeEach(() => {
  list.mockReset();
  resetClientNameCache();
});

describe("registered OAuth client names", () => {
  it("pages through the applications and matches on client ID, not name", async () => {
    const names = await loadRegisteredClientNames(fakeApps(250));
    expect(names.size).toBe(250);
    expect(names.get("client_249")).toBe("App 249");
  });

  it("resolves a registered client once per hour and falls back for unknown and CIMD clients", async () => {
    list.mockImplementation(fakeApps(150));
    expect(await resolveClientName("client_120")).toBe("App 120");
    expect(await resolveClientName("client_3")).toBe("App 3");
    expect(list).toHaveBeenCalledTimes(2); // two pages, then cached
    expect(await resolveClientName("client_unknown")).toBe("MCP client");
    expect(await resolveClientName("https://claude.ai/oauth/claude-code-client-metadata")).toBe("claude.ai");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("never throws when Clerk fails", async () => {
    list.mockRejectedValue(new Error("boom"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolveClientName("client_1")).toBe("MCP client");
    log.mockRestore();
  });
});
