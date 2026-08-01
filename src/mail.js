import nodemailer from "nodemailer";
import { badgeRarity, cardRarity, rarityLabel, rarityPalette } from "./rarity.js";

// Keep the sent message attractive on clients that do not load project fonts.
// Tabular numerals below preserve the alignment previously provided by a mono font.
const EMAIL_FONT = "'Inter','Segoe UI',system-ui,-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,Helvetica,sans-serif";

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
          ...(config.smtp.oauth.accessUrl ? { accessUrl: config.smtp.oauth.accessUrl } : {}),
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

function fromAddress(config) {
  return { name: config.mail.fromName ?? "RNGdle Today", address: config.smtp.from };
}

function emailShell({ preheader, headerMeta, content }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>RNGdle</title></head>
<body style="margin:0;padding:0;background:#fafafa;color:#111827;font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#fafafa;">
    <tr><td align="center" style="padding:0 16px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
        <tr><td style="padding:16px 0 13px;border-bottom:1px solid #e5e7eb;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
            <td style="font-family:${EMAIL_FONT};font-size:18px;line-height:24px;font-weight:800;letter-spacing:.04em;color:#111827;">RNGdle</td>
            <td align="right" style="font-family:${EMAIL_FONT};font-size:11px;line-height:16px;font-weight:700;font-variant-numeric:tabular-nums;text-transform:uppercase;color:#9ca3af;">${escapeHtml(headerMeta)}</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:36px 0 42px;">${content}</td></tr>
        <tr><td align="center" style="padding:17px 0 26px;border-top:1px solid #e5e7eb;font-family:${EMAIL_FONT};font-size:10px;line-height:16px;color:#9ca3af;letter-spacing:.04em;">AUTOMATED DAILY ROLL</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function badgeEmailRows(badges) {
  if (badges.length === 0) {
    return `<tr><td style="padding:16px;border:1px solid #e5e7eb;border-radius:8px;color:#9ca3af;font-family:${EMAIL_FONT};font-size:12px;text-align:center;">NO BADGES EARNED</td></tr>`;
  }
  return badges
    .map((badge) => {
      const score = Number(badge.score).toLocaleString("en-US");
      const rarity = badge.rarity && badge.rarity !== "unknown" ? badge.rarity : badgeRarity(badge.score);
      const palette = rarityPalette(rarity);
      const description = typeof badge.description === "string" ? badge.description : "";
      return `<tr><td style="padding:0 0 10px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border:1px solid #e5e7eb;border-left:4px solid ${palette.border};border-radius:8px;background:#ffffff;box-shadow:0 0 14px ${palette.accent}33;">
          <tr>
            <td style="width:32px;padding:12px 0 12px 13px;font-size:18px;line-height:22px;vertical-align:top;">${escapeHtml(badge.emoji)}</td>
            <td style="padding:11px 8px;vertical-align:middle;">
              <div style="font-family:${EMAIL_FONT};font-size:14px;line-height:20px;font-weight:600;color:#111827;">${escapeHtml(badge.label)}${badge.isNew ? ' <span style="color:#92400e;font-size:10px;font-weight:700;">NEW</span>' : ""} <span style="display:inline-block;margin-left:4px;padding:3px 6px;border:1px solid ${palette.border};border-radius:4px;font-family:${EMAIL_FONT};font-size:10px;line-height:12px;font-weight:700;letter-spacing:.04em;color:${palette.text};text-transform:uppercase;vertical-align:2px;">${escapeHtml(rarityLabel(rarity))}</span></div>
              ${description ? `<div style="padding-top:3px;font-family:${EMAIL_FONT};font-size:12px;line-height:17px;color:#6b7280;">${escapeHtml(description)}</div>` : ""}
            </td>
            <td align="right" style="padding:11px 13px 11px 8px;vertical-align:middle;"><span style="display:inline-block;padding:4px 8px;border:1px solid #fbbf24;border-radius:999px;background:#fffbeb;font-family:${EMAIL_FONT};font-size:11px;line-height:14px;font-weight:600;color:#b45309;font-variant-numeric:tabular-nums;white-space:nowrap;">+${escapeHtml(score)} EP</span></td>
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
  const rollRarity = result.rarity && result.rarity !== "unknown" ? result.rarity : cardRarity(result.earnedEp);
  const rollPalette = rarityPalette(rollRarity);
  const safeBaseUrl = escapeHtml(config.rngdle.baseUrl);
  const content = `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr><td align="center">
        <div style="display:inline-block;min-width:210px;padding:17px 22px;border:3px solid ${rollPalette.border};border-radius:11px;background-color:${rollPalette.bg};background:${rollPalette.gradient};box-shadow:0 0 14px ${rollPalette.accent}55;font-family:${EMAIL_FONT};font-size:44px;line-height:52px;font-weight:800;color:${rollPalette.text};font-variant-numeric:tabular-nums;text-align:center;">${escapeHtml(result.number)}</div>
        <div style="padding:12px 0 0;"><span style="display:inline-block;padding:4px 9px;border:1px solid ${rollPalette.border};border-radius:4px;background:${rollPalette.bg};font-family:${EMAIL_FONT};font-size:10px;line-height:13px;font-weight:700;letter-spacing:.04em;color:${rollPalette.text};text-transform:uppercase;">${escapeHtml(rarityLabel(rollRarity))}</span></div>
        <div style="padding:14px 0 0;font-family:${EMAIL_FONT};font-size:11px;line-height:16px;font-weight:700;color:#9ca3af;letter-spacing:.04em;text-transform:uppercase;">TODAY'S ROLL</div>
      </td></tr>
      <tr><td align="center" style="padding:14px 0 0;"><span style="display:inline-block;padding:6px 13px;border:1px solid ${rollPalette.border};border-radius:999px;background:${rollPalette.bg};font-family:${EMAIL_FONT};font-size:14px;line-height:18px;font-weight:600;color:${rollPalette.text};font-variant-numeric:tabular-nums;">${escapeHtml(earned)} EP</span></td></tr>
      <tr><td align="center" style="padding:10px 0 0;font-family:${EMAIL_FONT};font-size:16px;line-height:20px;font-weight:600;color:#4b5563;font-variant-numeric:tabular-nums;">${escapeHtml(total)} EP</td></tr>
      <tr><td align="center" style="padding:2px 0 32px;font-family:${EMAIL_FONT};font-size:10px;line-height:15px;color:#9ca3af;letter-spacing:.04em;text-transform:uppercase;">YOUR LIFETIME EP</td></tr>
      <tr><td align="center" style="padding:0 0 10px;font-family:${EMAIL_FONT};font-size:18px;line-height:24px;font-weight:700;color:#111827;">Badge Breakdown</td></tr>
      <tr><td align="center" style="padding:0 0 12px;font-family:${EMAIL_FONT};font-size:11px;line-height:16px;color:#4b5563;letter-spacing:.04em;text-transform:uppercase;">${badgeCountLabel}</td></tr>
      <tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${badgeRows}</table></td></tr>
      <tr><td align="center" style="padding:22px 0 0;"><a href="${safeBaseUrl}" style="display:inline-block;padding:10px 18px;border:2px solid #111827;border-radius:6px;color:#111827;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.06em;text-decoration:none;text-transform:uppercase;">OPEN RNGdle</a></td></tr>
    </table>`;

  return {
    from: fromAddress(config),
    to: config.smtp.to,
    subject: `${config.mail.subjectPrefix} ${date}: ${result.number} (+${result.earnedEp} EP)`,
    text: [
      `RNGdle result for ${date}`,
      "",
      `Number: ${result.number}`,
      `Earned EP: ${result.earnedEp}`,
      `Total EP: ${total}`,
      "Badges:",
      ...(badgeLines.length
        ? badgeLines.map((line, index) => {
            const badge = result.badges[index];
            const rarity = badge.rarity && badge.rarity !== "unknown" ? badge.rarity : badgeRarity(badge.score);
            return `- ${line} [${rarityLabel(rarity)}]`;
          })
        : ["- No badges"]),
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
      <tr><td align="center"><div style="display:inline-block;min-width:210px;padding:19px 22px;border:3px solid #dc2626;border-radius:11px;background:#fff1f2;font-family:${EMAIL_FONT};font-size:25px;line-height:32px;font-weight:800;color:#991b1b;text-align:center;text-transform:uppercase;">LOGIN REQUIRED</div></td></tr>
      <tr><td align="center" style="padding:17px 0 4px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#111827;">Authentication</td></tr>
      <tr><td align="center" style="padding:0 18px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#4b5563;letter-spacing:.02em;">THE SAVED RNGdle SESSION HAS EXPIRED</td></tr>
      <tr><td align="center" style="padding:26px 0 0;"><a href="${safeControlUrl}" style="display:inline-block;padding:12px 20px;border:2px solid #111827;border-radius:6px;background:#111827;color:#ffffff;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;line-height:16px;font-weight:700;letter-spacing:.06em;text-decoration:none;text-transform:uppercase;">OPEN RNGdle CONTROL</a></td></tr>
      <tr><td align="center" style="padding:16px 22px 0;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#9ca3af;">The pending daily run resumes automatically after authentication.</td></tr>
    </table>`;

  return {
    from: fromAddress(config),
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
