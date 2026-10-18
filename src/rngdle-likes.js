import { AuthenticationRequiredError, callServerAction, responseText } from "./rngdle-http.js";
import { clearServerActionCache, discoverServerAction } from "./rngdle-assets.js";
import { errorSummary, log } from "./logger.js";

const STATE_VERSION = 1;
const MAX_PROCESSED_IDS = 400;
const NOTIFICATION_LIMIT = 100;
const ACTION_CACHE_MS = 6 * 60 * 60 * 1000;

function iso(value = new Date()) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function authenticationRequired(response) {
  return response.status === 401 || response.status === 403;
}

async function jsonResponse(response, label) {
  if (authenticationRequired(response)) throw new AuthenticationRequiredError();
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return JSON.parse(await responseText(response));
}

export function createReturnLikeState(now = new Date()) {
  return {
    version: STATE_VERSION,
    initializedAt: iso(now),
    lastCheckedAt: null,
    processedIds: [],
    actionsByDate: {},
    baselineCount: 0,
    baselineCompleted: false,
    lastActionAt: null,
    lastActor: null,
    lastActivityId: null,
    heartActionId: null,
    heartActionExpiresAt: null,
    lastError: null,
  };
}

export function isReturnLikeState(value) {
  return value?.version === STATE_VERSION && typeof value.initializedAt === "string"
    && Array.isArray(value.processedIds) && value.actionsByDate && typeof value.actionsByDate === "object";
}

function utcDate(now) {
  return iso(now).slice(0, 10);
}

function pruneActions(actions, now) {
  const cutoff = new Date(Date.parse(utcDate(now)) - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const date of Object.keys(actions)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < cutoff) delete actions[date];
  }
}

export async function fetchSessionViewer(session) {
  const response = await session.request("/api/auth/get-session", { headers: { Accept: "application/json" } });
  if (authenticationRequired(response)) throw new AuthenticationRequiredError();
  if (!response.ok) throw new Error(`RNGdle session endpoint returned HTTP ${response.status}`);
  const payload = JSON.parse(await responseText(response));
  if (!payload?.user?.id || !payload.user.displayName) throw new AuthenticationRequiredError();
  return { id: String(payload.user.id), displayName: String(payload.user.displayName) };
}

export async function fetchNotifications(session, limit = NOTIFICATION_LIMIT) {
  const safeLimit = Math.max(1, Math.min(NOTIFICATION_LIMIT, Math.floor(Number(limit) || NOTIFICATION_LIMIT)));
  const response = await session.request(`/api/notifications?limit=${safeLimit}`, { headers: { Accept: "application/json" } });
  const payload = await jsonResponse(response, "RNGdle notifications endpoint");
  const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
  return {
    notifications: notifications.filter((item) => item && typeof item.id === "string" && typeof item.type === "string"),
    unreadCount: Number.isFinite(Number(payload?.unreadCount)) ? Number(payload.unreadCount) : 0,
  };
}

