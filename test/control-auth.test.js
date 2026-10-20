import assert from "node:assert/strict";
import test from "node:test";
import { createControlAuth, parseCookies, sessionCookie, expiredSessionCookie } from "../src/control-auth.js";
import { MemoryStorage } from "./helpers/cloud-fixture.js";

test("Control password hashes and sessions survive recreation using Durable Object storage", async () => {
  const storage = new MemoryStorage();
  let auth = await createControlAuth({ storage });
  await auth.setupPassword("control-test-password", "control-test-password");
  await assert.rejects(auth.login("wrong-password", "local"), /Invalid Control password/);
  const login = await auth.login("control-test-password", "local");
  assert.match(login.token, /^[A-Za-z0-9_-]+$/);
  const document = await storage.get("auth");
  assert.equal(document.password.algorithm, "scrypt");
  assert.doesNotMatch(JSON.stringify(document), /control-test-password/);
  auth = await createControlAuth({ storage });
  assert.equal((await auth.session(login.token)).csrfToken, login.csrfToken);
  await auth.logout(login.token);
  assert.equal(await (await createControlAuth({ storage })).session(login.token), null);
});

test("first-run setup validates passwords and cannot replace an existing password", async () => {
  const auth = await createControlAuth({ storage: new MemoryStorage() });
  assert.equal(auth.isConfigured(), false);
  await assert.rejects(auth.setupPassword("short", "short"), /at least 8/);
  await assert.rejects(auth.setupPassword("control-test-password", "mismatch"), /do not match/);
  const setup = await auth.setupPassword("control-test-password", "control-test-password");
  assert.ok(setup.token);
  assert.equal(auth.isConfigured(), true);
  await assert.rejects(auth.setupPassword("other-password", "other-password"), /already configured/);
});

test("Worker session cookies always use Secure, HttpOnly and SameSite", () => {
  const cookie = sessionCookie("token-value", 600);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(expiredSessionCookie(), /Secure.*Max-Age=0/);
  assert.deepEqual(parseCookies(new Request("https://control.example.com", {
    headers: { Cookie: "rngdle_control_session=token-value; other=value" },
  })), { rngdle_control_session: "token-value", other: "value" });
});
