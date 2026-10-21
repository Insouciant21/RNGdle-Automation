import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { configToEnv, splitWorkerBindings } from "../src/cloud/config.js";
import { workerBuildConfig } from "../scripts/worker-config.mjs";
import { fixtureConfig } from "./helpers/cloud-fixture.js";

const source = JSON.parse(await fs.readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("build variables and bulk secrets keep credentials and personal addresses separate", () => {
  const env = { ...configToEnv(fixtureConfig), CONTROL_PASSWORD: " private-control-password ", MIGRATION_TOKEN: "private-management-token", CLOUDFLARE_API_TOKEN: "private-build-token" };
  const { vars, secrets } = splitWorkerBindings(env);
  assert.equal(vars.SCHEDULE_TIME, undefined);
  assert.equal(vars.TZ, undefined);
  assert.equal(vars.RETURN_LIKES_POLL_MINUTES, "60");
  for (const name of ["RNGDLE_EMAIL", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM", "MAIL_TO", "LLM_API_KEY", "MIGRATION_TOKEN", "CONTROL_PASSWORD"]) {
    assert.equal(vars[name], undefined);
    assert.equal(secrets[name], env[name]);
  }
  assert.equal(secrets.SCHEDULE_TIME, undefined);
  assert.equal(secrets.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(vars.CLOUDFLARE_API_TOKEN, undefined);
  assert.equal(workerBuildConfig(source, env).vars.SMTP_PASSWORD, undefined);
});

test("build overrides update the deployment target without changing the public template", () => {
  const snapshot = structuredClone(source);
  const config = workerBuildConfig(source, {
    WORKER_NAME: "custom-worker", CONTROL_PUBLIC_URL: "https://control.example.com/",
    CUSTOM_DOMAIN: "control.example.com", ZONE_NAME: "example.com",
    TZ: "America/New_York", SCHEDULE_TIME: "09:00", RETURN_LIKES_POLL_MINUTES: "60", RNGDLE_EMAIL: "private@example.com",
    MAIL_FROM_NAME: "Custom sender", MAIL_SUBJECT_PREFIX: "[Custom]",
  });
  assert.equal(config.name, "custom-worker");
  assert.equal(config.vars.SCHEDULE_TIME, undefined);
  assert.equal(config.vars.TZ, undefined);
  assert.equal(config.vars.MAIL_FROM_NAME, undefined);
  assert.equal(config.vars.MAIL_SUBJECT_PREFIX, undefined);
  assert.equal(config.vars.CONTROL_PUBLIC_URL, "https://control.example.com");
  assert.equal(config.vars.RNGDLE_EMAIL, undefined);
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.routes, [{ pattern: "control.example.com/*", zone_name: "example.com" }]);
  assert.deepEqual(source, snapshot);
  assert.deepEqual(workerBuildConfig(config).routes, config.routes);
  assert.equal(workerBuildConfig(config).workers_dev, false);
});

test("invalid deployment overrides and secrets embedded in plain vars are rejected", () => {
  for (const env of [
    { CONTROL_PUBLIC_URL: "http://control.example.com" },
    { CONTROL_PUBLIC_URL: "https://user:password@control.example.com" },
    { CUSTOM_DOMAIN: "control.example.com" },
    { CUSTOM_DOMAIN: "https://control.example.com/", ZONE_NAME: "example.com" },
  ]) assert.throws(() => workerBuildConfig(source, env));
  for (const name of ["SMTP_PASSWORD", "RNGDLE_EMAIL", "CONFIG_JSON", "CONTROL_PASSWORD"]) {
    assert.throws(() => workerBuildConfig({ ...source, vars: { ...source.vars, [name]: "private" } }), /Use Worker secrets/);
  }
});

test("production deployment builds with production vars and stops before deploying a failed build", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-deploy-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, "bin");
  await fs.mkdir(bin);
  const production = workerBuildConfig(source, {
    WORKER_NAME: "production-worker", CONTROL_PUBLIC_URL: "https://control.example.com",
    CUSTOM_DOMAIN: "control.example.com", ZONE_NAME: "example.com",
  });
  await fs.writeFile(path.join(directory, "wrangler.production.jsonc"), JSON.stringify(production));
  const secretsPath = path.join(directory, "bindings.json");
  await fs.writeFile(secretsPath, JSON.stringify(configToEnv(fixtureConfig)));
  await fs.writeFile(path.join(bin, "pnpm"), `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
const configPath = process.env.CLOUDFLARE_WRANGLER_CONFIG;
const config = args[0] === "build" ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null;
fs.appendFileSync("commands.jsonl", JSON.stringify({ args, config }) + "\\n");
if (args[0] === "build" && process.env.FAIL_BUILD === "true") process.exit(17);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, SECRETS_PATH: secretsPath };
  for (const name of ["WORKER_NAME", "CONTROL_PUBLIC_URL", "CUSTOM_DOMAIN", "ZONE_NAME", "CLOUDFLARE_WRANGLER_CONFIG"]) delete env[name];
  const script = fileURLToPath(new URL("../scripts/deploy-production.mjs", import.meta.url));
  const run = (extra = {}) => spawnSync(process.execPath, [script, "--dry-run"], { cwd: directory, env: { ...env, ...extra }, encoding: "utf8" });
  const success = run();
  assert.equal(success.status, 0, success.stderr);
  const commands = (await fs.readFile(path.join(directory, "commands.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(commands.map((entry) => entry.args), [["build"], ["exec", "wrangler", "deploy", "--dry-run"]]);
  assert.equal(commands[0].config.name, "production-worker");
  assert.equal(commands[0].config.vars.CONTROL_PUBLIC_URL, "https://control.example.com");
  assert.equal(commands[0].config.vars.CONTROL_PASSWORD, undefined);
  assert.equal(commands[0].config.vars.SMTP_PORT, "465");
  assert.equal(commands[0].config.vars.SMTP_PASSWORD, undefined);
  assert.deepEqual(commands[0].config.routes, production.routes);

  assert.equal(run({ FAIL_BUILD: "true" }).status, 17);
  const after = (await fs.readFile(path.join(directory, "commands.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(after.length, 3);
  assert.deepEqual(after[2].args, ["build"]);
});
