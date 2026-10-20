import assert from "node:assert/strict";
import test from "node:test";
import { createReturnLikeState, processReturnLikes } from "../src/rngdle-likes.js";

const now = new Date("2026-10-18T12:00:00Z");
const config = {
  rngdle: { baseUrl: "https://www.rngdle.com" },
  likes: { enabled: true, pollMinutes: 10, maxPerDay: 10, lookbackDays: 7 },
};

function notification(id, displayName, createdAt = "2026-10-18T11:55:00.000Z", type = "heart_received") {
  return {
    id,
    type,
    createdAt,
    referenceId: `activity-${id}`,
    actor: { id: `actor-${displayName}`, displayName },
  };
}

function readyState(overrides = {}) {
  return {
    ...createReturnLikeState(new Date("2026-10-18T10:00:00Z")),
    lastCheckedAt: "2026-10-18T11:50:00.000Z",
    baselineCompleted: true,
    ...overrides,
  };
}

function dependencies(notifications, overrides = {}) {
  const calls = { hearts: [], toggles: [] };
  return {
    calls,
    now,
    session: {},
    getNotifications: async () => ({ notifications, unreadCount: notifications.length }),
    getViewer: async () => ({ id: "viewer-id", displayName: "player" }),
    getLatestRoll: async () => ({
      activityId: "friend-activity",
      number: 123456,
      rolledAt: "2026-10-18T00:00:00.000Z",
    }),
    getHeartIds: async (_session, activityId) => {
      calls.hearts.push(activityId);
      return new Set();
    },
    toggleHeart: async (_session, _config, activityId, displayName) => {
      calls.toggles.push({ activityId, displayName });
      return { hearted: true, heartCount: 1 };
    },
    ...overrides,
  };
}

test("the first return-like check records a baseline without liking historical notifications", async () => {
  const state = createReturnLikeState(now);
  const deps = dependencies([notification("old-1", "friend"), notification("old-2", "other")]);
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.baseline, true);
  assert.equal(result.liked, 0);
  assert.deepEqual(state.processedIds.sort(), ["old-1", "old-2"]);
  assert.equal(state.baselineCompleted, true);
  assert.equal(deps.calls.toggles.length, 0);
});

test("a failed first check retries the baseline instead of treating history as new", async () => {
  const state = createReturnLikeState(now);
  const failing = dependencies([], {
    getNotifications: async () => { throw new Error("temporary inbox failure"); },
  });
  await assert.rejects(processReturnLikes(config, state, failing), /temporary inbox failure/);
  const deps = dependencies([notification("old-1", "friend")]);
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.baseline, true);
  assert.equal(state.baselineCompleted, true);
  assert.equal(deps.calls.toggles.length, 0);
});

test("a new heart notification returns one heart to the other user's latest roll", async () => {
  const state = readyState();
  const deps = dependencies([notification("new-1", "friend"), notification("friend-request", "friend", undefined, "friend_request")]);
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.liked, 1);
  assert.deepEqual(deps.calls.toggles, [{ activityId: "friend-activity", displayName: "friend" }]);
  assert.deepEqual(state.processedIds, ["new-1"]);
  assert.equal(state.actionsByDate["2026-10-18"], 1);
  assert.equal(state.lastActor, "friend");
});

test("multiple notifications from one user do not trigger duplicate hearts", async () => {
  const state = readyState();
  const deps = dependencies([notification("new-2", "friend"), notification("new-1", "friend")]);
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.liked, 1);
  assert.equal(deps.calls.toggles.length, 1);
  assert.deepEqual(state.processedIds.sort(), ["new-1", "new-2"]);
});

test("an already hearted roll is skipped and resolved without toggling it off", async () => {
  const state = readyState();
  const deps = dependencies([notification("new-1", "friend")], {
    getHeartIds: async () => new Set(["viewer-id"]),
  });
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.liked, 0);
  assert.equal(result.skipped, 1);
  assert.equal(deps.calls.toggles.length, 0);
  assert.equal(state.lastSkippedReason, "already_liked");
  assert.deepEqual(state.processedIds, ["new-1"]);
});

test("self likes and stale rolls are skipped", async () => {
  const state = readyState();
  const deps = dependencies([
    notification("self-1", "player"),
    notification("stale-1", "old_friend"),
  ], {
    getLatestRoll: async (_session, displayName) => displayName === "old_friend" ? {
      activityId: "old-activity", number: 4, rolledAt: "2026-09-01T00:00:00.000Z",
    } : { activityId: "self-activity", number: 5, rolledAt: "2026-10-18T00:00:00.000Z" },
  });
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.liked, 0);
  assert.equal(result.skipped, 2);
  assert.equal(deps.calls.toggles.length, 0);
  assert.deepEqual(state.processedIds.sort(), ["self-1", "stale-1"]);
});

test("the daily cap leaves excess notifications pending for a later check", async () => {
  const state = readyState({ actionsByDate: { "2026-10-18": 1 } });
  const limited = { ...config, likes: { ...config.likes, maxPerDay: 2 } };
  const deps = dependencies([notification("new-1", "first"), notification("new-2", "second")], {
    getLatestRoll: async (_session, displayName) => ({
      activityId: `${displayName}-activity`, number: 1, rolledAt: "2026-10-18T00:00:00.000Z",
    }),
  });
  const result = await processReturnLikes(limited, state, deps);
  assert.equal(result.limited, true);
  assert.equal(result.liked, 1);
  assert.deepEqual(state.processedIds, ["new-1"]);
});

test("invalid notification dates cannot trigger a return-like", async () => {
  const state = readyState();
  const deps = dependencies([notification("invalid-date", "friend", "invalid")]);
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.liked, 0);
  assert.equal(deps.calls.toggles.length, 0);
  assert.deepEqual(state.processedIds, []);
});

test("an unsupported saved state records one fresh baseline before processing new hearts", async () => {
  const state = readyState({ version: 0 });
  const deps = dependencies([notification("old-1", "friend")]);
  assert.equal((await processReturnLikes(config, state, deps)).baseline, true);
  assert.equal(state.version, 1);
  assert.equal((await processReturnLikes(config, state, deps)).baseline, false);
  assert.equal(deps.calls.toggles.length, 0);
});

test("a lost successful heart response is recovered without toggling the heart off", async () => {
  const state = readyState({ heartActionId: "cached", heartActionExpiresAt: "2026-10-18T13:00:00Z" });
  let hearted = false;
  let toggles = 0;
  const deps = dependencies([notification("new-1", "friend")], {
    getHeartIds: async () => new Set(hearted ? ["viewer-id"] : []),
    toggleHeart: async () => {
      toggles++;
      hearted = true;
      throw new Error("response lost");
    },
  });
  await processReturnLikes(config, state, deps);
  assert.deepEqual(state.processedIds, []);
  assert.equal(state.heartActionId, null);
  assert.equal(state.lastError, "response lost");
  const result = await processReturnLikes(config, state, deps);
  assert.equal(result.skipped, 1);
  assert.equal(toggles, 1);
  assert.equal(hearted, true);
  assert.deepEqual(state.processedIds, ["new-1"]);
});
