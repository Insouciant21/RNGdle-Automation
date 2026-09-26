import { generatePoem, POEM_QUALITY_VERSION, POEM_RULES, renderPoem, validatePoemSelection } from "./poem.js";
import { fetchHome } from "./rngdle.js";
import { callServerAction, createRngdleSession } from "./rngdle-http.js";
import { buildWordBank, discoverRngdleAssets } from "./rngdle-assets.js";

const utcDate = () => new Date().toISOString().slice(0, 10);

function ensureSameRoll(home, expected, gameDate) {
  if (!home.hasRolledToday || !home.lastRoll || home.lastRoll.number !== expected.number || utcDate() !== gameDate) {
    throw new Error("RNGdle daily roll changed; refusing to submit a poem for a different roll/day");
  }
}

async function readBank(session, config, result) {
  const { actions, wordData } = await discoverRngdleAssets(session, config.rngdle.baseUrl, { words: true, actionName: "submitPoem" });
  const bank = { number: result.number, badges: result.badges, wordBank: buildWordBank(wordData, result.badges, result.number), rules: POEM_RULES };
  if (!bank.wordBank.length) throw new Error("RNGdle returned an empty word bank");
  return { bank, actionId: actions.submitPoem };
}

export async function inspectPoem(config) {
  const session = await createRngdleSession(config);
  const home = await fetchHome(session);
  if (!home.lastRoll) throw new Error("A daily roll is required before inspecting the word bank");
  const { bank, actionId } = await readBank(session, config, home.lastRoll);
  return { ...bank, existingPoem: home.lastRoll.poem, submit: { method: "POST", path: "/", actionId } };
}

export async function composeDailyPoem(config, result, { draft = null, onDraft = async () => {}, generate = generatePoem } = {}) {
  const session = await createRngdleSession(config);
  const gameDate = result.gameDate ?? utcDate();
  let home = await fetchHome(session);
  ensureSameRoll(home, result, gameDate);
  if (home.lastRoll.poem) return { text: home.lastRoll.poem, reused: true, gameDate };
  const { bank, actionId } = await readBank(session, config, home.lastRoll);
  const signature = JSON.stringify(bank.wordBank);
  if (draft?.qualityVersion !== POEM_QUALITY_VERSION || draft?.number !== result.number || draft?.gameDate !== gameDate || draft?.bankSignature !== signature) {
    draft = { ...await generate(config, bank), number: result.number, gameDate, bankSignature: signature };
    await onDraft(draft);
  }
  const tiles = validatePoemSelection({ tiles: draft.tiles }, bank.wordBank);
  const text = renderPoem(tiles, bank.wordBank);
  home = await fetchHome(session);
  ensureSameRoll(home, result, gameDate);
  if (home.lastRoll.poem) return { text: home.lastRoll.poem, reused: true, gameDate };
  // Official tile IDs are sent directly; no browser, DOM, or simulated clicks.
  await callServerAction(session, actionId, [tiles], (value) => value.success === true && typeof value.text === "string");
  const deadline = Date.now() + config.http.timeoutMs;
  do {
    home = await fetchHome(session);
    ensureSameRoll(home, result, gameDate);
    if (home.lastRoll.poem) {
      if (home.lastRoll.poem !== text) throw new Error("Saved RNGdle poem differs from the selected draft; check the website");
      return { text: home.lastRoll.poem, reused: false, gameDate, model: draft.model };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  } while (Date.now() < deadline);
  throw new Error("Poem submission could not be confirmed; the next attempt will check the saved poem first");
}
