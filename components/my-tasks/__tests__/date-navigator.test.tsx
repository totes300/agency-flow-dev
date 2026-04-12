import { describe, expect, it, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, within } from "@testing-library/react";
import { DateNavigator } from "../date-navigator";

afterEach(cleanup);

const TODAY = "2026-04-04";

function renderNav(props: Partial<React.ComponentProps<typeof DateNavigator>> = {}) {
  const result = render(
    <DateNavigator
      selectedDate={props.selectedDate ?? TODAY}
      today={TODAY}
      onDateChange={props.onDateChange ?? vi.fn()}
    />
  );
  const nav = within(result.container);
  return { ...result, nav };
}

describe("DateNavigator", () => {
  it("renders Today label when selectedDate is today", () => {
    const { nav } = renderNav();
    expect(nav.getByText(/Today, Apr 4/)).toBeInTheDocument();
  });

  it("renders weekday label when selectedDate is a past day", () => {
    const { nav } = renderNav({ selectedDate: "2026-04-02" });
    expect(nav.getByText(/Thu, Apr 2/)).toBeInTheDocument();
  });

  it("disables right arrow when on today", () => {
    const { nav } = renderNav();
    expect(nav.getByLabelText("Next day")).toBeDisabled();
  });

  it("enables right arrow when on a past day", () => {
    const { nav } = renderNav({ selectedDate: "2026-04-03" });
    expect(nav.getByLabelText("Next day")).not.toBeDisabled();
  });

  it("calls onDateChange with previous day when left arrow clicked", () => {
    const onChange = vi.fn();
    const { nav } = renderNav({ onDateChange: onChange });
    fireEvent.click(nav.getByLabelText("Previous day"));
    expect(onChange).toHaveBeenCalledWith("2026-04-03");
  });

  it("calls onDateChange with next day when right arrow clicked", () => {
    const onChange = vi.fn();
    const { nav } = renderNav({ selectedDate: "2026-04-03", onDateChange: onChange });
    fireEvent.click(nav.getByLabelText("Next day"));
    expect(onChange).toHaveBeenCalledWith("2026-04-04");
  });

  it("does NOT call onDateChange when right arrow clicked on today", () => {
    const onChange = vi.fn();
    const { nav } = renderNav({ onDateChange: onChange });
    fireEvent.click(nav.getByLabelText("Next day"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("handles keyboard ArrowLeft", () => {
    const onChange = vi.fn();
    const { nav } = renderNav({ onDateChange: onChange });
    fireEvent.keyDown(nav.getByRole("navigation"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("2026-04-03");
  });

  it("handles keyboard ArrowRight", () => {
    const onChange = vi.fn();
    const { nav } = renderNav({ selectedDate: "2026-04-03", onDateChange: onChange });
    fireEvent.keyDown(nav.getByRole("navigation"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("2026-04-04");
  });
});
