import assert from "node:assert/strict";
import test from "node:test";
import { AutomationService } from "../src/cloud/service.js";
import { configToEnv } from "../src/cloud/config.js";
import { MemoryStorage, fixtureConfig, bundle } from "./helpers/cloud-fixture.js";

async function setup() {
  const storage = new MemoryStorage();
  const sent = [];
  const service = new AutomationService(storage, {
    ...configToEnv(fixtureConfig), CONTROL_PASSWORD: "control-test-password", CONTROL_PUBLIC_URL: "https://control.example.com", MIGRATION_TOKEN: "private-management-token",
  }, {
    sendRoll: async (_config, date, result) => { sent.push({ type: "result", date, number: result.number }); },
    sendAuthentication: async () => { sent.push({ type: "authentication" }); },
  });
  const request = (path, options = {}) => service.fetch(new Request(`https://control.example.com${path}`, options));
  const data = await bundle();
  data.state.days["2026-10-18"] = {
    status: "success", emailSentAt: "2026-10-18T00:05:00Z",
    result: { number: 123456, earnedEp: 42, totalEp: 900, badges: [] },
  };
  assert.equal((await request("/__migration/import", {
    method: "POST", headers: { Authorization: "Bearer private-management-token" }, body: JSON.stringify(data),
  })).status, 200);
  const login = await request("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "control-test-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const { csrfToken } = await login.json();
  const authorized = (path, options = {}) => request(path, {
    ...options, headers: { Cookie: cookie, "X-CSRF-Token": csrfToken, ...options.headers },
  });
  return { request, authorized, sent };
}

test("Worker control APIs expose results and previews without exposing credentials", async () => {
  const { request, authorized, sent } = await setup();
  assert.equal((await request("/api/overview")).status, 401);
  const overview = await (await authorized("/api/overview")).json();
  assert.equal(overview.result.number, 123456);
  assert.equal(overview.result.rarity, "trash");
  assert.equal(overview.latest.emailSent, true);
  assert.doesNotMatch(JSON.stringify(overview), /smtp-private|llm-private|private-management-token|control-test-password/);
  const preview = await authorized("/preview/email?type=result");
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(await preview.text(), /123456/);
  assert.equal((await authorized("/preview/email?type=unknown")).status, 400);
  for (const type of ["result", "authentication"]) {
    assert.equal((await authorized("/api/email/send", { method: "POST", body: JSON.stringify({ type }) })).status, 200);
  }
  assert.deepEqual(sent, [{ type: "result", date: "2026-10-18", number: 123456 }, { type: "authentication" }]);
  assert.equal((await authorized("/api/email/send", {
    method: "POST", headers: { Origin: "https://evil.invalid" }, body: "{}",
  })).status, 403);
});

test("Worker authentication links and email requests reject invalid input", async () => {
  const { authorized, sent } = await setup();
  for (const link of [
    "http://www.rngdle.com/verify", "https://rngdle.com.evil.invalid/verify",
    "https://user:password@www.rngdle.com/verify", "https://untrusted.invalid/verify",
  ]) assert.equal((await authorized("/api/auth-link", { method: "POST", body: JSON.stringify({ link }) })).status, 400);
  for (const body of [{ type: "unknown" }, { date: "invalid" }]) {
    assert.equal((await authorized("/api/email/send", { method: "POST", body: JSON.stringify(body) })).status, 400);
  }
  assert.equal((await authorized("/api/email/send", { method: "POST", body: JSON.stringify({ date: "2000-01-01" }) })).status, 404);
  assert.deepEqual(sent, []);
});
