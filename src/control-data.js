import { cardRarity } from "./rarity.js";

export function newestDay(state, predicate = () => true) {
  const date = Object.keys(state.days)
    .sort()
    .reverse()
    .find((candidate) => predicate(state.days[candidate]));
  return date ? { date, day: state.days[date] } : null;
}

export function overviewPayload(config, status, state) {
  const latest = newestDay(state);
  const latestResult = newestDay(state, (day) => Boolean(day.result));
  const splitRetryState = latest
    ? ["nextRngdleRetryAt", "nextPoemRetryAt", "nextEmailRetryAt"].some((key) => Object.hasOwn(latest.day, key))
    : false;
  const legacyRetryAt = splitRetryState ? null : latest?.day.nextRetryAt ?? null;
  return {
    status,
    generatedAt: new Date().toISOString(),
    schedule: {
      timezone: config.timezone,
      time: config.schedule.time,
      retryMinutes: config.schedule.retryMinutes,
      rngdleRetryMinutes: config.schedule.retryMinutes,
      emailRetryMinutes: config.schedule.emailRetryMinutes ?? 1,
      poemEnabled: config.poem?.enabled ?? false,
      poemRetryMinutes: config.poem?.retryMinutes ?? 5,
    },
    rngdle: { email: config.rngdle.email, baseUrl: config.rngdle.baseUrl },
    mail: { from: config.smtp.from, to: [...config.smtp.to] },
    latest: latest
      ? {
          date: latest.date,
          status: latest.day.status,
          attempts: latest.day.attempts ?? 0,
          emailAttempts: latest.day.emailAttempts ?? 0,
          poemAttempts: latest.day.poemAttempts ?? 0,
          nextPoemRetryAt: latest.day.nextPoemRetryAt ?? null,
          nextRngdleRetryAt: splitRetryState ? latest.day.nextRngdleRetryAt ?? null : legacyRetryAt,
          nextEmailRetryAt: splitRetryState
            ? latest.day.nextEmailRetryAt ?? null
            : latest.day.status === "email_pending"
              ? legacyRetryAt
              : null,
          nextRetryAt: splitRetryState
            ? latest.day.status === "poem_pending"
              ? latest.day.nextPoemRetryAt ?? null
              : latest.day.status === "email_pending"
              ? latest.day.nextEmailRetryAt ?? null
              : latest.day.nextRngdleRetryAt ?? null
            : legacyRetryAt,
          lastError: latest.day.lastError ?? null,
          emailSent: Boolean(latest.day.emailSentAt),
        }
      : null,
    result: latestResult
      ? {
          date: latestResult.date,
          number: latestResult.day.result.number,
          earnedEp: latestResult.day.result.earnedEp,
          totalEp: latestResult.day.result.totalEp,
          rarity: latestResult.day.result.rarity ?? cardRarity(latestResult.day.result.earnedEp),
          badges: latestResult.day.result.badges,
          poem: latestResult.day.result.poem ?? null,
        }
      : null,
  };
}
