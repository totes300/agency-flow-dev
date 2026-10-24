import { describe, it, expect } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import {
  formatTimestamp,
  renderClientSection,
  renderCommentSection,
  renderMe,
  renderMemberSection,
  renderProjectSection,
  renderRecord,
  renderRefError,
  renderTaskRecord,
  renderTaskSection,
  renderTimeEntrySection,
  renderWorkspace,
  type FetchedRecord,
  type TaskRecord,
  type WorkspaceData,
} from "../render";
import { appOriginOf, clientLink, memberLink, projectLink, taskLink } from "../links";

const WORKSPACE: WorkspaceData = {
  orgTaskKey: "KON",
  statuses: [
    { name: "Backlog", category: "backlog", isDefault: true, archived: false },
    { name: "Old", category: "backlog", isDefault: false, archived: true },
    { name: "Todo", category: "unstarted", isDefault: true, archived: false },
    { name: "In progress", category: "started", isDefault: false, archived: false },
    { name: "Done", category: "completed", isDefault: true, archived: false },
  ],
  labels: [
    { name: "Bug", archived: false },
    { name: "Feature, request", archived: false },
  ],
  workCategories: [{ name: "Design", archived: false }],
  members: [
    { name: "Ada Admin", email: "ada@x.test", role: "admin" },
    { name: "Mel Member", email: null, role: "member" },
  ],
  projects: [
    { code: "ARLO", name: "Arlo website", client: "Arlo", archived: false },
    { code: "OLD", name: "Old", client: "Arlo", archived: true },
  ],
  clients: [
    { id: "k1" as Id<"clients">, name: "Arlo", prefix: "ARL", archived: false },
    { id: "k2" as Id<"clients">, name: "No Prefix Ltd", prefix: null, archived: false },
  ],
};

describe("renderMe", () => {
  it("renders user, org and role", () => {
    expect(
      renderMe({
        user: { name: "Ada Admin", email: "ada@x.test" },
        org: { id: "org_1", name: "Konverted" },
        role: "admin",
      }),
    ).toBe("## Me\n- User: Ada Admin <ada@x.test>\n- Org: Konverted (org_1)\n- Role: admin");
  });

  it("falls back to the org id and a bare name", () => {
    expect(
      renderMe({ user: { name: "Mel", email: null }, org: { id: "org_1", name: null }, role: "member" }),
    ).toBe("## Me\n- User: Mel\n- Org: org_1\n- Role: member");
  });
});

describe("renderWorkspace", () => {
  it("renders the compact reference sheet, one value per line", () => {
    expect(renderWorkspace(WORKSPACE)).toBe(
      [
        "## Workspace",
        "Task key for tasks without a project: KON",
        "### Statuses (name · category) (+1 archived)\n- Backlog · backlog · default\n- Todo · unstarted · default\n- In progress · started\n- Done · completed · default",
        "### Labels\n- Bug\n- Feature, request",
        "### Work categories\n- Design",
        "### Members (name · email · role)\n- Ada Admin · ada@x.test · admin\n- Mel Member · no email · member",
        "### Projects (code · name · client) (+1 archived)\n- ARLO · Arlo website · Arlo",
        "### Clients (prefix or id · name)\n- ARL · Arlo\n- k2 · No Prefix Ltd",
      ].join("\n\n"),
    );
  });

  it("keeps names with commas or newlines unambiguous", () => {
    const text = renderWorkspace({
      ...WORKSPACE,
      labels: [{ name: "Bug, urgent\nnow", archived: false }, { name: "Later", archived: false }],
    });
    expect(text).toContain("### Labels\n- Bug, urgent now\n- Later");
  });

  it("marks empty sections", () => {
    const text = renderWorkspace({ ...WORKSPACE, labels: [] });
    expect(text).toContain("### Labels\nnone");
  });
});

// ─── Slice 2: records, search rows and deep links ────────────────────────────

const ORIGIN = "https://localhost:3001";
const CTX = { appOrigin: ORIGIN, timezone: "Europe/Budapest" };
// 2026-10-24 12:00 UTC = 14:00 in Budapest (CEST).
const AT = Date.UTC(2026, 9, 24, 12);

