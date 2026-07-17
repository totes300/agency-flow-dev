import { describe, it, expect } from "vitest";
import {
  compareCloseRows,
  deriveCloseGroupMeta,
  type CloseGroupableRow,
} from "../closeGroups";

function row(over: Partial<CloseGroupableRow> = {}): CloseGroupableRow {
  return {
    _id: "e_1",
    date: "2026-06-10",
    durationMinutes: 60,
    skipped: false,
    carried: false,
    originMonthLabel: "June 2026",
    ...over,
  };
}

describe("deriveCloseGroupMeta", () => {
  it("subtotals in-scope rows only — skipped rows never inflate the subtotal", () => {
    const meta = deriveCloseGroupMeta([
      row({ _id: "e_1", durationMinutes: 60 }),
      row({ _id: "e_2", durationMinutes: 30 }),
      row({ _id: "e_3", durationMinutes: 480, skipped: true }),
    ]);
    expect(meta.inScopeMinutes).toBe(90);
    expect(meta.inScopeCount).toBe(2);
    expect(meta.allSkipped).toBe(false);
  });

  it("flags a fully-skipped group and keeps an empty group un-flagged", () => {
    expect(
      deriveCloseGroupMeta([
        row({ _id: "e_1", skipped: true }),
        row({ _id: "e_2", skipped: true }),
      ]),
    ).toMatchObject({ allSkipped: true, inScopeCount: 0, inScopeMinutes: 0 });
    expect(deriveCloseGroupMeta([]).allSkipped).toBe(false);
  });

  it("promotes the carried label on a uniform majority", () => {
    const meta = deriveCloseGroupMeta([
      row({ _id: "e_1", carried: true, carriedReason: "skipped", originMonthLabel: "May 2026" }),
      row({ _id: "e_2", carried: true, carriedReason: "skipped", originMonthLabel: "May 2026" }),
      row({ _id: "e_3" }),
    ]);
    expect(meta.majorityCarried).toBe(true);
    expect(meta.carriedShared).toEqual({
      reason: "skipped",
      originMonthLabel: "May 2026",
    });
  });

  it("majority carried but mixed origins → promoted flag without a shared label", () => {
    const meta = deriveCloseGroupMeta([
      row({ _id: "e_1", carried: true, carriedReason: "skipped", originMonthLabel: "May 2026" }),
      row({ _id: "e_2", carried: true, carriedReason: "logged-late", originMonthLabel: "April 2026" }),
      row({ _id: "e_3" }),
    ]);
    expect(meta.majorityCarried).toBe(true);
    expect(meta.carriedShared).toBeNull();
  });

  it("exactly half carried is NOT a majority", () => {
    const meta = deriveCloseGroupMeta([
      row({ _id: "e_1", carried: true, carriedReason: "skipped", originMonthLabel: "May 2026" }),
      row({ _id: "e_2" }),
    ]);
    expect(meta.majorityCarried).toBe(false);
    expect(meta.carriedShared).toBeNull();
  });

  it("ignores skipped rows when computing the carried majority", () => {
    const meta = deriveCloseGroupMeta([
      row({ _id: "e_1", carried: true, carriedReason: "skipped", originMonthLabel: "May 2026" }),
      row({ _id: "e_2", skipped: true }),
      row({ _id: "e_3", skipped: true }),
    ]);
    expect(meta.majorityCarried).toBe(true);
  });
});

describe("compareCloseRows", () => {
  it("orders in-scope chronologically, skipped last, id as tiebreaker", () => {
    const rows = [
      row({ _id: "e_4", date: "2026-06-02", skipped: true }),
      row({ _id: "e_2", date: "2026-06-20" }),
      row({ _id: "e_3", date: "2026-06-05" }),
      row({ _id: "e_1", date: "2026-06-05" }),
    ];
    expect(rows.sort(compareCloseRows).map((r) => r._id)).toEqual([
      "e_1",
      "e_3",
      "e_2",
      "e_4",
    ]);
  });
});
