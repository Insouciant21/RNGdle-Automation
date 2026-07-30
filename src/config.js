import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const ENV_PATTERN = /\$\{([A-Z_][A-Z0-9_]*)(:-([^}]*))?\}/g;

function expandEnvironment(value, env) {
  if (typeof value === "string") {
    return value.replace(ENV_PATTERN, (_, name, defaultExpression, defaultValue) => {
      if (!(name in env) || env[name] === "") {
        if (defaultExpression) return defaultValue;
        throw new Error(`Missing required environment variable: ${name}`);
      }
      return env[name];
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandEnvironment(item, env));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandEnvironment(item, env)]),
    );
  }
  return value;
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Configuration field ${field} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value, field) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Configuration field ${field} must be a positive integer`);
  }
  return number;
}

function booleanValue(value, field) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Configuration field ${field} must be true or false`);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function validateTime(value) {
  const time = requiredString(value, "schedule.time");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error("Configuration field schedule.time must use HH:mm (24-hour) format");
  }
  return time;
}

export async function loadConfig(configPath = process.env.CONFIG_PATH ?? "./config/config.yaml", env = process.env) {
  const absoluteConfigPath = path.resolve(configPath);
  let source;
  try {
    source = await fs.readFile(absoluteConfigPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Configuration file not found: ${absoluteConfigPath}. Start from config/config.example.yaml.`);
    }
    throw error;
  }

  const raw = expandEnvironment(YAML.parse(source), env);
  const configuredRecipients = raw.smtp?.to;
  const recipients = Array.isArray(configuredRecipients)
    ? configuredRecipients
    : typeof configuredRecipients === "string"
      ? configuredRecipients.split(",")
      : [];
  if (recipients.length === 0) {
    throw new Error("Configuration field smtp.to must contain at least one recipient");
  }

  const storageDirectory = path.resolve(raw.storage?.directory ?? "./data");
  const controlPublicUrl = requiredString(raw.control?.publicUrl ?? "http://localhost:3000", "control.publicUrl").replace(
    /\/$/,
    "",
  );
  const smtpUsername = requiredString(raw.smtp?.username, "smtp.username");
  const smtpAuthMode = requiredString(raw.smtp?.authMode ?? "password", "smtp.authMode").toLowerCase();
  if (!new Set(["password", "oauth2"]).has(smtpAuthMode)) {
    throw new Error("Configuration field smtp.authMode must be password or oauth2");
  }
  const smtpPassword = optionalString(raw.smtp?.password);
  const oauthClientId = optionalString(raw.smtp?.oauth?.clientId);
  const oauthClientSecret = optionalString(raw.smtp?.oauth?.clientSecret);
  const oauthRefreshToken = optionalString(raw.smtp?.oauth?.refreshToken);
  if (smtpAuthMode === "password" && !smtpPassword) {
    throw new Error("Configuration field smtp.password is required for password authentication");
  }
  if (smtpAuthMode === "oauth2" && (!oauthClientId || !oauthClientSecret || !oauthRefreshToken)) {
    throw new Error("smtp.oauth.clientId, clientSecret, and refreshToken are required for OAuth2 authentication");
  }
  const config = {
    timezone: requiredString(raw.timezone ?? "Asia/Shanghai", "timezone"),
    schedule: {
      time: validateTime(raw.schedule?.time ?? "08:02"),
      retryMinutes: positiveInteger(raw.schedule?.retryMinutes ?? 30, "schedule.retryMinutes"),
      pollSeconds: positiveInteger(raw.schedule?.pollSeconds ?? 30, "schedule.pollSeconds"),
    },
    rngdle: {
      baseUrl: requiredString(raw.rngdle?.baseUrl ?? "https://www.rngdle.com", "rngdle.baseUrl").replace(/\/$/, ""),
      email: requiredString(raw.rngdle?.email, "rngdle.email"),
    },
    browser: {
      headless: booleanValue(raw.browser?.headless ?? true, "browser.headless"),
      timeoutMs: positiveInteger(raw.browser?.timeoutMs ?? 45_000, "browser.timeoutMs"),
    },
    control: {
      port: positiveInteger(raw.control?.port ?? 3000, "control.port"),
      publicUrl: controlPublicUrl,
    },
    smtp: {
      host: requiredString(raw.smtp?.host, "smtp.host"),
      port: positiveInteger(raw.smtp?.port, "smtp.port"),
      secure: booleanValue(raw.smtp?.secure ?? true, "smtp.secure"),
      requireTls: booleanValue(raw.smtp?.requireTls ?? false, "smtp.requireTls"),
      username: smtpUsername,
      authMode: smtpAuthMode,
      password: smtpPassword,
      oauth: {
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        refreshToken: oauthRefreshToken,
        tenantId: optionalString(raw.smtp?.oauth?.tenantId) ?? "consumers",
      },
      from: optionalString(raw.smtp?.from) ?? smtpUsername,
      to: recipients.map((recipient, index) => requiredString(recipient, `smtp.to[${index}]`)),
    },
    mail: {
      fromName: requiredString(raw.mail?.fromName ?? "RNGdle Today", "mail.fromName"),
      subjectPrefix: requiredString(raw.mail?.subjectPrefix ?? "[RNGdle]", "mail.subjectPrefix"),
    },
    storage: {
      directory: storageDirectory,
      profileDirectory: path.join(storageDirectory, "browser-profile"),
      statePath: path.join(storageDirectory, "state.json"),
      settingsPath: path.join(storageDirectory, "settings.json"),
      lockPath: path.join(storageDirectory, "workflow.lock"),
    },
  };

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format();
    new URL(config.rngdle.baseUrl);
    new URL(config.control.publicUrl);
  } catch (error) {
    throw new Error(`Invalid timezone or URL in configuration: ${error.message}`);
  }

  return config;
}
