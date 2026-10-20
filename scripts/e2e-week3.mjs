/**
 * Week 3 end-to-end verification - approval, purchase order and invoice flow.
 *
 * Runs a real browser (Brave/Chrome via puppeteer-core) against the running app
 * and checks the API, PDF bytes, email delivery and database directly.
 *
 * Safety:
 *  - Refuses to run unless DATABASE_URL points at a loopback, disposable
 *    database whose name contains "e2e".
 *  - Creates RFQs whose titles start with "E2E Test W3" and deletes only the
 *    records created by this run (invoices -> POs -> approvals -> quotations ->
 *    RFQ).
 *  - Never prints credentials, cookies or tokens.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:password@127.0.0.1:55432/vendorbridge_e2e \
 *   APP_URL=http://localhost:4100 node scripts/e2e-week3.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.APP_URL || "http://localhost:4100";
const BROWSER_PATH =
  process.env.CHROME_PATH || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
const OUT = path.resolve("docs/verification/week3");
const OUTBOX = path.resolve(".mail-outbox.jsonl");
const PREFIX = "E2E Test W3";
const stamp = `${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Safety guard and reporting
// ---------------------------------------------------------------------------
const dbUrl = process.env.DATABASE_URL || "";
let parsedDb = null;
try {
  parsedDb = new URL(dbUrl);
} catch {
  parsedDb = null;
}
const isLoopback = parsedDb && ["127.0.0.1", "localhost", "::1"].includes(parsedDb.hostname);
const isDisposable = parsedDb && /e2e/i.test(parsedDb.pathname);
if (!isLoopback || !isDisposable) {
  console.error("Refusing to run: DATABASE_URL must point at a loopback database whose name contains 'e2e'.");
  process.exit(2);
}

const prisma = new PrismaClient();
const results = [];
const createdRfqIds = [];
const screenshots = [];

function check(name, passed, detail = "") {
  const status = passed ? "PASS" : "FAIL";
  results.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? ` - ${detail}` : ""}`);
  return Boolean(passed);
}

function section(title) {
  console.log(`\n== ${title}`);
}

// ---------------------------------------------------------------------------
// HTTP clients
// ---------------------------------------------------------------------------
function httpClient() {
  let cookie = "";
  return async function call(method, route, body, extraHeaders = {}) {
    const response = await fetch(`${BASE}/api${route}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    const session = setCookies.find((value) => value.startsWith("vb_token="));
    if (session) cookie = session.split(";")[0];
    // Read bytes once: PDFs are binary and must not go through a UTF-8 decode.
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString("utf8");
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, body: json, text, bytes: buffer, headers: response.headers };
  };
}

async function signIn(account) {
  const call = httpClient();
  const response = await call("POST", "/auth/login", account);
  if (response.status !== 200) throw new Error(`API login failed for ${account.email}: ${response.status}`);
  return call;
}

const accounts = {
  admin: { email: "admin@vendorbridge.dev", password: "Admin@123" },
  procurement: { email: "procurement@vendorbridge.dev", password: "Procure@123" },
  manager: { email: "manager@vendorbridge.dev", password: "Manager@123" },
  nova: { email: "vendor@vendorbridge.dev", password: "Vendor@123" },
  zenith: { email: "zenith@vendorbridge.dev", password: "Vendor@123" },
  apex: { email: "apex@vendorbridge.dev", password: "Vendor@123" },
};

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
async function settle(page, ms = 450) {
  await page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearSession(page) {
  const cookies = await page.cookies();
  for (const cookie of cookies) {
    await page.deleteCookie({ name: cookie.name, domain: cookie.domain, path: cookie.path });
  }
}

async function loginViaUi(page, account) {
  // Each role gets a clean cookie jar so the login form is actually shown.
  await clearSession(page);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("#email");
  await page.type("#email", account.email);
  await page.type("#password", account.password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname !== "/login", { timeout: 25000 });
  await settle(page);
}

async function waitForText(page, text, timeout = 15000) {
  try {
    await page.waitForFunction((needle) => (document.body.textContent ?? "").includes(needle), { timeout }, text);
  } catch (error) {
    const snippet = await page
      .evaluate(() => (document.body.textContent ?? ""))
      .catch(() => "");
    throw new Error(
      `Timed out waiting for "${text}" at ${page.url()}. Page text: ${snippet.replace(/\s+/g, " ").slice(0, 400)}`,
    );
  }
}

/** Re-reads one approval until `predicate` holds (bounded), for commit visibility. */
async function waitForApproval(id, predicate, timeout = 5000) {
  const started = Date.now();
  let row = null;
  while (Date.now() - started < timeout) {
    row = await prisma.approvalRequest.findUnique({
      where: { id },
      include: { events: { orderBy: { id: "asc" } } },
    });
    if (row && predicate(row)) return row;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return row;
}

async function clickByText(page, selector, text, { scope = "body", index = 0 } = {}) {
  const clicked = await page.evaluate(
    ({ selector, text, scope, index }) => {
      const root = scope === "body" ? document.body : document.querySelector(scope);
      if (!root) return false;
      const nodes = [...root.querySelectorAll(selector)].filter(
        (node) => node.textContent.trim().includes(text) && !node.disabled,
      );
      const node = nodes[index];
      if (!node) return false;
      node.click();
      return true;
    },
    { selector, text, scope, index },
  );
  if (!clicked) throw new Error(`Could not click ${selector} containing "${text}"`);
}

async function clickRowButton(page, rowText, buttonText) {
  const clicked = await page.evaluate(
    ({ rowText, buttonText }) => {
      const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(rowText));
      if (!row) return false;
      const button = [...row.querySelectorAll("button")].find((b) => b.textContent.trim().includes(buttonText));
      if (!button) return false;
      button.click();
      return true;
    },
    { rowText, buttonText },
  );
  if (!clicked) throw new Error(`No "${buttonText}" button in the row for "${rowText}"`);
}

