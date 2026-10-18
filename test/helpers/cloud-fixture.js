import crypto from "node:crypto";

export class MemoryStorage {
  data = new Map();
  alarm = null;
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async setAlarm(at) { this.alarm = Number(at); }
  async getAlarm() { return this.alarm; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(operation) { return operation(this); }
}

export const fixtureConfig = {
  timezone: "Asia/Shanghai",
  schedule: { time: "08:02", retryMinutes: 30, emailRetryMinutes: 1, pollSeconds: 30 },
  rngdle: { baseUrl: "https://www.rngdle.com", email: "player@example.com" },
  http: { timeoutMs: 45000 },
  control: { sessionDays: 7, publicUrl: "https://control.example.com", cookieSecure: true },
  smtp: { host: "smtp.example.com", port: 465, secure: true, requireTls: false, authMode: "password", password: "smtp-private", username: "sender@example.com", from: "sender@example.com", to: ["receiver@example.com"] },
  mail: { fromName: "RNGdle Today", subjectPrefix: "[RNGdle]" },
  poem: { enabled: true, retryMinutes: 5 },
  likes: { enabled: false, pollMinutes: 10, maxPerDay: 10, lookbackDays: 7 },
  llm: { endpoint: "https://api.deepseek.com", apiKey: "llm-private", model: "deepseek-flash", maxAttempts: 1, maxTokens: 2048, timeoutMs: 60000, thinking: "disabled" },
};

export async function bundle() {
  const salt = "migration-test-salt";
  const key = await new Promise((resolve, reject) => crypto.scrypt("control-test-password", salt, 64, (error, value) => error ? reject(error) : resolve(value.toString("hex"))));
  return { version: 1, config: fixtureConfig, state: { version: 1, days: {} }, cookies: { version: 1, cookies: {} },
    auth: { version: 1, password: { algorithm: "scrypt", salt, key }, sessions: [{ tokenHash: "old-session", expiresAt: "2099-01-01" }] } };
}
