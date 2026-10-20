import assert from "node:assert/strict";
import test from "node:test";
import { AutomationService } from "../src/cloud/service.js";
import { configToEnv } from "../src/cloud/config.js";
import { advanceWorkflow } from "../src/cloud/workflow.js";
import { nextReturnLikeWake, nextWake } from "../src/cloud/schedule.js";
import { AuthenticationRequiredError } from "../src/rngdle.js";
import { localParts } from "../src/schedule.js";
import { createReturnLikeState } from "../src/rngdle-likes.js";

import { MemoryStorage, fixtureConfig, bundle } from "./helpers/cloud-fixture.js";

const roll = { number: 123456, earnedEp: 100, totalEp: 200, badges: [], poem: null };
const empty = () => ({ version: 1, days: {} });
const fixtureBindings = (config = fixtureConfig) => ({ ...configToEnv(config), CONTROL_PASSWORD: "control-test-password" });
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

test("import requires a bearer token and empty storage, ignoring the old password and sessions", async () => {
  const { storage } = setup();
  const service = new AutomationService(storage, { ...fixtureBindings(), MIGRATION_TOKEN: "migration-private", CONTROL_PUBLIC_URL: "https://control.example.com" });
  const data = await bundle();
  assert.equal((await service.fetch(request("/__migration/import", data))).status, 404);
  const headers = { Authorization: "Bearer migration-private" };
  assert.equal((await service.fetch(request("/__migration/import", data, headers))).status, 200);
  assert.equal(await storage.get("auth"), undefined);
  assert.equal((await storage.get("meta")).paused, true);
  assert.equal((await service.fetch(request("/__migration/import", data, headers))).status, 409);
  const login = await service.fetch(request("/api/auth/login", { password: "control-test-password" }));
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly.*Secure/);
  assert.equal("password" in await storage.get("auth"), false);
  const backup = await (await service.fetch(request("/__migration/export", undefined, headers))).json();
  assert.equal("auth" in backup, false);
  assert.doesNotMatch(JSON.stringify(backup), /control-test-password/);
});