const TASK: TaskRecord = {
  type: "task",
  id: "t1" as Id<"tasks">,
  identifier: "ARLO-21",
  title: "Fix hero\nsection",
  status: "In progress",
  statusCategory: "started",
  priority: "High",
  project: { id: "p1" as Id<"projects">, code: "ARLO", name: "Arlow site" },
  client: { id: "c1" as Id<"clients">, name: "Arlow", prefix: "ARL" },
  assignees: ["Alice", "Bob"],
  labels: ["Launch"],
  workCategory: "Design",
  startDate: null,
  dueDate: "2026-10-20",
  overdue: true,
  estimateMinutes: 90,
  trackedMinutes: 120,
  billable: true,
  archived: false,
  parent: null,
  createdAt: AT,
  lastActivityAt: AT,
  commentCount: 1,
  subtaskCount: 1,
  subtaskDoneCount: 0,
  description: { text: "## Brief\n\nRebuild the **hero**", truncated: true },
  subtasks: {
    rows: [{ identifier: "ARLO-22", title: "Copy", status: "Next up", statusCategory: "unstarted", assignees: [] }],
    truncated: false,
  },
  comments: {
    rows: [
      {
        id: "cm1" as Id<"comments">,
        author: "Carol",
        createdAt: AT,
        edited: true,
        replyTo: null,
        resolved: false,
        text: "Line one\nLine two",
        textTruncated: false,
      },
    ],
    total: 40,
    truncated: false,
  },
  activity: {
    rows: [
      {
        type: "status_changed",
        userName: "Alice",
        metadata: { from: "Next up", to: "In progress" },
        createdAt: AT,
      },
    ],
    total: 1,
    truncated: false,
  },
  time: {
    rows: [
      {
        id: "e1" as Id<"timeEntries">,
        date: "2026-10-20",
        minutes: 90,
        member: "Alice",
        note: "Hero layout",
        noteTruncated: false,
        billable: true,
        task: { identifier: "ARLO-21", title: "Fix hero" },
      },
    ],
    total: 1,
    totalMinutes: 90,
    ownOnly: true,
    truncated: false,
  },
  files: {
    rows: [{ name: "brief.pdf", size: 2048, mimeType: "application/pdf", url: "https://files.test/brief", onComment: true }],
    truncated: false,
  },
  attachmentText: { available: false },
};

describe("deep links", () => {
  it("builds every entity's app link on the resource URL's origin", () => {
    expect(appOriginOf("https://localhost:3001/mcp")).toBe(ORIGIN);
    expect(taskLink(ORIGIN, "ARLO-21")).toBe("https://localhost:3001/tasks/ARLO-21");
    expect(taskLink(ORIGIN, "ARLO-21", "cm1")).toBe("https://localhost:3001/tasks/ARLO-21?comment=cm1");
    expect(projectLink(ORIGIN, "p1")).toBe("https://localhost:3001/projects/p1");
    expect(clientLink(ORIGIN, "c1")).toBe("https://localhost:3001/clients/c1");
    expect(memberLink(ORIGIN, "u1")).toBe("https://localhost:3001/my-tasks?user=u1");
  });
});

