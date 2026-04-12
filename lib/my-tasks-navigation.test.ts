import { describe, expect, it } from "vitest";
import { navigation } from "@/lib/navigation";

describe("My Tasks navigation", () => {
  const workGroup = navigation.find((g) => g.label === "Work");

  it("includes My Tasks entry in Work group", () => {
    expect(workGroup).toBeDefined();
    const myTasks = workGroup!.items.find((i) => i.url === "/my-tasks");
    expect(myTasks).toBeDefined();
    expect(myTasks!.title).toBe("My Tasks");
  });

  it("My Tasks is above Tasks in sidebar order", () => {
    const myTasksIdx = workGroup!.items.findIndex((i) => i.url === "/my-tasks");
    const tasksIdx = workGroup!.items.findIndex((i) => i.url === "/tasks");
    expect(myTasksIdx).toBeLessThan(tasksIdx);
  });

  it("My Tasks is not admin-only (visible to everyone)", () => {
    const myTasks = workGroup!.items.find((i) => i.url === "/my-tasks");
    expect(myTasks!.adminOnly).toBeFalsy();
  });
});
