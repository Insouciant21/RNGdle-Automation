import nodemailer from "nodemailer";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function transport(config) {
  const auth =
    config.smtp.authMode === "oauth2"
      ? {
          type: "OAuth2",
          user: config.smtp.username,
          clientId: config.smtp.oauth.clientId,
          clientSecret: config.smtp.oauth.clientSecret,
          refreshToken: config.smtp.oauth.refreshToken,
          accessUrl: `https://login.microsoftonline.com/${encodeURIComponent(config.smtp.oauth.tenantId)}/oauth2/v2.0/token`,
        }
      : {
          user: config.smtp.username,
          pass: config.smtp.password,
        };
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    requireTLS: config.smtp.requireTls,
    auth,
  });
}

function emailShell({ preheader, headerMeta, content }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>RNGdle</title></head>
<body style="margin:0;padding:0;background:#fafafa;color:#111827;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fafafa;">
    <tr><td align="center" style="padding:0 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
        <tr><td style="padding:18px 0 14px;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="font-size:18px;line-height:24px;font-weight:800;color:#111827;">RNGdle</td>
            <td align="right" style="font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;line-height:16px;font-weight:700;text-transform:uppercase;color:#9ca3af;">${escapeHtml(headerMeta)}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:42px 0 48px;">${content}</td></tr>
        <tr><td align="center" style="padding:18px 0 28px;border-top:1px solid #e5e7eb;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:10px;line-height:16px;color:#9ca3af;">AUTOMATED DAILY ROLL</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function badgeEmailRows(badges) {
  if (badges.length === 0) {
    return `<tr><td style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;color:#9ca3af;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;text-align:center;">NO BADGES EARNED</td></tr>`;
  }
  return badges
    .map((badge) => {
      const score = Number(badge.score).toLocaleString("en-US");
      return `<tr><td style="padding:0 0 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;">
          <tr>
            <td style="width:34px;padding:13px 0 13px 14px;font-size:18px;line-height:22px;vertical-align:middle;">${escapeHtml(badge.emoji)}</td>
            <td style="padding:13px 8px;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;line-height:18px;font-weight:700;text-transform:uppercase;color:#111827;vertical-align:middle;">${escapeHtml(badge.label)}</td>
            <td align="right" style="padding:13px 14px 13px 8px;vertical-align:middle;"><span style="display:inline-block;padding:3px 8px;border:1px solid #fbbf24;border-radius:999px;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;line-height:14px;font-weight:700;color:#c2410c;white-space:nowrap;">+${escapeHtml(score)} EP</span></td>
          </tr>
        </table>
      </td></tr>`;
    })
    .join("");
}

export function buildRollMessage(config, date, result) {
  const badgeLines = result.badges.map(
    (badge) => `${badge.emoji ? `${badge.emoji} ` : ""}${badge.label} (+${badge.score} EP)`,
  );
  const badgeRows = badgeEmailRows(result.badges);
  const badgeCountLabel = `${result.badges.length} BADGE${result.badges.length === 1 ? "" : "S"} EARNED`;
  const earned = Number(result.earnedEp).toLocaleString("en-US");
  const total = result.totalEp === null ? "Unavailable" : result.totalEp.toLocaleString("en-US");
  const safeBaseUrl = escapeHtml(config.rngdle.baseUrl);
  const content = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td align="center">
        <div style="display:inline-block;min-width:210px;padding:17px 22px;border:3px solid #9ca3af;border-radius:11px;background:#ffffff;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:44px;line-height:52px;font-weight:700;color:#374151;text-align:center;">${escapeHtml(result.number)}</div>
        <div style="padding:16px 0 0;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;line-height:16px;font-weight:700;color:#9ca3af;text-transform:uppercase;">TODAY'S ROLL</div>
      </td></tr>
      <tr><td align="center" style="padding:14px 0 0;"><span style="display:inline-block;padding:6px 13px;border:1px solid #d1d5db;border-radius:999px;background:#f3f4f6;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:14px;line-height:18px;font-weight:700;color:#4b5563;">${escapeHtml(earned)} EP</span></td></tr>
      <tr><td align="center" style="padding:10px 0 0;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:16px;line-height:20px;font-weight:700;color:#4b5563;">${escapeHtml(total)} EP</td></tr>
      <tr><td align="center" style="padding:2px 0 34px;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:10px;line-height:15px;color:#9ca3af;text-transform:uppercase;">YOUR LIFETIME EP</td></tr>
      <tr><td align="center" style="padding:0 0 12px;font-size:18px;line-height:24px;font-weight:800;color:#111827;text-transform:uppercase;">Badge breakdown</td></tr>
      <tr><td align="center" style="padding:0 0 12px;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;line-height:16px;color:#4b5563;text-transform:uppercase;">${badgeCountLabel}</td></tr>
      <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${badgeRows}</table></td></tr>
      <tr><td align="center" style="padding:22px 0 0;"><a href="${safeBaseUrl}" style="display:inline-block;padding:10px 18px;border:2px solid #111827;border-radius:6px;color:#111827;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:16px;font-weight:700;text-decoration:none;text-transform:uppercase;">OPEN RNGdle</a></td></tr>
    </table>`;

  return {
    from: config.smtp.from,
    to: config.smtp.to,
    subject: `${config.mail.subjectPrefix} ${date}: ${result.number} (+${result.earnedEp} EP)`,
    text: [
      `RNGdle result for ${date}`,
      "",
      `Number: ${result.number}`,
      `Earned EP: ${result.earnedEp}`,
      `Total EP: ${total}`,
      "Badges:",
      ...(badgeLines.length ? badgeLines.map((line) => `- ${line}`) : ["- No badges"]),
      "",
      config.rngdle.baseUrl,
    ].join("\n"),
    html: emailShell({
      preheader: `${result.number} - ${earned} EP - ${result.badges.length} badges`,
      headerMeta: date,
      content,
    }),
  };
}

export function buildAuthenticationRequiredMessage(config) {
  const safeControlUrl = escapeHtml(config.control.publicUrl);
  const content = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td align="center"><div style="display:inline-block;min-width:210px;padding:19px 22px;border:3px solid #dc2626;border-radius:11px;background:#ffffff;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:25px;line-height:32px;font-weight:700;color:#111827;text-align:center;text-transform:uppercase;">LOGIN REQUIRED</div></td></tr>
      <tr><td align="center" style="padding:17px 0 4px;font-size:18px;line-height:24px;font-weight:800;text-transform:uppercase;color:#111827;">Authentication</td></tr>
      <tr><td align="center" style="padding:0 18px;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:19px;color:#4b5563;">THE SAVED RNGdle SESSION HAS EXPIRED</td></tr>
      <tr><td align="center" style="padding:26px 0 0;"><a href="${safeControlUrl}" style="display:inline-block;padding:12px 20px;border:2px solid #111827;border-radius:6px;background:#111827;color:#ffffff;font-family:Menlo,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:16px;font-weight:700;text-decoration:none;text-transform:uppercase;">OPEN RNGdle CONTROL</a></td></tr>
      <tr><td align="center" style="padding:16px 22px 0;font-size:12px;line-height:19px;color:#9ca3af;">The pending daily run resumes automatically after authentication.</td></tr>
    </table>`;

  return {
    from: config.smtp.from,
    to: config.smtp.to,
    subject: `${config.mail.subjectPrefix} Login required`,
    text: `The saved RNGdle login has expired. Open ${config.control.publicUrl} and complete the email magic-link login. The pending daily run will continue automatically.`,
    html: emailShell({ preheader: "RNGdle authentication is required", headerMeta: "Control", content }),
  };
}

export async function sendRollEmail(config, date, result) {
  return transport(config).sendMail(buildRollMessage(config, date, result));
}

export async function sendAuthenticationRequiredEmail(config) {
  return transport(config).sendMail(buildAuthenticationRequiredMessage(config));
}
