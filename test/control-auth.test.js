import assert from "node:assert/strict";
import test from "node:test";
import { createControlAuth, parseCookies, sessionCookie, expiredSessionCookie } from "../src/control-auth.js";
import { MemoryStorage } from "./helpers/cloud-fixture.js";

const password = "control-test-password";

test("Control sessions survive recreation without storing the secret or a password hash", async () => {
  const storage = new MemoryStorage();
  let auth = await createControlAuth({ storage, password });
  await assert.rejects(auth.login("wrong-password", "local"), /Invalid Control password/);
  const login = await auth.login(password, "local");
  assert.match(login.token, /^[A-Za-z0-9_-]+$/);
  const document = await storage.get("auth");
  assert.equal(document.version, 2);
  assert.equal("password" in document, false);
  assert.doesNotMatch(JSON.stringify(document), /control-test-password/);
  auth = await createControlAuth({ storage, password });
  assert.equal((await auth.session(login.token)).csrfToken, login.csrfToken);
  await auth.logout(login.token);
  assert.equal(await (await createControlAuth({ storage, password })).session(login.token), null);
});

test("rotating the Worker secret rejects the old password and invalidates old sessions", async () => {
  const storage = new MemoryStorage();
  const before = await createControlAuth({ storage, password });
  const login = await before.login(password, "local");
  const after = await createControlAuth({ storage, password: "updated-control-password" });
  assert.equal(await after.session(login.token), null);
  await assert.rejects(after.login(password, "local"), /Invalid Control password/);
  const next = await after.login("updated-control-password", "local");
  assert.ok(await after.session(next.token));
});

test("the old stored password and sessions are retired while login limits survive", async () => {
  const storage = new MemoryStorage();
  const failures = { blocked: { count: 5, resetAt: Date.now() + 60_000 } };
  await storage.put("auth", {
    version: 1, password: { algorithm: "scrypt", salt: "old-salt", key: "old-hash" },
    sessions: [{ tokenHash: "old-session", expiresAt: "2099-01-01" }], failures,
  });
  const auth = await createControlAuth({ storage, password });
  assert.deepEqual(await storage.get("auth"), { version: 2, sessions: [], failures });
  assert.equal(await auth.session("old-session"), null);
  await assert.rejects(auth.login(password, "blocked"), /Too many failed attempts/);
  assert.ok((await auth.login(password, "another-address")).token);
});

test("a stored password cannot bypass a missing or invalid Worker secret", async () => {
  const storage = new MemoryStorage();
  await storage.put("auth", { version: 1, password: { algorithm: "scrypt", salt: "old", key: "hash" }, sessions: [] });
  for (const value of [undefined, "", "short", " ".repeat(8), "x".repeat(513)]) {
    await assert.rejects(createControlAuth({ storage, password: value }), /CONTROL_PASSWORD.*8–512/);
  }
});

test("the Control secret is compared exactly, including intentional whitespace", async () => {
  const secret = " control-password ";
  const auth = await createControlAuth({ storage: new MemoryStorage(), password: secret });
  await assert.rejects(auth.login(secret.trim(), "local"), /Invalid Control password/);
  assert.ok((await auth.login(secret, "local")).token);
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
