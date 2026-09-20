import { sendAuthenticationRequiredEmail, sendRollEmail } from "./mail.js";
import { errorSummary, log } from "./logger.js";
import { composeDailyPoem } from "./poem-http.js";
import { AuthenticationRequiredError, getDailyRoll, getExistingDailyRoll, waitForInteractiveAuthentication } from "./rngdle.js";
import { nextRetryAt } from "./schedule.js";
import { acquireLock, pruneState, readState, writeState } from "./state.js";

export async function runDailyWorkflow(config, date, now = new Date(), control = null, options = {}) {
  const {
    poemOnly = false,
    getRoll = poemOnly ? getExistingDailyRoll : getDailyRoll,
    composePoem = composeDailyPoem,
    sendRoll = sendRollEmail,
    sendAuthentication = sendAuthenticationRequiredEmail,
    authenticate = waitForInteractiveAuthentication,
  } = options;
  const release = await acquireLock(config.storage.lockPath);
  if (!release) {
    log("info", "Another workflow instance holds the lock; skipping this tick");
    return { skipped: true };
  }
  async function withAuthentication(operation) {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
      log("error", "Saved RNGdle authentication is no longer valid");
      try { await sendAuthentication(config); }
      catch (mailError) { log("error", "Could not send the authentication alert email", { error: errorSummary(mailError) }); }
      await authenticate(config, control);
      return operation();
    }
  }
  try {
    const state = await readState(config.storage.statePath);
    const current = state.days[date] ?? { status: "pending", attempts: 0, emailAttempts: 0 };
    if (current.status === "success" && !poemOnly) return { skipped: true, result: current.result };
    const wantsPoem = poemOnly || config.poem?.enabled === true;
    let stage = "rngdle";
    const persist = () => writeState(config.storage.statePath, state);
    const clearRetry = () => {
      current.nextRngdleRetryAt = null;
      current.nextPoemRetryAt = null;
      current.nextEmailRetryAt = null;
      current.nextRetryAt = null;
    };
    state.days[date] = current;
    current.lastAttemptAt = now.toISOString();
    current.lastError = null;
    pruneState(state);
    try {
      if (!current.result) {
        current.status = "running";
        current.attempts = (current.attempts ?? 0) + 1;
        current.lastRngdleAttemptAt = new Date().toISOString();
        clearRetry();
        current.nextRetryAt = current.nextRngdleRetryAt = nextRetryAt(new Date(), config.schedule.retryMinutes);
        await persist();
        current.result = await withAuthentication(() => getRoll(config));
        current.rolledAt = new Date().toISOString();
        current.status = wantsPoem ? "poem_pending" : "email_pending";
        clearRetry();
        await persist();
      }
      if (wantsPoem && !current.result.poem) {
        stage = "poem";
        current.status = "poem_pending";
        current.poemAttempts = (current.poemAttempts ?? 0) + 1;
        current.lastPoemAttemptAt = new Date().toISOString();
        clearRetry();
        current.nextRetryAt = current.nextPoemRetryAt = nextRetryAt(new Date(), config.poem?.retryMinutes ?? 5);
        await persist();
        const poem = await withAuthentication(() => composePoem(config, current.result, {
          draft: current.poemDraft,
          onDraft: async (draft) => { current.poemDraft = draft; await persist(); },
        }));
        current.result.poem = poem.text;
        current.poemSubmittedAt = new Date().toISOString();
        current.poemModel = poem.model ?? current.poemDraft?.model ?? null;
        delete current.poemDraft;
        clearRetry();
        await persist();
        log("info", "RNGdle poem saved", { date, number: current.result.number, reused: poem.reused });
      }
      if (poemOnly) {
        current.status = current.emailSentAt ? "success" : "email_pending";
        clearRetry();
        await persist();
        return { skipped: false, result: current.result };
      }
      if (!current.emailSentAt) {
        stage = "email";
        current.status = "email_pending";
        current.emailAttempts = (current.emailAttempts ?? 0) + 1;
        current.lastEmailAttemptAt = new Date().toISOString();
        clearRetry();
        current.nextRetryAt = current.nextEmailRetryAt = nextRetryAt(new Date(), config.schedule.emailRetryMinutes ?? 1);
        await persist();
        const info = await sendRoll(config, date, current.result);
        current.emailSentAt = new Date().toISOString();
        current.emailMessageId = info.messageId;
      }
      current.status = "success";
      current.completedAt = new Date().toISOString();
      clearRetry();
      await persist();
      log("info", "Daily RNGdle workflow completed", { date, number: current.result.number, earnedEp: current.result.earnedEp, badges: current.result.badges.length });
      return { skipped: false, result: current.result };
    } catch (error) {
      current.status = stage === "poem" ? "poem_pending" : stage === "email" ? "email_pending" : "failed";
      clearRetry();
      const retryMinutes = stage === "poem" ? config.poem?.retryMinutes ?? 5 : stage === "email" ? config.schedule.emailRetryMinutes ?? 1 : config.schedule.retryMinutes;
      const retryField = stage === "poem" ? "nextPoemRetryAt" : stage === "email" ? "nextEmailRetryAt" : "nextRngdleRetryAt";
      current.nextRetryAt = current[retryField] = nextRetryAt(new Date(), retryMinutes);
      current.lastError = errorSummary(error);
      await persist();
      log("error", "Daily RNGdle workflow failed", { date, retryType: stage, retryAt: current.nextRetryAt, error: current.lastError });
      throw error;
    }
  } finally {
    await release();
  }
}
