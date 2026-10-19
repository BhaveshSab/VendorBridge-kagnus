import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

const RESEND_API_URL = "https://api.resend.com/emails";
const OUTBOX_PATH = path.join(projectRoot, ".mail-outbox.jsonl");

function resetEmailBody({ name, resetUrl }) {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const text = `${greeting}

Use the link below to choose a new VendorBridge password:

${resetUrl}

The link expires in 30 minutes and can only be used once. If you didn't request a password reset, you can safely ignore this email.`;
  const html = `
    <p>${greeting}</p>
    <p>Use the button below to choose a new VendorBridge password.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>Or copy this link into your browser:<br />${resetUrl}</p>
    <p>The link expires in 30 minutes and can only be used once. If you didn't request a password reset, you can safely ignore this email.</p>
  `.trim();
  return { text, html };
}

/**
 * Dispatches a password-reset email through a transactional provider.
 *
 * - With `RESEND_API_KEY` set, the message is delivered through the Resend HTTP API.
 * - Without a provider configured (local development / smoke tests), the message
 *   is appended to a local mail outbox (`.mail-outbox.jsonl`) instead — the reset
 *   token never travels in an HTTP response body.
 */
export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const subject = "Reset your VendorBridge password";
  const { text, html } = resetEmailBody({ name, resetUrl });

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.EMAIL_FROM || "VendorBridge <onboarding@resend.dev>";
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      throw new Error(`Resend responded with ${response.status}: ${await response.text()}`);
    }
    return { provider: "resend" };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is required in production to deliver password reset emails.");
  }

  const entry = {
    to,
    name: name ?? null,
    subject,
    text,
    html,
    resetUrl,
    sentAt: new Date().toISOString(),
  };
  await fs.appendFile(OUTBOX_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  console.log(
    `[email:dev] No RESEND_API_KEY set — password reset link for ${to} written to ${path.relative(projectRoot, OUTBOX_PATH)}`,
  );
  return { provider: "dev-outbox" };
}
