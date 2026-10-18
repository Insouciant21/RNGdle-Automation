import { localParts, isWorkflowDue } from "../schedule.js";

function nextWorkflowWake(config, state, now) {
  const { date } = localParts(now, config.timezone);
  const day = state.days[date];
  if (day?.status !== "auth_required" && isWorkflowDue({
    now, timezone: config.timezone, scheduleTime: config.schedule.time, dayState: day,
  })) return now.getTime() + 1000;
  const retry = day?.nextRetryAt && Date.parse(day.nextRetryAt);
  const [hour, minute] = config.schedule.time.split(":").map(Number);
  if (day?.status !== "success" && day?.status !== "auth_required" && retry > now.getTime()
      && localParts(now, config.timezone).minutes >= hour * 60 + minute) return retry;
  // Search real UTC instants so timezone offsets and daylight saving transitions
  // are handled by Intl rather than by assuming that every day has 24 hours.
  const start = Math.floor(now.getTime() / 60000) * 60000 + 60000;
  for (let instant = start; instant < start + 49 * 60 * 60000; instant += 60000) {
    const part = localParts(new Date(instant), config.timezone);
    const candidate = state.days[part.date];
    if (candidate?.status !== "auth_required" && isWorkflowDue({
      now: new Date(instant), timezone: config.timezone, scheduleTime: config.schedule.time, dayState: candidate,
    })) return instant;
  }
  throw new Error("Unable to determine the next scheduled day");
}

export function nextReturnLikeWake(config, social, now = new Date()) {
  if (!config.likes?.enabled) return Infinity;
  const interval = (config.likes.pollMinutes ?? 10) * 60_000;
  const last = Date.parse(social?.lastCheckedAt);
  if (!Number.isFinite(last)) return now.getTime() + 1000;
  return Math.max(now.getTime() + 1000, last + interval);
}

export function nextWake(config, state, now = new Date(), social = null) {
  return Math.min(nextWorkflowWake(config, state, now), nextReturnLikeWake(config, social, now));
}
