export class AuthenticationRequiredError extends Error {
  constructor(message = "RNGdle authentication is required") {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

export function isRngdleUrl(candidate, baseUrl) {
  try {
    const url = new URL(candidate, baseUrl);
    const base = new URL(baseUrl);
    if (url.username || url.password) return false;
    if (url.origin === base.origin) return true;
    return url.protocol === "https:" && ["rngdle.com", "www.rngdle.com"].includes(base.hostname)
      && ["rngdle.com", "www.rngdle.com"].includes(url.hostname) && !url.port;
  } catch { return false; }
}

export async function createRngdleSession(config) {
  const storage = config.storage.adapter;
  const cookies = Object.create(null);
  try {
    const document = await storage.get("cookies") ?? { version: 1, cookies: {} };
    if (document.version !== 1 || !document.cookies || typeof document.cookies !== "object" || Array.isArray(document.cookies)) {
      throw new Error("Unsupported cookie format");
    }
    for (const [name, value] of Object.entries(document.cookies)) {
      if (typeof value !== "string" || /[;\r\n]/.test(name + value)) throw new Error("Invalid cookie entry");
      cookies[name] = value;
    }
  } catch {
    throw new Error("Unable to read RNGdle cookie storage");
  }
  // Serialize cookie writes when public assets are downloaded concurrently.
  let pendingWrite = Promise.resolve();
  function persist() {
    const document = { version: 1, cookies: { ...cookies } };
    pendingWrite = pendingWrite.then(() => storage.put("cookies", document));
    return pendingWrite;
  }
  async function request(candidate, options = {}) {
    const url = new URL(candidate, config.rngdle.baseUrl);
    if (!isRngdleUrl(url, config.rngdle.baseUrl)) throw new Error("RNGdle request tried to leave the trusted origin");
    const headers = new Headers(options.headers);
    if (Object.keys(cookies).length) headers.set("Cookie", Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; "));
    let response;
    try {
      response = await fetch(url, {
        ...options, headers, redirect: "manual",
        signal: options.signal ?? AbortSignal.timeout(config.http.timeoutMs),
      });
    } catch {
      throw new Error("RNGdle HTTP request failed or timed out");
    }
    let changed = false;
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const maxAge = attributes.find((attribute) => /^\s*max-age\s*=/i.test(attribute));
      const expires = attributes.find((attribute) => /^\s*expires\s*=/i.test(attribute));
      const deleted = !value || (maxAge
        ? Number(maxAge.slice(maxAge.indexOf("=") + 1)) <= 0
        : expires && Date.parse(expires.slice(expires.indexOf("=") + 1)) <= Date.now());
      if (deleted && Object.hasOwn(cookies, name)) { delete cookies[name]; changed = true; }
      else if (!deleted && cookies[name] !== value) { cookies[name] = value; changed = true; }
    }
    if (changed) await persist();
    return response;
  }
  return { request };
}

export async function responseText(response, maximum = 8 * 1024 * 1024) {
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > maximum) throw new Error("RNGdle response exceeded the expected size");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function callServerAction(session, actionId, args, expected) {
  const response = await session.request("/", {
    method: "POST",
    headers: {
      Accept: "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": actionId,
      "Next-Router-State-Tree": "",
    },
    body: JSON.stringify(args),
  });
  if (response.status === 401 || response.status === 403) throw new AuthenticationRequiredError();
  if (!response.ok) throw new Error(`RNGdle server action returned HTTP ${response.status}`);
  const source = await responseText(response);
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^[\da-f]+:(\{.*\})$/i);
    if (!match) continue;
    let value;
    try { value = JSON.parse(match[1]); } catch { continue; }
    if (value.error) throw new Error(`RNGdle rejected the action: ${String(value.error).slice(0, 200)}`);
    if (expected(value)) return value;
  }
  throw new Error("RNGdle server action returned an unrecognized result");
}