async function capture(page, file) {
  await settle(page, 700);
  const target = path.join(OUT, file);
  await page.screenshot({ path: target, fullPage: false });
  screenshots.push(file);
  console.log(`  screenshot ${path.relative(process.cwd(), target)}`);
}

/**
 * Inflates every FlateDecode stream and decodes the `<hex> Tj` text runs that
 * pdf-lib writes for standard fonts, so the PDF's visible content can be
 * asserted without a full PDF parser.
 */
function pdfText(buffer) {
  const body = buffer.toString("latin1");
  const chunks = [];
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = pattern.exec(body))) {
    const raw = Buffer.from(match[1], "latin1");
    try {
      chunks.push(zlib.inflateSync(raw).toString("latin1"));
    } catch {
      chunks.push(match[1]);
    }
  }
  return chunks
    .join("\n")
    .replace(/<([0-9A-Fa-f\s]+)>\s*Tj/g, (_match, hex) =>
      Buffer.from(hex.replace(/\s+/g, ""), "hex").toString("latin1"),
    );
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
async function createRfq(procurement, { title, vendorIds, items }) {
  const created = await procurement("POST", "/rfqs", {
    title: `${PREFIX} ${title} ${stamp}`,
    description: "Week 3 verification record. Safe to remove.",
    currency: "INR",
    deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    vendorIds,
    items,
  });
  if (created.status !== 201) {
    throw new Error(`Could not create RFQ (${created.status}): ${JSON.stringify(created.body)}`);
  }
  createdRfqIds.push(created.body.rfq.id);
  const published = await procurement("POST", `/rfqs/${created.body.rfq.id}/publish`);
  if (published.status !== 200) throw new Error(`Could not publish RFQ: ${published.status}`);
  return published.body.rfq;
}

