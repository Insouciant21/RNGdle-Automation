function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Configuration field ${field} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value, field) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Configuration field ${field} must be a positive integer`);
  }
  return number;
}

function booleanValue(value, field) {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Configuration field ${field} must be true or false`);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

// Validates and defaults the configuration built from Worker variables.
export function normalizeConfig(raw) {
  const configuredRecipients = raw.smtp?.to;
  const recipients = Array.isArray(configuredRecipients)
    ? configuredRecipients
    : typeof configuredRecipients === "string"
      ? configuredRecipients.split(",")
      : [];
  if (recipients.length === 0) {
    throw new Error("Configuration field smtp.to must contain at least one recipient");
  }

  const controlPublicUrl = requiredString(raw.control?.publicUrl, "control.publicUrl").replace(
    /\/$/,
    "",
  );
  const smtpUsername = requiredString(raw.smtp?.username, "smtp.username");
  const smtpAuthMode = requiredString(raw.smtp?.authMode ?? "password", "smtp.authMode").toLowerCase();
  if (!new Set(["password", "oauth2"]).has(smtpAuthMode)) {
    throw new Error("Configuration field smtp.authMode must be password or oauth2");
  }
  const smtpPassword = optionalString(raw.smtp?.password);
  const oauthClientId = optionalString(raw.smtp?.oauth?.clientId);
  const oauthClientSecret = optionalString(raw.smtp?.oauth?.clientSecret);
  const oauthRefreshToken = optionalString(raw.smtp?.oauth?.refreshToken);
  const oauthAccessUrl = optionalString(raw.smtp?.oauth?.accessUrl);
  if (smtpAuthMode === "password" && !smtpPassword) {
    throw new Error("Configuration field smtp.password is required for password authentication");
  }
  if (smtpAuthMode === "oauth2" && (!oauthClientId || !oauthClientSecret || !oauthRefreshToken || !oauthAccessUrl)) {
    throw new Error("smtp.oauth.clientId, clientSecret, refreshToken, and accessUrl are required for OAuth2 authentication");
  }
  const config = {
    timezone: "UTC",
    schedule: {
      time: "00:00",
      retryMinutes: positiveInteger(raw.schedule?.retryMinutes ?? 30, "schedule.retryMinutes"),
      emailRetryMinutes: positiveInteger(raw.schedule?.emailRetryMinutes ?? 1, "schedule.emailRetryMinutes"),
    },
    rngdle: {
      baseUrl: "https://www.rngdle.com",
      email: requiredString(raw.rngdle?.email, "rngdle.email"),
    },
    http: {
      timeoutMs: 45_000,
    },
    control: {
      publicUrl: controlPublicUrl,
      sessionDays: positiveInteger(raw.control?.sessionDays ?? 7, "control.sessionDays"),
    },
    smtp: {
      host: requiredString(raw.smtp?.host, "smtp.host"),
      port: positiveInteger(raw.smtp?.port ?? 587, "smtp.port"),
      secure: booleanValue(raw.smtp?.secure ?? false, "smtp.secure"),
      requireTls: booleanValue(raw.smtp?.requireTls ?? true, "smtp.requireTls"),
      username: smtpUsername,
      authMode: smtpAuthMode,
      password: smtpPassword,
      oauth: {
        clientId: oauthClientId,
        clientSecret: oauthClientSecret,
        refreshToken: oauthRefreshToken,
        accessUrl: oauthAccessUrl,
      },
      from: optionalString(raw.smtp?.from) ?? smtpUsername,
      to: recipients.map((recipient, index) => requiredString(recipient, `smtp.to[${index}]`)),
    },
    mail: {
      fromName: "RNGdle Today",
      subjectPrefix: "[RNGdle]",
    },
    poem: {
      enabled: booleanValue(raw.poem?.enabled ?? false, "poem.enabled"),
      retryMinutes: positiveInteger(raw.poem?.retryMinutes ?? 5, "poem.retryMinutes"),
    },
    likes: {
      enabled: booleanValue(raw.likes?.enabled ?? false, "likes.enabled"),
      pollMinutes: positiveInteger(raw.likes?.pollMinutes ?? 60, "likes.pollMinutes"),
      maxPerDay: positiveInteger(raw.likes?.maxPerDay ?? 10, "likes.maxPerDay"),
      lookbackDays: positiveInteger(raw.likes?.lookbackDays ?? 7, "likes.lookbackDays"),
    },
    llm: {
      endpoint: requiredString(raw.llm?.endpoint ?? "https://api.deepseek.com", "llm.endpoint").replace(/\/$/, ""),
      apiKey: optionalString(raw.llm?.apiKey),
      model: requiredString(raw.llm?.model ?? "deepseek-flash", "llm.model"),
      timeoutMs: 60_000,
      maxTokens: positiveInteger(raw.llm?.maxTokens ?? 2_048, "llm.maxTokens"),
      maxAttempts: positiveInteger(raw.llm?.maxAttempts ?? 3, "llm.maxAttempts"),
      thinking: requiredString(raw.llm?.thinking ?? "disabled", "llm.thinking"),
    },
  };

  const llmUrl = new URL(config.llm.endpoint);
  if (!["http:", "https:"].includes(llmUrl.protocol) || llmUrl.username || llmUrl.password || llmUrl.search || llmUrl.hash) {
    throw new Error("llm.endpoint must be an HTTP(S) API base URL without credentials, query, or fragment");
  }
  if (!new Set(["enabled", "disabled"]).has(config.llm.thinking)) throw new Error("llm.thinking must be enabled or disabled");
  if (config.llm.maxAttempts > 5) throw new Error("llm.maxAttempts must be at most 5");
  if (config.poem.enabled && !config.llm.apiKey) throw new Error("LLM_API_KEY is required when POEM_ENABLED=true");

  try {
    new URL(config.control.publicUrl);
  } catch (error) {
    throw new Error(`Invalid URL in configuration: ${error.message}`);
  }

  return config;
}
