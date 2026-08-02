import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationRequiredError, normalizeHomePayload, parseServerActionResult } from "../src/rngdle.js";

test("parses the authenticated Next.js roll action response", () => {
  assert.deepEqual(
    parseServerActionResult('0:{"a":"$@1"}\n1:{"number":123456,"badges":[],"totalScore":42,"recorded":true}\n'),
    { number: 123456, badges: [], totalScore: 42, recorded: true },
  );
});

test("normalizes the current roll and badge fields from /api/home", () => {
  assert.deepEqual(
    normalizeHomePayload({
      viewer: {
        totalEp: 1234,
        hasRolledToday: true,
        lastRoll: {
          number: 4242,
          totalScore: 81,
          poem: "hello",
          badges: [{ id: "MEANING", label: "Meaning", emoji: "x", score: 42 }],
        },
      },
    }),
    {
      hasRolledToday: true,
      totalEp: 1234,
      lastRoll: {
        number: 4242,
        earnedEp: 81,
        poem: "hello",
        badges: [{ id: "MEANING", label: "Meaning", emoji: "x", description: "", score: 42, isScoring: true, isNew: false, rarity: "common" }],
        rarity: "trash",
      },
    },
  );
});

test("treats a missing viewer as expired authentication", () => {
  assert.throws(() => normalizeHomePayload({ viewer: null }), AuthenticationRequiredError);
});

test("preserves explicit RNGdle rarity metadata", () => {
  const result = normalizeHomePayload({
    viewer: {
      totalEp: 10,
      hasRolledToday: true,
      lastRoll: {
        number: 123,
        totalScore: 100,
        rarity: "MYTHIC",
        badges: [{ id: "RARE", label: "Rare badge", score: 2_000, rarity: "EPIC", description: "A test badge.", isNew: true }],
      },
    },
  }).lastRoll;

  assert.equal(result.rarity, "mythic");
  assert.equal(result.badges[0].rarity, "epic");
  assert.equal(result.badges[0].description, "A test badge.");
  assert.equal(result.badges[0].isNew, true);
});
