import assert from "node:assert/strict";
import test from "node:test";
import { isWorkflowDue, utcDate, nextRetryAt } from "../src/schedule.js";

test("daily records use UTC dates across midnight and local timezone offsets", () => {
  assert.equal(utcDate(new Date("2026-07-28T23:59:59.999Z")), "2026-07-28");
  assert.equal(utcDate(new Date("2026-07-29T00:00:00Z")), "2026-07-29");
  assert.equal(utcDate(new Date("2026-07-29T07:59:59+08:00")), "2026-07-28");
});

test("a completed day becomes due again at the next UTC midnight", () => {
  const days = { "2026-07-28": { status: "success" } };
  for (const [instant, due] of [["2026-07-28T23:59:59.999Z", false], ["2026-07-29T00:00:00Z", true]]) {
    const now = new Date(instant);
    assert.equal(isWorkflowDue({ now, dayState: days[utcDate(now)] }), due);
  }
});

test("successful days do not rerun and failed days respect next retry", () => {
  const base = {
    now: new Date("2026-07-29T01:00:00Z"),
  };
  assert.equal(isWorkflowDue({ ...base, dayState: { status: "success" } }), false);
  assert.equal(isWorkflowDue({ ...base, dayState: { status: "auth_required" } }), false);
  assert.equal(
    isWorkflowDue({
      ...base,
      dayState: { lastAttemptAt: "2026-07-29T00:45:00Z", nextRetryAt: "2026-07-29T01:15:00Z" },
    }),
    false,
  );
  assert.equal(
    isWorkflowDue({
      ...base,
      dayState: { lastAttemptAt: "2026-07-29T00:20:00Z", nextRetryAt: "2026-07-29T00:50:00Z" },
    }),
    true,
  );
});

test("email-pending days use the email retry timestamp", () => {
  const base = {
    now: new Date("2026-07-29T01:00:00Z"),
  };
  assert.equal(
    isWorkflowDue({
      ...base,
      dayState: {
        status: "email_pending",
        lastAttemptAt: "2026-07-29T00:45:00Z",
        nextRngdleRetryAt: "2026-07-29T01:45:00Z",
        nextEmailRetryAt: "2026-07-29T00:46:00Z",
      },
    }),
    true,
  );
  assert.equal(
    isWorkflowDue({
      ...base,
      dayState: {
        status: "email_pending",
        lastAttemptAt: "2026-07-29T00:45:00Z",
        nextRngdleRetryAt: "2026-07-29T01:45:00Z",
        nextEmailRetryAt: "2026-07-29T01:01:00Z",
      },
    }),
    false,
  );
});

test("nextRetryAt adds the configured interval", () => {
  assert.equal(nextRetryAt(new Date("2026-07-29T00:02:00Z"), 30), "2026-07-29T00:32:00.000Z");
});

test("poem-pending days respect their own retry timestamp", () => {
  const base = { now: new Date("2026-09-19T01:00:00Z") };
  const dayState = { status: "poem_pending", lastAttemptAt: "2026-09-19T00:50:00Z", nextPoemRetryAt: "2026-09-19T01:05:00Z", nextEmailRetryAt: "2026-09-19T00:51:00Z" };
  assert.equal(isWorkflowDue({ ...base, dayState }), false);
  assert.equal(isWorkflowDue({ ...base, dayState: { ...dayState, nextPoemRetryAt: "2026-09-19T00:55:00Z" } }), true);
});
