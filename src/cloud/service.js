import crypto from "node:crypto";
import { createControlAuth, parseCookies, sessionCookie, expiredSessionCookie } from "../control-auth.js";
import { overviewPayload, newestDay } from "../control-data.js";
import { buildAuthenticationRequiredMessage, buildRollMessage, sendAuthenticationRequiredEmail, sendRollEmail, verifyMailTransport } from "../mail.js";
import { createRngdleSession, isRngdleUrl } from "../rngdle-http.js";
import { fetchHome, followAuthenticationLink } from "../rngdle.js";
import { inspectPoem } from "../poem-http.js";
import { generatePoem } from "../poem.js";
import { localParts, isWorkflowDue } from "../schedule.js";
import { errorSummary, log, withLogSink } from "../logger.js";
import { workerConfig } from "./config.js";
import { nextWake } from "./schedule.js";
import { advanceWorkflow } from "./workflow.js";
import { createReturnLikeState, isReturnLikeState, processReturnLikes } from "../rngdle-likes.js";

const EMPTY_STATE = () => ({ version: 1, days: {} });
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
function fail(message, statusCode = 400) { throw Object.assign(new Error(message), { statusCode }); }

async function readJson(request, maximum = 32768) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request.body ?? []) {
    size += chunk.byteLength;
    if (size > maximum) fail("Request body is too large", 413);
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export class AutomationService {
  constructor(storage, env, dependencies = {}) {
    this.storage = storage;
    this.env = env;
    this.dependencies = dependencies;
    this.pending = Promise.resolve();
  }

  exclusive(operation) {
    const next = this.pending.then(() => this.logged(operation));
    this.pending = next.catch(() => {});
    return next;
  }

  async logged(operation) {
    const entries = [];
    return withLogSink((entry) => entries.push(entry), async () => {
      try { return await operation(); }
      finally {
        if (entries.length) {
          const journal = await this.storage.get("logs") ?? { nextId: 1, entries: [] };
          journal.entries.push(...entries.map((entry) => ({ ...entry, id: journal.nextId++ })));
          journal.entries = journal.entries.slice(-250);
          await this.storage.put("logs", journal);
        }
      }
    });
  }

  async meta() { return await this.storage.get("meta") ?? { paused: true }; }
  async state() { return await this.storage.get("state") ?? EMPTY_STATE(); }
  async config() { return workerConfig(this.env, this.storage); }
  async hasConfig() { try { await this.config(); return true; } catch { return false; } }

  async status() {
    const meta = await this.meta();
    if (meta.authenticated === false) return { state: "waiting", label: "Waiting for RNGdle login" };
    if (!(await this.storage.get("auth"))?.password && this.env.ALLOW_SETUP !== "true") {
      return { state: "idle", label: "Waiting for Control setup" };
    }
    if (meta.paused) return { state: "idle", label: "Automation paused" };
    return { state: "authenticated", label: "Authenticated" };
  }

  async schedule() {
    const meta = await this.meta();
    if (meta.paused || meta.authenticated === false || !(await this.hasConfig())) return this.storage.deleteAlarm();
    const at = nextWake(await this.config(), await this.state(), new Date(), await this.storage.get("social"));
    await this.storage.setAlarm(at);
  }

  async returnLikes(config, now = new Date()) {
    if (!config.likes?.enabled) return null;
    const current = await this.storage.get("social");
    const lastChecked = Date.parse(current?.lastCheckedAt);
    const interval = (config.likes.pollMinutes ?? 60) * 60_000;
    if (Number.isFinite(lastChecked) && lastChecked + interval > now.getTime()) return null;
    const social = current ?? createReturnLikeState(now);
    const session = await createRngdleSession(config);
    const process = this.dependencies.processReturnLikes ?? processReturnLikes;
    try {
      const result = await process(config, social, {
        ...(this.dependencies.returnLikeDependencies ?? {}),
        session,
        now,
      });
      return result;
    } catch (error) {
      log("error", "RNGdle return-like check failed", { error: errorSummary(error) });
      return null;
    } finally {
      await this.storage.put("social", social);
    }
  }

  async tick() {
    return this.exclusive(async () => {
      const meta = await this.meta();
      if (meta.paused || meta.authenticated === false) return;
      const config = await this.config();
      const now = new Date();
      const { date } = localParts(now, config.timezone);
      const state = await this.state();
      try {
        if (state.days[date]?.status !== "auth_required" && isWorkflowDue({
          now, timezone: config.timezone, scheduleTime: config.schedule.time, dayState: state.days[date],
        })) {
          // Arm recovery before I/O; an eviction must never erase the next wake.
          await this.storage.setAlarm(Date.now() + 10 * 60000);
          await advanceWorkflow(config, state, date, this.dependencies);
          if (state.days[date]?.status === "auth_required") {
            meta.authenticated = false;
            await this.storage.put("meta", meta);
          }
        }
        if (meta.authenticated !== false) await this.returnLikes(config, now);
      } finally { await this.schedule(); }
    });
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/__migration/")) {
        const expected = this.env.MIGRATION_TOKEN;
        const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
        if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
          return json({ message: "Not found" }, 404);
        }
        return await this.exclusive(() => this.migration(request, url));
      }
      if (request.method === "GET" && url.pathname === "/api/status") return json(await this.status());
      const run = () => this.api(request, url);
      return await (request.method === "GET" || request.method === "HEAD" ? run() : this.exclusive(run));
    } catch (error) {
      return json({ message: errorSummary(error) }, error.statusCode ?? 400);
    } finally {
      if (request.body && !request.bodyUsed) await request.body.cancel();
    }
  }

  async api(request, url) {
    const configured = Boolean((await this.storage.get("auth"))?.password);
    if (!configured && this.env.ALLOW_SETUP !== "true") {
      if (url.pathname === "/api/auth/session") return json({ authenticated: false, configured: false, setupDisabled: true });
      fail("Set up Control credentials or restore a backup before signing in", 503);
    }
    const config = await this.config();
    const auth = await createControlAuth({ storage: this.storage, sessionDays: config.control.sessionDays });
    const token = parseCookies(request).rngdle_control_session;
    const session = await auth.session(token);
    const route = `${request.method} ${url.pathname}`;
    const publicRoute = ["GET /api/auth/session", "POST /api/auth/login", "POST /api/auth/setup"].includes(route);
    if (!publicRoute && !session) fail("Control authentication required.", 401);
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) fail("Cross-origin Control requests are not allowed.", 403);
      if (!publicRoute && request.headers.get("x-csrf-token") !== session.csrfToken) fail("Invalid Control request token.", 403);
    }
    switch (route) {
      case "GET /api/auth/session":
        return json(session ? { authenticated: true, configured: true, ...session } : { authenticated: false, configured: auth.isConfigured() });
      case "POST /api/auth/login": {
        const { password } = await readJson(request);
        try {
          const result = await auth.login(password, request.headers.get("cf-connecting-ip") ?? "local");
          return json({ authenticated: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt }, 200,
            { "Set-Cookie": sessionCookie(result.token, result.maxAgeSeconds) });
        } catch (error) { return json({ message: errorSummary(error) }, error.message.startsWith("Too many") ? 429 : 401); }
      }
      case "POST /api/auth/setup": {
        if (this.env.ALLOW_SETUP !== "true") fail("First-run setup is disabled", 403);
        const { password, confirmation } = await readJson(request);
        try {
          const result = await auth.setupPassword(password, confirmation);
          return json({ authenticated: true, configured: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt }, 201,
            { "Set-Cookie": sessionCookie(result.token, result.maxAgeSeconds) });
        } catch (error) { fail(errorSummary(error), 409); }
        break;
      }
      case "POST /api/auth/logout":
        await auth.logout(token);
        return json({ authenticated: false }, 200, { "Set-Cookie": expiredSessionCookie() });
      case "GET /api/overview": return json(overviewPayload(config, await this.status(), await this.state()));
      case "GET /api/logs": {
        const level = url.searchParams.get("level") ?? "all";
        if (!["all", "info", "error"].includes(level)) fail("Invalid log level");
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 100));
        const journal = await this.storage.get("logs");
        return json({ logs: (journal?.entries ?? []).filter((entry) => entry.id > Number(url.searchParams.get("after") ?? 0) && (level === "all" || entry.level === level)).slice(-limit) });
      }
      case "GET /preview/email": {
        const type = url.searchParams.get("type") ?? "result";
        if (!["result", "authentication"].includes(type)) fail("Invalid email preview type");
        const selected = await this.selectedResult(url.searchParams.get("date"));
        const html = type === "authentication" ? buildAuthenticationRequiredMessage(config).html
          : selected ? buildRollMessage(config, selected.date, selected.day.result).html : "<p>No roll result is available.</p>";
        return new Response(html, { status: type === "result" && !selected ? 404 : 200, headers: {
          "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
        } });
      }
      case "POST /api/email/send": {
        const { type = "result", date = null } = await readJson(request);
        if (!["result", "authentication"].includes(type)) fail("Invalid email type");
        if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) fail("Email date must use YYYY-MM-DD format");
        const selected = await this.selectedResult(date);
        if (type === "result" && !selected) fail("No roll result is available to send.", 404);
        try {
          if (type === "authentication") await (this.dependencies.sendAuthentication ?? sendAuthenticationRequiredEmail)(config);
          else await (this.dependencies.sendRoll ?? sendRollEmail)(config, selected.date, selected.day.result);
          log("info", "Control email sent", { type, date: selected?.date ?? null });
          return json({ message: `${type === "result" ? "Result" : "Login required"} email sent.`, type, date: selected?.date ?? null });
        } catch (error) { log("error", "Control email send failed", { error: errorSummary(error) }); fail(`Email send failed: ${errorSummary(error)}`, 502); }
        break;
      }
      case "POST /api/auth-link": {
        const { link } = await readJson(request);
        if (typeof link !== "string" || !link.startsWith("https://") || !isRngdleUrl(link, config.rngdle.baseUrl)) fail("Enter a valid HTTPS RNGdle magic-link URL.");
        await followAuthenticationLink(await createRngdleSession(config), config, link);
        const meta = await this.meta();
        meta.authenticated = true;
        await this.storage.put("meta", meta);
        const state = await this.state();
        for (const day of Object.values(state.days)) {
          if (day.status === "auth_required") {
            day.status = day.result ? config.poem.enabled && !day.result.poem ? "poem_pending" : "email_pending" : "pending";
            day.nextRetryAt = null;
            day.authenticationNotifiedAt = null;
          }
        }
        await this.storage.put("state", state);
        await this.schedule();
        log("info", "RNGdle HTTP authentication completed");
        return json({ message: "RNGdle authentication verified." }, 202);
      }
      default: return json({ message: "Not found" }, 404);
    }
  }

  async selectedResult(date) {
    const state = await this.state();
    return date ? state.days[date]?.result ? { date, day: state.days[date] } : null : newestDay(state, (day) => Boolean(day.result));
  }

  async migration(request, url) {
    const action = url.pathname.slice("/__migration/".length);
    if (request.method === "GET" && action === "status") {
      const state = await this.state();
      const latest = newestDay(state);
      return json({ ...await this.meta(), days: Object.keys(state.days).length, latestDate: latest?.date ?? null,
        latestStatus: latest?.day.status ?? null, nextAlarm: await this.storage.getAlarm(), configured: Boolean((await this.storage.get("auth"))?.password) });
    }
    if (request.method === "GET" && action === "export") {
      const { storage: _storage, ...config } = await this.config();
      return json({ version: 1, exportedAt: new Date().toISOString(), config,
        state: await this.state(), cookies: await this.storage.get("cookies"),
        social: await this.storage.get("social") ?? null,
        auth: { ...await this.storage.get("auth"), sessions: [], failures: {} }, meta: await this.meta() });
    }
    if (request.method !== "POST") return json({ message: "Not found" }, 404);
    if (action === "import") {
      const data = await readJson(request, 2 * 1024 * 1024);
      if (data.version !== 1 || data.state?.version !== 1 || !data.state.days || Array.isArray(data.state.days) ||
          data.cookies?.version !== 1 || !data.cookies.cookies || data.auth?.version !== 1 || !data.auth.password ||
          data.auth.password.algorithm !== "scrypt") fail("Unsupported backup format");
      if (data.social != null && !isReturnLikeState(data.social)) fail("Unsupported return-like state");
      await this.storage.transaction(async (transaction) => {
        if ((await transaction.get("meta"))?.importedAt || await transaction.get("state") || (await transaction.get("auth"))?.password) fail("Import requires an empty target", 409);
        await transaction.put("state", data.state);
        await transaction.put("cookies", data.cookies);
        if (data.social != null) await transaction.put("social", data.social);
        await transaction.put("auth", { ...data.auth, sessions: [], failures: {} });
        await transaction.put("meta", { paused: true, importedAt: new Date().toISOString(), authenticated: null });
      });
      log("info", "Backup imported", { days: Object.keys(data.state.days).length });
      return json({ imported: true, days: Object.keys(data.state.days).length });
    }
    if (action === "pause" || action === "resume") {
      const meta = await this.meta();
      if (action === "resume" && !(await this.storage.get("auth"))?.password) {
        fail("Set up Control credentials or restore a backup before enabling automation", 409);
      }
      meta.paused = action === "pause";
      await this.storage.put("meta", meta);
      await this.schedule();
      log("info", meta.paused ? "Automation paused" : "Automation enabled");
      return json({ paused: meta.paused, nextAlarm: await this.storage.getAlarm() });
    }
    if (action === "verify") {
      const { type } = await readJson(request);
      const config = await this.config();
      if (type === "smtp") { await verifyMailTransport(config); return json({ smtp: true }); }
      if (type === "rngdle") {
        try {
          const home = await fetchHome(await createRngdleSession(config));
          const meta = await this.meta(); meta.authenticated = true; await this.storage.put("meta", meta);
          return json({ authenticated: true, hasRolledToday: home.hasRolledToday, number: home.lastRoll?.number, hasPoem: Boolean(home.lastRoll?.poem) });
        } catch (error) {
          if (error.name === "AuthenticationRequiredError") { const meta = await this.meta(); meta.authenticated = false; await this.storage.put("meta", meta); }
          throw error;
        }
      }
      if (type === "poem") {
        const bank = await inspectPoem(config);
        const generated = await generatePoem(config, bank);
        return json({ words: bank.wordBank.length, existingPoem: Boolean(bank.existingPoem), generated: Boolean(generated.text), model: generated.model });
      }
      if (type === "email") {
        const selected = await this.selectedResult();
        if (!selected) fail("No roll result is available", 404);
        const info = await sendRollEmail(config, selected.date, selected.day.result);
        return json({ sent: true, messageId: info.messageId });
      }
      fail("Unknown verification type");
    }
    return json({ message: "Not found" }, 404);
  }
}
