import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRngdleSession, callServerAction } from "../src/rngdle-http.js";
import { parseWordData, buildWordBank } from "../src/rngdle-assets.js";
import { followAuthenticationLink, getDailyRoll } from "../src/rngdle.js";
import { composeDailyPoem, inspectPoem } from "../src/poem-http.js";

const wordSource = await fs.readFile(new URL("./fixtures/rngdle-word-data.txt", import.meta.url), "utf8");
const actions = 'var roll=(0,S.createServerReference)("001122",S.callServer,void 0,S.findSourceMapURL,"rollDiceAction"),poem=(0,S.createServerReference)("409988",S.callServer,void 0,S.findSourceMapURL,"submitPoem");';
const badges = [{ id: "MOUNTAIN", label: "Mountain" }, { id: "HELIUM", label: "Helium", isScoring: false }, { id: "EVEN", label: "Even" }];

async function fixture(context) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-http-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const state = { roll: { number: 238410, totalScore: 100, badges, poem: null }, hasRolledToday: true, posts: [], savedDraft: null, failResponse: false, rejected: false };
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/home") {
      res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": "session=fresh-token; Path=/; HttpOnly" });
      res.end(JSON.stringify({ viewer: { hasRolledToday: state.hasRolledToday, totalEp: 100, lastRoll: state.roll } }));
    } else if (req.method === "POST") {
      let body = ""; for await (const chunk of req) body += chunk;
      state.posts.push({ body: JSON.parse(body), action: req.headers["next-action"], cookie: req.headers.cookie, contentType: req.headers["content-type"] });
      res.setHeader("Content-Type", "text/x-component");
      if (req.headers["next-action"] === "001122") {
        state.hasRolledToday = true;
        res.end('0:{"a":"$@1"}\n1:{"number":238410}\n');
      } else if (state.rejected) {
        res.end('0:{"a":"$@1"}\n1:{"success":false,"error":"Invalid tile"}\n');
      } else {
        assert.ok(state.savedDraft, "draft must be persisted before the HTTP POST");
        state.roll.poem = state.savedDraft.text;
        if (state.failResponse) { res.destroy(); return; }
        res.end('0:{"a":"$@a"}\na:'+JSON.stringify({ success: true, text: state.roll.poem })+'\n');
      }
    } else if (req.url === "/_next/static/words.js") res.end(wordSource);
    else if (req.url === "/_next/static/actions.js") res.end(actions);
    else res.end('<script src="/_next/static/words.js"></script><script src="/_next/static/actions.js"></script><script src="https://untrusted.invalid/_next/static/leak.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const config = { http: { timeoutMs: 5000 }, rngdle: { baseUrl: `http://127.0.0.1:${server.address().port}` }, storage: { directory, cookiePath: path.join(directory, "cookies.json") } };
  const generated = { tiles: [{ id: "MOUNTAIN_0", variant: "mountains" }, { id: "HELIUM_0" }, { id: "MOUNTAIN_5" }], text: "mountains rise!", model: "test" };
  const options = { generate: async () => generated, onDraft: async (draft) => { state.savedDraft = draft; } };
  return { config, state, options };
}

test("literal parser reconstructs deterministic official IDs without executing downloaded code", () => {
  const data = parseWordData(wordSource + '\nglobalThis.__rngdleExecuted = true;');
  assert.equal(globalThis.__rngdleExecuted, undefined);
  const bank = buildWordBank(data, badges, 238410);
  assert.equal(bank.length, 9);
  assert.deepEqual(bank.filter(x => x.badgeId === "MOUNTAIN").map(x => x.id), ["MOUNTAIN_0", "MOUNTAIN_2", "MOUNTAIN_5"]);
  assert.deepEqual(bank.find(x => x.id === "MOUNTAIN_0").variants, ["mountains"]);
  assert.equal(bank.find(x => x.id === "HELIUM_0").word, "rise");
  assert.deepEqual(buildWordBank(data, badges, 238410), bank);
  assert.notDeepEqual(buildWordBank(data, badges, 123456), bank);
  assert.throws(() => parseWordData(wordSource.replace("1664525", "1664526")), /algorithm changed/);
  assert.throws(() => parseWordData(wordSource.replace('"mountains"', 'process.exit()')));
});