describe("renderTaskRecord", () => {
  it("renders heading, fields, the markdown body and every included section", () => {
    expect(renderTaskRecord(TASK, CTX)).toBe(
      [
        [
          "## ARLO-21 · Fix hero section",
          "- Link: https://localhost:3001/tasks/ARLO-21",
          "- Status: In progress (started)",
          "- Priority: High",
          "- Project: ARLO · Arlow site",
          "- Client: ARL · Arlow",
          "- Assignees: Alice, Bob",
          "- Labels: Launch",
          "- Work category: Design",
          "- Due: 2026-10-20 (overdue)",
          "- Estimate: 1h 30m · Tracked: 2h",
          "- Billable: yes",
          "- Sub-tasks: 0/1 done",
          "- Comments: 1",
          "- Created: 2026-10-24 14:00 · Last activity: 2026-10-24 14:00",
        ].join("\n"),
        "### Description\n## Brief\n\nRebuild the **hero**\n\n(Description cut short here. Open the link for the full text.)",
        "### Sub-tasks (1)\n- [ARLO-22](https://localhost:3001/tasks/ARLO-22) · Copy · Next up · unassigned",
        "### Comments (latest 1 of 40)\n- 2026-10-24 14:00 · Carol · edited\n  Line one\n  Line two",
        "### Activity (1)\n- 2026-10-24 14:00 · Alice changed status Next up → In progress",
        "### Time (your entries only; members see their own time)\nTotal: 1h 30m over 1 entry\n- e1 · 2026-10-20 · 1h 30m · Alice · \"Hero layout\" · billable",
        "### Files (1)\n- [brief.pdf](https://files.test/brief) · 2.0 KB · application/pdf · on a comment",
        "### Attachment text\nNot available: Agency Flow does not extract text from attachments yet. Use the file links above.",
      ].join("\n\n"),
    );
  });

  it("leaves out sections that were not included", () => {
    const text = renderTaskRecord(
      { ...TASK, subtasks: null, comments: null, activity: null, time: null, files: null, attachmentText: null, description: null },
      CTX,
    );
    expect(text).not.toContain("###");
    expect(text).toContain("- Link: https://localhost:3001/tasks/ARLO-21");
  });
});

describe("renderRecord (other kinds) and ref errors", () => {
  it("every record carries its app link", () => {
    const records: FetchedRecord[] = [
      {
        type: "project",
        id: "p1" as Id<"projects">,
        code: "ARLO",
        name: "Arlow site",
        client: { id: "c1" as Id<"clients">, name: "Arlow", prefix: null },
        archived: false,
      },
      {
        type: "client",
        id: "c1" as Id<"clients">,
        name: "Arlow",
        prefix: "ARL",
        archived: false,
        projects: [{ id: "p1" as Id<"projects">, code: "ARLO", name: "Arlow site", archived: true }],
        projectsTruncated: false,
      },
      { type: "member", id: "u1" as Id<"users">, name: "Ada", email: "ada@x.test", role: "admin" },
      {
        type: "comment",
        id: "cm1" as Id<"comments">,
        task: { identifier: "ARLO-21", title: "Fix hero" },
        author: "Carol",
        createdAt: AT,
        edited: false,
        resolved: true,
        isReply: false,
        text: "Done",
        textTruncated: false,
      },
      {
        type: "time_entry",
        id: "e1" as Id<"timeEntries">,
        date: "2026-10-20",
        minutes: 45,
        member: "Alice",
        note: null,
        noteTruncated: false,
        billable: false,
        task: { identifier: "ARLO-21", title: "Fix hero" },
        project: { id: "p1" as Id<"projects">, code: "ARLO", name: "Arlow site" },
      },
    ];
    const [project, client, member, comment, entry] = records.map((r) => renderRecord(r, CTX));
    expect(project).toBe(
      "## Project ARLO · Arlow site\n- Link: https://localhost:3001/projects/p1\n- Code: ARLO (task keys ARLO-N)\n- Client: Arlow\n- Archived: no",
    );
    expect(client).toBe(
      "## Client ARL · Arlow\n- Link: https://localhost:3001/clients/c1\n- Prefix: ARL\n- Archived: no\n\n### Projects (1)\n- [ARLO](https://localhost:3001/projects/p1) · Arlow site · archived",
    );
    expect(member).toBe(
      "## Member Ada\n- Link: https://localhost:3001/my-tasks?user=u1\n- Email: ada@x.test\n- Role: admin\n- Ref: ada@x.test",
    );
    expect(comment).toBe(
      "## Comment on ARLO-21 · Fix hero\n- Link: https://localhost:3001/tasks/ARLO-21?comment=cm1\n- Ref: cm1\n- Author: Carol\n- Written: 2026-10-24 14:00\n- Resolved: yes\n\nDone",
    );
    expect(entry).toBe(
      "## Time entry e1\n- Link: https://localhost:3001/tasks/ARLO-21 (the entry's task)\n- Date: 2026-10-20\n- Duration: 45m\n- Member: Alice\n- Task: ARLO-21 · Fix hero\n- Project: ARLO · Arlow site\n- Billable: no",
    );
  });

  it("lists ambiguity candidates with refs and links", () => {
    expect(
      renderRefError(
        "arlo",
        '"arlo" is ambiguous: it matches project ARLO · Arlow site (ref p1); client ARLO · Arlow (ref c1). Use one of these refs.',
        [
          { type: "project", id: "p1", key: "ARLO", name: "Arlow site" },
          { type: "client", id: "c1", key: "ARLO", name: "Arlow" },
        ],
        CTX,
      ),
    ).toBe(
      [
        'Error fetching "arlo": "arlo" is ambiguous: it matches project ARLO · Arlow site (ref p1); client ARLO · Arlow (ref c1). Use one of these refs.',
        "- project · ARLO · Arlow site · ref p1 · https://localhost:3001/projects/p1",
        "- client · ARLO · Arlow · ref c1 · https://localhost:3001/clients/c1",
      ].join("\n"),
    );
  });
});

