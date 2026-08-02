import fs from "node:fs/promises";
import path from "node:path";
import { errorSummary, log } from "./logger.js";
import { badgeRarity, cardRarity, normalizeRarity } from "./rarity.js";

const ROLL_ACTION_ID = "00112e9ce8e5bde4cc3641ed6ff30b8b670783d6e4";

export class AuthenticationRequiredError extends Error {
  constructor(message = "RNGdle authentication is required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

function normalizeBadge(badge) {
  return {
    id: String(badge.id ?? "UNKNOWN"),
    label: String(badge.label ?? badge.id ?? "Unknown badge"),
    emoji: typeof badge.emoji === "string" ? badge.emoji : "",
    description: typeof badge.description === "string" ? badge.description : "",
    score: Number.isFinite(Number(badge.score)) ? Number(badge.score) : 0,
    isScoring: badge.isScoring !== false,
    isNew: badge.isNew === true,
    rarity:
      normalizeRarity(badge.rarity) === "unknown" ? badgeRarity(badge.score) : normalizeRarity(badge.rarity),
  };
}

export function normalizeHomePayload(payload) {
  if (!payload?.viewer) {
    throw new AuthenticationRequiredError();
  }
  const viewer = payload.viewer;
  let lastRoll = null;
  if (viewer.hasRolledToday && viewer.lastRoll) {
    const roll = viewer.lastRoll;
    if (!Number.isFinite(Number(roll.number)) || !Number.isFinite(Number(roll.totalScore))) {
      throw new Error("RNGdle returned an invalid daily roll payload");
    }
    lastRoll = {
      number: Number(roll.number),
      earnedEp: Number(roll.totalScore),
      badges: Array.isArray(roll.badges) ? roll.badges.map(normalizeBadge) : [],
      poem: typeof roll.poem === "string" ? roll.poem : null,
      rarity:
        normalizeRarity(roll.rarity) === "unknown" ? cardRarity(roll.totalScore) : normalizeRarity(roll.rarity),
    };
  }
  return {
    hasRolledToday: Boolean(viewer.hasRolledToday),
    totalEp: Number.isFinite(Number(viewer.totalEp)) ? Number(viewer.totalEp) : null,
    lastRoll,
  };
}

function splitSetCookieHeader(value) {
  if (!value) return [];
  return value
    .split(/,(?=\s*[^;,=]+=[^;,]+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cookiePairs(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : splitSetCookieHeader(headers.get("set-cookie"));
  return values.map((value) => value.split(";", 1)[0]).filter((value) => value.includes("="));
}

function updateCookieJar(jar, headers) {
  for (const pair of cookiePairs(headers)) {
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name) continue;
    if (value === "") delete jar[name];
    else jar[name] = value;
  }
}

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function loadCookies(cookiePath) {
  try {
    const document = JSON.parse(await fs.readFile(cookiePath, "utf8"));
    return document.cookies && typeof document.cookies === "object" ? document.cookies : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Unable to read ${cookiePath}: ${error.message}`);
  }
}

async function saveCookies(cookiePath, cookies) {
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  const temporaryPath = `${cookiePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify({ version: 1, cookies }, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, cookiePath);
}

function timeoutSignal(milliseconds) {
  return AbortSignal.timeout(milliseconds);
}

async function request(config, cookies, url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const currentCookies = cookieHeader(cookies);
  if (currentCookies) headers.set("cookie", currentCookies);
  const response = await fetch(url, {
    ...options,
    headers,
    signal: options.signal ?? timeoutSignal(config.browser.timeoutMs),
  });
  updateCookieJar(cookies, response.headers);
  return response;
}

async function fetchHome(config, cookies) {
  const response = await request(config, cookies, `${config.rngdle.baseUrl}/api/home`, {
    headers: { Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) throw new AuthenticationRequiredError();
  if (!response.ok) throw new Error(`RNGdle /api/home returned HTTP ${response.status}`);
  return normalizeHomePayload(await response.json());
}

export function parseServerActionResult(source) {
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\d+:(\{.*\})$/);
    if (!match) continue;
    try {
      const value = JSON.parse(match[1]);
      if (Number.isFinite(Number(value.number))) return value;
      if (value.error) throw new Error(String(value.error));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error("RNGdle roll action returned an unrecognized response");
}

async function discoverRollActionId(config, cookies) {
  const page = await request(config, cookies, config.rngdle.baseUrl, {
    headers: { Accept: "text/html" },
  });
  if (!page.ok) return ROLL_ACTION_ID;
  const html = await page.text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => new URL(match[1], config.rngdle.baseUrl).href);
  for (const scriptUrl of new Set(scripts)) {
    const response = await request(config, cookies, scriptUrl, { headers: { Accept: "text/javascript" } });
    if (!response.ok) continue;
    const source = await response.text();
    const match = source.match(/createServerReference\)\("([a-f0-9]+)"[^)]*"rollDiceAction"\)/i);
    if (match) return match[1];
  }
  return ROLL_ACTION_ID;
}

async function roll(config, cookies, actionId) {
  const response = await request(config, cookies, config.rngdle.baseUrl, {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Next-Action": actionId,
      "Next-Router-State-Tree": "",
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: "[]",
  });
  if (response.status === 401 || response.status === 403) throw new AuthenticationRequiredError();
  if (!response.ok) throw new Error(`RNGdle roll action returned HTTP ${response.status}`);
  return parseServerActionResult(await response.text());
}

export async function getDailyRoll(config) {
  const cookies = await loadCookies(config.storage.cookiePath);
  const existing = await fetchHome(config, cookies);
  await saveCookies(config.storage.cookiePath, cookies);
  if (existing.hasRolledToday && existing.lastRoll) {
    log("info", "Today's RNGdle roll already exists; reusing it", { number: existing.lastRoll.number });
    return { ...existing.lastRoll, totalEp: existing.totalEp };
  }

  log("info", "Generating today's RNGdle number over HTTP");
  const actionId = await discoverRollActionId(config, cookies);
  await roll(config, cookies, actionId);
  await saveCookies(config.storage.cookiePath, cookies);

  const deadline = Date.now() + config.browser.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const current = await fetchHome(config, cookies);
    if (current.hasRolledToday && current.lastRoll) {
      await saveCookies(config.storage.cookiePath, cookies);
      return { ...current.lastRoll, totalEp: current.totalEp };
    }
  }
  throw new Error("RNGdle did not expose the generated roll before the timeout");
}

async function followAuthenticationLink(config, link) {
  const cookies = await loadCookies(config.storage.cookiePath);
  let current = link;
  for (let redirects = 0; redirects < 10; redirects += 1) {
    const response = await request(config, cookies, current, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Authentication redirect returned HTTP ${response.status} without a location`);
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) throw new Error(`Authentication link returned HTTP ${response.status}`);
    await response.arrayBuffer();
    await saveCookies(config.storage.cookiePath, cookies);
    await fetchHome(config, cookies);
    await saveCookies(config.storage.cookiePath, cookies);
    return;
  }
  throw new Error("Authentication link redirected too many times");
}

export async function waitForInteractiveAuthentication(config, control = null) {
  const cookies = await loadCookies(config.storage.cookiePath);
  try {
    await fetchHome(config, cookies);
    await saveCookies(config.storage.cookiePath, cookies);
    log("info", "Existing RNGdle HTTP authentication is valid");
    control?.setStatus("authenticated", "Authenticated");
    return;
  } catch (error) {
    if (!(error instanceof AuthenticationRequiredError)) throw error;
  }

  let verifying = false;
  const onLine = async (line) => {
    const candidate = line.trim();
    if (!/^https:\/\//i.test(candidate) || verifying) return;
    verifying = true;
    try {
      await followAuthenticationLink(config, candidate);
      log("info", "RNGdle HTTP authentication completed");
      control?.setStatus("authenticated", "Authenticated");
    } catch (error) {
      log("error", "Could not verify the pasted authentication link", { error: errorSummary(error) });
    } finally {
      verifying = false;
    }
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onLine);
  const removeLinkListener = control?.onLink(onLine);
  try {
    log("info", "Interactive HTTP authentication is waiting", {
      email: config.rngdle.email,
      control: config.control.publicUrl,
    });
    control?.setStatus("waiting", "Waiting for RNGdle login");
    console.log(`Open ${config.control.publicUrl}, request a sign-in link on RNGdle, then submit the full magic-link URL.`);
    console.log("When running interactively, you may also paste the full magic-link URL here and press Enter.");

    while (true) {
      try {
        const current = await loadCookies(config.storage.cookiePath);
        await fetchHome(config, current);
        await saveCookies(config.storage.cookiePath, current);
        log("info", "RNGdle authentication completed");
        control?.setStatus("authenticated", "Authenticated");
        return;
      } catch (error) {
        if (!(error instanceof AuthenticationRequiredError)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
  } finally {
    removeLinkListener?.();
    process.stdin.off("data", onLine);
  }
}
