import assert from "node:assert/strict";
import test from "node:test";
import { isWorkflowDue, localParts, nextRetryAt } from "../src/schedule.js";

test("localParts uses the configured UTC+8 timezone", () => {
  assert.deepEqual(localParts(new Date("2026-07-29T00:02:00.000Z"), "Asia/Shanghai"), {
    date: "2026-07-29",
    minutes: 8 * 60 + 2,
  });
});

test("workflow becomes due at 08:02 and not before", () => {
  const base = { timezone: "Asia/Shanghai", scheduleTime: "08:02" };
  assert.equal(isWorkflowDue({ ...base, now: new Date("2026-07-28T23:59:00Z") }), false);
  assert.equal(isWorkflowDue({ ...base, now: new Date("2026-07-29T00:02:00Z") }), true);
});

test("successful days do not rerun and failed days respect next retry", () => {
  const base = {
    timezone: "Asia/Shanghai",
    scheduleTime: "08:02",
    now: new Date("2026-07-29T01:00:00Z"),
  };
  assert.equal(isWorkflowDue({ ...base, dayState: { status: "success" } }), false);
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
    timezone: "Asia/Shanghai",
    scheduleTime: "08:02",
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