export async function fetchLatestUserRoll(session, displayName) {
  const response = await session.request(`/api/users/${encodeURIComponent(displayName)}/rolls?limit=1&offset=0`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  const payload = await jsonResponse(response, "RNGdle user rolls endpoint");
  const roll = Array.isArray(payload?.rolls) ? payload.rolls[0] : null;
  if (!roll) return null;
  if (typeof roll.activityId !== "string" || !roll.activityId || !Number.isFinite(Date.parse(roll.rolledAt))) return null;
  return {
    activityId: roll.activityId,
    number: Number.isFinite(Number(roll.number)) ? Number(roll.number) : null,
    rolledAt: new Date(roll.rolledAt).toISOString(),
  };
}

export async function fetchActivityHeartIds(session, activityId) {
  const response = await session.request(`/api/activity/${encodeURIComponent(activityId)}/hearts`, {
    headers: { Accept: "application/json" },
  });
  const payload = await jsonResponse(response, "RNGdle activity hearts endpoint");
  return new Set((Array.isArray(payload?.hearts) ? payload.hearts : [])
    .map((item) => item?.id)
    .filter((id) => typeof id === "string"));
}

export async function toggleHeart(session, config, activityId, displayName, cachedActionId = null) {
  const pagePath = `/u/${encodeURIComponent(displayName)}`;
  const actionId = cachedActionId ?? await discoverServerAction(session, config.rngdle.baseUrl, {
    pagePath,
    actionName: "toggleHeart",
  });
  try {
    const result = await callServerAction(session, actionId, [activityId], (value) => (
      value && typeof value.hearted === "boolean" && Number.isFinite(Number(value.heartCount))
    ));
    return { hearted: result.hearted, heartCount: Number(result.heartCount), actionId };
  } catch (error) {
    // A response may be lost after success, so the caller rechecks hearts before
    // another mutation. Clear action discovery here so a deployed action change
    // can still recover on the next poll.
    clearServerActionCache(config.rngdle.baseUrl, pagePath, "toggleHeart");
    throw error;
  }
}

function addProcessed(state, ids) {
  const current = new Set(Array.isArray(state.processedIds) ? state.processedIds : []);
  for (const id of ids) if (typeof id === "string") current.add(id);
  state.processedIds = [...current].slice(-MAX_PROCESSED_IDS);
}

function markGroup(state, group, reason) {
  addProcessed(state, group.notifications.map((item) => item.id));
  if (reason) state.lastSkippedReason = reason;
}

function groupNotifications(notifications, processed, initializedAt) {
  const groups = new Map();
  for (const notification of notifications) {
    if (notification.type !== "heart_received" || processed.has(notification.id)) continue;
    if (Date.parse(notification.createdAt) < Date.parse(initializedAt)) continue;
    const displayName = notification.actor?.displayName;
    if (typeof displayName !== "string" || !displayName) continue;
    if (!groups.has(displayName)) groups.set(displayName, { displayName, notifications: [] });
    groups.get(displayName).notifications.push(notification);
  }
  return [...groups.values()].sort((a, b) => {
    const aTime = Math.min(...a.notifications.map((item) => Date.parse(item.createdAt)));
    const bTime = Math.min(...b.notifications.map((item) => Date.parse(item.createdAt)));
    return aTime - bTime;
  });
}

export async function processReturnLikes(config, state, dependencies = {}) {
  const now = dependencies.now ?? new Date();
  const session = dependencies.session;
  const getViewer = dependencies.getViewer ?? fetchSessionViewer;
  const getNotifications = dependencies.getNotifications ?? fetchNotifications;
  const getLatestRoll = dependencies.getLatestRoll ?? fetchLatestUserRoll;
  const getHeartIds = dependencies.getHeartIds ?? fetchActivityHeartIds;
  const setHeart = dependencies.toggleHeart ?? toggleHeart;
  const initialized = !isReturnLikeState(state) || state.baselineCompleted !== true;

  state.initializedAt ??= iso(now);
  state.processedIds = Array.isArray(state.processedIds) ? state.processedIds : [];
  state.actionsByDate = state.actionsByDate && typeof state.actionsByDate === "object" ? state.actionsByDate : {};
  state.lastError = null;
  pruneActions(state.actionsByDate, now);

  try {
    const inbox = await getNotifications(session, NOTIFICATION_LIMIT);
    if (initialized) {
      addProcessed(state, inbox.notifications.map((item) => item.id));
      state.baselineCount = inbox.notifications.length;
      state.baselineCompleted = true;
      state.lastCheckedAt = iso(now);
      log("info", "Return-like baseline recorded", { notifications: state.baselineCount });
      return { baseline: true, liked: 0, skipped: 0, checked: state.baselineCount };
    }

    const viewer = await getViewer(session);
    const processed = new Set(state.processedIds);
    const groups = groupNotifications(inbox.notifications, processed, state.initializedAt);
    const today = utcDate(now);
    let liked = 0;
    let skipped = 0;
    let limited = false;

    for (const group of groups) {
      if (liked >= config.likes.maxPerDay || (state.actionsByDate[today] ?? 0) >= config.likes.maxPerDay) {
        limited = true;
        break;
      }
      if (group.displayName.toLowerCase() === viewer.displayName.toLowerCase()) {
        markGroup(state, group, "self");
        skipped++;
        continue;
      }

      let target;
      try {
        target = await getLatestRoll(session, group.displayName);
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) throw error;
        state.lastError = errorSummary(error);
        state.lastSkippedReason = "roll_lookup_failed";
        break;
      }
      if (!target) {
        markGroup(state, group, "no_roll");
        skipped++;
        continue;
      }
      if (Date.parse(target.rolledAt) < now.getTime() - config.likes.lookbackDays * 24 * 60 * 60 * 1000) {
        markGroup(state, group, "stale_roll");
        skipped++;
        continue;
      }

      try {
        const hearts = await getHeartIds(session, target.activityId);
        if (hearts.has(viewer.id)) {
          markGroup(state, group, "already_liked");
          skipped++;
          continue;
        }
        const cachedActionId = Date.parse(state.heartActionExpiresAt) > now.getTime() ? state.heartActionId : null;
        let result = await setHeart(session, config, target.activityId, group.displayName, cachedActionId);
        if (result.actionId) {
          state.heartActionId = result.actionId;
          state.heartActionExpiresAt = iso(now.getTime() + ACTION_CACHE_MS);
        }
        if (!result.hearted) {
          // toggleHeart is not idempotent. If a race turns the target off, restore
          // the intended state once before treating the operation as complete.
          const after = await getHeartIds(session, target.activityId);
          if (!after.has(viewer.id)) {
            result = await setHeart(session, config, target.activityId, group.displayName, result.actionId ?? cachedActionId);
            if (result.actionId) {
              state.heartActionId = result.actionId;
              state.heartActionExpiresAt = iso(now.getTime() + ACTION_CACHE_MS);
            }
            if (!result.hearted) throw new Error("RNGdle did not retain the return-like");
          }
        }
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) throw error;
        state.heartActionId = null;
        state.heartActionExpiresAt = null;
        state.lastError = errorSummary(error);
        state.lastSkippedReason = "heart_failed";
        break;
      }

      markGroup(state, group);
      liked++;
      state.actionsByDate[today] = (state.actionsByDate[today] ?? 0) + 1;
      state.lastActionAt = iso(now);
      state.lastActor = group.displayName;
      state.lastActivityId = target.activityId;
      state.lastSkippedReason = null;
      log("info", "Returned a RNGdle heart", { actor: group.displayName, activityId: target.activityId, roll: target.number });
    }

    state.lastCheckedAt = iso(now);
    return { baseline: false, checked: inbox.notifications.length, liked, skipped, limited };
  } catch (error) {
    state.lastCheckedAt = iso(now);
    state.lastError = errorSummary(error);
    throw error;
  }
}
