import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildPoemMessages, filterWordsByBadge, generatePoem, renderPoem, validatePoemSelection } from "../src/poem.js";

const wordBank = [
  { id: "MOUNTAIN_0", word: "mountain", variants: ["mountains"], badgeId: "MOUNTAIN", category: "word" },
  { id: "HELIUM_0", word: "rise", variants: ["rises", "rising"], badgeId: "HELIUM", category: "word" },
  { id: "MOUNTAIN_5", word: "!", variants: [], badgeId: "MOUNTAIN", category: "punct" },
  { id: "OTHER_0", word: "mountain", variants: [], badgeId: "OTHER", category: "word" },
];
const bank = { number: 123456, badges: [{ id: "MOUNTAIN", label: "Mountain", description: "A peak", isScoring: false }], wordBank };
const config = { llm: { apiKey: "test-key", endpoint: "http://127.0.0.1", model: "deepseek-flash", timeoutMs: 1000, maxTokens: 2048, maxAttempts: 3, thinking: "disabled" } };

test("poem prompt contains the complete bank, allowed variants, and non-scoring badge words", () => {
  const messages = buildPoemMessages(bank);
  const data = JSON.parse(messages[1].content);
  assert.deepEqual(data.wordBank, wordBank);
  assert.deepEqual(data.wordsFromBadges[0].tileIds, ["MOUNTAIN_0", "MOUNTAIN_5"]);
  assert.deepEqual(filterWordsByBadge(wordBank, "MOUNTAIN"), [wordBank[0], wordBank[2]]);
  assert.match(messages[0].content, /Each tile ID may be used only once/);
});

test("validation enforces tile budget, unique IDs, and exact allowed forms", () => {
  for (const tiles of [[], Array.from({ length: 11 }, () => ({ id: "MOUNTAIN_0" })), [{ id: "missing" }], [{ id: "MOUNTAIN_0" }, { id: "MOUNTAIN_0", variant: "mountains" }], [{ id: "HELIUM_0", variant: "rose" }], [{ id: "MOUNTAIN_0", variant: null }]]) {
    assert.throws(() => validatePoemSelection({ tiles }, wordBank));
  }
  assert.equal(validatePoemSelection({ tiles: [{ id: "MOUNTAIN_0" }, { id: "OTHER_0" }] }, wordBank).length, 2);
  assert.equal(renderPoem([{ id: "MOUNTAIN_0", variant: "mountains" }, { id: "HELIUM_0" }, { id: "MOUNTAIN_5" }], wordBank), "mountains rise!");
});

test("OpenAI SDK sends configurable auth, JSON mode and DeepSeek settings over HTTP", async (context) => {
  let captured;
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    captured = { url: req.url, auth: req.headers.authorization, body: JSON.parse(text) };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tiles: [{ id: "MOUNTAIN_0", variant: "mountains" }, { id: "HELIUM_0" }] }) } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const result = await generatePoem({ llm: { ...config.llm, endpoint: `http://127.0.0.1:${server.address().port}/v1` } }, bank);
  assert.equal(result.text, "mountains rise");
  assert.equal(captured.url, "/v1/chat/completions");
  assert.equal(captured.auth, "Bearer test-key");
  assert.equal(captured.body.model, "deepseek-flash");
  assert.deepEqual(captured.body.response_format, { type: "json_object" });
  assert.deepEqual(captured.body.thinking, { type: "disabled" });
});

test("invalid model output is repaired within a bounded number of attempts", async () => {
  let attempts = 0;
  const client = { chat: { completions: { create: async ({ messages }) => {
    attempts++;
    if (attempts === 2) assert.match(messages.at(-1).content, /unknown tile/);
    return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ tiles: [{ id: attempts === 1 ? "invented" : "MOUNTAIN_0" }] }) } }] };
  } } } };
  assert.equal((await generatePoem(config, bank, { client })).text, "mountain");
  assert.equal(attempts, 2);
  client.chat.completions.create = async () => ({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
  await assert.rejects(generatePoem(config, bank, { client }), /after 3 attempts/);
});

test("provider errors do not leak API keys or echo response bodies", async () => {
  const client = { chat: { completions: { create: async () => { throw Object.assign(new Error("Authorization: Bearer PRIVATE_KEY"), { status: 401 }); } } } };
  await assert.rejects(generatePoem(config, bank, { client }), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /PRIVATE_KEY/);
    return true;
  });
});
