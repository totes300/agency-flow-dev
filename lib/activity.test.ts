import { describe, expect, it } from "vitest"
import { formatActivityText, getActivityIcon, type ActivityEventType } from "./activity"

// ─── formatActivityText ─────────────────────────────────────────────────────────

describe("formatActivityText", () => {
  it("formats task_created", () => {
    const result = formatActivityText("task_created", "Adam", {})
    expect(result.text).toBe("Adam created this task")
    expect(result.highlight).toBeUndefined()
  })

  it("formats status_changed with highlight", () => {
    const result = formatActivityText("status_changed", "Adam", { from: "Backlog", to: "In Progress" })
    expect(result.text).toBe("Adam changed status to")
    expect(result.highlight).toBe("In Progress")
  })

  it("formats assignee_added", () => {
    const result = formatActivityText("assignee_added", "Adam", { userId: "u1", userName: "Emma" })
    expect(result.text).toBe("Adam assigned")
    expect(result.highlight).toBe("Emma")
  })

  it("formats assignee_removed", () => {
    const result = formatActivityText("assignee_removed", "Adam", { userId: "u1", userName: "Emma" })
    expect(result.text).toBe("Adam unassigned")
    expect(result.highlight).toBe("Emma")
  })

  it("formats category_changed", () => {
    const result = formatActivityText("category_changed", "Emma", { from: "Design", to: "Dev" })
    expect(result.text).toBe("Emma changed category to")
    expect(result.highlight).toBe("Dev")
  })

  it("formats due_date_changed with date", () => {
    const result = formatActivityText("due_date_changed", "Adam", { from: null, to: "2026-03-22" })
    expect(result.text).toBe("Adam set due date to")
    expect(result.highlight).toBe("Mar 22")
  })

  it("formats due_date_changed removal", () => {
    const result = formatActivityText("due_date_changed", "Adam", { from: "Mar 22", to: null })
    expect(result.text).toBe("Adam removed the due date")
    expect(result.highlight).toBeUndefined()
  })

  it("formats project_changed with project name", () => {
    const result = formatActivityText("project_changed", "Emma", { from: "Old Project", to: "Brand Refresh" })
    expect(result.text).toBe("Emma moved to project")
    expect(result.highlight).toBe("Brand Refresh")
  })

  it("formats project_changed removal", () => {
    const result = formatActivityText("project_changed", "Emma", { from: "Brand Refresh", to: null })
    expect(result.text).toBe("Emma removed from project")
  })

  it("formats subtask_created", () => {
    const result = formatActivityText("subtask_created", "Adam", { subtaskId: "s1", title: "Design mockups" })
    expect(result.text).toBe("Adam created subtask")
    expect(result.highlight).toBe("Design mockups")
  })

  it("formats subtask_completed", () => {
    const result = formatActivityText("subtask_completed", "Adam", { subtaskId: "s1", title: "Design mockups" })
    expect(result.text).toBe("Adam completed")
    expect(result.highlight).toBe("Design mockups")
  })

  it("formats subtask_deleted", () => {
    const result = formatActivityText("subtask_deleted", "Adam", { subtaskId: "s1", title: "Design mockups" })
    expect(result.text).toBe("Adam deleted subtask")
    expect(result.highlight).toBe("Design mockups")
  })

  it("formats time_entry_logged", () => {
    const result = formatActivityText("time_entry_logged", "Emma", { entryId: "e1", duration: "4:00", note: "API work" })
    expect(result.text).toBe("Emma logged")
    expect(result.highlight).toBe("4:00")
  })

  it("formats time_entry_edited", () => {
    const result = formatActivityText("time_entry_edited", "Emma", { entryId: "e1", oldDuration: "2:00", newDuration: "4:00" })
    expect(result.text).toBe("Emma edited time entry")
    expect(result.highlight).toBe("2:00 → 4:00")
  })

  it("formats time_entry_deleted", () => {
    const result = formatActivityText("time_entry_deleted", "Emma", { entryId: "e1", duration: "2:00" })
    expect(result.text).toBe("Emma deleted time entry")
    expect(result.highlight).toBe("2:00")
  })

  it("formats billable_changed to billable", () => {
    const result = formatActivityText("billable_changed", "Adam", { from: false, to: true })
    expect(result.text).toBe("Adam marked as")
    expect(result.highlight).toBe("Billable")
  })

  it("formats billable_changed to non-billable", () => {
    const result = formatActivityText("billable_changed", "Adam", { from: true, to: false })
    expect(result.text).toBe("Adam marked as")
    expect(result.highlight).toBe("Non-billable")
  })

  it("formats comment_added", () => {
    const result = formatActivityText("comment_added", "Adam", { commentId: "c1" })
    expect(result.text).toBe("Adam commented")
  })

  it("handles unknown event type gracefully", () => {
    const result = formatActivityText("unknown_event" as ActivityEventType, "Adam", {})
    expect(result.text).toBe("Adam updated the task")
  })
})

// ─── getActivityIcon ────────────────────────────────────────────────────────────

describe("getActivityIcon", () => {
  it("returns 'status' for status_changed", () => {
    expect(getActivityIcon("status_changed")).toBe("status")
  })

  it("returns 'user' for assignee events", () => {
    expect(getActivityIcon("assignee_added")).toBe("user")
    expect(getActivityIcon("assignee_removed")).toBe("user")
  })

  it("returns 'check' for subtask events", () => {
    expect(getActivityIcon("subtask_created")).toBe("check")
    expect(getActivityIcon("subtask_completed")).toBe("check")
    expect(getActivityIcon("subtask_deleted")).toBe("check")
  })

  it("returns 'time' for time entry events", () => {
    expect(getActivityIcon("time_entry_logged")).toBe("time")
    expect(getActivityIcon("time_entry_edited")).toBe("time")
    expect(getActivityIcon("time_entry_deleted")).toBe("time")
  })

  it("returns 'comment' for comment_added", () => {
    expect(getActivityIcon("comment_added")).toBe("comment")
  })

  it("returns 'default' for task_created and others", () => {
    expect(getActivityIcon("task_created")).toBe("default")
    expect(getActivityIcon("category_changed")).toBe("default")
    expect(getActivityIcon("due_date_changed")).toBe("default")
    expect(getActivityIcon("project_changed")).toBe("default")
  })
})
