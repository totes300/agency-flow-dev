import { describe, expect, it } from "vitest";
import { changeCoverage, checkChangePlan, needsReopen, type ChangePlanInput } from "../changePlan";
import type { PlanLedgerRow } from "../plan";

const row = (id: string, text: string, constraints: PlanLedgerRow["constraints"] = [], disposition = "open"): PlanLedgerRow => ({
  id,
  text,
  disposition,
  constraints,
});

const rows: PlanLedgerRow[] = [
  row("r_story", "És kérnénk egy story méretet is a Facebookra.", [{ kind: "platform", value: "Facebookra" }]),
  row("r_ask", "Mikorra lesz kész?"),
  row("r_old", "Bannerek", [], "covered"),
];

const empty: ChangePlanInput = { add: [], amend: [], cancel: [], dispositions: [] };

describe("checkChangePlan (D4 coverage, D13 titles)", () => {
  it("a complete change: every unresolved row has its place", () => {
    const check = checkChangePlan(
      {
        ...empty,
        add: [{ title: "Story méret a Facebookra is", requestIds: ["r_story"] }],
        dispositions: [{ requestId: "r_ask", disposition: "answered" }],
      },
      rows,
    );
    expect(check).toEqual({ errors: [], gaps: [] });
  });

  it("gaps: an uncovered row, a constraint not in the title (amend falls back to the current title)", () => {
    const check = checkChangePlan(
      { ...empty, amend: [{ subtaskId: "s1", currentTitle: "Story méret az Instagramra", requestIds: ["r_story"] }] },
      rows,
    );
    expect(check.errors).toEqual([]);
    expect(check.gaps).toEqual([
      expect.objectContaining({ kind: "missing_disposition", requestId: "r_ask" }),
      expect.objectContaining({ kind: "constraint_not_in_title", requestId: "r_story" }),
    ]);
  });

  it("errors: unknown ids, a row named twice, a dismissal without a reason", () => {
    const check = checkChangePlan(
      {
        ...empty,
        add: [{ title: "Story", requestIds: ["r_story", "nope"] }],
        cancel: [{ subtaskId: "s2", requestIds: ["r_story"] }],
        dispositions: [{ requestId: "r_ask", disposition: "dismissed" }],
      },
      rows,
    );
    expect(check.errors).toEqual([
      expect.stringContaining('"nope"'),
      expect.stringContaining("named 2 times"),
      expect.stringContaining("needs a reason"),
    ]);
  });

  it("coverage lists what names each row", () => {
    expect(
      changeCoverage({
        ...empty,
        add: [{ title: "A", requestIds: ["r_story"] }],
        cancel: [{ subtaskId: "s9", requestIds: ["r_ask"] }],
      }),
    ).toEqual([
      { requestId: "r_story", by: "add", index: 0 },
      { requestId: "r_ask", by: "cancel", subtaskId: "s9" },
    ]);
  });
});

describe("needsReopen (D4)", () => {
  it("review roles and done reopen; open work does not", () => {
    expect(needsReopen({ workflowRole: "admin_review", closed: false })).toBe(true);
    expect(needsReopen({ workflowRole: "client_review", closed: false })).toBe(true);
    expect(needsReopen({ workflowRole: null, closed: true })).toBe(true);
    expect(needsReopen({ workflowRole: "blocked", closed: false })).toBe(false);
    expect(needsReopen({ workflowRole: null, closed: false })).toBe(false);
  });
});
