import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DailyNotesPanel } from "../daily-notes-panel";

afterEach(cleanup);

// Mock the editor component to avoid TipTap complexity in panel tests
vi.mock("../daily-notes-editor", () => ({
  DailyNotesEditor: ({ content, onChange }: { content: unknown; onChange: (json: string) => void }) => (
    <div data-testid="mock-editor" onClick={() => onChange('{"type":"doc"}')}>
      {content ? "has-content" : "empty"}
    </div>
  ),
}));

const TODAY = "2026-04-04";

const defaultProps = {
  today: TODAY,
  content: null as string | null,
  onContentChange: vi.fn(),
  saveStatus: "idle" as const,
};

// Mock localStorage for jsdom environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

describe("DailyNotesPanel", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('renders "Daily Notes" header', () => {
    render(<DailyNotesPanel {...defaultProps} />);
    expect(screen.getByText("Daily Notes")).toBeInTheDocument();
  });

  it("renders DateNavigator", () => {
    render(<DailyNotesPanel {...defaultProps} />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("has collapse button with accessible label", () => {
    render(<DailyNotesPanel {...defaultProps} />);
    const btn = screen.getByLabelText("Collapse notes panel");
    expect(btn).toBeInTheDocument();
  });

  it("hides editor when collapse button is clicked", () => {
    render(<DailyNotesPanel {...defaultProps} />);
    const btn = screen.getByLabelText("Collapse notes panel");
    fireEvent.click(btn);
    expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
  });

  it("restores editor when collapse button is clicked again", () => {
    render(<DailyNotesPanel {...defaultProps} />);
    const btn = screen.getByLabelText("Collapse notes panel");
    fireEvent.click(btn); // collapse
    fireEvent.click(screen.getByLabelText("Expand notes panel")); // expand
    expect(screen.getByTestId("mock-editor")).toBeInTheDocument();
  });

  it("reads collapse state from localStorage on mount", () => {
    localStorage.setItem("daily-notes-panel-open", "false");
    render(<DailyNotesPanel {...defaultProps} />);
    expect(screen.queryByTestId("mock-editor")).not.toBeInTheDocument();
  });

  it("writes collapse state to localStorage on toggle", () => {
    render(<DailyNotesPanel {...defaultProps} />);
    const btn = screen.getByLabelText("Collapse notes panel");
    fireEvent.click(btn);
    expect(localStorage.getItem("daily-notes-panel-open")).toBe("false");
  });

  it("shows 'Saving...' when saveStatus is saving", () => {
    render(<DailyNotesPanel {...defaultProps} saveStatus="saving" />);
    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("shows 'Saved' when saveStatus is saved", () => {
    render(<DailyNotesPanel {...defaultProps} saveStatus="saved" />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("shows 'Failed to save' when saveStatus is error", () => {
    render(<DailyNotesPanel {...defaultProps} saveStatus="error" />);
    expect(screen.getByText("Failed to save")).toBeInTheDocument();
  });
});
