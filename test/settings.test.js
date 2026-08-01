import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRuntimeSettings, publicSettings, saveRuntimeSettings, validateSettings } from "../src/settings.js";

function configFor(directory) {
  return {
    timezone: "Asia/Shanghai",
    schedule: { time: "08:02", retryMinutes: 30, pollSeconds: 30 },
    rngdle: { email: "player@example.com" },
    browser: { timeoutMs: 45_000 },
    control: { publicUrl: "http://localhost:3000" },
    smtp: {
      host: "smtp.example.com",
      port: 587,
      secure: false,
      requireTls: true,
      username: "sender@example.com",
      from: "sender@example.com",
      to: ["receiver@example.com"],
      password: "original-secret",
    },
    mail: { fromName: "RNGdle Today", subjectPrefix: "[RNGdle]" },
    storage: { settingsPath: path.join(directory, "settings.json") },
  };
}

test("runtime settings persist, hot-apply, and never expose the password", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-settings-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = configFor(directory);

  const visible = await saveRuntimeSettings(config, {
    ...publicSettings(config),
    scheduleTime: "09:15",
    retryMinutes: 45,
    mailFromName: "RNGdle Today",
    mailTo: "first@example.com, second@example.com",
    smtpAppPassword: "replacement-secret",
  });

  assert.equal(config.schedule.time, "09:15");
  assert.equal(config.smtp.password, "replacement-secret");
  assert.deepEqual(config.smtp.to, ["first@example.com", "second@example.com"]);
  assert.equal(config.mail.fromName, "RNGdle Today");
  assert.equal(visible.hasSmtpPassword, true);
  assert.equal("smtpAppPassword" in visible, false);
  assert.equal((await fs.stat(config.storage.settingsPath)).mode & 0o777, 0o600);

  const restarted = configFor(directory);
  assert.equal(await loadRuntimeSettings(restarted), true);
  assert.equal(restarted.schedule.time, "09:15");
  assert.equal(restarted.smtp.password, "replacement-secret");
});

test("blank password preserves the configured SMTP credential", () => {
  const config = configFor("/tmp");
  const settings = validateSettings({ ...publicSettings(config), smtpAppPassword: "" }, config);
  assert.equal(settings.smtpAppPassword, "original-secret");
});

test("runtime settings reject invalid schedule and recipient values", () => {
  const config = configFor("/tmp");
  assert.throws(() => validateSettings({ ...publicSettings(config), scheduleTime: "25:00" }, config), /HH:mm/);
  assert.throws(() => validateSettings({ ...publicSettings(config), mailTo: "not-an-email" }, config), /email/);
});
