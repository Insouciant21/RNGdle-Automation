export function utcDate(now) {
  return now.toISOString().slice(0, 10);
}

export function workflowRetryAt(dayState) {
  return dayState?.status === "poem_pending"
    ? dayState.nextPoemRetryAt ?? dayState.nextRetryAt
    : dayState?.status === "email_pending"
    ? dayState.nextEmailRetryAt ?? dayState.nextRetryAt
    : dayState?.nextRngdleRetryAt ?? dayState?.nextRetryAt;
}

export function isWorkflowDue({ now, dayState }) {
  if (dayState?.status === "success" || dayState?.status === "auth_required") {
    return false;
  }
  if (!dayState?.lastAttemptAt) {
    return true;
  }
  const retryAt = workflowRetryAt(dayState);
  return !retryAt || now >= new Date(retryAt);
}

export function nextRetryAt(now, retryMinutes) {
  return new Date(now.getTime() + retryMinutes * 60_000).toISOString();
}
