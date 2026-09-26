import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildPoemMessages, filterWordsByBadge, generatePoem, renderPoem, selectPoemWords, validatePoemSelection } from "../src/poem.js";

const wordBank = [
  { id: "MOUNTAIN_0", word: "mountain", variants: ["mountains"], badgeId: "MOUNTAIN", category: "word" },
  { id: "HELIUM_0", word: "rise", variants: ["rises", "rising"], badgeId: "HELIUM", category: "word" },
  { id: "MOUNTAIN_5", word: "!", variants: [], badgeId: "MOUNTAIN", category: "punct" },
  { id: "OTHER_0", word: "mountain", variants: [], badgeId: "OTHER", category: "word" },
];
const bank = { number: 123456, badges: [{ id: "MOUNTAIN", label: "Mountain", description: "A peak", isScoring: false }], wordBank };
const approvedReview = { understandable: true, naturalEnglish: true, coherentImage: true, meaning: "Mountains rise upward.", problems: [] };
const completion = (value) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });

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
    const request = { url: req.url, auth: req.headers.authorization, body: JSON.parse(text) };
    const reviewing = request.body.messages[0].content.includes("strict English poetry editor");
    if (!reviewing) captured = request;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(completion(reviewing ? approvedReview : { words: ["mountains", "rise"] })));
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
    if (messages[0].content.includes("strict English poetry editor")) return completion(approvedReview);
    attempts++;
    if (attempts === 2) assert.match(messages.at(-1).content, /unavailable word/);
    return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ words: [attempts === 1 ? "invented" : "mountain"] }) } }] };
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


test("legal but meaningless poems are rejected and regenerated with concrete feedback", async () => {
  let generations = 0, reviews = 0;
  const client = { chat: { completions: { create: async ({ messages }) => {
    if (messages[0].content.includes("strict English poetry editor")) {
      reviews++;
      assert.equal(messages.length, 2);
      assert.deepEqual(Object.keys(JSON.parse(messages[1].content)), ["poem"]);
      return completion(reviews === 1 ? { ...approvedReview, naturalEnglish: false, problems: ["Singular subject mountain requires rises."] } : approvedReview);
    }
    generations++;
    if (generations === 2) {
      const feedback = JSON.parse(messages.at(-1).content);
      assert.equal(feedback.rejectedCandidate, "mountain rise");
      assert.match(feedback.feedback, /requires rises/);
    }
    return completion({ words: [generations === 2 ? "mountains" : "mountain", "rise"] });
  } } } };
  const result = await generatePoem(config, bank, { client });
  assert.equal(result.text, "mountains rise");
  assert.equal(result.qualityVersion, 1);
  assert.equal(generations, 2);
  assert.equal(reviews, 2);
});

test("failed, malformed, and contradictory reviews never yield a submit-ready poem", async () => {
  for (const review of [null, {}, { ...approvedReview, understandable: "true" }, { ...approvedReview, meaning: "" }, { ...approvedReview, coherentImage: false }, { ...approvedReview, problems: ["Word salad"] }]) {
    let calls = 0;
    const client = { chat: { completions: { create: async ({ messages }) => {
      calls++;
      return completion(messages[0].content.includes("strict English poetry editor") ? review : { words: ["mountain"] });
    } } } };
    await assert.rejects(generatePoem(config, bank, { client }), /after 3 attempts/);
    assert.equal(calls, 6);
  }
});

test("review transport failure stops generation without accepting the candidate", async () => {
  let calls = 0;
  const client = { chat: { completions: { create: async () => {
    if (++calls === 1) return completion({ words: ["mountain"] });
    throw Object.assign(new Error("secret provider body"), { status: 503 });
  } } } };
  await assert.rejects(generatePoem(config, bank, { client }), /LLM request failed \(HTTP 503\)/);
  assert.equal(calls, 2);
});


test("readable words map to official IDs with exact forms and distinct tile allocation", () => {
  const tiles = selectPoemWords({ words: ["mountains", "rise", "!"] }, wordBank);
  assert.equal(renderPoem(tiles, wordBank), "mountains rise!");
  assert.equal(selectPoemWords({ words: ["mountain", "mountain"] }, wordBank).length, 2);
  for (const words of [[], ["invented"], ["rise", "rise"], ["Mountain"], ["mountain rise"], [null], Array(11).fill("mountain")]) {
    assert.throws(() => selectPoemWords({ words }, wordBank));
  }
  const overlapping = [
    { id: "A", word: "rise", variants: ["rises"] },
    { id: "B", word: "rise", variants: [] },
  ];
  assert.deepEqual(selectPoemWords({ words: ["rise", "rises"] }, overlapping), [{ id: "B" }, { id: "A", variant: "rises" }]);
});
