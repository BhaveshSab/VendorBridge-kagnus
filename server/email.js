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

/**
 * Invoice delivery.
 *
 * Unlike password resets, an unconfigured mail provider must never look like a
 * successful send: the API reports `not_configured` and leaves the invoice
 * untouched. Two providers are supported:
 *   - `resend`      — RESEND_API_KEY is set (PDF attached)
 *   - `dev-outbox`  — explicit local opt-in via EMAIL_DEV_OUTBOX=true
 * Anything else returns `not_configured` so the UI can say so plainly.
 */
export function invoiceEmailProvider() {
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.EMAIL_DEV_OUTBOX === "true" && process.env.NODE_ENV !== "production") return "dev-outbox";
  return null;
}

export function invoiceEmailConfigured() {
  return invoiceEmailProvider() !== null;
}

function invoiceEmailBody({ invoice, vendorName }) {
  const money = (value) =>
    `${invoice.currency} ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const greeting = vendorName ? `Hello ${vendorName},` : "Hello,";
  const reference = invoice.purchaseOrder?.number ?? "-";
  const due = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("en-GB") : "on receipt";
  const text = `${greeting}

Please find attached invoice ${invoice.number} for purchase order ${reference}.

Amount due: ${money(invoice.total)}
Issue date: ${new Date(invoice.issueDate).toLocaleDateString("en-GB")}
Due date: ${due}

This is a system-generated pro forma document and does not replace a vendor-issued tax invoice.

VendorBridge Procurement`;
  const html = `
    <p>${greeting}</p>
    <p>Please find attached invoice <strong>${invoice.number}</strong> for purchase order <strong>${reference}</strong>.</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td>Amount due</td><td><strong>${money(invoice.total)}</strong></td></tr>
      <tr><td>Issue date</td><td>${new Date(invoice.issueDate).toLocaleDateString("en-GB")}</td></tr>
      <tr><td>Due date</td><td>${due}</td></tr>
    </table>
    <p style="color:#64748b;font-size:12px">This is a system-generated pro forma document and does not replace a vendor-issued tax invoice.</p>
    <p>VendorBridge Procurement</p>
  `.trim();
  return { text, html };
}

/**
 * Sends an invoice to the vendor's stored email address. Returns a
 * discriminated result instead of throwing so the caller can persist the exact
 * delivery state; it never contains credentials or provider payloads.
 */
export async function sendInvoiceEmail({ to, invoice, pdfBytes = null, vendorName = null }) {
  const provider = invoiceEmailProvider();
  if (!provider) {
    return { status: "not_configured", provider: null, error: null };
  }

  const subject = `Invoice ${invoice.number} from VendorBridge`;
  const { text, html } = invoiceEmailBody({ invoice, vendorName });

  try {
    if (provider === "resend") {
      const from = process.env.EMAIL_FROM || "VendorBridge <onboarding@resend.dev>";
      const payload = {
        from,
        to: [to],
        subject,
        text,
        html,
        ...(pdfBytes
          ? {
              attachments: [
                {
                  filename: `${invoice.number}.pdf`,
                  content: Buffer.from(pdfBytes).toString("base64"),
                },
              ],
            }
          : {}),
      };
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.text();
        return {
          status: "failed",
          provider,
          error: `Resend responded with ${response.status}: ${detail.slice(0, 160)}`,
        };
      }
      return { status: "sent", provider, error: null };
    }

    const entry = {
      to,
      subject,
      text,
      html,
      invoiceNumber: invoice.number,
      purchaseOrderNumber: invoice.purchaseOrder?.number ?? null,
      attachment: pdfBytes ? { filename: `${invoice.number}.pdf`, bytes: pdfBytes.length } : null,
      sentAt: new Date().toISOString(),
      provider,
    };
    await fs.appendFile(OUTBOX_PATH, `${JSON.stringify(entry)}\n`, "utf8");
    console.log(`[email:dev] Invoice ${invoice.number} for ${to} written to ${path.relative(projectRoot, OUTBOX_PATH)}`);
    return { status: "sent", provider, error: null };
  } catch (error) {
    return { status: "failed", provider, error: String(error?.message || error).slice(0, 240) };
  }
}
