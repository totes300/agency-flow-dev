import { expect } from "vitest";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "../../_generated/dataModel";
import { TASK_CATEGORIES, isClosedCategory, isValidIdentifierKey, parseIdentifier } from "../../tasks/model";

/**
 * Shared checks for the seed (`devSeedTasks`) tests: one org's task data as
 * rows and the §4 invariants every org must satisfy.
 */

export type Snapshot = {
  statuses: Doc<"statuses">[];
  tasks: Doc<"tasks">[];
  projects: Doc<"projects">[];
  settings: Doc<"orgSettings">;
  labels: Doc<"labels">[];
  assigneeEdges: Doc<"taskAssignees">[];
  labelEdges: Doc<"taskLabels">[];
};

export async function snapshotOrg(db: GenericDatabaseReader<DataModel>, orgId: string): Promise<Snapshot> {
  return {
    statuses: await db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    tasks: await db.query("tasks").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    projects: await db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    settings: (await db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).unique())!,
    labels: await db.query("labels").withIndex("by_orgId_position", (q) => q.eq("orgId", orgId)).collect(),
    assigneeEdges: (await db.query("taskAssignees").collect()).filter((e) => e.orgId === orgId),
    labelEdges: (await db.query("taskLabels").collect()).filter((e) => e.orgId === orgId),
  };
}

/** The invariants every seeded org must satisfy (§4.1, §4.2, T3–T6). */
export function expectInvariants(s: Snapshot) {
  for (const category of TASK_CATEGORIES) {
    const active = s.statuses.filter((x) => x.category === category && !x.archivedAt);
    expect(active.length, category).toBeGreaterThan(0);
    expect(active.filter((x) => x.isDefault).length, category).toBe(1);
    const positions = active.map((x) => x.position);
    expect(new Set(positions).size, category).toBe(positions.length);
  }

  // The org key is set lazily (first org-level task), so it may be absent.
  const keys = [...(s.settings.taskKey ? [s.settings.taskKey] : []), ...s.projects.map((p) => p.code)];
  for (const key of keys) expect(isValidIdentifierKey(key), key).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);

  const statusById = new Map(s.statuses.map((x) => [x._id, x]));
  const projectById = new Map(s.projects.map((p) => [p._id, p]));
  const identifiers = new Set<string>();
  const numbersByScope = new Map<string, number[]>();

  for (const task of s.tasks) {
    const label = task.title;
    expect(task.identifier, label).toBeDefined();
    const identifier = task.identifier!;
    expect(identifiers.has(identifier), `duplicate ${identifier}`).toBe(false);
    identifiers.add(identifier);
    const parsed = parseIdentifier(identifier)!;
    expect(parsed.number, label).toBe(task.number);
    if (task.projectId) {
      expect(task.numberScope, label).toEqual({ kind: "project", projectId: task.projectId });
      expect(parsed.key, label).toBe(projectById.get(task.projectId)!.code);
      expect(task.clientId, label).toBe(projectById.get(task.projectId)!.clientId);
    } else {
      expect(task.numberScope, label).toEqual({ kind: "org" });
      expect(parsed.key, label).toBe(s.settings.taskKey);
      expect(task.clientId, label).toBeUndefined();
    }
    const scopeKey = task.projectId ?? "org";
    numbersByScope.set(scopeKey, [...(numbersByScope.get(scopeKey) ?? []), task.number!]);

    // T3 + T4.
    const status = statusById.get(task.statusId)!;
    expect(task.statusCategory, label).toBe(status.category);
    expect(task.completedAt !== undefined, label).toBe(isClosedCategory(status.category!));

    // T6: caches == edges.
    const userEdges = s.assigneeEdges.filter((e) => e.taskId === task._id).map((e) => e.userId);
    expect([...userEdges].sort(), label).toEqual([...task.assigneeIds].sort());
    expect(new Set(userEdges).size, label).toBe(userEdges.length);
    const labelEdges = s.labelEdges.filter((e) => e.taskId === task._id).map((e) => e.labelId);
    expect([...labelEdges].sort(), label).toEqual([...(task.labelIds ?? [])].sort());
  }

  // Numbers are unique per scope; counters point past the highest.
  for (const [scopeKey, numbers] of numbersByScope) {
    expect(new Set(numbers).size, scopeKey).toBe(numbers.length);
    const next =
      scopeKey === "org"
        ? s.settings.nextTaskNumber
        : projectById.get(scopeKey as Id<"projects">)!.nextTaskNumber;
    expect(next, scopeKey).toBe(Math.max(...numbers) + 1);
  }

  const taskIds = new Set(s.tasks.map((x) => x._id));
  for (const e of [...s.assigneeEdges, ...s.labelEdges]) expect(taskIds.has(e.taskId)).toBe(true);
}
