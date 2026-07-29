import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthenticationRequiredMessage, buildRollMessage } from "../src/mail.js";

const config = {
  rngdle: { baseUrl: "https://www.rngdle.com" },
  control: { publicUrl: "http://localhost:3000" },
  mail: { subjectPrefix: "[RNGdle]" },
  smtp: { from: "sender@gmail.com", to: ["receiver@example.com"] },
};

test("buildRollMessage renders the RNGdle result hierarchy", () => {
  const message = buildRollMessage(config, "2026-07-29", {
    number: 534461,
    earnedEp: 2795,
    totalEp: 865460,
    badges: [{ emoji: "x", label: "Mini Scramble", score: 579 }],
  });

  assert.match(message.subject, /534461 \(\+2795 EP\)/);
  assert.match(message.text, /Total EP: 865,460/);
  assert.match(message.html, />534461</);
  assert.match(message.html, /2,795 EP/);
  assert.match(message.html, /865,460 EP/);
  assert.match(message.html, /BADGE BREAKDOWN/i);
  assert.match(message.html, /Mini Scramble/);
  assert.match(message.html, /1 BADGE EARNED/);
});

test("mail templates escape untrusted display values", () => {
  const message = buildRollMessage(config, "2026-07-29", {
    number: 1,
    earnedEp: 0,
    totalEp: null,
    badges: [{ emoji: "", label: '<img src=x onerror="alert(1)">', score: 0 }],
  });
  const authentication = buildAuthenticationRequiredMessage({
    ...config,
    control: { publicUrl: 'http://localhost:3000/?next="><script>alert(1)</script>' },
  });

  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;img src=x/);
  assert.doesNotMatch(authentication.html, /<script>alert/);
  assert.match(authentication.html, /&lt;script&gt;/);
});
