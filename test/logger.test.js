import assert from "node:assert/strict";
import test from "node:test";
import { errorSummary, withLogSink, log } from "../src/logger.js";

test("errorSummary excludes multiline request details", () => {
  const error = new Error("request failed\nCall log:\n  - cookie: secret-session-token");
  const summary = errorSummary(error);

  assert.equal(summary, "request failed");
  assert.doesNotMatch(summary, /cookie|secret-session-token/);
});

test("Durable Object log entries recursively redact sensitive fields", () => {
  const entries = [];
  withLogSink((entry) => entries.push(entry), () => log("info", "configuration test", {
    smtpPassword: "top-secret",
    changed: ["scheduleTime"],
    request: { headers: { authorization: "Bearer top-secret" } },
  }));
  const [entry] = entries;

  assert.equal(entry.level, "info");
  assert.equal(entry.message, "configuration test");
  assert.equal(entry.fields.smtpPassword, "[redacted]");
  assert.deepEqual(entry.fields.changed, ["scheduleTime"]);
  assert.equal(entry.fields.request.headers.authorization, "[redacted]");
});

test("LLM credentials are redacted from nested structured logs", () => {
  const entries = [];
  withLogSink((entry) => entries.push(entry), () => log("info", "LLM config", { llm: { apiKey: "private", model: "deepseek-flash" }, LLM_API_KEY: "private" }));
  const [entry] = entries;
  assert.doesNotMatch(JSON.stringify(entry), /private/);
  assert.equal(entry.fields.llm.model, "deepseek-flash");
});

test("concurrent operations keep their Durable Object log sinks separate", async () => {
  const first = [];
  const second = [];
  await Promise.all([
    withLogSink((entry) => first.push(entry), async () => { await Promise.resolve(); log("info", "first operation"); }),
    withLogSink((entry) => second.push(entry), async () => { await Promise.resolve(); log("info", "second operation"); }),
  ]);
  assert.deepEqual(first.map((entry) => entry.message), ["first operation"]);
  assert.deepEqual(second.map((entry) => entry.message), ["second operation"]);
});
