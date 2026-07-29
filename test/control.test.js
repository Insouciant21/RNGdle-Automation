import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createControlServer, isAllowedAuthenticationLink } from "../src/control.js";

test("authentication control accepts only HTTPS RNGdle links", () => {
  const base = "https://www.rngdle.com";
  assert.equal(isAllowedAuthenticationLink("https://www.rngdle.com/api/auth/magic-link/verify?token=x", base), true);
  assert.equal(isAllowedAuthenticationLink("https://rngdle.com/api/auth/magic-link/verify?token=x", base), true);
  assert.equal(isAllowedAuthenticationLink("https://auth.rngdle.com/verify?token=x", base), true);
  assert.equal(isAllowedAuthenticationLink("http://www.rngdle.com/verify", base), false);
  assert.equal(isAllowedAuthenticationLink("https://rngdle.com.example.org/verify", base), false);
});

test("control APIs expose operations without exposing secrets", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-control-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const statePath = path.join(directory, "state.json");
  await fs.writeFile(
    statePath,
    JSON.stringify({
      version: 1,
      days: {
        "2026-07-29": {
          status: "success",
          attempts: 1,
          emailSentAt: "2026-07-29T00:03:00.000Z",
          result: { number: 123456, earnedEp: 42, totalEp: 900, badges: [] },
        },
      },
    }),
  );
  const config = {
    timezone: "Asia/Shanghai",
    schedule: { time: "08:02", retryMinutes: 30, pollSeconds: 30 },
    rngdle: { baseUrl: "https://www.rngdle.com", email: "player@example.com" },
    browser: { timeoutMs: 45_000 },
    control: { port: 0, publicUrl: "http://localhost:3000" },
    smtp: {
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTls: true,
      authMode: "password",
      username: "sender@gmail.com",
      password: "never-return-this",
      from: "sender@gmail.com",
      to: ["receiver@example.com"],
    },
    mail: { subjectPrefix: "[RNGdle]" },
    storage: { statePath, settingsPath: path.join(directory, "settings.json") },
  };
  const sent = [];
  const control = await createControlServer(config, {
    sendRoll: async (_config, date, result) => {
      sent.push({ type: "result", date, number: result.number });
      return { messageId: "test-result" };
    },
    sendAuthentication: async () => {
      sent.push({ type: "authentication" });
      return { messageId: "test-authentication" };
    },
  });
  context.after(() => control.close());
  const baseUrl = `http://127.0.0.1:${control.address().port}`;

  const page = await (await fetch(baseUrl)).text();
  assert.match(page, /@font-face/);
  assert.match(page, /\/assets\/fonts\/inter-latin\.woff2/);
  assert.match(page, /id="email-send"/);
  assert.match(page, /<header class="topbar">[\s\S]*<nav class="tabs"[\s\S]*<\/header>/);
  assert.doesNotMatch(page, /tabs-wrap/);
  const font = await fetch(`${baseUrl}/assets/fonts/space-mono-700-latin.woff2`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.ok((await font.arrayBuffer()).byteLength > 1_000);

  const overview = await (await fetch(`${baseUrl}/api/overview`)).json();
  assert.equal(overview.result.number, 123456);
  assert.equal(overview.latest.emailSent, true);

  const settings = await (await fetch(`${baseUrl}/api/settings`)).json();
  assert.equal(settings.hasSmtpPassword, true);
  assert.equal("smtpAppPassword" in settings, false);
  assert.doesNotMatch(JSON.stringify(settings), /never-return-this/);

  const rejected = await fetch(`${baseUrl}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: "https://example.org" },
    body: JSON.stringify(settings),
  });
  assert.equal(rejected.status, 403);

  const updated = await fetch(`${baseUrl}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ ...settings, scheduleTime: "09:30", smtpAppPassword: "" }),
  });
  assert.equal(updated.status, 200);
  assert.equal(config.schedule.time, "09:30");

  const preview = await fetch(`${baseUrl}/preview/email?type=result`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await preview.text(), /123456/);

  const invalidPreview = await fetch(`${baseUrl}/preview/email?type=unknown`);
  assert.equal(invalidPreview.status, 400);

  const rejectedEmail = await fetch(`${baseUrl}/api/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://example.org" },
    body: JSON.stringify({ type: "result" }),
  });
  assert.equal(rejectedEmail.status, 403);

  const resultEmail = await fetch(`${baseUrl}/api/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ type: "result" }),
  });
  assert.equal(resultEmail.status, 200);
  assert.deepEqual(sent.at(-1), { type: "result", date: "2026-07-29", number: 123456 });

  const authenticationEmail = await fetch(`${baseUrl}/api/email/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ type: "authentication" }),
  });
  assert.equal(authenticationEmail.status, 200);
  assert.deepEqual(sent.at(-1), { type: "authentication" });

  const logs = await (await fetch(`${baseUrl}/api/logs?level=info`)).json();
  assert.ok(logs.logs.some((entry) => entry.message === "Control page started"));
  assert.ok(logs.logs.some((entry) => entry.message === "Control email sent"));
});
