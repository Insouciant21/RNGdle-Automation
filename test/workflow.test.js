import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runDailyWorkflow } from "../src/workflow.js";
import { readState, writeState } from "../src/state.js";

const date = "2026-09-19";
const roll = { number: 123456, earnedEp: 100, totalEp: 200, badges: [], poem: null };
async function setup(context, enabled = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-workflow-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { schedule: { retryMinutes: 30, emailRetryMinutes: 1 }, poem: { enabled, retryMinutes: 5 }, storage: { statePath: path.join(directory, "state.json"), lockPath: path.join(directory, "workflow.lock") } };
}
const run = (config, deps) => runDailyWorkflow(config, date, new Date(), null, deps);
const day = async (config) => (await readState(config.storage.statePath)).days[date];

test("daily workflow saves roll then poem before email, and skips a successful day", async (context) => {
  const config = await setup(context);
  const calls = [];
  const deps = {
    getRoll: async () => { calls.push("roll"); return { ...roll }; },
    composePoem: async (_config, result, { onDraft }) => {
      calls.push("poem"); assert.equal((await day(config)).result.number, result.number);
      await onDraft({ tiles: [{ id: "MOUNTAIN_0" }], text: "mountains rise" });
      assert.ok((await day(config)).poemDraft);
      return { text: "mountains rise", model: "deepseek-flash", reused: false };
    },
    sendRoll: async (_config, _date, result) => { calls.push("mail"); assert.equal(result.poem, "mountains rise"); return { messageId: "1" }; },
  };
  await run(config, deps);
  assert.deepEqual(calls, ["roll", "poem", "mail"]);
  assert.equal((await day(config)).status, "success");
  assert.equal((await day(config)).poemDraft, undefined);
  assert.equal((await run(config, deps)).skipped, true);
  assert.equal(calls.length, 3);
});

test("poem failure preserves draft, schedules a separate retry, and never rerolls", async (context) => {
  const config = await setup(context);
  let rolls = 0;
  let mails = 0;
  const draft = { tiles: [{ id: "MOUNTAIN_0" }], text: "mountains rise" };
  const deps = {
    getRoll: async () => { rolls++; return { ...roll }; },
    composePoem: async (_config, _result, { onDraft }) => { await onDraft(draft); throw new Error("submit timed out"); },
    sendRoll: async () => { mails++; return { messageId: "1" }; },
  };
  await assert.rejects(run(config, deps), /submit timed out/);
  const pending = await day(config);
  assert.equal(pending.status, "poem_pending");
  assert.ok(pending.nextPoemRetryAt);
  assert.equal(pending.nextEmailRetryAt, null);
  assert.equal(mails, 0);
  deps.composePoem = async (_config, _result, options) => { assert.deepEqual(options.draft, draft); return { text: draft.text, reused: true }; };
  await run(config, deps);
  assert.equal(rolls, 1);
  assert.equal(mails, 1);
  assert.equal((await day(config)).poemAttempts, 2);
});

test("email failure retries delivery without regenerating or resubmitting the poem", async (context) => {
  const config = await setup(context);
  let poems = 0;
  const deps = {
    getRoll: async () => ({ ...roll }),
    composePoem: async () => { poems++; return { text: "mountains rise" }; },
    sendRoll: async () => { throw new Error("smtp unavailable"); },
  };
  await assert.rejects(run(config, deps), /smtp unavailable/);
  assert.equal((await day(config)).status, "email_pending");
  assert.equal((await day(config)).nextPoemRetryAt, null);
  deps.sendRoll = async () => ({ messageId: "ok" });
  await run(config, deps);
  assert.equal(poems, 1);
  assert.equal((await day(config)).emailAttempts, 2);
});

test("disabled poetry preserves the existing daily workflow", async (context) => {
  const config = await setup(context, false);
  await run(config, { getRoll: async () => ({ ...roll }), composePoem: async () => assert.fail("poetry disabled"), sendRoll: async () => ({ messageId: "ok" }) });
  assert.equal((await day(config)).status, "success");
});

test("manual poem command can complete an already emailed day without another email", async (context) => {
  const config = await setup(context);
  await writeState(config.storage.statePath, { version: 1, days: { [date]: { status: "success", result: { ...roll }, emailSentAt: "2026-09-19T00:02:00Z" } } });
  await run(config, { poemOnly: true, getRoll: async () => assert.fail("must not roll"), composePoem: async () => ({ text: "mountains rise" }), sendRoll: async () => assert.fail("must not send mail") });
  assert.equal((await day(config)).status, "success");
  assert.equal((await day(config)).result.poem, "mountains rise");
});
