import { describe, it, expect } from "vitest";
import { classifyReportPeriod } from "../reportPeriod";

/**
 * `getRetainerMonthlyReport` (currently `getRetainerStatement`) accepts a
 * year+month and returns:
 *   - past month → data with `inProgress: false`
 *   - current month → data with `inProgress: true`
 *   - future month → null
 *
 * The classifier here is the pure branch behind that. The query consumes the
 * three labels to drive the response shape per `docs/invoicing-refactor.md` D6.
 */
describe("classifyReportPeriod", () => {
  it("returns 'past' for any month before today", () => {
    expect(classifyReportPeriod(2026, 4, "2026-05-02")).toBe("past");
    expect(classifyReportPeriod(2025, 12, "2026-05-02")).toBe("past");
    expect(classifyReportPeriod(2026, 1, "2026-05-02")).toBe("past");
  });

  it("returns 'current' for the same year/month as today", () => {
    expect(classifyReportPeriod(2026, 5, "2026-05-02")).toBe("current");
    expect(classifyReportPeriod(2026, 5, "2026-05-31")).toBe("current");
    expect(classifyReportPeriod(2026, 5, "2026-05-01")).toBe("current");
  });

  it("returns 'future' for any month after today", () => {
    expect(classifyReportPeriod(2026, 6, "2026-05-02")).toBe("future");
    expect(classifyReportPeriod(2027, 1, "2026-05-02")).toBe("future");
    expect(classifyReportPeriod(2026, 12, "2026-05-02")).toBe("future");
  });
});
