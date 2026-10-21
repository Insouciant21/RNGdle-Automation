import assert from "node:assert/strict";
import test from "node:test";
import { configToEnv, splitWorkerBindings, workerConfig } from "../src/cloud/config.js";
import { MemoryStorage } from "./helpers/cloud-fixture.js";

const required = {
  CONTROL_PUBLIC_URL: "https://control.example.com",
  RNGDLE_EMAIL: "player@example.com",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "sender@example.com",
  SMTP_PASSWORD: "smtp-password",
  MAIL_TO: "receiver@example.com",
};

test("minimal Worker bindings use defaults and Durable Object storage", async () => {
  const storage = new MemoryStorage();
  const config = await workerConfig(required, storage);
  assert.equal(config.timezone, "UTC");
  assert.equal(config.rngdle.baseUrl, "https://www.rngdle.com");
  for (const name of ["TZ", "SCHEDULE_TIME", "RNGDLE_BASE_URL", "HTTP_TIMEOUT_MS", "LLM_TIMEOUT_MS", "MAIL_FROM_NAME", "MAIL_SUBJECT_PREFIX"]) {
    assert.equal(name in configToEnv(config), false);
  }
  assert.deepEqual(config.schedule, { time: "00:00", retryMinutes: 30, emailRetryMinutes: 1 });
  assert.deepEqual(config.control, { publicUrl: required.CONTROL_PUBLIC_URL, sessionDays: 7 });
  assert.deepEqual(config.storage, { adapter: storage });
  assert.equal(config.http.timeoutMs, 45_000);
  assert.equal(config.llm.timeoutMs, 60_000);
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
  assert.equal(config.smtp.requireTls, true);
  assert.equal(config.smtp.from, required.SMTP_USER);
  assert.deepEqual(config.smtp.to, [required.MAIL_TO]);
  assert.deepEqual(config.likes, { enabled: false, pollMinutes: 60, maxPerDay: 10, lookbackDays: 7 });
  assert.equal(config.poem.enabled, false);
});

test("mail sender overrides and multiple recipients are normalized", async () => {
  const config = await workerConfig({ ...required, MAIL_FROM: "other@example.com", MAIL_TO: "a@example.com, b@example.com", CONTROL_PUBLIC_URL: "https://control.example.com/" });
  assert.equal(config.smtp.from, "other@example.com");
  assert.deepEqual(config.smtp.to, ["a@example.com", "b@example.com"]);
  assert.equal(config.control.publicUrl, required.CONTROL_PUBLIC_URL);
});

test("missing required Worker bindings fail before a workflow can run", async () => {
  for (const name of Object.keys(required)) {
    await assert.rejects(workerConfig({ ...required, [name]: "" }), /required|non-empty|at least one recipient/);
  }
});

test("deployment variables validate types and URLs", async () => {
  for (const extra of [
    { RETURN_LIKES_POLL_MINUTES: "0" }, { POEM_ENABLED: "yes" }, { SMTP_PORT: "invalid" },
    { CONTROL_PUBLIC_URL: "invalid" },
  ]) await assert.rejects(workerConfig({ ...required, ...extra }));
});

test("retired bindings no longer affect Worker configuration", async () => {
  const retired = {
    TZ: "invalid", SCHEDULE_TIME: "25:00",
    RNGDLE_BASE_URL: "https://other.example.com", HTTP_TIMEOUT_MS: "1", LLM_TIMEOUT_MS: "1",
    MAIL_FROM_NAME: "Custom sender", MAIL_SUBJECT_PREFIX: "[Custom]",
  };
  const config = await workerConfig({
    ...required, ...retired, BROWSER_TIMEOUT_MS: "90000", MAIL_RETRY_MINUTES: "10", llm_model: "old-model",
    POLL_SECONDS: "1", CONTROL_PORT: "9000", CONTROL_COOKIE_SECURE: "false",
  });
  assert.equal(config.rngdle.baseUrl, "https://www.rngdle.com");
  assert.equal(config.timezone, "UTC");
  assert.equal(config.schedule.time, "00:00");
  assert.deepEqual(config.mail, { fromName: "RNGdle Today", subjectPrefix: "[RNGdle]" });
  assert.deepEqual(splitWorkerBindings(retired), { vars: {}, secrets: {} });
  assert.equal(config.http.timeoutMs, 45_000);
  assert.equal(config.llm.timeoutMs, 60_000);
  assert.equal(config.schedule.emailRetryMinutes, 1);
  assert.equal(config.llm.model, "deepseek-flash");
  assert.equal(config.schedule.pollSeconds, undefined);
  assert.deepEqual(Object.keys(config.control).sort(), ["publicUrl", "sessionDays"]);
  await assert.rejects(workerConfig({ ...required, SMTP_PASSWORD: "", SMTP_APP_PASSWORD: "legacy" }), /smtp.password is required/);
});

test("OAuth remains optional and does not require a password", async () => {
  const env = {
    ...required, SMTP_AUTH_MODE: "oauth2", SMTP_PASSWORD: "",
    SMTP_OAUTH_CLIENT_ID: "client", SMTP_OAUTH_CLIENT_SECRET: "secret",
    SMTP_OAUTH_REFRESH_TOKEN: "refresh", SMTP_OAUTH_ACCESS_URL: "https://auth.example.com/token",
  };
  const config = await workerConfig(env);
  assert.equal(config.smtp.authMode, "oauth2");
  assert.equal(config.smtp.password, null);
  assert.equal(config.smtp.oauth.refreshToken, "refresh");
  await assert.rejects(workerConfig({ ...env, SMTP_OAUTH_CLIENT_SECRET: "" }), /required for OAuth2/);
});

test("poetry uses uppercase LLM bindings and requires a secret when enabled", async () => {
  await assert.rejects(workerConfig({ ...required, POEM_ENABLED: "true", llm_api_key: "legacy" }), /LLM_API_KEY/);
  const config = await workerConfig({
    ...required, POEM_ENABLED: "true", LLM_API_KEY: "key", LLM_ENDPOINT: "https://example.com/v1/", LLM_MODEL: "custom-model",
  });
  assert.equal(config.llm.endpoint, "https://example.com/v1");
  assert.equal(config.llm.model, "custom-model");
  assert.equal(config.llm.apiKey, "key");
  for (const extra of [
    { LLM_ENDPOINT: "file:///tmp/model" }, { LLM_ENDPOINT: "https://user:password@example.com" },
    { LLM_MAX_ATTEMPTS: "6" }, { LLM_THINKING: "maybe" },
  ]) await assert.rejects(workerConfig({ ...required, ...extra }));
});
