import { describe, expect, it } from "vitest";
import {
  computeTaskIndicatorState,
  type ActivityIndicatorComment,
  type ActivityIndicatorEvent,
} from "../taskActivityIndicators";

const USER_A = "user_a";
const USER_B = "user_b";
const USER_C = "user_c";

const T = {
  t1: 1000,
  t2: 2000,
  t3: 3000,
  t4: 4000,
  t5: 5000,
};

function event(
  type: string,
  userId: string,
  createdAt: number,
): ActivityIndicatorEvent {
  return { type, userId, createdAt };
}

function comment(userId: string, createdAt: number): ActivityIndicatorComment {
  return { userId, createdAt };
}

describe("computeTaskIndicatorState", () => {
  it("shows unseen only for the other assignees after one user updates a task", () => {
    const events = [event("description_changed", USER_A, T.t3)];

    expect(
      computeTaskIndicatorState({
        events,
        comments: [],
        currentUserId: USER_A,
        lastViewedAt: T.t2,
        lastSeenAt: T.t2,
      }).hasUnseen,
    ).toBe(false);

    expect(
      computeTaskIndicatorState({
        events,
        comments: [],
        currentUserId: USER_B,
        lastViewedAt: T.t2,
        lastSeenAt: T.t2,
      }).hasUnseen,
    ).toBe(true);

    expect(
      computeTaskIndicatorState({
        events,
        comments: [],
        currentUserId: USER_C,
        lastViewedAt: T.t2,
        lastSeenAt: T.t2,
      }).hasUnseen,
    ).toBe(true);
  });

  it("clears unseen only for the user who opened the task", () => {
    const events = [event("category_changed", USER_A, T.t3)];

    expect(
      computeTaskIndicatorState({
        events,
        comments: [],
        currentUserId: USER_B,
        lastViewedAt: T.t4,
        lastSeenAt: T.t4,
      }).hasUnseen,
    ).toBe(false);

    expect(
      computeTaskIndicatorState({
        events,
        comments: [],
        currentUserId: USER_C,
        lastViewedAt: T.t2,
        lastSeenAt: T.t2,
      }).hasUnseen,
    ).toBe(true);
  });

  it("keeps older other-user comments unread even if the latest comment is mine", () => {
    const state = computeTaskIndicatorState({
      events: [],
      comments: [
        comment(USER_B, T.t2),
        comment(USER_B, T.t3),
        comment(USER_A, T.t4),
      ],
      currentUserId: USER_A,
      lastViewedAt: T.t1,
      lastSeenAt: 0,
    });

    expect(state.unreadCommentCount).toBe(2);
    expect(state.hasUnseenComments).toBe(true);
    expect(state.hasUnseen).toBe(true);
  });

  it("marks comments seen for only the user whose lastSeenAt advanced", () => {
    expect(
      computeTaskIndicatorState({
        events: [],
        comments: [
          comment(USER_A, T.t2),
          comment(USER_B, T.t3),
          comment(USER_A, T.t4),
        ],
        currentUserId: USER_B,
        lastViewedAt: T.t1,
        lastSeenAt: T.t5,
      }).hasUnseen,
    ).toBe(false);

    const unopened = computeTaskIndicatorState({
      events: [],
      comments: [
        comment(USER_A, T.t2),
        comment(USER_B, T.t3),
        comment(USER_A, T.t4),
      ],
      currentUserId: USER_C,
      lastViewedAt: T.t1,
      lastSeenAt: T.t1,
    });

    expect(unopened.unreadCommentCount).toBe(3);
    expect(unopened.hasUnseen).toBe(true);
  });

  it("ignores activity by the current user when computing non-comment unseen", () => {
    const state = computeTaskIndicatorState({
      events: [
        event("description_changed", USER_A, T.t3),
        event("subtask_created", USER_A, T.t4),
      ],
      comments: [],
      currentUserId: USER_A,
      lastViewedAt: T.t2,
      lastSeenAt: T.t2,
    });

    expect(state.hasUnseenNonComment).toBe(false);
    expect(state.hasUnseenSubtasks).toBe(false);
    expect(state.hasUnseenDescription).toBe(false);
    expect(state.hasUnseen).toBe(false);
  });
});
