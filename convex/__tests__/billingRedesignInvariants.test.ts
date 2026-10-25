// @vitest-environment node
//
// Source invariants of the project/billing redesign
// (docs/prd-project-billing-redesign.md §6.1, §12):
// - the period read model never reads a close's snapshot per close (closed
//   periods use the frozen close fields and the entries locked to it);
// - states come from `periodState.ts` only.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
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

// §5.2 / §12 slice 8: labels the redesign removed must not come back.
describe("removed billing labels", () => {
  const REMOVED = [
    "Review to invoice",
    "Create Invoice",
    "Generate invoice",
    "Invoice unbilled hours",
    "Close cycle",
    "Close without invoice",
    "ready to bill",
    "close & report",
    "Download cycle worksheet",
    "Download report",
    "View report",
    "Billed here",
    "Mark as Paid",
    "Mark as Invoiced",
    "Revert to Draft",
    "Delete Draft",
    "Mark as Unpaid",
  ];
  const root = join(__dirname, "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => {
      const rel = join(dir, d.name);
      if (d.isDirectory()) return d.name === "_generated" || d.name === "__tests__" ? [] : files(rel);
      return /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [rel] : [];
    });

  it("no source file in app/, components/, lib/ or convex/ uses one", () => {
    const hits: string[] = [];
    for (const file of ["app", "components", "lib", "convex"].flatMap(files)) {
      const src = readFileSync(join(root, file), "utf8");
      for (const label of REMOVED) if (src.includes(label)) hits.push(`${file}: ${label}`);
    }
    expect(hits).toEqual([]);
  });

  // Tasks keep their own "Overdue" (due dates); billing says Past due.
  it("billing surfaces never say Overdue", () => {
    const billing = [
      "components/billing",
      "components/invoices",
      "components/projects",
      "app/(dashboard)/billing",
      "app/(dashboard)/invoices",
      "app/(dashboard)/projects",
      "convex/lib/billing",
    ];
    const hits = billing.flatMap(files).filter((file) => readFileSync(join(root, file), "utf8").includes("Overdue"));
    expect(hits).toEqual([]);
  });
});
