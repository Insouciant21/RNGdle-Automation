import crypto from "node:crypto";

const AUTH_VERSION = 2;
const PASSWORD_MIN_LENGTH = 8;

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function tokenDigest(token, password) {
  return crypto.createHmac("sha256", password).update(token).digest("hex");
}

export function isControlPasswordConfigured(password) {
  return typeof password === "string" && password.trim() !== "" && password.length >= PASSWORD_MIN_LENGTH && password.length <= 512;
}

function cleanSessions(document, now = Date.now()) {
  document.sessions = (Array.isArray(document.sessions) ? document.sessions : []).filter(
    (session) => typeof session?.tokenHash === "string" && Date.parse(session.expiresAt) > now,
  );
}

export async function createControlAuth({ password: secret, sessionDays = 7, storage }) {
  if (!isControlPasswordConfigured(secret)) {
    throw new Error("Set CONTROL_PASSWORD as a Worker secret (8–512 characters)");
  }
  const expectedPassword = crypto.createHash("sha256").update(secret).digest();
  const document = await storage.transaction(async (transaction) => {
    const current = await transaction.get("auth");
    if (current?.version === AUTH_VERSION) return current;
    if (current && current.version !== 1) throw new Error("Unsupported Control authentication state format");
    // Retire the migrated password hash and sessions from the old credential.
    const next = { version: AUTH_VERSION, sessions: [], failures: current?.failures ?? {} };
    await transaction.put("auth", next);
    return next;
  });
  cleanSessions(document);
  const failedAttempts = new Map(Object.entries(document.failures ?? {}));
  const maxAgeSeconds = sessionDays * 24 * 60 * 60;

  async function persist() {
    cleanSessions(document);
    for (const [address, entry] of failedAttempts) {
      if (entry.resetAt <= Date.now()) failedAttempts.delete(address);
    }
    document.failures = Object.fromEntries(failedAttempts);
    await storage.put("auth", document);
  }

  function rateLimitKey(address) {
    return address || "unknown";
  }

  function isRateLimited(address) {
    const entry = failedAttempts.get(rateLimitKey(address));
    if (!entry) return false;
    if (entry.resetAt <= Date.now()) {
      failedAttempts.delete(rateLimitKey(address));
      return false;
    }
    return entry.count >= 5;
  }

  function recordFailure(address) {
    const key = rateLimitKey(address);
    const entry = failedAttempts.get(key);
    if (!entry || entry.resetAt <= Date.now()) {
      failedAttempts.set(key, { count: 1, resetAt: Date.now() + 60_000 });
    } else {
      entry.count += 1;
    }
  }

  async function login(password, address) {
    if (isRateLimited(address)) throw new Error("Too many failed attempts. Try again in a minute.");
    const valid = typeof password === "string" && password.length <= 512 && crypto.timingSafeEqual(
      crypto.createHash("sha256").update(password).digest(), expectedPassword,
    );
    if (!valid) {
      recordFailure(address);
      await persist();
      throw new Error("Invalid Control password");
    }
    failedAttempts.delete(rateLimitKey(address));
    return issueSession();
  }

  async function issueSession() {
    const token = randomToken();
    const csrfToken = randomToken(24);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + maxAgeSeconds * 1_000).toISOString();
    document.sessions.push({ tokenHash: tokenDigest(token, secret), csrfToken, createdAt, expiresAt });
    await persist();
    return { token, csrfToken, createdAt, expiresAt, maxAgeSeconds };
  }

  function findSession(token) {
    if (!token) return null;
    cleanSessions(document);
    const digest = tokenDigest(token, secret);
    return document.sessions.find((session) => {
      const expected = Buffer.from(session.tokenHash, "hex");
      const actual = Buffer.from(digest, "hex");
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }) ?? null;
  }

  async function session(token) {
    const current = findSession(token);
    if (!current) return null;
    return { csrfToken: current.csrfToken, createdAt: current.createdAt, expiresAt: current.expiresAt };
  }

  async function logout(token) {
    if (!token) return;
    const digest = tokenDigest(token, secret);
    document.sessions = document.sessions.filter((current) => current.tokenHash !== digest);
    await persist();
  }

  return {
    login,
    session,
    logout,
  };
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") ?? "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value)
      .map(([name, ...value]) => [name, decodeURIComponent(value.join("="))]),
  );
}

export function sessionCookie(token, maxAgeSeconds) {
  const attributes = [
    `rngdle_control_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return attributes.join("; ");
}

export function expiredSessionCookie() {
  return sessionCookie("", 0);
}
