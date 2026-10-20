import { normalizeConfig } from "../config.js";

// Worker variable names, configuration paths, and secret classification.
const ENV_FIELDS = [
  ["TZ", ["timezone"]],
  ["SCHEDULE_TIME", ["schedule", "time"]],
  ["RETRY_MINUTES", ["schedule", "retryMinutes"]],
  ["EMAIL_RETRY_MINUTES", ["schedule", "emailRetryMinutes"]],
  ["RNGDLE_EMAIL", ["rngdle", "email"], true],
  ["HTTP_TIMEOUT_MS", ["http", "timeoutMs"]],
  ["CONTROL_SESSION_DAYS", ["control", "sessionDays"]],
  ["SMTP_HOST", ["smtp", "host"]],
  ["SMTP_PORT", ["smtp", "port"]],
  ["SMTP_SECURE", ["smtp", "secure"]],
  ["SMTP_REQUIRE_TLS", ["smtp", "requireTls"]],
  ["SMTP_AUTH_MODE", ["smtp", "authMode"]],
  ["SMTP_USER", ["smtp", "username"], true],
  ["SMTP_PASSWORD", ["smtp", "password"], true],
  ["SMTP_OAUTH_CLIENT_ID", ["smtp", "oauth", "clientId"], true],
  ["SMTP_OAUTH_CLIENT_SECRET", ["smtp", "oauth", "clientSecret"], true],
  ["SMTP_OAUTH_REFRESH_TOKEN", ["smtp", "oauth", "refreshToken"], true],
  ["SMTP_OAUTH_ACCESS_URL", ["smtp", "oauth", "accessUrl"], true],
  ["MAIL_FROM", ["smtp", "from"], true],
  ["MAIL_TO", ["smtp", "to"], true],
  ["MAIL_FROM_NAME", ["mail", "fromName"]],
  ["MAIL_SUBJECT_PREFIX", ["mail", "subjectPrefix"]],
  ["POEM_ENABLED", ["poem", "enabled"]],
  ["POEM_RETRY_MINUTES", ["poem", "retryMinutes"]],
  ["RETURN_LIKES_ENABLED", ["likes", "enabled"]],
  ["RETURN_LIKES_POLL_MINUTES", ["likes", "pollMinutes"]],
  ["RETURN_LIKES_MAX_PER_DAY", ["likes", "maxPerDay"]],
  ["RETURN_LIKES_LOOKBACK_DAYS", ["likes", "lookbackDays"]],
  ["LLM_ENDPOINT", ["llm", "endpoint"]],
  ["LLM_API_KEY", ["llm", "apiKey"], true],
  ["LLM_MODEL", ["llm", "model"]],
  ["LLM_TIMEOUT_MS", ["llm", "timeoutMs"]],
  ["LLM_MAX_TOKENS", ["llm", "maxTokens"]],
  ["LLM_MAX_ATTEMPTS", ["llm", "maxAttempts"]],
  ["LLM_THINKING", ["llm", "thinking"]],
];

function assign(target, path, value) {
  let node = target;
  for (const key of path.slice(0, -1)) node = node[key] ??= {};
  node[path.at(-1)] = value;
}

function valueAt(source, path) {
  let node = source;
  for (const key of path) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[key];
  }
  return node;
}

function rawFromEnv(env) {
  const raw = {};
  for (const [name, path] of ENV_FIELDS) {
    const value = env[name];
    // Workers delivers empty variables as ""; treat them as unset so defaults apply.
    if (typeof value === "string" && value.trim() !== "") assign(raw, path, value.trim());
  }
  return raw;
}

// Use one classification for builds and secret uploads. Ignore unrelated build
// variables so a new credential can never accidentally become a visible var.
export function splitWorkerBindings(env) {
  const vars = {};
  const secrets = {};
  const fields = [...ENV_FIELDS, ["MIGRATION_TOKEN", null, true]];
  for (const [name, , sensitive] of fields) {
    const value = env[name];
    if (typeof value === "string" && value.trim() !== "") {
      (sensitive ? secrets : vars)[name] = value.trim();
    }
  }
  return { vars, secrets };
}

export async function workerConfig(env, storage) {
  const publicUrl = env.CONTROL_PUBLIC_URL?.trim();
  if (!publicUrl) throw new Error("CONTROL_PUBLIC_URL is required");
  let config;
  try {
    const raw = rawFromEnv(env);
    raw.control = { ...raw.control, publicUrl };
    config = normalizeConfig(raw);
  } catch (error) {
    throw new Error(`Worker configuration error: ${error.message}`);
  }
  config.storage = { adapter: storage };
  return config;
}

// Inverse of rawFromEnv for tooling and tests: flattens a validated config
// into the individual variable names. CONTROL_PUBLIC_URL is deliberately
// excluded because wrangler.jsonc already declares it as a plain var and a
// same-named secret would collide on deploy.
export function configToEnv(config) {
  const vars = {};
  for (const [name, path] of ENV_FIELDS) {
    const value = valueAt(config, path);
    if (value !== undefined && value !== null) vars[name] = String(value);
  }
  if (Array.isArray(config.smtp?.to)) vars.MAIL_TO = config.smtp.to.join(",");
  return vars;
}
