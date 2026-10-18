#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/config.js";

const [command, ...args] = process.argv.slice(2);
const credentialsPath = process.env.MIGRATION_CREDENTIALS ?? "data/cloudflare-migration.json";
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function privateFile(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await fs.chmod(file, 0o600);
}
const read = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
function run(program, values, options = {}) {
  const result = spawnSync(program, values, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || `${program} failed`);
  return result.stdout;
}
async function cf(resource, options = {}) {
  let token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    const source = await fs.readFile(path.join(os.homedir(), ".config/.wrangler/config/default.toml"), "utf8");
    token = source.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  }
  if (!token) throw new Error("Run pnpm exec wrangler login first");
  const response = await fetch(`https://api.cloudflare.com/client/v4${resource}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = await response.json();
  if (!data.success) throw new Error(`Cloudflare API ${response.status}: ${JSON.stringify(data.errors)}`);
  return data.result;
}
async function endpoint(action, method = "GET", payload) {
  const credentials = await read(credentialsPath);
  const origin = process.env.MIGRATION_ORIGIN ?? credentials.origin;
  if (!origin) throw new Error("Set MIGRATION_ORIGIN to the deployed Worker URL");
  const response = await fetch(new URL(`/__migration/${action}`, origin), {
    method,
    headers: { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? `HTTP ${response.status}`);
  return result;
}

if (command === "init") {
  const publicUrl = args[0] ?? process.env.CONTROL_PUBLIC_URL;
  if (!publicUrl) throw new Error("Usage: pnpm cloudflare:init https://your-worker-name.your-subdomain.workers.dev");
  process.env.CONTROL_PUBLIC_URL = publicUrl;
  const config = await loadConfig();
  delete config.storage;
  config.control.publicUrl = publicUrl.replace(/\/$/, "");
  config.control.cookieSecure = true;
  config.control.initialPassword = null;
  let credentials;
  try { credentials = await read(credentialsPath); }
  catch (error) { if (error.code !== "ENOENT") throw error; credentials = { token: crypto.randomBytes(32).toString("hex") }; }
  await privateFile("data/cloudflare-config.json", config);
  await privateFile(credentialsPath, credentials);
  await privateFile("data/cloudflare-secrets.json", { CONFIG_JSON: JSON.stringify(config), MIGRATION_TOKEN: credentials.token });
  console.log(JSON.stringify({ config: "data/cloudflare-config.json", secrets: "data/cloudflare-secrets.json", controlUrl: config.control.publicUrl }, null, 2));
} else if (command === "export") {
  const [destination = "data/legacy-snapshot.json", host, directory] = args;
  if (!host || !directory) throw new Error("Usage: pnpm cloudflare export <file> <user@host> <remote-project-directory>");
  const controlPublicUrl = process.env.CONTROL_PUBLIC_URL;
  if (!controlPublicUrl) throw new Error("Set CONTROL_PUBLIC_URL to the new Control URL before export");
  const code = `
    import fs from 'node:fs/promises';
    import {loadConfig} from './src/config.js';
    import {loadRuntimeSettings} from './src/settings.js';
    const config = await loadConfig();
    await loadRuntimeSettings(config);
    const read = async (name) => {try {return JSON.parse(await fs.readFile(config.storage.directory+'/'+name+'.json','utf8'));} catch(error) {if(error.code==='ENOENT')return null;throw error;}};
    const data={version:1,exportedAt:new Date().toISOString(),config,state:await read('state'),cookies:await read('cookies'),settings:await read('settings'),auth:await read('control-auth')};
    delete config.storage;
    config.control.initialPassword=null;
    config.control.publicUrl=process.env.CONTROL_PUBLIC_URL;
    config.control.cookieSecure=true;
    if(data.auth){data.auth.sessions=[];data.auth.failures={};}
    process.stdout.write(JSON.stringify(data));
  `;
  const remote = `cd ${shellQuote(directory)} && docker compose run --rm --no-deps -T rngdle node --input-type=module -e ${shellQuote(code)}`;
  const data = JSON.parse(run("ssh", ["-F", "/dev/null", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, remote], { maxBuffer: 4 * 1024 * 1024 }));
  await privateFile(destination, data);
  console.log(JSON.stringify({ file: destination, days: Object.keys(data.state.days).length, exportedAt: data.exportedAt }));
} else if (command === "secrets") {
  const snapshot = await read(args[0] ?? "data/legacy-snapshot.json");
  let credentials;
  try { credentials = await read(credentialsPath); }
  catch (error) { if (error.code !== "ENOENT") throw error; credentials = { token: crypto.randomBytes(32).toString("hex") }; }
  await privateFile(credentialsPath, credentials);
  const secrets = { CONFIG_JSON: JSON.stringify(snapshot.config), MIGRATION_TOKEN: credentials.token };
  if (args.includes("--local")) {
    await fs.writeFile(".dev.vars", Object.entries(secrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
    console.log("Local Worker secrets saved to .dev.vars");
  } else {
    console.log(run("pnpm", ["exec", "wrangler", "secret", "bulk", ...(args.includes("--staging") ? ["--env", "staging"] : [])], { input: JSON.stringify(secrets) }));
  }
} else if (command === "origin") {
  const credentials = await read(credentialsPath);
  credentials.origin = args[0];
  await privateFile(credentialsPath, credentials);
  console.log(`Migration origin: ${credentials.origin}`);
} else if (command === "import") {
  console.log(JSON.stringify(await endpoint("import", "POST", await read(args[0] ?? "data/legacy-snapshot.json"))));
} else if (["status", "pause", "resume"].includes(command)) {
  console.log(JSON.stringify(await endpoint(command, command === "status" ? "GET" : "POST"), null, 2));
} else if (command === "verify") {
  console.log(JSON.stringify(await endpoint("verify", "POST", { type: args[0] }), null, 2));
} else if (command === "backup") {
  const destination = args[0] ?? `backups/workers-${new Date().toISOString().replaceAll(":", "-")}.json`;
  const data = await endpoint("export");
  await privateFile(destination, data);
  console.log(JSON.stringify({ file: destination, days: Object.keys(data.state.days).length }));
} else if (command === "preflight") {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const zoneName = process.env.CLOUDFLARE_ZONE_NAME;
  const hostname = process.env.CONTROL_HOSTNAME;
  if (!account || !zoneName || !hostname) throw new Error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_NAME, and CONTROL_HOSTNAME before preflight");
  const zones = await cf(`/zones?name=${encodeURIComponent(zoneName)}`);
  const domains = await cf(`/accounts/${account}/workers/domains`);
  let subscriptions = [];
  let subscriptionAccess = true;
  try { subscriptions = await cf(`/accounts/${account}/subscriptions`); }
  catch { subscriptionAccess = false; }
  const subdomain = await cf(`/accounts/${account}/workers/subdomain`);
  const zone = zones[0];
  const routes = await cf(`/zones/${zone.id}/workers/routes`);
  let dns = [];
  let dnsAccess = true;
  try { dns = await cf(`/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`); }
  catch { dnsAccess = false; }
  const domain = domains.filter((entry) => entry.hostname === hostname);
  await privateFile("data/cloudflare-preflight.json", { account, zone, domain, subscriptions, subdomain, dns, routes });
  console.log(JSON.stringify({ account, zone: zone?.name, zoneId: zone?.id, existingWorkerDomains: domain,
    subdomain: subdomain.subdomain, subscriptionAccess, dnsAccess, existingRoutes: routes,
    plans: subscriptions.map((entry) => ({ name: entry.rate_plan?.public_name ?? entry.rate_plan?.id, status: entry.state })) }, null, 2));
} else {
  console.log("Commands: init <url>, export <file> <user@host> <remote-project-directory>, secrets [file] [--local|--staging], origin <url>, import [file], status, pause, resume, verify <smtp|rngdle|poem|email>, backup [file], preflight");
  process.exitCode = command ? 1 : 0;
}
