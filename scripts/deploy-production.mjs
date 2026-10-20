#!/usr/bin/env node
// Build and deploy with the same production configuration. Credentials remain
// existing Worker secrets; only known non-secret overrides enter the build.
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { workerBuildConfig } from "./worker-config.mjs";
import { splitWorkerBindings } from "../src/cloud/config.js";

const production = JSON.parse(await fs.readFile("wrangler.production.jsonc", "utf8"));
const overrides = JSON.parse(await fs.readFile(process.env.SECRETS_PATH ?? "data/cloudflare-secrets.json", "utf8"));
const config = workerBuildConfig(production, { ...splitWorkerBindings(overrides).vars, ...process.env });
const configPath = "wrangler.workers-build.jsonc";
await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
await fs.chmod(configPath, 0o600);

function run(args, env = process.env) {
  const result = spawnSync("pnpm", args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["build"], { ...process.env, CLOUDFLARE_WRANGLER_CONFIG: configPath });
run(["exec", "wrangler", "deploy", ...process.argv.slice(2)]);