async function submitQuotation(client, rfq, prices, extra = {}) {
  const response = await client("PUT", `/rfqs/${rfq.id}/quotation`, {
    deliveryDays: 10,
    deliveryTerms: "Delivered to site",
    notes: "Verification quotation.",
    taxPercent: 18,
    shippingAmount: 500,
    items: rfq.items.map((item, index) => ({ rfqItemId: item.id, unitPrice: prices[index] })),
    ...extra,
  });
  if (response.status !== 201) {
    throw new Error(`Could not submit quotation (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body.quotation;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let browser = null;

async function main() {
  console.log(`VendorBridge Week 3 verification against ${BASE}`);
  await mkdir(OUT, { recursive: true });

  const procurement = await signIn(accounts.procurement);
  const manager = await signIn(accounts.manager);
  const admin = await signIn(accounts.admin);
  const nova = await signIn(accounts.nova);
  const zenith = await signIn(accounts.zenith);
  const apex = await signIn(accounts.apex);
  const anon = httpClient();

  section("0. Environment");
  const health = await anon("GET", "/health");
  check("API and database report ready", health.status === 200 && health.body?.database === "connected");
  check("Database under test is a disposable loopback database", Boolean(isLoopback && isDisposable), parsedDb?.pathname);

  const register = await procurement("GET", "/vendors?pageSize=100");
  const vendorByName = (name) => register.body.items.find((vendor) => vendor.name === name);
  const novaVendor = vendorByName("Nova Office Supplies");
  const zenithVendor = vendorByName("Zenith IT Solutions");
  const apexVendor = vendorByName("Apex Hardware");
  check("Seeded test vendors are present", Boolean(novaVendor && zenithVendor && apexVendor));

  const items = [
    { description: "Ergonomic mesh office chair", quantity: 20, unit: "unit", specifications: "Adjustable lumbar support" },
    { description: "Height-adjustable standing desk", quantity: 10, unit: "unit", specifications: "120 x 70 cm" },
    { description: "Monitor arm", quantity: 10, unit: "unit", specifications: "Single 32-inch display" },
  ];

  const rfqA = await createRfq(procurement, {
    title: "Approval to invoice",
    vendorIds: [novaVendor.id, zenithVendor.id],
    items,
  });
  const novaQuoteA = await submitQuotation(nova, rfqA, [4200, 18500, 3200]);
  const zenithQuoteA = await submitQuotation(zenith, rfqA, [3980, 17900, 3450]);

  // ---------------------------------------------------------------- browser
  browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 980 });
  page.on("pageerror", (error) => console.error(`  page error: ${error.message}`));

  section("1. Procurement requests approval in the browser");
  await loginViaUi(page, accounts.procurement);
  await page.goto(`${BASE}/rfqs/${rfqA.id}/quotations`, { waitUntil: "networkidle0" });
  await waitForText(page, "Quotation register");
  await waitForText(page, zenithVendor.name);
  await clickRowButton(page, zenithVendor.name, "Request");
  await waitForText(page, "Request approval for this quotation?");
  const requestNote = `Lowest comparable total (${stamp})`;
  await page.type("#approval-request-remarks", requestNote);
  await clickByText(page, '[role="dialog"] button', "Send for approval");
  await page.waitForFunction(() => /\/approvals\/\d+/.test(location.pathname), { timeout: 20000 });
  await waitForText(page, "Pending");
  await waitForText(page, requestNote);
  check("UI request lands on the approval detail page", /\/approvals\/\d+/.test(page.url()), page.url());
  const approvalId = Number(page.url().split("/").pop());

  const approvalRow = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { events: true, quotation: true },
  });
  check("Approval is stored as pending for the selected quotation", approvalRow?.status === "pending");
  check("Approval references the correct quotation and revision", approvalRow?.quotationId === zenithQuoteA.id && approvalRow?.quotationRevision === zenithQuoteA.revision);
  check(
    "Snapshot captures the reviewed total",
    approvalRow?.snapshot?.total === Number(zenithQuoteA.total).toFixed(2),
    `${approvalRow?.snapshot?.total} vs ${zenithQuoteA.total}`,
  );
  check("Request event persisted with the requester", approvalRow?.events.length === 1 && approvalRow.events[0].type === "requested");

  await page.reload({ waitUntil: "networkidle0" });
  await waitForText(page, requestNote);
  check("Pending approval and remarks persist after reload", await page.evaluate((note) => (document.body.textContent ?? "").includes(note), requestNote));
  await capture(page, "01-approval-requested.png");

  section("2. Manager reviews and approves");
  await loginViaUi(page, accounts.manager);
  await page.goto(`${BASE}/approvals`, { waitUntil: "networkidle0" });
  await waitForText(page, "Awaiting decision");
  await waitForText(page, "Zenith IT Solutions");
  await page.goto(`${BASE}/approvals/${approvalId}`, { waitUntil: "networkidle0" });
  await waitForText(page, "Reviewed quotation");
  check("Manager sees the requested quotation and its lines", await page.evaluate(() => (document.body.textContent ?? "").includes("Ergonomic mesh office chair")));
  check("Manager sees the requester note", await page.evaluate((note) => (document.body.textContent ?? "").includes(note), requestNote));

  const managerNote = `Approved for Q3 delivery (${stamp})`;
  await clickByText(page, "button", "Approve quotation");
  await waitForText(page, "Approve this quotation?");
  await page.type("#decision-remarks", managerNote);
  await clickByText(page, '[role="dialog"] button', "Confirm approval");
  // The dialog only closes after the POST succeeds, so this waits for the
  // committed decision instead of a label that exists before the request.
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 20000 });
  await waitForText(page, managerNote);
  const decidedBody = await page.evaluate(() => document.body.textContent ?? "");
  check("Decision UI shows the approved state", decidedBody.includes("Approved"));
  check("Decision UI shows the approver identity in the timeline", decidedBody.includes("Approved · Priya Nair"));

  const approvedRow = await waitForApproval(approvalId, (row) => row.status === "approved");
  check("Decision persisted with approver, time and remarks", approvedRow?.status === "approved" && Boolean(approvedRow?.approverId) && Boolean(approvedRow?.decidedAt) && approvedRow?.decisionRemarks === managerNote);
  check("Approval timeline has requested + approved events", approvedRow?.events.map((event) => event.type).join(",") === "requested,approved");

  await page.reload({ waitUntil: "networkidle0" });
  await waitForText(page, managerNote);
  check("Approved state and history persist after reload", true);
  await capture(page, "02-approval-approved.png");

  section("3. Purchase order generation");
  await loginViaUi(page, accounts.procurement);
  await page.goto(`${BASE}/approvals/${approvalId}`, { waitUntil: "networkidle0" });
  await clickByText(page, "button", "Generate purchase order");
  await waitForText(page, "Generate purchase order?");
  await clickByText(page, '[role="dialog"] button', "Generate purchase order");
  await page.waitForFunction(() => /\/purchase-orders\/\d+/.test(location.pathname), { timeout: 25000 });
  await settle(page);
  const poId = Number(page.url().split("/").pop());
  const poRow = await prisma.purchaseOrder.findUnique({ where: { id: poId }, include: { items: true } });
  if (!poRow) throw new Error("The purchase order was not persisted after generation.");
  check("Purchase order page loaded after approval", /\/purchase-orders\/\d+/.test(page.url()), page.url());
  check("Purchase order has a unique human-readable number", /^PO-\d{4,}$/.test(poRow?.number ?? ""), poRow?.number);
  check("Purchase order links to the approved quotation and RFQ", poRow?.quotationId === zenithQuoteA.id && poRow?.rfqId === rfqA.id && poRow?.approvalRequestId === approvalId);
  check("Purchase order vendor matches the quotation", poRow?.vendorId === zenithVendor.id);
  check("Purchase order line count matches the quotation", poRow?.items.length === rfqA.items.length);
  check(
    "Purchase order total matches the approved quotation",
    poRow?.total.toFixed(2) === Number(zenithQuoteA.total).toFixed(2),
    `${poRow?.total} vs ${zenithQuoteA.total}`,
  );
  check("Purchase order subtotal/tax/shipping match the quotation", poRow?.subtotal.toFixed(2) === Number(zenithQuoteA.subtotal).toFixed(2) && poRow?.taxAmount.toFixed(2) === Number(zenithQuoteA.taxAmount).toFixed(2) && poRow?.shippingAmount.toFixed(2) === Number(zenithQuoteA.shippingAmount).toFixed(2));
  check("UI shows the purchase order number", await page.evaluate((number) => (document.body.textContent ?? "").includes(number), poRow.number));
  check("UI shows 'No invoice generated yet'", await page.evaluate(() => (document.body.textContent ?? "").includes("No invoice generated yet")));
  await page.reload({ waitUntil: "networkidle0" });
  check("Purchase order persists after reload", await page.evaluate((number) => (document.body.textContent ?? "").includes(number), poRow.number));
  await capture(page, "03-purchase-order.png");

  section("4. Invoice generation, PDF and print");
  await clickByText(page, "button", "Generate invoice");
  await waitForText(page, "Generate an invoice for");
  await clickByText(page, '[role="dialog"] button', "Generate invoice");
  await waitForText(page, "Open invoice", 25000);
  const invoiceRow = await prisma.invoice.findFirst({ where: { purchaseOrderId: poId }, include: { items: true } });
  if (!invoiceRow) throw new Error("The invoice was not persisted after generation.");
  check("Invoice generated from the purchase order", Boolean(invoiceRow));
  check("Invoice number is unique-formatted", /^INV-\d{4,}$/.test(invoiceRow?.number ?? ""), invoiceRow?.number);
  check("Invoice links to the same PO, RFQ and vendor", invoiceRow?.purchaseOrderId === poId && invoiceRow?.rfqId === rfqA.id && invoiceRow?.vendorId === zenithVendor.id);
  check("Invoice carries the PO totals without re-taxing", invoiceRow?.total.toFixed(2) === poRow.total.toFixed(2) && invoiceRow?.taxAmount.toFixed(2) === poRow.taxAmount.toFixed(2));
  check(
    "Invoice subtotal + tax + delivery equals its total",
    Number(invoiceRow.subtotal) + Number(invoiceRow.taxAmount) + Number(invoiceRow.shippingAmount) === Number(invoiceRow.total),
  );
  const taxPercent = Number(invoiceRow.taxPercent);
  const expectedTax = Math.round(Number(invoiceRow.subtotal) * taxPercent) / 100;
  check("Tax is single-applied at the approved percentage", Math.abs(expectedTax - Number(invoiceRow.taxAmount)) < 0.011);

  await page.reload({ waitUntil: "networkidle0" });
  await waitForText(page, "Open invoice");
  await clickByText(page, "a", "Open invoice");
  await page.waitForFunction(() => /\/invoices\/\d+/.test(location.pathname), { timeout: 20000 });
  await waitForText(page, "Pro forma invoice");
  check("Invoice screen shows the persisted number", await page.evaluate((number) => (document.body.textContent ?? "").includes(number), invoiceRow.number));
  check("Invoice screen shows the total due", await page.evaluate(() => (document.body.textContent ?? "").includes("Total due")));
  await capture(page, "04-invoice.png");

  const pdf = await procurement("GET", `/invoices/${invoiceRow.id}/pdf`);
  check("PDF response is application/pdf", pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf", pdf.headers.get("content-type"));
  check("PDF filename is derived from the invoice number", (pdf.headers.get("content-disposition") || "").includes(`${invoiceRow.number}.pdf`));
  const pdfBytes = pdf.bytes;
  check("PDF starts with the %PDF signature", pdfBytes.subarray(0, 5).toString() === "%PDF-", pdfBytes.subarray(0, 5).toString());
  const pdfContent = pdfText(pdfBytes);
  const totalText = Number(invoiceRow.total).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  check("PDF contains the invoice number", pdfContent.includes(invoiceRow.number));
  check("PDF contains the vendor name", pdfContent.includes(zenithVendor.name));
  check("PDF contains the purchase order number", pdfContent.includes(poRow.number));
  check("PDF renders the persisted total", pdfContent.includes(totalText), totalText);

  await page.goto(`${BASE}/invoices/${invoiceRow.id}/print`, { waitUntil: "networkidle0" });
  await waitForText(page, invoiceRow.number);
  const printBody = await page.evaluate(() => (document.body.textContent ?? ""));
  check("Print view contains the invoice content", printBody.includes(invoiceRow.number) && printBody.includes(zenithVendor.name));
  check("Print view excludes application navigation", !printBody.includes("RFQs & quotations") && !printBody.includes("Secure Enterprise Workspace"));
  await capture(page, "05-invoice-print.png");

  section("5. Invoice email delivery");
  await page.goto(`${BASE}/invoices/${invoiceRow.id}`, { waitUntil: "networkidle0" });
  await waitForText(page, "Email delivery");
  await clickByText(page, "button", "Send to vendor");
  await waitForText(page, "Invoice emailed", 25000);
  await waitForText(page, "Sent");
  await settle(page, 700);
  const sentInvoice = await prisma.invoice.findUnique({ where: { id: invoiceRow.id } });
  check("Delivery state persisted as sent", sentInvoice?.emailStatus === "sent");
  check("Provider recorded", Boolean(sentInvoice?.emailProvider), sentInvoice?.emailProvider);
  check("Send timestamp recorded", Boolean(sentInvoice?.emailSentAt));
  check("Attempt counter incremented", sentInvoice?.emailAttempts === 1);

  const outbox = (await readFile(OUTBOX, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const delivery = [...outbox].reverse().find((entry) => entry.invoiceNumber === invoiceRow.number);
  check("Email was addressed to the vendor address on record", delivery?.to === zenithVendor.email);
  check("Email carries the invoice attachment", delivery?.attachment?.filename === `${invoiceRow.number}.pdf`);

  const retry = await procurement("POST", `/invoices/${invoiceRow.id}/send`);
  const invoiceCount = await prisma.invoice.count({ where: { purchaseOrderId: poId } });
  check("Retry delivery succeeds", retry.status === 200, String(retry.status));
  check("Retry does not create another invoice", invoiceCount === 1, String(invoiceCount));
  await capture(page, "06-invoice-email-sent.png");

  section("6. Vendor view is scoped");
  await loginViaUi(page, accounts.zenith);
  await page.goto(`${BASE}/purchase-orders`, { waitUntil: "networkidle0" });
  await waitForText(page, poRow.number);
  await page.goto(`${BASE}/purchase-orders/${poId}`, { waitUntil: "networkidle0" });
  await waitForText(page, poRow.number);
  const vendorPoBody = await page.evaluate(() => (document.body.textContent ?? ""));
  check("Vendor can read its own purchase order", vendorPoBody.includes(poRow.number) && vendorPoBody.includes(invoiceRow.number));
  check("Vendor sees no approval remarks", !vendorPoBody.includes(managerNote) && !vendorPoBody.includes(requestNote));
  check(
    "Vendor sees no internal document actions",
    !vendorPoBody.includes("Send to vendor") &&
      !vendorPoBody.includes("Resend email") &&
      !vendorPoBody.includes("Generate invoice"),
  );
  await capture(page, "07-vendor-purchase-order.png");
  await page.goto(`${BASE}/invoices/${invoiceRow.id}`, { waitUntil: "networkidle0" });
  await waitForText(page, invoiceRow.number);
  check("Vendor can read its own invoice", await page.evaluate((number) => (document.body.textContent ?? "").includes(number), invoiceRow.number));

  // ---------------------------------------------------------------- API tests
  section("7. Authorization and validation (HTTP status codes)");
  check("anonymous approvals -> 401", (await anon("GET", "/approvals")).status === 401);
  check("anonymous purchase orders -> 401", (await anon("GET", "/purchase-orders")).status === 401);
  check("anonymous invoices -> 401", (await anon("GET", "/invoices")).status === 401);
  check("anonymous invoice PDF -> 401", (await anon("GET", `/invoices/${invoiceRow.id}/pdf`)).status === 401);
  check("vendor cannot list approvals -> 403", (await zenith("GET", "/approvals")).status === 403);
  check("vendor cannot request approval -> 403", (await zenith("POST", "/approvals", { quotationId: zenithQuoteA.id })).status === 403);
  check("vendor cannot decide -> 403", (await zenith("POST", `/approvals/${approvalId}/approve`, {})).status === 403);
  check("vendor cannot create a purchase order -> 403", (await zenith("POST", "/purchase-orders", { approvalRequestId: approvalId })).status === 403);
  check("vendor cannot create an invoice -> 403", (await zenith("POST", "/invoices", { purchaseOrderId: poId })).status === 403);
  check("vendor cannot send an invoice -> 403", (await zenith("POST", `/invoices/${invoiceRow.id}/send`)).status === 403);
  check("manager cannot create a purchase order -> 403", (await manager("POST", "/purchase-orders", { approvalRequestId: approvalId })).status === 403);
  check("manager cannot create an invoice -> 403", (await manager("POST", "/invoices", { purchaseOrderId: poId })).status === 403);
  check("manager cannot send an invoice -> 403", (await manager("POST", `/invoices/${invoiceRow.id}/send`)).status === 403);
  check("manager can read purchase orders -> 200", (await manager("GET", `/purchase-orders/${poId}`)).status === 200);

  const otherVendorPo = await nova("GET", `/purchase-orders/${poId}`);
  const otherVendorInvoice = await nova("GET", `/invoices/${invoiceRow.id}`);
  const otherVendorPdf = await nova("GET", `/invoices/${invoiceRow.id}/pdf`);
  check("another vendor's purchase order -> 404", otherVendorPo.status === 404, String(otherVendorPo.status));
  check("another vendor's invoice -> 404", otherVendorInvoice.status === 404, String(otherVendorInvoice.status));
  check("another vendor's invoice PDF -> 404", otherVendorPdf.status === 404, String(otherVendorPdf.status));

  const duplicateApproval = await procurement("POST", "/approvals", { quotationId: zenithQuoteA.id });
  check("duplicate approval for the same quotation -> 409", duplicateApproval.status === 409, String(duplicateApproval.status));
  const secondQuotationApproval = await procurement("POST", "/approvals", { quotationId: novaQuoteA.id });
  check("a second quotation for an approved RFQ cannot be approved -> 409", secondQuotationApproval.status === 409, String(secondQuotationApproval.status));

  const duplicatePo = await procurement("POST", "/purchase-orders", { approvalRequestId: approvalId });
  check(
    "repeating PO generation returns the existing document",
    duplicatePo.status === 200 && duplicatePo.body?.created === false && duplicatePo.body?.purchaseOrder?.number === poRow.number,
    `status ${duplicatePo.status}`,
  );
  const duplicateInvoice = await procurement("POST", "/invoices", { purchaseOrderId: poId });
  check(
    "repeating invoice generation returns the existing document",
    duplicateInvoice.status === 200 && duplicateInvoice.body?.created === false && duplicateInvoice.body?.invoice?.number === invoiceRow.number,
    `status ${duplicateInvoice.status}`,
  );

  const tamperedPo = await procurement("POST", "/purchase-orders", {
    approvalRequestId: approvalId,
    total: "1.00",
    vendorId: novaVendor.id,
    status: "cancelled",
  });
  check(
    "client-supplied PO totals/vendor/status are ignored",
    tamperedPo.body?.purchaseOrder?.total === poRow.total.toFixed(2) &&
      tamperedPo.body?.purchaseOrder?.vendor?.id === zenithVendor.id &&
      tamperedPo.body?.purchaseOrder?.status === "issued",
  );

  section("8. Rejected approval cannot become a document");
  const rfqB = await createRfq(procurement, {
    title: "Rejection path",
    vendorIds: [novaVendor.id],
    items: [{ description: "A4 copier paper", quantity: 50, unit: "pack", specifications: "" }],
  });
  const quoteB = await submitQuotation(nova, rfqB, [320]);
  const requestB = await procurement("POST", "/approvals", { quotationId: quoteB.id });
  const approvalB = requestB.body?.approval?.id;
  const emptyRejection = await manager("POST", `/approvals/${approvalB}/reject`, { remarks: "" });
  check("rejection without remarks -> 422", emptyRejection.status === 422, String(emptyRejection.status));
  const rejected = await manager("POST", `/approvals/${approvalB}/reject`, { remarks: `Price above contracted rate (${stamp})` });
  check("manager can reject with remarks", rejected.status === 200 && rejected.body?.approval?.status === "rejected");
  const rejectedPo = await procurement("POST", "/purchase-orders", { approvalRequestId: approvalB });
  check("PO from a rejected quotation -> 409", rejectedPo.status === 409, String(rejectedPo.status));
  const reDecision = await manager("POST", `/approvals/${approvalB}/approve`, {});
  check("deciding an already-decided request -> 409", reDecision.status === 409, String(reDecision.status));

  await loginViaUi(page, accounts.manager);
  await page.goto(`${BASE}/approvals/${approvalB}`, { waitUntil: "networkidle0" });
  await waitForText(page, "Rejected");
  await waitForText(page, "Price above contracted rate");
  check(
    "UI shows the rejection reason and no approve control",
    await page.evaluate(() => !(document.body.textContent ?? "").includes("Approve quotation")),
  );
  await capture(page, "08-approval-rejected.png");

  section("9. Self-approval is forbidden");
  const rfqC = await createRfq(procurement, {
    title: "Self approval guard",
    vendorIds: [apexVendor.id],
    items: [{ description: "Network switch", quantity: 2, unit: "unit", specifications: "" }],
  });
  const quoteC = await submitQuotation(apex, rfqC, [15000]);
  const adminRequest = await admin("POST", "/approvals", { quotationId: quoteC.id });
  const approvalC = adminRequest.body?.approval?.id;
  const selfApproval = await admin("POST", `/approvals/${approvalC}/approve`, { remarks: "self" });
  check("requester cannot approve their own request -> 403", selfApproval.status === 403, String(selfApproval.status));
  const stillPending = await prisma.approvalRequest.findUnique({ where: { id: approvalC } });
  check("self-approval attempt did not change the record", stillPending?.status === "pending");
  const pendingPo = await procurement("POST", "/purchase-orders", { approvalRequestId: approvalC });
  check("PO from a pending approval -> 409", pendingPo.status === 409, String(pendingPo.status));

  section("10. Cancelled purchase order cannot be invoiced");
  const rfqD = await createRfq(procurement, {
    title: "Cancel path",
    vendorIds: [apexVendor.id],
    items: [{ description: "Docking station", quantity: 5, unit: "unit", specifications: "" }],
  });
  const quoteD = await submitQuotation(apex, rfqD, [7800]);
  const requestD = await procurement("POST", "/approvals", { quotationId: quoteD.id });
  const approvalD = requestD.body.approval.id;
  const decisionD = await manager("POST", `/approvals/${approvalD}/approve`, { remarks: "ok" });
  check("approval for the cancel-path RFQ succeeds", decisionD.status === 200);
  const poD = await procurement("POST", "/purchase-orders", { approvalRequestId: approvalD });
  const poDId = poD.body?.purchaseOrder?.id;
  const cancelD = await procurement("POST", `/purchase-orders/${poDId}/cancel`, { reason: "Vendor withdrew the offer." });
  check("issued purchase order can be cancelled with a reason", cancelD.status === 200 && cancelD.body?.purchaseOrder?.status === "cancelled");
  const invoiceCancelled = await procurement("POST", "/invoices", { purchaseOrderId: poDId });
  check("invoice from a cancelled PO -> 409", invoiceCancelled.status === 409, String(invoiceCancelled.status));

  section("11. Concurrency");
  const rfqE = await createRfq(procurement, {
    title: "Concurrency",
    vendorIds: [novaVendor.id, zenithVendor.id],
    items: [{ description: "Conference table", quantity: 1, unit: "unit", specifications: "" }],
  });
  const quoteE1 = await submitQuotation(nova, rfqE, [61000]);
  const quoteE2 = await submitQuotation(zenith, rfqE, [59000]);

  const parallelRequests = await Promise.all([
    procurement("POST", "/approvals", { quotationId: quoteE1.id }),
    procurement("POST", "/approvals", { quotationId: quoteE2.id }),
  ]);
  const requestStatuses = parallelRequests.map((response) => response.status).sort();
  check(
    "simultaneous approval requests for one RFQ -> exactly one accepted",
    requestStatuses[0] === 201 && requestStatuses[1] === 409,
    requestStatuses.join(","),
  );
  const approvalE = parallelRequests.find((response) => response.status === 201)?.body?.approval?.id;
  const activeForRfq = await prisma.approvalRequest.count({ where: { rfqId: rfqE.id, status: { in: ["pending", "approved"] } } });
  check("database holds one active approval for the RFQ", activeForRfq === 1, String(activeForRfq));

  const parallelDecisions = await Promise.all([
    manager("POST", `/approvals/${approvalE}/approve`, { remarks: `concurrent a ${stamp}` }),
    manager("POST", `/approvals/${approvalE}/approve`, { remarks: `concurrent b ${stamp}` }),
  ]);
  const decisionStatuses = parallelDecisions.map((response) => response.status).sort();
  check(
    "simultaneous decisions -> one decision wins, the other is rejected",
    decisionStatuses[0] === 200 && decisionStatuses[1] === 409,
    decisionStatuses.join(","),
  );
  const decisionEvents = await prisma.approvalEvent.count({ where: { approvalId: approvalE, type: "approved" } });
  check("only one approved event was written", decisionEvents === 1, String(decisionEvents));

  const parallelPos = await Promise.all([
    procurement("POST", "/purchase-orders", { approvalRequestId: approvalE }),
    procurement("POST", "/purchase-orders", { approvalRequestId: approvalE }),
  ]);
  const poStatuses = parallelPos.map((response) => response.status).sort();
  const poNumbers = new Set(parallelPos.map((response) => response.body?.purchaseOrder?.number));
  const poCount = await prisma.purchaseOrder.count({ where: { approvalRequestId: approvalE } });
  check(
    "simultaneous PO generation creates exactly one purchase order",
    poCount === 1 && poNumbers.size === 1,
    `${poStatuses.join(",")} count=${poCount}`,
  );
  const poEId = parallelPos.find((response) => response.body?.purchaseOrder)?.body.purchaseOrder.id;

  const parallelInvoices = await Promise.all([
    procurement("POST", "/invoices", { purchaseOrderId: poEId }),
    procurement("POST", "/invoices", { purchaseOrderId: poEId }),
  ]);
  const invoiceNumbers = new Set(parallelInvoices.map((response) => response.body?.invoice?.number));
  const invoiceCountE = await prisma.invoice.count({ where: { purchaseOrderId: poEId } });
  check(
    "simultaneous invoice generation creates exactly one invoice",
    invoiceCountE === 1 && invoiceNumbers.size === 1,
    `${parallelInvoices.map((response) => response.status).join(",")} count=${invoiceCountE}`,
  );

  section("12. Cache and validation headers");
  const privateResponse = await procurement("GET", `/purchase-orders/${poId}`);
  check("authenticated documents are not cacheable", privateResponse.headers.get("cache-control") === "no-store", privateResponse.headers.get("cache-control"));
  const invalidBody = await procurement("POST", "/approvals", { quotationId: "abc" });
  check("invalid IDs return the standard validation error", invalidBody.status === 422 && invalidBody.body?.error?.code === "validation_failed", String(invalidBody.status));

  section("13. Database integrity");
  const crossLinked = await prisma.purchaseOrder.count({
    where: {
      OR: [
        { vendorId: { not: zenithVendor.id } },
        { rfqId: { not: rfqA.id } },
        { quotationId: { not: zenithQuoteA.id } },
      ],
      id: poId,
    },
  });
  check("purchase order vendor/RFQ/quotation relationships agree", crossLinked === 0);
  const invoiceLink = await prisma.invoice.findUnique({ where: { id: invoiceRow.id }, include: { purchaseOrder: true } });
  check("invoice PO relationship agrees", invoiceLink?.purchaseOrderId === invoiceLink?.purchaseOrder.id && invoiceLink?.rfqId === invoiceLink?.purchaseOrder.rfqId && invoiceLink?.vendorId === invoiceLink?.purchaseOrder.vendorId);
  const duplicateOrders = await prisma.$queryRaw`
    SELECT quotation_id, COUNT(*)::int AS count FROM purchase_orders GROUP BY quotation_id HAVING COUNT(*) > 1
  `;
  const duplicateInvoices = await prisma.$queryRaw`
    SELECT purchase_order_id, COUNT(*)::int AS count FROM invoices GROUP BY purchase_order_id HAVING COUNT(*) > 1
  `;
  check("no quotation has more than one purchase order", duplicateOrders.length === 0, JSON.stringify(duplicateOrders));
  check("no purchase order has more than one invoice", duplicateInvoices.length === 0, JSON.stringify(duplicateInvoices));

  section("14. Existing Week 1/2 routes still work");
  check("vendors list still responds", (await procurement("GET", "/vendors?pageSize=1")).status === 200);
  check("RFQ list still responds", (await procurement("GET", "/rfqs?pageSize=1")).status === 200);
  check("comparison still responds", (await procurement("GET", `/rfqs/${rfqA.id}/comparison`)).status === 200);
  check("dashboard still responds", (await procurement("GET", "/dashboard")).status === 200);
  check("vendor RFQ detail still responds", (await nova("GET", `/rfqs/${rfqA.id}`)).status === 200);
}

// ---------------------------------------------------------------------------
// Cleanup + report
// ---------------------------------------------------------------------------
async function cleanup() {
  section("15. Cleanup");
  let deleted = 0;
  for (const rfqId of createdRfqIds) {
    try {
      const invoices = await prisma.invoice.findMany({ where: { rfqId }, select: { id: true } });
      if (invoices.length > 0) {
        await prisma.invoice.deleteMany({ where: { id: { in: invoices.map((row) => row.id) } } });
      }
      const orders = await prisma.purchaseOrder.findMany({ where: { rfqId }, select: { id: true } });
      if (orders.length > 0) {
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: orders.map((row) => row.id) } } });
      }
      await prisma.approvalRequest.deleteMany({ where: { rfqId } });
      // Bids are append-only: the database rejects deleting quotations while
      // their vendor and RFQ still exist, so they are removed with the RFQ
      // itself (ON DELETE CASCADE) — the one sanctioned disappearance path.
      await prisma.rfq.delete({ where: { id: rfqId } });
      deleted += 1;
    } catch (error) {
      console.error(`  cleanup failed for RFQ ${rfqId}: ${error.message}`);
    }
  }
  const remaining = await prisma.rfq.count({ where: { id: { in: createdRfqIds } } });
  check(`deleted ${deleted}/${createdRfqIds.length} test RFQs`, remaining === 0, `remaining=${remaining}`);
}

async function run() {
  const started = Date.now();
  let fatal = null;
  try {
    await main();
  } catch (error) {
    fatal = error;
    check("workflow completed without an unexpected error", false, error.message);
    console.error(error);
  } finally {
    try {
      await cleanup();
    } catch (error) {
      console.error("cleanup error", error.message);
    }
    if (browser) await browser.close();
    await prisma.$disconnect();
  }

  const passed = results.filter((row) => row.status === "PASS").length;
  const failed = results.filter((row) => row.status === "FAIL").length;
  const report = {
    runAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    baseUrl: BASE,
    database: parsedDb ? `${parsedDb.hostname}${parsedDb.pathname}` : "unknown",
    totals: { passed, failed, total: results.length },
    screenshots,
    results,
  };
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "results.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n${passed} passed, ${failed} failed - report written to docs/verification/week3/results.json`);
  if (fatal) process.exitCode = 1;
  if (failed > 0) process.exitCode = 1;
}

await run();
