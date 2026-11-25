import { env } from "../config/env";

const appName = "Ala Eh Stocks";

// Email clients ignore stylesheets and theme variables, so everything is inline and table-based. The
// palette is the app's own: ink on warm white, brand gold for the one action. Light by design - a dark
// card inverts badly in clients that force their own dark mode.
const INK = "#1a1a1a";
const MUTED = "#6b6b66";
const LINE = "#e6e2d3";
const GOLD = "#f5c000";
const GOLD_EDGE = "#d4a000";
const PAGE = "#f4f1e8";
const FONT = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/// The shared frame: a gold top rule, the app name, a title, the body, and a quiet footer.
function layout(opts: { preheader: string; title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid ${LINE};border-radius:8px;overflow:hidden;">
    <tr><td style="height:5px;background:${GOLD};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:26px 28px 6px;font-family:${FONT};">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${appName}</div>
      <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${esc(opts.title)}</h1>
    </td></tr>
    <tr><td style="padding:12px 28px 28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">
      ${opts.body}
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid ${LINE};font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};">
      You received this because of a request on the ${appName} admin account. This is an automated message - please don't reply.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0 4px;"><tr>
    <td style="background:${GOLD};border:1px solid ${GOLD_EDGE};border-radius:6px;">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:15px;font-weight:700;color:${INK};text-decoration:none;">${esc(label)}</a>
    </td></tr></table>`;
}

function linkFallback(href: string): string {
  return `<p style="margin:14px 0 0;font-size:12.5px;color:${MUTED};">Button not working? Paste this into your browser:<br><a href="${esc(href)}" style="color:${MUTED};word-break:break-all;">${esc(href)}</a></p>`;
}

const MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
const ALERT = "#c1272d";

/// The one highlighted value in a mail (the code, an address): cream tile, gold bottom rule. `select`
/// makes a single click or tap select the whole value, the nearest thing to "copy" an email allows.
function tile(inner: string, opts: { mono?: boolean; select?: boolean } = {}): string {
  const font = opts.mono ? `font-family:${MONO};font-size:30px;font-weight:700;letter-spacing:0.16em;line-height:1.2;` : "font-size:17px;font-weight:700;line-height:1.4;word-break:break-all;";
  const sel = opts.select ? "-webkit-user-select:all;user-select:all;" : "";
  return `<div style="margin:0;padding:20px 12px;text-align:center;background:#faf8f1;border:1px solid ${LINE};border-bottom:3px solid ${GOLD};border-radius:6px;">
        <span style="display:inline-block;${font}color:${INK};${sel}">${inner}</span>
      </div>`;
}

/// The "if this wasn't you" call-out of a security notice.
function alertNote(html: string): string {
  return `<p style="margin:20px 0 0;padding:12px 14px;background:#fbf3f1;border-left:3px solid ${ALERT};border-radius:4px;font-size:14px;line-height:1.55;">${html}</p>`;
}

function quietNote(html: string): string {
  return `<p style="margin:20px 0 0;font-size:13px;color:${MUTED};">${html}</p>`;
}

const ignoreNote = (what: string) => quietNote(`<strong style="color:${INK};">Didn't ask for this?</strong> ${what}`);

/// Plain text goes alongside every HTML mail: some clients and filters show only that part.
/// An email cannot hold a real "copy" button (clients strip scripts and block clipboard access), so the
/// code is set to select in ONE click or tap with a hint to copy it.
export function resetCodeMail(username: string, code: string, minutes: number) {
  const link = `${env.clientOrigin}/#/forgot-password?username=${encodeURIComponent(username)}`;
  const body = `
      <p style="margin:0 0 16px;">Use this code to reset the password for <strong>${esc(username)}</strong>.</p>
      ${tile(esc(code), { mono: true, select: true })}
      <p style="margin:10px 0 0;text-align:center;font-size:13px;color:${MUTED};">Tap or click the code to select it, then copy.</p>
      <p style="margin:18px 0 0;font-size:14px;">Enter it on the <a href="${esc(link)}" style="color:${INK};font-weight:700;">password reset page</a>. It works once and expires in ${minutes} minutes.</p>
      ${ignoreNote("Ignore this email - your password has not changed.")}`;
  return {
    subject: `${appName}: your password reset code`,
    text:
      `Use this code to reset the password for "${username}".\n\n` +
      `Your one-time code: ${code}\n` +
      `It works once and expires in ${minutes} minutes.\n\n` +
      `Enter it here: ${link}\n\n` +
      `If this wasn't you, ignore this email - your password has not changed.`,
    html: layout({ preheader: `Your one-time code is ${code}. It expires in ${minutes} minutes.`, title: "Your reset code", body }),
  };
}

/// The one mail that needs a real link (the address is confirmed by opening it), so it keeps a button.
export function verifyEmailMail(token: string) {
  const link = `${env.clientOrigin}/#/verify-email?token=${encodeURIComponent(token)}`;
  const body = `
      <p style="margin:0;">Confirm this address as the recovery email for your admin account. Password reset codes will be sent here.</p>
      ${button(link, "Confirm recovery email")}
      <p style="margin:10px 0 0;font-size:13px;color:${MUTED};">The link works once and expires in 1 hour.</p>
      ${linkFallback(link)}
      ${ignoreNote("Ignore this email - nothing changes unless the link is opened.")}`;
  return {
    subject: `${appName}: confirm your recovery email`,
    text:
      `Confirm this address as the recovery email for your ${appName} admin account:\n\n${link}\n\n` +
      `The link works once and expires in 1 hour. If you didn't ask for this, ignore it.`,
    html: layout({ preheader: "Confirm this address to use it for password recovery.", title: "Confirm your recovery email", body }),
  };
}

export function passwordResetDoneMail(username: string, ip: string | null, when: Date) {
  const at = when.toUTCString();
  const body = `
      <p style="margin:0 0 16px;">The password for <strong>${esc(username)}</strong> was just reset with an emailed code.</p>
      ${tile(esc(at) + (ip ? `<br><span style="font-size:13px;font-weight:400;color:${MUTED};">from ${esc(ip)}</span>` : ""))}
      ${alertNote("<strong>If this wasn't you</strong>, someone has access to this mailbox. Sign in, change your password, and change the recovery email.")}`;
  return {
    subject: `${appName}: your password was reset`,
    text:
      `The password for "${username}" was just reset with an emailed code (${at}${ip ? `, from ${ip}` : ""}).\n` +
      `If this wasn't you, someone has access to this mailbox. Sign in, change your password, and change the recovery email.`,
    html: layout({ preheader: "Your admin password was just reset.", title: "Your password was reset", body }),
  };
}

/// Sent to the CURRENT recovery address the moment a change is requested, so a hijack can be noticed
/// before it completes. `maskedNew` is e.g. "j***@example.com" - never the full new address.
export function emailChangeRequestedMail(maskedNew: string) {
  const body = `
      <p style="margin:0 0 16px;">Someone asked to change the recovery email on your admin account to:</p>
      ${tile(esc(maskedNew))}
      <p style="margin:14px 0 0;font-size:14px;color:${MUTED};">Nothing changes until the link sent to that address is opened (within 1 hour).</p>
      ${alertNote("<strong>If this wasn't you</strong>, sign in and change your password now.")}`;
  return {
    subject: `${appName}: a recovery email change was requested`,
    text:
      `Someone asked to change the recovery email on your ${appName} admin account to ${maskedNew}.\n` +
      `Nothing changes until the link sent to that address is opened (within 1 hour). If this wasn't you, sign in and change your password now.`,
    html: layout({ preheader: "A recovery email change was requested.", title: "Recovery email change requested", body }),
  };
}

export function emailChangedMail(newEmail: string) {
  const body = `
      <p style="margin:0 0 16px;">The recovery email on your admin account was changed to:</p>
      ${tile(esc(newEmail))}
      ${alertNote("<strong>If this wasn't you</strong>, sign in and change your password now, then contact whoever runs the server.")}`;
  return {
    subject: `${appName}: your recovery email was changed`,
    text:
      `The recovery email on your ${appName} admin account was changed to ${newEmail}.\n` +
      `If this wasn't you, sign in and change your password now, then contact whoever runs the server.`,
    html: layout({ preheader: `Your recovery email is now ${newEmail}.`, title: "Your recovery email was changed", body }),
  };
}
