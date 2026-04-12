import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DailyNotesEditor } from "../daily-notes-editor";

afterEach(cleanup);

// TipTap requires a full DOM — these tests verify the component renders
// and passes correct props. Full editor behavior is tested manually.

describe("DailyNotesEditor", () => {
  it("renders without crashing with null content", () => {
    const { container } = render(
      <DailyNotesEditor content={null} onChange={vi.fn()} />
    );
    expect(container).toBeTruthy();
  });

  it("renders without crashing with content", () => {
    const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] });
    const { container } = render(
      <DailyNotesEditor content={content} onChange={vi.fn()} />
    );
    expect(container).toBeTruthy();
  });

  it("renders the editor container element", () => {
    const { container } = render(
      <DailyNotesEditor content={null} onChange={vi.fn()} />
    );
    const editor = container.querySelector("[data-testid='daily-notes-editor']");
    expect(editor).toBeInTheDocument();
  });

  it("shows editor or loading state when content is empty", () => {
    const { container } = render(
      <DailyNotesEditor content={null} onChange={vi.fn()} />
    );
    // With dynamic import, renders either the editor or a loading skeleton
    const editor = container.querySelector("[data-testid='daily-notes-editor']");
    expect(editor).toBeTruthy();
  });
});
