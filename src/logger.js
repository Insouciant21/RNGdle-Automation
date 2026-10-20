import { AsyncLocalStorage } from "node:async_hooks";

const sinks = new AsyncLocalStorage();
export const withLogSink = (sink, operation) => sinks.run(sink, operation);

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
      /password|secret|token|cookie|authorization|api[_-]?key/i.test(key) ? "[redacted]" : sanitizedValue(nestedValue),
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
  const entry = { timestamp, level, message, fields: safeFields };
  sinks.getStore()?.(entry);
  const line = `${timestamp} ${level.toUpperCase()} ${message}${serialize(safeFields)}`;
  const output = level === "error" ? console.error : console.log;
  output(line);
}
