import { splitWorkerBindings } from "../src/cloud/config.js";

export function workerBuildConfig(source, env = {}) {
  const config = structuredClone(source);
  const value = (name) => env[name]?.trim() || undefined;
  const { secrets } = splitWorkerBindings(config.vars ?? {});
  const secretNames = Object.keys(secrets);
  if ("CONFIG_JSON" in (config.vars ?? {})) secretNames.push("CONFIG_JSON");
  if (secretNames.length) throw new Error(`Use Worker secrets for: ${secretNames.join(", ")}`);

  config.vars = { ...config.vars, ...splitWorkerBindings(env).vars };
  if (value("WORKER_NAME")) config.name = value("WORKER_NAME");
  if (value("CONTROL_PUBLIC_URL")) {
    const url = new URL(value("CONTROL_PUBLIC_URL"));
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("CONTROL_PUBLIC_URL must use HTTPS without credentials");
    }
    config.vars.CONTROL_PUBLIC_URL = url.origin;
  }
  if (value("ALLOW_SETUP")) {
    if (!["true", "false"].includes(value("ALLOW_SETUP"))) throw new Error("ALLOW_SETUP must be true or false");
    config.vars.ALLOW_SETUP = value("ALLOW_SETUP");
  }

  const customDomain = value("CUSTOM_DOMAIN");
  if (customDomain) {
    const zoneName = value("ZONE_NAME");
    if (!zoneName) throw new Error("ZONE_NAME is required when CUSTOM_DOMAIN is set");
    if (/^https?:\/\//i.test(customDomain) || customDomain.includes("/")) {
      throw new Error("CUSTOM_DOMAIN must be a hostname without protocol or path");
    }
    config.routes = [{ pattern: `${customDomain}/*`, zone_name: zoneName }];
    config.workers_dev = false;
  }
  return config;
}
