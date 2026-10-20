import { utcDate, isWorkflowDue, workflowRetryAt } from "../schedule.js";

function nextWorkflowWake(state, now) {
  const date = utcDate(now);
  const day = state.days[date];
  if (isWorkflowDue({ now, dayState: day })) return now.getTime() + 1000;
  const midnight = Date.parse(date) + 24 * 60 * 60 * 1000;
  const retry = Date.parse(workflowRetryAt(day));
  return day?.status !== "success" && day?.status !== "auth_required" && Number.isFinite(retry)
    ? Math.min(retry, midnight) : midnight;
}

export function nextReturnLikeWake(config, social, now = new Date()) {
  if (!config.likes?.enabled) return Infinity;
  const interval = (config.likes.pollMinutes ?? 60) * 60_000;
  const last = Date.parse(social?.lastCheckedAt);
  if (!Number.isFinite(last)) return now.getTime() + 1000;
  return Math.max(now.getTime() + 1000, last + interval);
}

export function nextWake(config, state, now = new Date(), social = null) {
  return Math.min(nextWorkflowWake(state, now), nextReturnLikeWake(config, social, now));
}
