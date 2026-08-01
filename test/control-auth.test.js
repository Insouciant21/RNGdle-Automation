import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createControlAuth, parseCookies, sessionCookie } from "../src/control-auth.js";

test("Control authentication persists hashed passwords and sessions", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-control-auth-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const authPath = path.join(directory, "control-auth.json");
  const auth = await createControlAuth({ authPath, initialPassword: "initial-control-password", sessionDays: 7 });

  await assert.rejects(() => auth.login("wrong-control-password", "127.0.0.1"), /Invalid Control password/);
  const login = await auth.login("initial-control-password", "127.0.0.1");
  assert.match(login.token, /^[A-Za-z0-9_-]+$/);
  assert.ok((await auth.session(login.token)).csrfToken);
  const document = JSON.parse(await fs.readFile(authPath, "utf8"));
  assert.equal(document.password.key.includes("initial-control-password"), false);
  assert.equal(document.sessions.length, 1);

  await auth.changePassword("replacement-control-password", "replacement-control-password");
  assert.equal(await auth.session(login.token), null);
  await assert.rejects(() => auth.login("initial-control-password", "127.0.0.1"), /Invalid Control password/);
  assert.ok(await auth.login("replacement-control-password", "127.0.0.1"));
});

test("Control authentication supports first-run password setup", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rngdle-control-setup-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const auth = await createControlAuth({ authPath: path.join(directory, "control-auth.json") });
  assert.equal(auth.isConfigured(), false);
  const setup = await auth.setupPassword("first-run-control-password", "first-run-control-password");
  assert.ok(setup.token);
  assert.equal(auth.isConfigured(), true);
  await assert.rejects(() => auth.setupPassword("another-control-password", "another-control-password"), /already configured/);
});

test("Control session cookies are HttpOnly and SameSite protected", () => {
  const cookie = sessionCookie("token-value", 600, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.deepEqual(parseCookies({ headers: { cookie: "rngdle_control_session=token-value; other=value" } }), {
    rngdle_control_session: "token-value",
    other: "value",
  });
});
