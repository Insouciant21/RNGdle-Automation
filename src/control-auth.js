import crypto from "node:crypto";

const AUTH_VERSION = 1;
const PASSWORD_MIN_LENGTH = 8;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function tokenDigest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function passwordInput(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Control password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > 512) throw new Error("Control password is too long");
  return password;
}

function derivePassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key.toString("hex"));
    });
  });
}

async function hashPassword(password) {
  const salt = randomToken(16);
  return { algorithm: "scrypt", salt, key: await derivePassword(password, salt) };
}

async function verifyPassword(password, stored) {
  if (!stored || stored.algorithm !== "scrypt" || typeof stored.salt !== "string" || typeof stored.key !== "string") {
    return false;
  }
  const derived = await derivePassword(password, stored.salt);
  const expected = Buffer.from(stored.key, "hex");
  const actual = Buffer.from(derived, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function cleanSessions(document, now = Date.now()) {
  document.sessions = (Array.isArray(document.sessions) ? document.sessions : []).filter(
    (session) => typeof session?.tokenHash === "string" && Date.parse(session.expiresAt) > now,
  );
}

export async function createControlAuth({ sessionDays = 7, storage }) {
  let document = await storage.get("auth");
  if (!document) {
    document = {
      version: AUTH_VERSION,
      password: null,
      sessions: [],
    };
    await storage.put("auth", document);
  }
  if (document.version !== AUTH_VERSION || (document.password !== null && !document.password)) {
    throw new Error("Unsupported Control authentication state format");
  }
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
    if (!document.password) throw new Error("Control password has not been configured");
    if (isRateLimited(address)) throw new Error("Too many failed attempts. Try again in a minute.");
    const valid = typeof password === "string" && password.length <= 512 && await verifyPassword(password, document.password);
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
    document.sessions.push({ tokenHash: tokenDigest(token), csrfToken, createdAt, expiresAt });
    await persist();
    return { token, csrfToken, createdAt, expiresAt, maxAgeSeconds };
  }

  async function setupPassword(password, confirmation) {
    if (document.password) throw new Error("Control password is already configured");
    const nextPassword = passwordInput(password);
    if (nextPassword !== confirmation) throw new Error("Control passwords do not match");
    document.password = await hashPassword(nextPassword);
    return issueSession();
  }

  function findSession(token) {
    if (!token) return null;
    cleanSessions(document);
    const digest = tokenDigest(token);
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
    const digest = tokenDigest(token);
    document.sessions = document.sessions.filter((current) => current.tokenHash !== digest);
    await persist();
  }

  return {
    isConfigured() {
      return Boolean(document.password);
    },
    login,
    setupPassword,
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
