// @vitest-environment node
//
// Source invariants of the project/billing redesign
// (docs/prd-project-billing-redesign.md §6.1, §12):
// - the period read model never reads a close's snapshot per close (closed
//   periods use the frozen close fields and the entries locked to it);
// - states come from `periodState.ts` only.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

describe("project period read model", () => {
  const src = read("lib/billing/projectPeriods.ts");

  it("does no per-close snapshot reads", () => {
    expect(src).not.toMatch(/billingCloseEntries|buildPeriodView|priceClose|monthBalances/);
  });

  it("derives state, action and undo through periodState only", () => {
    expect(src).toMatch(/derivePeriodState\(/);
    expect(src).toMatch(/periodPrimaryAction\(/);
    expect(src).toMatch(/periodUndoActions\(/);
  });
});
