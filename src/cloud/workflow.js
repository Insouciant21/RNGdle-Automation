import { getDailyRoll, AuthenticationRequiredError } from "../rngdle.js";
import { composeDailyPoem } from "../poem-http.js";
import { sendRollEmail, sendAuthenticationRequiredEmail } from "../mail.js";
import { nextRetryAt } from "../schedule.js";
import { errorSummary, log } from "../logger.js";

function pruneState(state, keep = 45) {
  const dates = Object.keys(state.days).sort().reverse();
  for (const date of dates.slice(keep)) delete state.days[date];
}

export async function advanceWorkflow(config, state, date, dependencies = {}) {
  const { getRoll = getDailyRoll, composePoem = composeDailyPoem, sendRoll = sendRollEmail,
    sendAuthentication = sendAuthenticationRequiredEmail, now = () => new Date() } = dependencies;
  const current = state.days[date] ??= { status: "pending", attempts: 0, emailAttempts: 0 };
  if (current.status === "success" || current.status === "auth_required") return;
  const store = config.storage.adapter;
  const persist = () => store.put("state", state);
  const clearRetry = () => {
    for (const field of ["nextRetryAt", "nextRngdleRetryAt", "nextPoemRetryAt", "nextEmailRetryAt"]) current[field] = null;
  };
  const stage = !current.result ? "rngdle"
    : config.poem.enabled && !current.result.poem ? "poem" : "email";
  const retryMinutes = stage === "rngdle" ? config.schedule.retryMinutes
    : stage === "poem" ? config.poem.retryMinutes : config.schedule.emailRetryMinutes;
  const retryField = stage === "rngdle" ? "nextRngdleRetryAt" : stage === "poem" ? "nextPoemRetryAt" : "nextEmailRetryAt";
  const status = stage === "rngdle" ? "running" : `${stage}_pending`;
  current.status = status;
  current.lastAttemptAt = now().toISOString();
  current.lastError = null;
  clearRetry();
  current.nextRetryAt = current[retryField] = nextRetryAt(now(), retryMinutes);
  const attemptField = stage === "rngdle" ? "attempts" : `${stage}Attempts`;
  current[attemptField] = (current[attemptField] ?? 0) + 1;
  current[stage === "rngdle" ? "lastRngdleAttemptAt" : stage === "poem" ? "lastPoemAttemptAt" : "lastEmailAttemptAt"] = now().toISOString();
  pruneState(state);
  // Save the recovery deadline before issuing any external side effect.
  await persist();
  await store.setAlarm?.(Date.parse(current.nextRetryAt));
  try {
    if (stage === "rngdle") {
      current.result = await getRoll(config);
      current.rolledAt = now().toISOString();
      current.status = config.poem.enabled && !current.result.poem ? "poem_pending" : "email_pending";
    } else if (stage === "poem") {
      const poem = await composePoem(config, current.result, {
        draft: current.poemDraft,
        onDraft: async (draft) => { current.poemDraft = draft; await persist(); },
      });
      current.result.poem = poem.text;
      current.poemSubmittedAt = now().toISOString();
      current.poemModel = poem.model ?? current.poemDraft?.model ?? null;
      delete current.poemDraft;
      current.status = "email_pending";
    } else {
      if (!current.emailSentAt) {
        const info = await sendRoll(config, date, current.result);
        current.emailSentAt = now().toISOString();
        current.emailMessageId = info?.messageId ?? null;
      }
      current.status = "success";
      current.completedAt = now().toISOString();
    }
    clearRetry();
    await persist();
    log("info", "RNGdle workflow stage completed", { date, stage, status: current.status });
  } catch (error) {
    clearRetry();
    current.lastError = errorSummary(error);
    if (error instanceof AuthenticationRequiredError) {
      current.status = "auth_required";
      // Mark before sending: repeated alarms must not repeatedly send alerts.
      const notified = current.authenticationNotifiedAt;
      current.authenticationNotifiedAt = now().toISOString();
      await persist();
      if (!notified) {
        try { await sendAuthentication(config); }
        catch (mailError) { log("error", "Authentication alert failed", { error: errorSummary(mailError) }); }
      }
    } else {
      current.status = stage === "rngdle" ? "failed" : `${stage}_pending`;
      current.nextRetryAt = current[retryField] = nextRetryAt(now(), retryMinutes);
      await persist();
    }
    log("error", "RNGdle workflow stage failed", { date, stage, error: current.lastError });
  }
}