describe("search sections", () => {
  const page = { total: 1, offset: 0, incomplete: false, notes: [] as string[] };

  it("one line per row with ref, title, key fields and link", () => {
    expect(
      renderProjectSection(
        { ...page, rows: [{ id: "p1" as Id<"projects">, code: "ARLO", name: "Arlow site", client: { name: "Arlow", prefix: "ARL" }, archived: false }] },
        CTX,
      ),
    ).toBe("### Projects · 1–1 of 1\n- [ARLO](https://localhost:3001/projects/p1) · Arlow site · client ARL · Arlow");
    expect(
      renderClientSection({ ...page, rows: [{ id: "c9" as Id<"clients">, name: "No Prefix", prefix: null, archived: true }] }, CTX),
    ).toBe("### Clients · 1–1 of 1\n- [c9](https://localhost:3001/clients/c9) · No Prefix · archived");
    expect(
      renderMemberSection({ ...page, rows: [{ id: "u1" as Id<"users">, name: "Ada", email: "ada@x.test", role: "admin" }] }, CTX),
    ).toBe("### Members · 1–1 of 1\n- [ada@x.test](https://localhost:3001/my-tasks?user=u1) · Ada · admin");
    expect(
      renderCommentSection(
        {
          ...page,
          timezone: "UTC",
          rows: [
            {
              id: "cm1" as Id<"comments">,
              task: { identifier: "ARLO-21", title: "Fix hero" },
              author: "Carol",
              createdAt: AT,
              text: "Looks good",
              textTruncated: true,
            },
          ],
        },
        CTX,
      ),
    ).toBe(
      '### Comments · 1–1 of 1\n- [cm1](https://localhost:3001/tasks/ARLO-21?comment=cm1) · on ARLO-21 Fix hero · Carol · 2026-10-24 12:00 · "Looks good…"',
    );
  });

  it("time entries carry the total of every match; incomplete and empty states are explicit", () => {
    const row = TASK.time!.rows[0];
    expect(renderTimeEntrySection({ ...page, total: 3, rows: [row], totalMinutes: 150, incomplete: true }, CTX)).toBe(
      [
        "### Time entries · 1–1 of at least 3",
        "Total of all 3 matching entries: at least 2h 30m",
        "Incomplete: the search reads a bounded number of records and more may match than are listed. Narrow it with filters (project, assignee, status, a date range) for a complete list.",
        '- e1 · 2026-10-20 · 1h 30m · Alice · [ARLO-21](https://localhost:3001/tasks/ARLO-21) Fix hero · "Hero layout" · billable',
      ].join("\n"),
    );
    expect(renderTaskSection({ ...page, total: 0, rows: [], today: "2026-10-24" }, CTX)).toBe("### Tasks · no matches");
  });

  it("formats timestamps in the org's timezone", () => {
    expect(formatTimestamp(AT, "Europe/Budapest")).toBe("2026-10-24 14:00");
    expect(formatTimestamp(AT)).toBe("2026-10-24 12:00");
  });
});
