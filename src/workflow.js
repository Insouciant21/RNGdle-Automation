import { sendAuthenticationRequiredEmail, sendRollEmail } from "./mail.js";
import { errorSummary, log } from "./logger.js";
import {
  AuthenticationRequiredError,
  getDailyRoll,
  waitForInteractiveAuthentication,
} from "./rngdle.js";
import { nextRetryAt } from "./schedule.js";
import { acquireLock, pruneState, readState, writeState } from "./state.js";

async function obtainRoll(config, control) {
  try {
    return await getDailyRoll(config);
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
    log("error", "Saved RNGdle authentication is no longer valid");
    try {
      await sendAuthenticationRequiredEmail(config);
    } catch (mailError) {
      log("error", "Could not send the authentication alert email", { error: errorSummary(mailError) });
    }
    await waitForInteractiveAuthentication(config, control);
    return getDailyRoll(config);
  }
}

export async function runDailyWorkflow(config, date, now = new Date(), control = null) {
  const release = await acquireLock(config.storage.lockPath);
  if (!release) {
    log("info", "Another workflow instance holds the lock; skipping this tick");
    return { skipped: true };
  }

  try {
    const state = await readState(config.storage.statePath);
    const current = state.days[date] ?? { status: "pending", attempts: 0 };
    if (current.status === "success") {
      return { skipped: true, result: current.result };
    }

    current.status = "running";
    current.attempts += 1;
    current.lastAttemptAt = now.toISOString();
    current.nextRetryAt = nextRetryAt(now, config.schedule.retryMinutes);
    current.lastError = null;
    state.days[date] = current;
    pruneState(state);
    await writeState(config.storage.statePath, state);

    try {
      if (!current.result) {
        current.result = await obtainRoll(config, control);
        current.rolledAt = new Date().toISOString();
        current.status = "email_pending";
        await writeState(config.storage.statePath, state);
      }

      if (!current.emailSentAt) {
        const info = await sendRollEmail(config, date, current.result);
        current.emailSentAt = new Date().toISOString();
        current.emailMessageId = info.messageId;
      }
      current.status = "success";
      current.completedAt = new Date().toISOString();
      current.nextRetryAt = null;
      await writeState(config.storage.statePath, state);
      log("info", "Daily RNGdle workflow completed", {
        date,
        number: current.result.number,
        earnedEp: current.result.earnedEp,
        badges: current.result.badges.length,
      });
      return { skipped: false, result: current.result };
    } catch (error) {
      current.status = current.result ? "email_pending" : "failed";
      current.lastError = errorSummary(error);
      await writeState(config.storage.statePath, state);
      log("error", "Daily RNGdle workflow failed", {
        date,
        attempt: current.attempts,
        retryAt: current.nextRetryAt,
        error: current.lastError,
      });
      throw error;
    }
  } finally {
    await release();
  }
}
