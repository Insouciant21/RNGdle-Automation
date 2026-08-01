import fs from "node:fs/promises";
import path from "node:path";

const SETTINGS_VERSION = 1;

function stringValue(value, field, { max = 500, allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!allowEmpty && normalized === "") throw new Error(`${field} must not be empty`);
  if (normalized.length > max) throw new Error(`${field} is too long`);
  return normalized;
}

function integerValue(value, field, min, max) {
  const normalized = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return normalized;
}

function booleanValue(value, field) {
  if (value !== true && value !== false) throw new Error(`${field} must be true or false`);
  return value;
}

function emailValue(value, field) {
  const email = stringValue(value, field, { max: 254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${field} must be an email address`);
  return email;
}

function urlValue(value, field, protocols) {
  const candidate = stringValue(value, field, { max: 2_000 });
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol)) throw new Error(`${field} uses an unsupported protocol`);
  return candidate.replace(/\/$/, "");
}

function timezoneValue(value) {
  const timezone = stringValue(value, "timezone", { max: 100 });
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return timezone;
}

function timeValue(value) {
  const time = stringValue(value, "scheduleTime", { max: 5 });
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("scheduleTime must use HH:mm format");
  return time;
}

function recipientValues(value) {
  const source = Array.isArray(value) ? value : stringValue(value, "mailTo", { max: 2_000 }).split(",");
  if (source.length === 0 || source.length > 20) throw new Error("mailTo must contain between 1 and 20 recipients");
  return source.map((recipient, index) => emailValue(String(recipient), `mailTo[${index}]`));
}

export function publicSettings(config) {
  return {
    timezone: config.timezone,
    scheduleTime: config.schedule.time,
    rngdleRetryMinutes: config.schedule.retryMinutes,
    emailRetryMinutes: config.schedule.emailRetryMinutes ?? 1,
    pollSeconds: config.schedule.pollSeconds,
    rngdleEmail: config.rngdle.email,
    browserTimeoutMs: config.browser.timeoutMs,
    controlPublicUrl: config.control.publicUrl,
    smtpHost: config.smtp.host,
    smtpPort: config.smtp.port,
    smtpSecure: config.smtp.secure,
    smtpRequireTls: config.smtp.requireTls,
    smtpUsername: config.smtp.username,
    smtpFrom: config.smtp.from,
    mailTo: config.smtp.to.join(", "),
    mailFromName: config.mail.fromName ?? "RNGdle Today",
    mailSubjectPrefix: config.mail.subjectPrefix,
    hasSmtpPassword: Boolean(config.smtp.password),
  };
}

export function validateSettings(input, config) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings payload must be an object");
  const passwordInput = typeof input.smtpAppPassword === "string" ? input.smtpAppPassword.trim() : "";
  if (passwordInput.length > 512) throw new Error("smtpAppPassword is too long");
  return {
    timezone: timezoneValue(input.timezone ?? config.timezone),
    scheduleTime: timeValue(input.scheduleTime ?? config.schedule.time),
    rngdleRetryMinutes: integerValue(
      input.rngdleRetryMinutes ?? input.retryMinutes ?? config.schedule.retryMinutes,
      "rngdleRetryMinutes",
      1,
      1_440,
    ),
    emailRetryMinutes: integerValue(
      input.emailRetryMinutes ?? config.schedule.emailRetryMinutes ?? 1,
      "emailRetryMinutes",
      1,
      1_440,
    ),
    pollSeconds: integerValue(input.pollSeconds ?? config.schedule.pollSeconds, "pollSeconds", 5, 3_600),
    rngdleEmail: emailValue(input.rngdleEmail ?? config.rngdle.email, "rngdleEmail"),
    browserTimeoutMs: integerValue(
      input.browserTimeoutMs ?? config.browser.timeoutMs,
      "browserTimeoutMs",
      5_000,
      300_000,
    ),
    controlPublicUrl: urlValue(
      input.controlPublicUrl ?? config.control.publicUrl,
      "controlPublicUrl",
      ["http:", "https:"],
    ),
    smtpHost: stringValue(input.smtpHost ?? config.smtp.host, "smtpHost", { max: 253 }),
    smtpPort: integerValue(input.smtpPort ?? config.smtp.port, "smtpPort", 1, 65_535),
    smtpSecure: booleanValue(input.smtpSecure ?? config.smtp.secure, "smtpSecure"),
    smtpRequireTls: booleanValue(input.smtpRequireTls ?? config.smtp.requireTls, "smtpRequireTls"),
    smtpUsername: emailValue(input.smtpUsername ?? config.smtp.username, "smtpUsername"),
    smtpFrom: emailValue(input.smtpFrom || input.smtpUsername || config.smtp.from, "smtpFrom"),
    mailTo: recipientValues(input.mailTo ?? config.smtp.to),
    mailFromName: stringValue(input.mailFromName ?? config.mail.fromName ?? "RNGdle Today", "mailFromName", {
      max: 100,
    }),
    mailSubjectPrefix: stringValue(input.mailSubjectPrefix ?? config.mail.subjectPrefix, "mailSubjectPrefix", {
      max: 100,
    }),
    smtpAppPassword: passwordInput || config.smtp.password,
  };
}

export function applySettings(config, settings) {
  config.timezone = settings.timezone;
  config.schedule.time = settings.scheduleTime;
  config.schedule.retryMinutes = settings.rngdleRetryMinutes;
  config.schedule.emailRetryMinutes = settings.emailRetryMinutes;
  config.schedule.pollSeconds = settings.pollSeconds;
  config.rngdle.email = settings.rngdleEmail;
  config.browser.timeoutMs = settings.browserTimeoutMs;
  config.control.publicUrl = settings.controlPublicUrl;
  config.smtp.host = settings.smtpHost;
  config.smtp.port = settings.smtpPort;
  config.smtp.secure = settings.smtpSecure;
  config.smtp.requireTls = settings.smtpRequireTls;
  config.smtp.username = settings.smtpUsername;
  config.smtp.from = settings.smtpFrom;
  config.smtp.to = [...settings.mailTo];
  config.smtp.password = settings.smtpAppPassword;
  config.mail.fromName = settings.mailFromName;
  config.mail.subjectPrefix = settings.mailSubjectPrefix;
}

async function writeSettings(settingsPath, settings) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
  const document = { version: SETTINGS_VERSION, updatedAt: new Date().toISOString(), values: settings };
  await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, settingsPath);
}

export async function loadRuntimeSettings(config) {
  let document;
  try {
    document = JSON.parse(await fs.readFile(config.storage.settingsPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error(`Unable to read runtime settings: ${error.message}`);
  }
  if (document.version !== SETTINGS_VERSION || !document.values) {
    throw new Error("Unsupported runtime settings format");
  }
  const settings = validateSettings(document.values, config);
  applySettings(config, settings);
  return true;
}

export async function saveRuntimeSettings(config, input) {
  const settings = validateSettings(input, config);
  await writeSettings(config.storage.settingsPath, settings);
  applySettings(config, settings);
  return publicSettings(config);
}
