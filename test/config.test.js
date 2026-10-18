import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("loads YAML and expands secret environment variables", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.writeFile(
    configPath,
    `rngdle:\n  email: login@example.com\nsmtp:\n  host: smtp.example.com\n  port: 465\n  username: sender@example.com\n  password: \"\${SMTP_PASSWORD}\"\n  from: sender@example.com\n  to: [receiver@example.com]\nstorage:\n  directory: ${directory}/data\n`,
  );
  const config = await loadConfig(configPath, { SMTP_PASSWORD: "secret" });
  assert.equal(config.smtp.password, "secret");
  assert.equal(config.smtp.authMode, "password");
  assert.equal(config.schedule.time, "08:02");
  assert.equal(config.schedule.retryMinutes, 30);
  assert.equal(config.schedule.emailRetryMinutes, 1);
  assert.equal(config.control.port, 3000);
  assert.equal(config.mail.fromName, "RNGdle Today");
  assert.deepEqual(config.likes, { enabled: false, pollMinutes: 60, maxPerDay: 10, lookbackDays: 7 });
});

test("loads generic SMTP settings from environment variables", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.copyFile(path.resolve("config/default.yaml"), configPath);
  const config = await loadConfig(configPath, {
    RNGDLE_EMAIL: "player@outlook.com",
    SMTP_USER: "sender@example.com",
    SMTP_PASSWORD: "smtp-password",
    MAIL_TO: "receiver@example.com",
  });
  assert.equal(config.smtp.host, "smtp.example.com");
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
  assert.equal(config.smtp.requireTls, true);
  assert.equal(config.schedule.emailRetryMinutes, 1);
  assert.equal(config.smtp.authMode, "password");
  assert.equal(config.smtp.password, "smtp-password");
  assert.equal(config.smtp.from, "sender@example.com");
  assert.equal(config.mail.fromName, "RNGdle Today");
  assert.deepEqual(config.smtp.to, ["receiver@example.com"]);
});

test("accepts the legacy mail retry environment alias", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.copyFile(path.resolve("config/default.yaml"), configPath);
  const config = await loadConfig(configPath, {
    RNGDLE_EMAIL: "player@outlook.com",
    SMTP_USER: "sender@example.com",
    SMTP_PASSWORD: "smtp-password",
    MAIL_TO: "receiver@example.com",
    MAIL_RETRY_MINUTES: "3",
  });
  assert.equal(config.schedule.emailRetryMinutes, 3);
});

test("fails when a referenced environment variable is missing", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.writeFile(configPath, 'smtp:\n  password: "${MISSING_SECRET}"\n');
  await assert.rejects(() => loadConfig(configPath, {}), /Missing required environment variable: MISSING_SECRET/);
});

test("rejects password SMTP configuration without a credential", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.copyFile(path.resolve("config/default.yaml"), configPath);
  await assert.rejects(
    () => loadConfig(configPath, { RNGDLE_EMAIL: "player@example.com", SMTP_USER: "sender@example.com", MAIL_TO: "receiver@example.com" }),
    /smtp\.password is required/,
  );
});

test("LLM lowercase environment variables take precedence and enabled poetry requires a key", async () => {
  const env = { RNGDLE_EMAIL: "player@example.com", SMTP_USER: "sender@example.com", SMTP_PASSWORD: "smtp-secret", MAIL_TO: "receiver@example.com" };
  const defaults = await loadConfig("config/default.yaml", env);
  assert.equal(defaults.poem.enabled, false);
  assert.equal(defaults.llm.model, "deepseek-flash");
  await assert.rejects(loadConfig("config/default.yaml", { ...env, POEM_ENABLED: "true" }), /llm_api_key/);
  const configured = await loadConfig("config/default.yaml", { ...env, POEM_ENABLED: "true", llm_api_key: "lowercase-key", LLM_API_KEY: "uppercase-key", llm_endpoint: "https://example.com/v1/", llm_model: "my-model" });
  assert.equal(configured.llm.apiKey, "lowercase-key");
  assert.equal(configured.llm.endpoint, "https://example.com/v1");
  assert.equal(configured.llm.model, "my-model");
  for (const extra of [{ llm_endpoint: "file:///tmp/model" }, { llm_endpoint: "https://user:password@example.com" }, { LLM_MAX_ATTEMPTS: "6" }, { LLM_THINKING: "maybe" }]) {
    await assert.rejects(loadConfig("config/default.yaml", { ...env, ...extra }));
  }
});

test("HTTP timeout accepts the legacy environment alias and cookies use the existing data directory", async () => {
  const env = { RNGDLE_EMAIL: "player@example.com", SMTP_USER: "sender@example.com", SMTP_PASSWORD: "smtp-secret", MAIL_TO: "receiver@example.com", BROWSER_TIMEOUT_MS: "60000" };
  const legacy = await loadConfig("config/default.yaml", env);
  assert.equal(legacy.http.timeoutMs, 60_000);
  assert.equal("browser" in legacy, false);
  assert.equal("profileDirectory" in legacy.storage, false);
  assert.equal(legacy.storage.cookiePath, path.join(legacy.storage.directory, "cookies.json"));
  assert.equal((await loadConfig("config/default.yaml", { ...env, HTTP_TIMEOUT_MS: "30000" })).http.timeoutMs, 30_000);
});
