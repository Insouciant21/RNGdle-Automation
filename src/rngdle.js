import { log } from "./logger.js";
import { badgeRarity, cardRarity, normalizeRarity } from "./rarity.js";
import { AuthenticationRequiredError, callServerAction, createRngdleSession, isRngdleUrl, responseText } from "./rngdle-http.js";
import { discoverRngdleAssets } from "./rngdle-assets.js";

export { AuthenticationRequiredError } from "./rngdle-http.js";

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

export async function fetchHome(session) {
  const response = await session.request("/api/home", { headers: { Accept: "application/json" } });
  if (response.status === 401 || response.status === 403) throw new AuthenticationRequiredError();
  if (!response.ok) throw new Error(`RNGdle /api/home returned HTTP ${response.status}`);
  return normalizeHomePayload(JSON.parse(await responseText(response)));
}

const utcDate = () => new Date().toISOString().slice(0, 10);
function resultForDay(home, gameDate) {
  if (utcDate() !== gameDate) throw new Error("RNGdle game day changed during the request; retry for the current day");
  return { ...home.lastRoll, totalEp: home.totalEp, gameDate };
}

export async function getDailyRoll(config) {
  const session = await createRngdleSession(config);
  const gameDate = utcDate();
  const home = await fetchHome(session);
  if (home.lastRoll) {
    log("info", "Today's RNGdle roll already exists; reusing it", { number: home.lastRoll.number });
    return resultForDay(home, gameDate);
  }
  const { actions } = await discoverRngdleAssets(session, config.rngdle.baseUrl, { actionName: "rollDiceAction" });
  if (utcDate() !== gameDate) throw new Error("RNGdle game day changed before rolling");
  await callServerAction(session, actions.rollDiceAction, [], (value) => value.number !== null && Number.isFinite(Number(value.number)));
  const deadline = Date.now() + config.http.timeoutMs;
  do {
    const current = await fetchHome(session);
    if (current.lastRoll) return resultForDay(current, gameDate);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error("RNGdle did not expose the generated roll before the timeout");
}

export async function followAuthenticationLink(session, config, link) {
  let url = new URL(link);
  if (url.protocol !== "https:" || !isRngdleUrl(url, config.rngdle.baseUrl)) throw new Error("Enter a valid HTTPS RNGdle magic-link URL");
  for (let redirects = 0; redirects < 10; redirects++) {
    const response = await session.request(url);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("RNGdle login redirect has no destination");
      url = new URL(location, url);
      if (!isRngdleUrl(url, config.rngdle.baseUrl)) throw new Error("RNGdle login redirected outside the trusted origin");
      continue;
    }
    if (!response.ok) throw new Error(`RNGdle login returned HTTP ${response.status}`);
    await responseText(response);
    await fetchHome(session);
    return;
  }
  throw new Error("RNGdle login redirected too many times");
}
