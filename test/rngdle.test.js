import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationRequiredError, normalizeHomePayload } from "../src/rngdle.js";

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
        badges: [{ id: "MEANING", label: "Meaning", emoji: "x", score: 42, isScoring: true }],
      },
    },
  );
});

test("treats a missing viewer as expired authentication", () => {
  assert.throws(() => normalizeHomePayload({ viewer: null }), AuthenticationRequiredError);
});
