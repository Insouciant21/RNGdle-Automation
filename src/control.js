import http from "node:http";
import { readFile } from "node:fs/promises";
import { renderControlPage, renderLoginPage, renderSetupPage } from "./control-page.js";
import { createControlAuth, expiredSessionCookie, parseCookies, sessionCookie } from "./control-auth.js";
import { errorSummary, getRecentLogs, log } from "./logger.js";
import {
  buildAuthenticationRequiredMessage,
  buildRollMessage,
  sendAuthenticationRequiredEmail,
  sendRollEmail,
} from "./mail.js";
import { publicSettings, saveRuntimeSettings } from "./settings.js";
import { readState } from "./state.js";
import { cardRarity } from "./rarity.js";

const MAX_BODY_BYTES = 32 * 1024;
const EMAIL_TYPES = new Set(["result", "authentication"]);
const STATIC_ASSETS = new Map([
  [
    "/assets/fonts/inter-latin.woff2",
    {
      url: new URL("../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", import.meta.url),
      contentType: "font/woff2",
    },
  ],
  [
    "/assets/fonts/space-mono-400-latin.woff2",
    {
      url: new URL("../node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2", import.meta.url),
      contentType: "font/woff2",
    },
  ],
  [
    "/assets/fonts/space-mono-700-latin.woff2",
    {
      url: new URL("../node_modules/@fontsource/space-mono/files/space-mono-latin-700-normal.woff2", import.meta.url),
      contentType: "font/woff2",
    },
  ],
  [
    "/assets/vendor/perfect-scrollbar.css",
    {
      url: new URL("../node_modules/perfect-scrollbar/css/perfect-scrollbar.css", import.meta.url),
      contentType: "text/css; charset=utf-8",
    },
  ],
  [
    "/assets/vendor/perfect-scrollbar.min.js",
    {
      url: new URL("../node_modules/perfect-scrollbar/dist/perfect-scrollbar.min.js", import.meta.url),
      contentType: "text/javascript; charset=utf-8",
    },
  ],
]);

export function isAllowedAuthenticationLink(candidate, baseUrl) {
  try {
    const link = new URL(candidate);
    const expected = new URL(baseUrl);
    return (
      link.protocol === "https:" &&
      (link.hostname === expected.hostname || link.hostname === "rngdle.com" || link.hostname.endsWith(".rngdle.com"))
    );
  } catch {
    return false;
  }
}

export function isSameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, html, { preview = false } = {}) {
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
  if (preview) {
    headers["Content-Security-Policy"] =
      "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";
  }
  response.writeHead(status, headers);
  response.end(html);
}

async function sendStaticAsset(request, response, asset) {
  const contents = await readFile(asset.url);
  response.writeHead(200, {
    "Content-Type": asset.contentType,
    "Content-Length": contents.length,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : contents);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("Request body is too large");
  }
  return JSON.parse(body || "{}");
}

function newestDay(state, predicate = () => true) {
  const date = Object.keys(state.days)
    .sort()
    .reverse()
    .find((candidate) => predicate(state.days[candidate]));
  return date ? { date, day: state.days[date] } : null;
}

async function overviewPayload(config, status) {
  const state = await readState(config.storage.statePath);
  const latest = newestDay(state);
  const latestResult = newestDay(state, (day) => Boolean(day.result));
  const splitRetryState = latest
    ? Object.hasOwn(latest.day, "nextRngdleRetryAt") || Object.hasOwn(latest.day, "nextEmailRetryAt")
    : false;
  const legacyRetryAt = splitRetryState ? null : latest?.day.nextRetryAt ?? null;
  return {
    status,
    generatedAt: new Date().toISOString(),
    schedule: {
      timezone: config.timezone,
      time: config.schedule.time,
      retryMinutes: config.schedule.retryMinutes,
      rngdleRetryMinutes: config.schedule.retryMinutes,
      emailRetryMinutes: config.schedule.emailRetryMinutes ?? 1,
    },
    rngdle: { email: config.rngdle.email, baseUrl: config.rngdle.baseUrl },
    mail: { from: config.smtp.from, to: [...config.smtp.to] },
    latest: latest
      ? {
          date: latest.date,
          status: latest.day.status,
          attempts: latest.day.attempts ?? 0,
          emailAttempts: latest.day.emailAttempts ?? 0,
          nextRngdleRetryAt: splitRetryState ? latest.day.nextRngdleRetryAt ?? null : legacyRetryAt,
          nextEmailRetryAt: splitRetryState
            ? latest.day.nextEmailRetryAt ?? null
            : latest.day.status === "email_pending"
              ? legacyRetryAt
              : null,
          nextRetryAt: splitRetryState
            ? latest.day.status === "email_pending"
              ? latest.day.nextEmailRetryAt ?? null
              : latest.day.nextRngdleRetryAt ?? null
            : legacyRetryAt,
          lastError: latest.day.lastError ?? null,
          emailSent: Boolean(latest.day.emailSentAt),
        }
      : null,
    result: latestResult
      ? {
          date: latestResult.date,
          number: latestResult.day.result.number,
          earnedEp: latestResult.day.result.earnedEp,
          totalEp: latestResult.day.result.totalEp,
          rarity: latestResult.day.result.rarity ?? cardRarity(latestResult.day.result.earnedEp),
          badges: latestResult.day.result.badges,
          poem: latestResult.day.result.poem ?? null,
        }
      : null,
  };
}

