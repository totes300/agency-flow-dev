export type ActivityIndicatorEvent = {
  createdAt: number;
  type: string;
  userId: string;
};

export type ActivityIndicatorComment = {
  createdAt: number;
  userId: string;
};

export const UNSEEN_EVENT_TYPES = new Set([
  "status_changed",
  "assignee_added",
  "assignee_removed",
  "subtask_created",
  "subtask_completed",
  "due_date_changed",
  "category_changed",
  "project_changed",
]);

export function computeTaskIndicatorState(args: {
  events: ActivityIndicatorEvent[];
  comments: ActivityIndicatorComment[];
  currentUserId: string;
  lastSeenAt: number;
  lastViewedAt: number;
}) {
  const unseenEvents = args.events.filter(
    (event) =>
      event.createdAt > args.lastViewedAt && event.userId !== args.currentUserId,
  );

  const unreadCommentCount = args.comments.filter(
    (comment) =>
      comment.createdAt > args.lastSeenAt && comment.userId !== args.currentUserId,
  ).length;

  const hasUnseenNonComment = unseenEvents.some((event) =>
    UNSEEN_EVENT_TYPES.has(event.type),
  );

  const hasUnseenSubtasks = unseenEvents.some(
    (event) =>
      event.type === "subtask_created" || event.type === "subtask_completed",
  );

  const unseenEventCount = unseenEvents.filter((event) =>
    UNSEEN_EVENT_TYPES.has(event.type),
  ).length;

  return {
    hasUnseenNonComment,
    hasUnseenSubtasks,
    hasUnseenDescription: false,
    hasUnseenComments: unreadCommentCount > 0,
    hasUnseen: hasUnseenNonComment || unreadCommentCount > 0,
    unreadCommentCount,
    unseenActivityCount: unseenEventCount + unreadCommentCount,
  };
}
