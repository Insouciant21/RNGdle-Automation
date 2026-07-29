const formatters = new Map();

function getFormatter(timezone) {
  if (!formatters.has(timezone)) {
    formatters.set(
      timezone,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    );
  }
  return formatters.get(timezone);
}

export function localParts(now, timezone) {
  const parts = Object.fromEntries(
    getFormatter(timezone)
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function isWorkflowDue({ now, timezone, scheduleTime, dayState }) {
  const current = localParts(now, timezone);
  const [hour, minute] = scheduleTime.split(":").map(Number);
  if (dayState?.status === "success" || current.minutes < hour * 60 + minute) {
    return false;
  }
  if (!dayState?.lastAttemptAt) {
    return true;
  }
  return !dayState.nextRetryAt || now >= new Date(dayState.nextRetryAt);
}

export function nextRetryAt(now, retryMinutes) {
  return new Date(now.getTime() + retryMinutes * 60_000).toISOString();
}