async function selectedResult(config, requestedDate) {
  const state = await readState(config.storage.statePath);
  return requestedDate
    ? state.days[requestedDate]?.result
      ? { date: requestedDate, day: state.days[requestedDate] }
      : null
    : newestDay(state, (day) => Boolean(day.result));
}

async function emailPreview(config, type, requestedDate) {
  if (type === "authentication") return buildAuthenticationRequiredMessage(config).html;
  const selected = await selectedResult(config, requestedDate);
  if (!selected) return null;
  return buildRollMessage(config, selected.date, selected.day.result).html;
}

export async function createControlServer(
  config,
  { sendRoll = sendRollEmail, sendAuthentication = sendAuthenticationRequiredEmail } = {},
) {
  const auth = await createControlAuth({
    authPath: config.storage.controlAuthPath,
    initialPassword: config.control.initialPassword,
    sessionDays: config.control.sessionDays,
  });
  let status = { state: "idle", label: "RNGdle service ready" };
  let emailSendInFlight = false;
  const linkListeners = new Set();
  const page = renderControlPage(config.rngdle.baseUrl);
  const loginPage = renderLoginPage();
  const setupPage = renderSetupPage();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      const cookies = parseCookies(request);
      const sessionToken = cookies.rngdle_control_session;
      const currentSession = await auth.session(sessionToken);
      const publicRoute =
        (request.method === "GET" || request.method === "HEAD") && STATIC_ASSETS.has(url.pathname)
        || (request.method === "GET" || request.method === "HEAD") && url.pathname === "/login"
        || (request.method === "GET" || request.method === "HEAD") && url.pathname === "/setup"
        || request.method === "GET" && url.pathname === "/api/status"
        || request.method === "GET" && url.pathname === "/api/auth/session"
        || request.method === "POST" && (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/setup");
      if (!publicRoute && !currentSession) {
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/preview/")) {
          sendJson(response, 401, { message: "Control authentication required." });
        } else {
          response.writeHead(302, { Location: auth.isConfigured() ? "/login" : "/setup", "Cache-Control": "no-store" });
          response.end();
        }
        return;
      }
      const requireSameOrigin = () => {
        if (!isSameOriginRequest(request)) {
          const error = new Error("Cross-origin Control requests are not allowed.");
          error.statusCode = 403;
          throw error;
        }
      };
      const requireCsrf = () => {
        if (!currentSession || request.headers["x-csrf-token"] !== currentSession.csrfToken) {
          const error = new Error("Invalid Control request token.");
          error.statusCode = 403;
          throw error;
        }
      };
      if ((request.method === "GET" || request.method === "HEAD") && STATIC_ASSETS.has(url.pathname)) {
        await sendStaticAsset(request, response, STATIC_ASSETS.get(url.pathname));
      } else if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/login") {
        if (!auth.isConfigured()) {
          response.writeHead(302, { Location: "/setup", "Cache-Control": "no-store" });
          response.end();
        } else if (currentSession) {
          response.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          response.end();
        } else {
          sendHtml(response, 200, loginPage);
        }
      } else if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/setup") {
        if (auth.isConfigured()) {
          response.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });
          response.end();
        } else if (currentSession) {
          response.writeHead(302, { Location: "/", "Cache-Control": "no-store" });
          response.end();
        } else {
          sendHtml(response, 200, setupPage);
        }
      } else if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
        });
        response.end(request.method === "HEAD" ? undefined : page);
      } else if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, status);
      } else if (request.method === "GET" && url.pathname === "/api/auth/session") {
        sendJson(response, 200, currentSession
          ? { authenticated: true, configured: true, csrfToken: currentSession.csrfToken, expiresAt: currentSession.expiresAt }
          : { authenticated: false, configured: auth.isConfigured() });
      } else if (request.method === "POST" && url.pathname === "/api/auth/login") {
        requireSameOrigin();
        try {
          const { password } = await readJson(request);
          const result = await auth.login(password, request.socket.remoteAddress);
          sendJson(response, 200, {
            authenticated: true,
            csrfToken: result.csrfToken,
            expiresAt: result.expiresAt,
          }, {
            "Set-Cookie": sessionCookie(result.token, result.maxAgeSeconds, config.control.cookieSecure),
          });
        } catch (error) {
          const limited = error.message.startsWith("Too many failed attempts");
          sendJson(response, limited ? 429 : 401, { message: error.message });
        }
      } else if (request.method === "POST" && url.pathname === "/api/auth/setup") {
        requireSameOrigin();
        try {
          const { password, confirmation } = await readJson(request);
          const result = await auth.setupPassword(password, confirmation);
          sendJson(response, 201, { authenticated: true, configured: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt }, {
            "Set-Cookie": sessionCookie(result.token, result.maxAgeSeconds, config.control.cookieSecure),
          });
        } catch (error) {
          sendJson(response, 409, { message: error.message });
        }
      } else if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        requireSameOrigin();
        requireCsrf();
        await auth.logout(sessionToken);
        sendJson(response, 200, { authenticated: false }, { "Set-Cookie": expiredSessionCookie(config.control.cookieSecure) });
      } else if (request.method === "PUT" && url.pathname === "/api/auth/password") {
        requireSameOrigin();
        requireCsrf();
        const { password, confirmation } = await readJson(request);
        await auth.changePassword(password, confirmation);
        sendJson(response, 200, { message: "Control password changed. Sign in again." }, { "Set-Cookie": expiredSessionCookie(config.control.cookieSecure) });
      } else if (request.method === "GET" && url.pathname === "/api/overview") {
        sendJson(response, 200, await overviewPayload(config, status));
      } else if (request.method === "GET" && url.pathname === "/api/logs") {
        const level = url.searchParams.get("level") ?? "all";
        if (!new Set(["all", "info", "error"]).has(level)) throw new Error("Invalid log level");
        sendJson(response, 200, {
          logs: getRecentLogs({
            limit: url.searchParams.get("limit") ?? 100,
            after: url.searchParams.get("after") ?? 0,
            level,
          }),
        });
      } else if (request.method === "GET" && url.pathname === "/api/settings") {
        sendJson(response, 200, publicSettings(config));
      } else if (request.method === "PUT" && url.pathname === "/api/settings") {
        requireSameOrigin();
        requireCsrf();
        const input = await readJson(request);
        const before = publicSettings(config);
        const settings = await saveRuntimeSettings(config, input);
        const changed = Object.keys(settings).filter((key) => settings[key] !== before[key]);
        if (typeof input.smtpAppPassword === "string" && input.smtpAppPassword.trim()) changed.push("smtpAppPassword");
        log("info", "Control settings updated", { changed: [...new Set(changed)] });
        sendJson(response, 200, { message: "Settings saved and applied.", settings });
      } else if (request.method === "GET" && url.pathname === "/preview/email") {
        const previewType = url.searchParams.get("type") ?? "result";
        if (!EMAIL_TYPES.has(previewType)) throw new Error("Invalid email preview type");
        const preview = await emailPreview(config, previewType, url.searchParams.get("date"));
        if (!preview) {
          sendHtml(response, 404, "<!doctype html><html><body><p>No roll result is available.</p></body></html>", {
            preview: true,
          });
        } else {
          sendHtml(response, 200, preview, { preview: true });
        }
      } else if (request.method === "POST" && url.pathname === "/api/email/send") {
        requireSameOrigin();
        requireCsrf();
        if (emailSendInFlight) {
          sendJson(response, 409, { message: "An email is already being sent." });
          return;
        }
        const { type = "result", date = null } = await readJson(request);
        if (!EMAIL_TYPES.has(type)) throw new Error("Invalid email type");
        if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
          throw new Error("Email date must use YYYY-MM-DD format");
        }
        const selected = type === "result" ? await selectedResult(config, date) : null;
        if (type === "result" && !selected) {
          sendJson(response, 404, { message: "No roll result is available to send." });
          return;
        }
        emailSendInFlight = true;
        try {
          const info =
            type === "authentication"
              ? await sendAuthentication(config)
              : await sendRoll(config, selected.date, selected.day.result);
          const sentDate = selected?.date ?? null;
          log("info", "Control email sent", {
            type,
            date: sentDate,
            recipientCount: config.smtp.to.length,
            messageId: info?.messageId ?? null,
          });
          sendJson(response, 200, {
            message: `${type === "result" ? "Result" : "Login required"} email sent.`,
            type,
            date: sentDate,
          });
        } catch (error) {
          const summary = errorSummary(error);
          log("error", "Control email send failed", { type, error: summary });
          sendJson(response, 502, { message: `Email send failed: ${summary}` });
        } finally {
          emailSendInFlight = false;
        }
      } else if (request.method === "POST" && url.pathname === "/api/auth-link") {
        requireSameOrigin();
        requireCsrf();
        const { link } = await readJson(request);
        if (status.state !== "waiting") {
          sendJson(response, 409, { message: "The HTTP session is not currently waiting for authentication." });
        } else if (!isAllowedAuthenticationLink(link, config.rngdle.baseUrl)) {
          sendJson(response, 400, { message: "Enter a valid HTTPS RNGdle magic-link URL." });
        } else {
          for (const listener of linkListeners) listener(link);
          sendJson(response, 202, { message: "Link sent to the HTTP session." });
        }
      } else {
        sendJson(response, 404, { message: "Not found" });
      }
    } catch (error) {
      sendJson(response, error.statusCode ?? 400, { message: errorSummary(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.control.port, "0.0.0.0", resolve);
  });
  log("info", "Control page started", { url: config.control.publicUrl });

  return {
    address() {
      return server.address();
    },
    setStatus(state, label) {
      status = { state, label };
    },
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
