import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env";

let transporter: Transporter | null = null;

/// False when SMTP_USER / SMTP_PASS are not set: recovery email is simply off.
export function mailConfigured(): boolean {
  return Boolean(env.mail.user && env.mail.pass);
}

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.mail.host,
    port: env.mail.port,
    secure: env.mail.port === 465, // 465 = TLS from the start, 587 = STARTTLS
    auth: { user: env.mail.user, pass: env.mail.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

/// The ONLY place mail leaves the app. Moving from Gmail to Resend/Brevo/any SMTP means editing this file.
export async function sendMail(opts: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  if (!mailConfigured()) throw new Error("Mail is not configured");
  await getTransporter().sendMail({ from: env.mail.from, ...opts });
}
