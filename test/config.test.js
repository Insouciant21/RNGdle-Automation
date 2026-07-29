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
  assert.equal(config.control.port, 3000);
});

test("loads Gmail SMTP settings from environment variables", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.copyFile(path.resolve("config/config.example.yaml"), configPath);
  const config = await loadConfig(configPath, {
    RNGDLE_EMAIL: "player@outlook.com",
    SMTP_USER: "sender@gmail.com",
    SMTP_APP_PASSWORD: "app-password",
    MAIL_TO: "receiver@example.com",
  });
  assert.equal(config.smtp.host, "smtp.gmail.com");
  assert.equal(config.smtp.port, 587);
  assert.equal(config.smtp.secure, false);
  assert.equal(config.smtp.requireTls, true);
  assert.equal(config.smtp.authMode, "password");
  assert.equal(config.smtp.password, "app-password");
  assert.equal(config.smtp.from, "sender@gmail.com");
  assert.deepEqual(config.smtp.to, ["receiver@example.com"]);
});

test("fails when a referenced environment variable is missing", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-config-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  await fs.writeFile(configPath, 'smtp:\n  password: "${MISSING_SECRET}"\n');
  await assert.rejects(() => loadConfig(configPath, {}), /Missing required environment variable: MISSING_SECRET/);
});
