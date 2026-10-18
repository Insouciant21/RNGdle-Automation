import assert from "node:assert/strict";
import test from "node:test";
import { AutomationService } from "../src/cloud/service.js";
import { advanceWorkflow } from "../src/cloud/workflow.js";
import { nextReturnLikeWake, nextWake } from "../src/cloud/schedule.js";
import { AuthenticationRequiredError } from "../src/rngdle.js";
import { localParts } from "../src/schedule.js";

import { MemoryStorage, fixtureConfig, bundle } from "./helpers/cloud-fixture.js";

const roll = { number: 123456, earnedEp: 100, totalEp: 200, badges: [], poem: null };
const empty = () => ({ version: 1, days: {} });
const request = (path, body, headers = {}) => new Request(`https://control.example.com${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
function setup() {
  const storage = new MemoryStorage();
  const config = structuredClone(fixtureConfig);
  config.storage = { adapter: storage };
  return { storage, config };
}

test("cloud workflow persists each stage and restores a poem draft after a failure", async () => {
  const { config, storage } = setup();
  let state = empty();
  const calls = [];
  const dependencies = {
    getRoll: async () => { calls.push("roll"); return { ...roll }; },
    composePoem: async (_config, _roll, { draft, onDraft }) => {
      calls.push("poem");
      if (!draft) { await onDraft({ text: "mountains rise" }); throw new Error("submission interrupted"); }
      return draft;
    },
    sendRoll: async () => { calls.push("email"); return { messageId: "ok" }; },
  };
  await advanceWorkflow(config, state, "2026-10-18", dependencies);
  assert.deepEqual(calls, ["roll"]);
  state = await storage.get("state");
  assert.equal(state.days["2026-10-18"].status, "poem_pending");
  await advanceWorkflow(config, state, "2026-10-18", dependencies);
  state = await storage.get("state");
  assert.equal(state.days["2026-10-18"].poemDraft.text, "mountains rise");
  assert.ok(state.days["2026-10-18"].nextPoemRetryAt);
  await advanceWorkflow(config, state, "2026-10-18", dependencies);
  await advanceWorkflow(config, await storage.get("state"), "2026-10-18", dependencies);
  await advanceWorkflow(config, await storage.get("state"), "2026-10-18", dependencies);
  assert.deepEqual(calls, ["roll", "poem", "poem", "email"]);
  assert.equal((await storage.get("state")).days["2026-10-18"].status, "success");
});

test("cloud mail failures retry only delivery, preserving completed roll and poem", async () => {
  const { config, storage } = setup();
  const state = { version: 1, days: { "2026-10-18": { result: { ...roll, poem: "saved" }, status: "email_pending" } } };
  await advanceWorkflow(config, state, "2026-10-18", { sendRoll: async () => { throw new Error("mail offline"); } });
  const pending = (await storage.get("state")).days["2026-10-18"];
  assert.equal(pending.status, "email_pending");
  assert.ok(pending.nextEmailRetryAt);
  assert.equal(pending.nextPoemRetryAt, null);
  await advanceWorkflow(config, await storage.get("state"), "2026-10-18", {
    getRoll: () => assert.fail("must not roll"), composePoem: () => assert.fail("must not compose"), sendRoll: async () => ({ messageId: "retry" }),
  });
  assert.equal((await storage.get("state")).days["2026-10-18"].emailAttempts, 2);
});

test("authentication failure pauses the stage and sends one notification", async () => {
  const { config } = setup();
  const state = empty();
  let notifications = 0;
  const deps = { getRoll: async () => { throw new AuthenticationRequiredError(); }, sendAuthentication: async () => notifications++ };
  await advanceWorkflow(config, state, "2026-10-18", deps);
  await advanceWorkflow(config, state, "2026-10-18", deps);
  assert.equal(state.days["2026-10-18"].status, "auth_required");
  assert.equal(notifications, 1);
  assert.equal(state.days["2026-10-18"].nextRetryAt, null);
});

test("alarms respect daily schedule, stage retry deadlines, and completed days", () => {
  const { config } = setup();
  const state = empty();
  assert.equal(nextWake(config, state, new Date("2026-10-18T00:01:00Z")), Date.parse("2026-10-18T00:02:00Z"));
  state.days["2026-10-18"] = { status: "success" };
  assert.equal(nextWake(config, state, new Date("2026-10-18T00:03:00Z")), Date.parse("2026-10-19T00:02:00Z"));
  state.days["2026-10-18"] = { status: "email_pending", lastAttemptAt: "2026-10-18T00:02:00Z", nextEmailRetryAt: "2026-10-18T00:04:23Z", nextRetryAt: "2026-10-18T00:04:23Z" };
  assert.equal(nextWake(config, state, new Date("2026-10-18T00:03:00Z")), Date.parse("2026-10-18T00:04:23Z"));
  config.schedule.time = "09:00";
  assert.equal(nextWake(config, state, new Date("2026-10-18T00:03:00Z")), Date.parse("2026-10-18T01:00:00Z"));
});

test("return-like polling chooses an independent short alarm and resets after the enabled baseline", () => {
  const { config } = setup();
  config.likes = { enabled: true, pollMinutes: 10, maxPerDay: 10, lookbackDays: 7 };
  const now = new Date("2026-10-18T12:00:00Z");
  assert.equal(nextReturnLikeWake(config, null, now), now.getTime() + 1000);
  assert.equal(nextReturnLikeWake(config, { lastCheckedAt: "2026-10-18T11:55:00Z" }, now), Date.parse("2026-10-18T12:05:00Z"));
  assert.ok(nextWake(config, empty(), now, { lastCheckedAt: "2026-10-18T11:55:00Z" }) <= Date.parse("2026-10-18T12:05:00Z"));
  config.likes.enabled = false;
  assert.equal(nextReturnLikeWake(config, null, now), Infinity);
});

test("alarms schedule across DST using real timezone instants", () => {
  const { config } = setup(); config.timezone = "America/New_York"; config.schedule.time = "08:02";
  const state = { version: 1, days: { "2026-03-07": { status: "success" } } };
  assert.equal(nextWake(config, state, new Date("2026-03-07T14:00:00Z")), Date.parse("2026-03-08T12:02:00Z"));
});

test("import requires a bearer token and empty storage, preserving hash and clearing sessions", async () => {
  const { storage } = setup();
  const service = new AutomationService(storage, { CONFIG_JSON: JSON.stringify(fixtureConfig), MIGRATION_TOKEN: "migration-private" });
  const data = await bundle();
  assert.equal((await service.fetch(request("/__migration/import", data))).status, 404);
  const headers = { Authorization: "Bearer migration-private" };
  assert.equal((await service.fetch(request("/__migration/import", data, headers))).status, 200);
  assert.deepEqual((await storage.get("auth")).sessions, []);
  assert.deepEqual((await storage.get("auth")).password, data.auth.password);
  assert.equal((await storage.get("meta")).paused, true);
  assert.equal((await service.fetch(request("/__migration/import", data, headers))).status, 409);
  const login = await service.fetch(request("/api/auth/login", { password: "control-test-password" }));
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly.*Secure/);
});

test("Control sessions, CSRF, settings, and logs survive service recreation", async () => {
  const { storage } = setup();
  const env = { CONFIG_JSON: JSON.stringify(fixtureConfig), MIGRATION_TOKEN: "migration-private", CONTROL_PUBLIC_URL: "https://control.example.com" };
  let service = new AutomationService(storage, env);
  await service.fetch(request("/__migration/import", await bundle(), { Authorization: "Bearer migration-private" }));
  const login = await service.fetch(request("/api/auth/login", { password: "control-test-password" }));
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const session = await login.json();
  const update = (headers) => new Request("https://control.example.com/api/settings", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json", ...headers }, body: JSON.stringify({ scheduleTime: "09:12", smtpAppPassword: "", controlPublicUrl: "https://old.invalid" }) });
  assert.equal((await service.fetch(update({}))).status, 403);
  assert.equal((await service.fetch(update({ "x-csrf-token": session.csrfToken, Origin: "https://evil.invalid" }))).status, 403);
  assert.equal((await service.fetch(update({ "x-csrf-token": session.csrfToken }))).status, 200);
  service = new AutomationService(storage, env);
  const response = await service.fetch(request("/api/settings", undefined, { Cookie: cookie }));
  const settings = await response.json();
  assert.equal(settings.scheduleTime, "09:12");
  assert.equal(settings.controlPublicUrl, "https://control.example.com");
  assert.equal(JSON.stringify(settings).includes("smtp-private"), false);
  const logs = await (await service.fetch(request("/api/logs", undefined, { Cookie: cookie }))).json();
  assert.ok(logs.logs.some((entry) => entry.message === "Control settings updated"));
  assert.equal((await service.config()).smtp.password, "smtp-private");
});

test("concurrent alarms serialize and never generate a second roll", async () => {
  const { storage } = setup();
  const config = structuredClone(fixtureConfig); config.schedule.time = "00:00"; config.poem.enabled = false;
  await storage.put("meta", { paused: false, importedAt: new Date().toISOString() });
  let rolls = 0;
  const service = new AutomationService(storage, { CONFIG_JSON: JSON.stringify(config) }, {
    getRoll: async () => { rolls++; await new Promise((resolve) => setTimeout(resolve, 15)); return { ...roll }; }, sendRoll: async () => ({ messageId: "concurrent" }),
  });
  await Promise.all([service.tick(), service.tick(), service.tick()]);
  assert.equal(rolls, 1);
  assert.equal((await storage.get("state")).days[localParts(new Date(), config.timezone).date].status, "success");
  assert.ok(await storage.getAlarm());
});

test("an alarm runs the return-like workflow without rerunning a completed daily roll", async () => {
  const { storage } = setup();
  const config = structuredClone(fixtureConfig);
  config.likes = { enabled: true, pollMinutes: 10, maxPerDay: 10, lookbackDays: 7 };
  const today = localParts(new Date(), config.timezone).date;
  await storage.put("state", { version: 1, days: { [today]: { status: "success" } } });
  await storage.put("meta", { paused: false, importedAt: new Date().toISOString() });
  let calls = 0;
  const service = new AutomationService(storage, { CONFIG_JSON: JSON.stringify(config) }, {
    getRoll: () => assert.fail("must not reroll a completed day"),
    processReturnLikes: async (_config, social) => {
      calls++;
      social.lastCheckedAt = new Date().toISOString();
      return { liked: 0, skipped: 0 };
    },
  });
  await service.tick();
  assert.equal(calls, 1);
  assert.ok((await storage.get("social")).lastCheckedAt);
});

test("failed login limits remain enforced after object restart", async () => {
  const { storage } = setup();
  const env = { CONFIG_JSON: JSON.stringify(fixtureConfig), MIGRATION_TOKEN: "migration-private" };
  let service = new AutomationService(storage, env);
  await service.fetch(request("/__migration/import", await bundle(), { Authorization: "Bearer migration-private" }));
  for (let i = 0; i < 5; i++) assert.equal((await service.fetch(request("/api/auth/login", { password: "incorrect" }))).status, 401);
  service = new AutomationService(storage, env);
  assert.equal((await service.fetch(request("/api/auth/login", { password: "control-test-password" }))).status, 429);
});

test("authentication-required automation stays asleep across dates and object restarts", async () => {
  const { storage } = setup();
  await storage.put("meta", { paused: false, authenticated: false, importedAt: new Date().toISOString() });
  const service = new AutomationService(storage, { CONFIG_JSON: JSON.stringify(fixtureConfig) }, { getRoll: () => assert.fail("must wait for authentication") });
  await service.schedule();
  assert.equal(await storage.getAlarm(), null);
  await service.tick();
  assert.equal(await storage.get("state"), undefined);
});
