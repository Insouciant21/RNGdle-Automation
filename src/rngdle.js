import { chromium } from "playwright";
import { errorSummary, log } from "./logger.js";
import { badgeRarity, cardRarity, normalizeRarity } from "./rarity.js";

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
    rarity: normalizeRarity(badge.rarity) === "unknown" ? badgeRarity(badge.score) : normalizeRarity(badge.rarity),
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
      rarity: normalizeRarity(roll.rarity) === "unknown" ? cardRarity(roll.totalScore) : normalizeRarity(roll.rarity),
    };
  }
  return {
    hasRolledToday: Boolean(viewer.hasRolledToday),
    totalEp: Number.isFinite(Number(viewer.totalEp)) ? Number(viewer.totalEp) : null,
    lastRoll,
  };
}

async function launchContext(config, headless) {
  return chromium.launchPersistentContext(config.storage.profileDirectory, {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    timezoneId: "UTC",
    acceptDownloads: false,
  });
}

async function fetchHome(context, config) {
  const response = await context.request.get(`${config.rngdle.baseUrl}/api/home`, {
    timeout: config.browser.timeoutMs,
    failOnStatusCode: false,
  });
  if (response.status() === 401 || response.status() === 403) {
    throw new AuthenticationRequiredError();
  }
  if (!response.ok()) {
    throw new Error(`RNGdle /api/home returned HTTP ${response.status()}`);
  }
  return normalizeHomePayload(await response.json());
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function getDailyRoll(config) {
  const context = await launchContext(config, config.browser.headless);
  context.setDefaultTimeout(config.browser.timeoutMs);
  try {
    const existing = await fetchHome(context, config);
    if (existing.hasRolledToday && existing.lastRoll) {
      log("info", "Today's RNGdle roll already exists; reusing it", { number: existing.lastRoll.number });
      return { ...existing.lastRoll, totalEp: existing.totalEp };
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(config.rngdle.baseUrl, { waitUntil: "domcontentloaded" });
    const generateButton = page.getByRole("button", { name: /generate/i });
    await generateButton.waitFor({ state: "visible" });
    log("info", "Generating today's RNGdle number");
    await generateButton.click();

    const deadline = Date.now() + config.browser.timeoutMs;
    while (Date.now() < deadline) {
      await delay(1_000);
      const current = await fetchHome(context, config);
      if (current.hasRolledToday && current.lastRoll) {
        return { ...current.lastRoll, totalEp: current.totalEp };
      }
    }
    throw new Error("RNGdle did not expose the generated roll before the timeout");
  } finally {
    await context.close();
  }
}

export async function waitForInteractiveAuthentication(config, control = null) {
  const context = await launchContext(config, true);
  context.setDefaultTimeout(config.browser.timeoutMs);
  const page = context.pages()[0] ?? (await context.newPage());
  let navigating = false;

  const onLine = async (line) => {
    const candidate = line.trim();
    if (!/^https:\/\//i.test(candidate) || navigating) return;
    navigating = true;
    try {
      await page.goto(candidate, { waitUntil: "domcontentloaded" });
    } catch (error) {
      log("error", "Could not open the pasted authentication link", { error: errorSummary(error) });
    } finally {
      navigating = false;
    }
  };

  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onLine);
  const removeLinkListener = control?.onLink(onLine);
  try {
    await page.goto(config.rngdle.baseUrl, { waitUntil: "domcontentloaded" });
    try {
      await fetchHome(context, config);
      log("info", "Existing RNGdle authentication is valid");
      control?.setStatus("authenticated", "Authenticated");
      return;
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
    }

    log("info", "Interactive authentication is waiting", {
      email: config.rngdle.email,
      control: config.control.publicUrl,
    });
    control?.setStatus("waiting", "Waiting for RNGdle login");
    console.log(`Open ${config.control.publicUrl}, request a sign-in link on RNGdle, then submit the full magic-link URL.`);
    console.log("When running interactively, you may also paste the full magic-link URL here and press Enter.");

    while (true) {
      try {
        await fetchHome(context, config);
        log("info", "RNGdle authentication completed");
        control?.setStatus("authenticated", "Authenticated");
        return;
      } catch (error) {
        if (!(error instanceof AuthenticationRequiredError)) throw error;
      }
      await delay(3_000);
    }
  } finally {
    removeLinkListener?.();
    process.stdin.off("data", onLine);
    await context.close();
  }
}