test("poem is submitted by HTTP using dynamic action ID, official tile IDs, and persisted cookies", async (context) => {
  const { config, state, options } = await fixture(context);
  const inspection = await inspectPoem(config);
  assert.equal(inspection.wordBank.length, 9);
  assert.equal(inspection.submit.actionId, "409988");
  const result = await composeDailyPoem(config, state.roll, options);
  assert.equal(result.text, "mountains rise!");
  assert.equal(result.reused, false);
  assert.deepEqual(state.posts[0], { body: [state.savedDraft.tiles], action: "409988", cookie: "session=fresh-token", contentType: "text/plain;charset=UTF-8" });
  const document = JSON.parse(await fs.readFile(config.storage.cookiePath, "utf8"));
  assert.equal(document.cookies.session, "fresh-token");
  assert.equal((await fs.stat(config.storage.cookiePath)).mode & 0o777, 0o600);
  assert.equal((await composeDailyPoem(config, state.roll, { generate: () => assert.fail("must not generate twice") })).reused, true);
  assert.equal(state.posts.length, 1);
  // Inspection still works after the site hides the composer button.
  assert.equal((await inspectPoem(config)).wordBank.length, 9);
  await assert.rejects(composeDailyPoem(config, { ...state.roll, number: 999 }), /different roll\/day/);
  await assert.rejects(composeDailyPoem(config, { ...state.roll, gameDate: "2000-01-01" }), /different roll\/day/);
});

test("lost submit response is recovered without a second submission or LLM call", async (context) => {
  const { config, state, options } = await fixture(context);
  state.failResponse = true;
  await assert.rejects(composeDailyPoem(config, state.roll, options), /request failed/);
  const result = await composeDailyPoem(config, state.roll, { generate: () => assert.fail("no duplicate paid call") });
  assert.equal(result.reused, true);
  assert.equal(state.posts.length, 1);
});

test("server rejection is not treated as success and a valid saved draft is reused", async (context) => {
  const { config, state, options } = await fixture(context);
  state.rejected = true;
  await assert.rejects(composeDailyPoem(config, state.roll, options), /Invalid tile/);
  assert.equal(state.roll.poem, null);
  state.rejected = false;
  const result = await composeDailyPoem(config, state.roll, { draft: state.savedDraft, generate: () => assert.fail("reuse saved draft") });
  assert.equal(result.text, "mountains rise!");
});

test("daily roll reuses existing data or submits the dynamically discovered roll action", async (context) => {
  const { config, state } = await fixture(context);
  assert.equal((await getDailyRoll(config)).number, 238410);
  assert.equal(state.posts.length, 0);
  state.hasRolledToday = false;
  assert.equal((await getDailyRoll(config)).number, 238410);
  assert.equal(state.posts.length, 1);
  assert.equal(state.posts[0].action, "001122");
  assert.deepEqual(state.posts[0].body, []);
});

test("sessions restrict origin, load existing remote cookie files, and reject unknown action responses", async (context) => {
  const { config } = await fixture(context);
  await fs.writeFile(config.storage.cookiePath, JSON.stringify({ version: 1, cookies: { session: "remote-session" } }));
  const session = await createRngdleSession(config);
  await assert.rejects(session.request("https://external.invalid/"), /trusted origin/);
  await assert.rejects(callServerAction({ request: async () => new Response('0:{"success":false}') }, "id", [], value => value.success), /unrecognized result/);
});

test("HTTP magic-link redirects are followed only within trusted RNGdle origins", async () => {
  const config = { rngdle: { baseUrl: "https://www.rngdle.com" } };
  const visited = [];
  const session = { request: async (url) => {
    visited.push(String(url));
    if (String(url).includes("verify")) return new Response(null, { status: 302, headers: { location: "/" } });
    if (String(url).includes("/api/home")) return Response.json({ viewer: { hasRolledToday: false } });
    return new Response("logged in");
  } };
  await followAuthenticationLink(session, config, "https://www.rngdle.com/verify?token=private");
  assert.equal(visited.length, 3);
  session.request = async () => new Response(null, { status: 302, headers: { location: "https://external.invalid/" } });
  await assert.rejects(followAuthenticationLink(session, config, "https://www.rngdle.com/verify"), /trusted origin/);
});
