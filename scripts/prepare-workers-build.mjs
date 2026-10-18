#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const sourcePath = "wrangler.jsonc";
const outputPath = "wrangler.workers-build.jsonc";
const value = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return undefined;
  return raw.trim();
};

const config = JSON.parse(await fs.readFile(sourcePath, "utf8"));
const workerName = value("WORKER_NAME");
const controlPublicUrl = value("CONTROL_PUBLIC_URL");
const allowSetup = value("ALLOW_SETUP");
const customDomain = value("CUSTOM_DOMAIN");
const zoneName = value("ZONE_NAME");

if (workerName) config.name = workerName;
if (controlPublicUrl) {
  const url = new URL(controlPublicUrl);
  if (url.protocol !== "https:") throw new Error("CONTROL_PUBLIC_URL must use HTTPS");
  config.vars = { ...config.vars, CONTROL_PUBLIC_URL: url.origin };
}
if (allowSetup) {
  if (!["true", "false"].includes(allowSetup)) throw new Error("ALLOW_SETUP must be true or false");
  config.vars = { ...config.vars, ALLOW_SETUP: allowSetup };
}

if (customDomain) {
  if (!zoneName) throw new Error("ZONE_NAME is required when CUSTOM_DOMAIN is set");
  if (/^https?:\/\//i.test(customDomain) || customDomain.includes("/")) throw new Error("CUSTOM_DOMAIN must be a hostname without protocol or path");
  config.routes = [{ pattern: `${customDomain}/*`, zone_name: zoneName }];
  config.workers_dev = false;
} else {
  delete config.routes;
  config.workers_dev = true;
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
console.log(`Prepared Wrangler config: ${outputPath}`);