test("Control sessions, CSRF, and logs survive service recreation with config fixed to environment variables", async () => {
  const { storage } = setup();
  const env = { ...fixtureBindings(), MIGRATION_TOKEN: "migration-private", CONTROL_PUBLIC_URL: "https://control.example.com" };
  let service = new AutomationService(storage, env);
  await service.fetch(request("/__migration/import", await bundle(), { Authorization: "Bearer migration-private" }));
  const login = await service.fetch(request("/api/auth/login", { password: "control-test-password" }));
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const session = await login.json();
  const authLink = (headers) => new Request("https://control.example.com/api/auth-link", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", ...headers }, body: JSON.stringify({ link: "https://www.rngdle.com/api/auth/magic-link/verify?token=x" }) });
  assert.equal((await service.fetch(authLink({}))).status, 403);
  assert.equal((await service.fetch(authLink({ "x-csrf-token": session.csrfToken, Origin: "https://evil.invalid" }))).status, 403);
  const removed = (path) => new Request(`https://control.example.com${path}`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json", "x-csrf-token": session.csrfToken }, body: "{}" });
  assert.equal((await service.fetch(removed("/api/settings"))).status, 404);
  assert.equal((await service.fetch(removed("/api/auth/password"))).status, 404);
  assert.equal((await service.fetch(request("/__migration/pause", {}, { Authorization: "Bearer migration-private" }))).status, 200);
  service = new AutomationService(storage, env);
  const overview = await (await service.fetch(request("/api/overview", undefined, { Cookie: cookie }))).json();
  assert.equal(overview.schedule.time, fixtureConfig.schedule.time);
  assert.equal(JSON.stringify(overview).includes("smtp-private"), false);
  assert.equal(JSON.stringify(overview).includes("llm-private"), false);
  const logs = await (await service.fetch(request("/api/logs", undefined, { Cookie: cookie }))).json();
  assert.ok(logs.logs.some((entry) => entry.message === "Automation paused"));
  assert.equal((await service.config()).smtp.password, "smtp-private");
});

test("backups restore return-like history and daily limits without resetting the baseline", async () => {
  const env = { ...fixtureBindings(), MIGRATION_TOKEN: "migration-private", CONTROL_PUBLIC_URL: "https://control.example.com" };
  const storage = new MemoryStorage();
  const service = new AutomationService(storage, env);
  const data = await bundle();
  data.social = {
    ...createReturnLikeState(new Date("2026-10-18T10:00:00Z")),
    baselineCompleted: true,
    processedIds: ["notification-already-liked"],
    actionsByDate: { "2026-10-18": 3 },
  };
  const headers = { Authorization: "Bearer migration-private" };
  assert.equal((await service.fetch(request("/__migration/import", data, headers))).status, 200);
  const exported = await (await service.fetch(request("/__migration/export", undefined, headers))).json();
  assert.deepEqual(exported.social, data.social);
  const target = new MemoryStorage();
  const restored = new AutomationService(target, env);
  assert.equal((await restored.fetch(request("/__migration/import", exported, headers))).status, 200);
  assert.deepEqual(await target.get("social"), data.social);

  const invalid = new AutomationService(new MemoryStorage(), env);
  data.social.initializedAt = "invalid";
  assert.equal((await invalid.fetch(request("/__migration/import", data, headers))).status, 400);
});

test("concurrent alarms serialize and never generate a second roll", async () => {
  const { storage } = setup();
  const config = structuredClone(fixtureConfig); config.schedule.time = "00:00"; config.poem.enabled = false;
  await storage.put("meta", { paused: false, importedAt: new Date().toISOString() });
  let rolls = 0;
  const service = new AutomationService(storage, { ...fixtureBindings(config), CONTROL_PUBLIC_URL: "https://control.example.com" }, {
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
  const service = new AutomationService(storage, { ...fixtureBindings(config), CONTROL_PUBLIC_URL: "https://control.example.com" }, {
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
  const env = { ...fixtureBindings(), MIGRATION_TOKEN: "migration-private", CONTROL_PUBLIC_URL: "https://control.example.com" };
  let service = new AutomationService(storage, env);
  await service.fetch(request("/__migration/import", await bundle(), { Authorization: "Bearer migration-private" }));
  for (let i = 0; i < 5; i++) assert.equal((await service.fetch(request("/api/auth/login", { password: "incorrect" }))).status, 401);
  service = new AutomationService(storage, env);
  assert.equal((await service.fetch(request("/api/auth/login", { password: "control-test-password" }))).status, 429);
});

test("authentication-required automation stays asleep across dates and object restarts", async () => {
  const { storage } = setup();
  await storage.put("meta", { paused: false, authenticated: false, importedAt: new Date().toISOString() });
  const service = new AutomationService(storage, { ...configToEnv(fixtureConfig) }, { getRoll: () => assert.fail("must wait for authentication") });
  await service.schedule();
  assert.equal(await storage.getAlarm(), null);
  await service.tick();
  assert.equal(await storage.get("state"), undefined);
});

test("individual environment variables round-trip through the config and missing ones fail validation", async () => {
  const { storage } = setup();
  const env = { ...configToEnv(fixtureConfig), CONTROL_PUBLIC_URL: "https://control.example.com" };
  const config = await new AutomationService(storage, env).config();
  assert.equal(config.timezone, fixtureConfig.timezone);
  assert.equal(config.schedule.retryMinutes, fixtureConfig.schedule.retryMinutes);
  assert.equal(config.schedule.emailRetryMinutes, fixtureConfig.schedule.emailRetryMinutes);
  assert.equal(config.smtp.secure, fixtureConfig.smtp.secure);
  assert.equal(config.smtp.requireTls, fixtureConfig.smtp.requireTls);
  assert.equal(config.smtp.password, fixtureConfig.smtp.password);
  assert.equal(config.llm.apiKey, fixtureConfig.llm.apiKey);
  assert.deepEqual(config.smtp.to, fixtureConfig.smtp.to);
  assert.equal(config.likes.pollMinutes, fixtureConfig.likes.pollMinutes);
  assert.equal(config.control.publicUrl, "https://control.example.com");
  assert.deepEqual(Object.keys(config.control).sort(), ["publicUrl", "sessionDays"]);

  const partial = new AutomationService(storage, { CONTROL_PUBLIC_URL: "https://control.example.com" });
  assert.equal(await partial.hasConfig(), false);
  await assert.rejects(() => partial.config(), /smtp\.to must contain at least one recipient/);
  await assert.rejects(() => new AutomationService(storage, configToEnv(fixtureConfig)).config(), /CONTROL_PUBLIC_URL is required/);
  await assert.rejects(() => new AutomationService(storage, { ...env, CONTROL_PUBLIC_URL: "invalid" }).config(), /Invalid timezone or URL/);
});

test("an expired daily session prevents a return-like check in the same alarm", async () => {
  const storage = new MemoryStorage();
  const config = structuredClone(fixtureConfig);
  config.schedule.time = "00:00";
  config.likes.enabled = true;
  await storage.put("meta", { paused: false, importedAt: new Date().toISOString() });
  const service = new AutomationService(storage, { ...configToEnv(config), CONTROL_PUBLIC_URL: "https://control.example.com" }, {
    getRoll: async () => { throw new AuthenticationRequiredError(); },
    sendAuthentication: async () => {},
    processReturnLikes: () => assert.fail("must wait for a new session"),
  });
  await service.tick();
  assert.equal((await storage.get("meta")).authenticated, false);
  assert.equal(await storage.getAlarm(), null);
});

test("a fresh Worker uses the password secret and can enable automation without importing a backup", async () => {
  const storage = new MemoryStorage();
  const env = { ...configToEnv(fixtureConfig), CONTROL_PUBLIC_URL: "https://control.example.com", MIGRATION_TOKEN: "private-management-token" };
  let service = new AutomationService(storage, env);
  const headers = { Authorization: "Bearer private-management-token" };
  assert.equal((await service.fetch(request("/__migration/resume", {}, headers))).status, 409);
  service = new AutomationService(storage, { ...env, CONTROL_PASSWORD: "control-test-password" });
  assert.equal((await service.fetch(request("/api/auth/login", { password: "control-test-password" }))).status, 200);
  assert.equal((await service.fetch(request("/__migration/resume", {}, headers))).status, 200);
  assert.equal((await service.status()).state, "authenticated");
  assert.ok(await storage.getAlarm());
  assert.equal((await storage.get("meta")).importedAt, undefined);
});

test("a Worker with an old stored password still requires the password secret", async () => {
  const storage = new MemoryStorage();
  await storage.put("auth", (await bundle()).auth);
  const service = new AutomationService(storage, {});
  const session = await (await service.fetch(request("/api/auth/session"))).json();
  assert.deepEqual(session, { authenticated: false, configured: false });
  assert.equal((await service.status()).label, "Waiting for CONTROL_PASSWORD secret");
  assert.equal((await service.fetch(request("/api/auth/login", { password: "control-test-password" }))).status, 503);
});

test("the Worker keeps only the latest 45 daily records", async () => {
  const { config, storage } = setup();
  const state = empty();
  const today = "2026-10-18";
  for (let offset = 1; offset <= 50; offset++) {
    const date = new Date(Date.parse(today) - offset * 86_400_000).toISOString().slice(0, 10);
    state.days[date] = { status: "success" };
  }
  await advanceWorkflow(config, state, today, { getRoll: async () => ({ ...roll }) });
  const saved = await storage.get("state");
  assert.equal(Object.keys(saved.days).length, 45);
  assert.equal(saved.days[today].result.number, roll.number);
  assert.equal(saved.days["2026-09-03"], undefined);
});
