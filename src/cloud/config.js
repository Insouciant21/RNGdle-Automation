import { applySettings, validateSettings } from "../settings.js";

// CONFIG_JSON is a Worker secret, never a client-side environment variable.
export async function workerConfig(env, storage) {
  if (!env.CONFIG_JSON) throw new Error("Worker configuration has not been imported");
  const config = JSON.parse(env.CONFIG_JSON);
  config.storage = { adapter: storage };
  config.control.initialPassword = null;
  config.control.cookieSecure = true;
  const settings = await storage.get("settings");
  if (settings) applySettings(config, validateSettings(settings.values, config));
  // A stale runtime override from Docker must never change the public origin.
  const publicUrl = env.CONTROL_PUBLIC_URL ?? config.control.publicUrl;
  if (!publicUrl) throw new Error("CONTROL_PUBLIC_URL is required");
  config.control.publicUrl = publicUrl.replace(/\/$/, "");
  return config;
}
