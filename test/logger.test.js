import assert from "node:assert/strict";
import test from "node:test";
import { errorSummary, getRecentLogs, log } from "../src/logger.js";

test("errorSummary excludes multiline request details", () => {
  const error = new Error("request failed\nCall log:\n  - cookie: secret-session-token");
  const summary = errorSummary(error);

  assert.equal(summary, "request failed");
  assert.doesNotMatch(summary, /cookie|secret-session-token/);
});

test("recent logs are structured and recursively redact sensitive fields", () => {
  log("info", "settings test", {
    smtpPassword: "top-secret",
    changed: ["scheduleTime"],
    request: { headers: { authorization: "Bearer top-secret" } },
  });
  const [entry] = getRecentLogs({ limit: 1 });

  assert.equal(entry.level, "info");
  assert.equal(entry.message, "settings test");
  assert.equal(entry.fields.smtpPassword, "[redacted]");
  assert.deepEqual(entry.fields.changed, ["scheduleTime"]);
  assert.equal(entry.fields.request.headers.authorization, "[redacted]");
});
