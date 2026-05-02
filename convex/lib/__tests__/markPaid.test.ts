import { describe, it, expect } from "vitest";
import { classifyMarkPaid, classifyUndo } from "../markPaid";

describe("classifyMarkPaid", () => {
  const NOW = 1735_000_000_000;

  it("patches an invoiced row to paid with paidAt=now", () => {
    const out = classifyMarkPaid({ status: "invoiced" }, NOW);
    expect(out.kind).toBe("patch");
    if (out.kind === "patch") {
      expect(out.setPaidAt).toBe(NOW);
      expect(out.prior).toEqual({ status: "invoiced", paidAt: null });
    }
  });

  it("is idempotent for already-paid rows (noop, snapshot keeps paidAt)", () => {
    const out = classifyMarkPaid(
      { status: "paid", paidAt: 1700_000_000_000 },
      NOW,
    );
    expect(out.kind).toBe("noop");
    if (out.kind === "noop") {
      expect(out.prior).toEqual({ status: "paid", paidAt: 1700_000_000_000 });
    }
  });

  it("skips drafts with a clear reason", () => {
    const out = classifyMarkPaid({ status: "draft" }, NOW);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") {
      expect(out.reason).toMatch(/draft/i);
    }
  });

  it("skips voided invoices with a clear reason", () => {
    const out = classifyMarkPaid({ status: "void" }, NOW);
    expect(out.kind).toBe("skip");
    if (out.kind === "skip") {
      expect(out.reason).toMatch(/void/i);
    }
  });

  it("preserves paidAt=null on the snapshot when the invoice has none", () => {
    const out = classifyMarkPaid({ status: "invoiced" }, NOW);
    if (out.kind === "patch") {
      expect(out.prior.paidAt).toBeNull();
    }
  });
});

describe("classifyUndo", () => {
  it("reverts when current status is still 'paid' (no third-party edit)", () => {
    const out = classifyUndo(
      { status: "paid", paidAt: 1735_000_000_000 },
      { status: "invoiced", paidAt: null },
    );
    expect(out.kind).toBe("revert");
    if (out.kind === "revert") {
      expect(out.setStatus).toBe("invoiced");
      expect(out.setPaidAt).toBeNull();
    }
  });

  it("skips when another admin voided the invoice during the undo window", () => {
    const out = classifyUndo(
      { status: "void" },
      { status: "invoiced", paidAt: null },
    );
    expect(out.kind).toBe("skip");
  });

  it("skips when another admin reverted to invoiced manually", () => {
    const out = classifyUndo(
      { status: "invoiced" },
      { status: "invoiced", paidAt: null },
    );
    expect(out.kind).toBe("skip");
  });

  it("reverts paid→paid restoring the snapshot paidAt (idempotent mark case)", () => {
    const out = classifyUndo(
      { status: "paid", paidAt: 1735_000_000_000 },
      { status: "paid", paidAt: 1700_000_000_000 },
    );
    expect(out.kind).toBe("revert");
    if (out.kind === "revert") {
      expect(out.setStatus).toBe("paid");
      expect(out.setPaidAt).toBe(1700_000_000_000);
    }
  });

  it("returns a human-readable skip reason", () => {
    const out = classifyUndo(
      { status: "draft" },
      { status: "invoiced", paidAt: null },
    );
    if (out.kind === "skip") {
      expect(out.reason).toMatch(/modified/i);
    }
  });
});
