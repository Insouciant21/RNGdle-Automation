const MAX_RECENT_LOGS = 250;
const recentLogs = [];
let nextLogId = 1;

function serialize(fields) {
  if (!fields || Object.keys(fields).length === 0) return "";
  return ` ${JSON.stringify(fields)}`;
}

function sanitizedValue(value) {
  if (Array.isArray(value)) return value.map(sanitizedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      /password|secret|token|cookie|authorization/i.test(key) ? "[redacted]" : sanitizedValue(nestedValue),
    ]),
  );
}

function sanitizedFields(fields) {
  if (!fields || typeof fields !== "object") return {};
  return sanitizedValue(fields);
}

export function errorSummary(error, maxLength = 500) {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split(/\r?\n/, 1)[0].trim() || "Unknown error";
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength - 3)}...` : firstLine;
}

export function log(level, message, fields = {}) {
  const timestamp = new Date().toISOString();
  const safeFields = sanitizedFields(fields);
  const entry = { id: nextLogId++, timestamp, level, message, fields: safeFields };
  recentLogs.push(entry);
  if (recentLogs.length > MAX_RECENT_LOGS) recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
  const line = `${timestamp} ${level.toUpperCase()} ${message}${serialize(safeFields)}`;
  const output = level === "error" ? console.error : console.log;
  output(line);
}

export function getRecentLogs({ limit = 100, level = "all", after = 0 } = {}) {
  const normalizedLimit = Math.max(1, Math.min(200, Number(limit) || 100));
  return recentLogs
    .filter((entry) => entry.id > Number(after || 0) && (level === "all" || entry.level === level))
    .slice(-normalizedLimit)
    .map((entry) => structuredClone(entry));
}
