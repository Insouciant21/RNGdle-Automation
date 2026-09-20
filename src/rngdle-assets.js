import { createHash } from "node:crypto";
import { parse } from "acorn";
import { isRngdleUrl, responseText } from "./rngdle-http.js";

const cache = new Map();
// Fingerprint of the observed selection function, not of the word dictionary.
// A changed algorithm must be reviewed before using its reconstructed word IDs.
const WORD_ALGORITHM_HASH = "94e20cf939f070dedfd08a42e52e25943bb02eb7116e1dd654a38ed624776a21";

function* nodes(root) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (node.type) yield node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) pending.push(...value);
      else if (value && typeof value === "object") pending.push(value);
    }
  }
}

function literal(node, bindings) {
  if (node?.type === "Literal" && ["string", "number"].includes(typeof node.value)) return node.value;
  if (node?.type === "Identifier" && bindings.has(node.name)) return bindings.get(node.name);
  if (node?.type === "ArrayExpression") return node.elements.map((value) => literal(value, bindings));
  if (node?.type === "ObjectExpression") {
    const value = Object.create(null);
    for (const property of node.properties) {
      if (property.type !== "Property" || property.computed || property.method || property.kind !== "init") throw new Error("Unsupported data property");
      const key = property.key.name ?? property.key.value;
      if (typeof key !== "string") throw new Error("Unsupported data key");
      value[key] = literal(property.value, bindings);
    }
    return value;
  }
  throw new Error("Only literal RNGdle word data is supported");
}

export function parseWordData(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "script" });
  for (const module of nodes(ast)) {
    if (module.type !== "ArrowFunctionExpression" || module.body.type !== "BlockStatement") continue;
    const body = module.body.body;
    const bindings = new Map();
    for (const statement of body) {
      if (statement.type !== "VariableDeclaration") continue;
      for (const declaration of statement.declarations) {
        if (declaration.id.type !== "Identifier") continue;
        try { bindings.set(declaration.id.name, literal(declaration.init, bindings)); } catch { /* Not static data. */ }
      }
    }
    let variants;
    let functionName;
    for (const statement of body) {
      if (statement.type !== "ExpressionStatement") continue;
      for (const array of nodes(statement)) {
        if (array.type !== "ArrayExpression") continue;
        for (let index = 0; index < array.elements.length; index++) {
          if (array.elements[index]?.value === "WORD_VARIANTS" && array.elements[index + 1]?.value === 0) {
            variants = literal(array.elements[index + 2], bindings);
          }
          if (array.elements[index]?.value === "getWordsForBadges") {
            const exported = array.elements[index + 1];
            if (exported?.type === "ArrowFunctionExpression" && exported.body.type === "Identifier") functionName = exported.body.name;
          }
        }
      }
    }
    if (!variants || !functionName) continue;
    const algorithm = body.find((node) => node.type === "FunctionDeclaration" && node.id.name === functionName);
    if (!algorithm || createHash("sha256").update(source.slice(algorithm.start, algorithm.end)).digest("hex") !== WORD_ALGORITHM_HASH) {
      throw new Error("RNGdle word selection algorithm changed; review it before submitting poems");
    }
    const badgeWords = [...bindings.values()].find((value) => value && !Array.isArray(value) && Array.isArray(value.MOUNTAIN) && Array.isArray(value.EVEN));
    const categories = [...bindings.values()].find((value) => Array.isArray(value) && value.includes("noun") && value.includes("punct"));
    if (!badgeWords || !categories) throw new Error("RNGdle badge dictionary or category order is missing");
    if (!Object.values(variants).every((forms) => Array.isArray(forms) && forms.every((word) => typeof word === "string"))) throw new Error("Invalid word variants data");
    for (const entries of Object.values(badgeWords)) {
      if (!Array.isArray(entries) || !entries.every((entry) => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string" && categories.includes(entry[1]))) {
        throw new Error("Invalid badge word data");
      }
    }
    return { variants, badgeWords, categories };
  }
  throw new Error("RNGdle word data exports could not be found");
}

export function buildWordBank(data, badges, rollNumber) {
  const tiles = [];
  for (const badge of badges) {
    const candidates = data.badgeWords[badge.id];
    if (!candidates) continue;
    let indices = candidates.map((_, index) => index);
    if (indices.length > 3) {
      let seed = 5381;
      for (const character of `${rollNumber}:${badge.id}`) seed = ((seed << 5) + seed + character.charCodeAt(0)) | 0;
      seed = Math.abs(seed);
      for (let index = indices.length - 1; index > 0; index--) {
        seed = (1664525 * seed + 1013904223) | 0;
        const selected = Math.abs(seed) % (index + 1);
        [indices[index], indices[selected]] = [indices[selected], indices[index]];
      }
      indices = indices.slice(0, 3).sort((a, b) => a - b);
    }
    for (const index of indices) {
      const [originalWord, category] = candidates[index];
      const word = originalWord.toLowerCase();
      tiles.push({ id: `${badge.id}_${index}`, word, variants: data.variants[word] ?? [], badgeId: badge.id, category });
    }
  }
  const rank = new Map(data.categories.map((category, index) => [category, index]));
  return tiles.sort((a, b) => (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99) || a.word.localeCompare(b.word, "en"));
}

export async function discoverRngdleAssets(session, baseUrl, { words = false, actionName } = {}) {
  const page = await session.request("/", { headers: { Accept: "text/html" } });
  if (!page.ok) throw new Error(`RNGdle page returned HTTP ${page.status}`);
  const html = await responseText(page);
  const scripts = [...new Set([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => new URL(match[1], baseUrl).href))]
    .filter((url) => isRngdleUrl(url, baseUrl) && new URL(url).pathname.startsWith("/_next/static/") && new URL(url).pathname.endsWith(".js"));
  if (!scripts.length || scripts.length > 100) throw new Error("RNGdle page exposed an unexpected script list");
  let wordData;
  const actions = {};
  for (let start = 0; start < scripts.length; start += 4) {
    const batch = await Promise.all(scripts.slice(start, start + 4).map(async (url) => {
      if (cache.has(url)) return cache.get(url);
      const response = await session.request(url);
      if (!response.ok) throw new Error(`RNGdle asset returned HTTP ${response.status}`);
      const source = await responseText(response);
      const metadata = { actions: {} };
      for (const match of source.matchAll(/createServerReference\)\("([a-f0-9]+)"[^)]*"(rollDiceAction|submitPoem)"\)/g)) metadata.actions[match[2]] = match[1];
      if (source.includes('"WORD_VARIANTS"') && source.includes('"getWordsForBadges"')) metadata.wordSource = source;
      cache.set(url, metadata);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      return metadata;
    }));
    for (const metadata of batch) {
      Object.assign(actions, metadata.actions);
      if (words && metadata.wordSource && !metadata.wordData) metadata.wordData = parseWordData(metadata.wordSource);
      wordData ??= metadata.wordData;
    }
    if ((!words || wordData) && (!actionName || actions[actionName])) return { actions, wordData };
  }
  throw new Error("RNGdle required action or word data was not found in current site assets");
}
