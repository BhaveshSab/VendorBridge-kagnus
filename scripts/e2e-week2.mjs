/**
 * Week 2 end-to-end verification — RFQ lifecycle and vendor quotations.
 *
 * Runs a real browser (Chrome/Brave via puppeteer-core) against the running
 * app, plus direct API calls, and finally inspects the database with Prisma.
 *
 * Safety:
 *  - Refuses to run unless DATABASE_URL points at a loopback disposable
 *    database whose name contains "e2e".
 *  - Creates RFQs whose titles start with "E2E Test" and deletes only those
 *    records (cascade removes items, assignments and quotations).
 *  - Never prints credentials, cookies or tokens.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:password@127.0.0.1:55432/vendorbridge_e2e \
 *   APP_URL=http://localhost:4100 node scripts/e2e-week2.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.APP_URL || "http://localhost:4100";
const BROWSER_PATH =
  process.env.CHROME_PATH || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
const OUT = path.resolve("docs/verification/week2");
const PREFIX = "E2E Test";
const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const TITLE = `${PREFIX} RFQ ${stamp}`;

const accounts = {
  procurement: { email: "procurement@vendorbridge.dev", password: "Procure@123" },
  nova: { email: "vendor@vendorbridge.dev", password: "Vendor@123" },
  zenith: { email: "zenith@vendorbridge.dev", password: "Vendor@123" },
  apex: { email: "apex@vendorbridge.dev", password: "Vendor@123" },
};

// ---------------------------------------------------------------------------
// Safety guard + results
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
  console.error(
    "Refusing to run: DATABASE_URL must point at a loopback database whose name contains 'e2e'.",
  );
  process.exit(2);
}

const prisma = new PrismaClient();
const results = [];
const cleanup = [];

function check(name, passed, detail = "") {
  const status = passed ? "PASS" : "FAIL";
  results.push({ name, status, detail });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) cleanup.push(name);
  return Boolean(passed);
}

function section(title) {
  console.log(`\n== ${title}`);
}

function money(value) {
  return Number(value).toFixed(2);
}

// ---------------------------------------------------------------------------
// HTTP client with its own cookie jar
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
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      body: json,
      cacheControl: response.headers.get("cache-control"),
      setCookie: session || null,
      raw: text,
    };
  };
}

async function signIn(account) {
  const call = httpClient();
  const response = await call("POST", "/auth/login", account);
  if (response.status !== 200) throw new Error(`API login failed for ${account.email}: ${response.status}`);
  return call;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------
async function settle(page, ms = 450) {
  await page.waitForNetworkIdle({ idleTime: 350, timeout: 15000 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginViaUi(page, account) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("#email");
  await page.type("#email", account.email);
  await page.type("#password", account.password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => location.pathname !== "/login", { timeout: 20000 });
  await settle(page);
  if (!page.url().includes("/dashboard")) {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
    throw new Error(`UI login did not reach the dashboard: ${text}`);
  }
}

async function newBrowserSession(browser, account) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await loginViaUi(page, account);
  return { context, page, pageErrors };
}

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

async function clickText(page, selector, text) {
  const clicked = await page.evaluate(
    ({ selector: sel, text: label }) => {
      const nodes = Array.from(document.querySelectorAll(sel));
      const target = nodes.find((node) => (node.textContent || "").includes(label));
      if (!target) return false;
      target.click();
      return true;
    },
    { selector, text },
  );
  if (!clicked) throw new Error(`Could not find "${text}" in ${selector}`);
}

async function setHandleValue(handle, value) {
  await handle.evaluate((element, next) => {
    let prototype = Object.getPrototypeOf(element);
    let descriptor = null;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      prototype = Object.getPrototypeOf(prototype);
    }
    descriptor.set.call(element, next);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function setNativeValue(page, selector, value) {
  const handle = await page.$(selector);
  if (!handle) throw new Error(`Field not found: ${selector}`);
  try {
    await setHandleValue(handle, value);
  } finally {
    await handle.dispose();
  }
}

async function setSelect(page, selector, value) {
  const tag = await page.$eval(selector, (element) => element.tagName);
  if (tag === "SELECT") await page.select(selector, value);
  else await setNativeValue(page, selector, value);
}

async function shot(page, file) {
  await settle(page, 250);
  await page.screenshot({ path: path.join(OUT, file) });
  console.log(`  (screenshot ${file})`);
}

function localDeadline(daysAhead) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------
function rfqBody({ title, vendorIds, currency = "INR", days = 20, items }) {
  return {
    title,
    description: "End-to-end verification requirement. Disposable test data.",
    currency,
    deadline: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
    vendorIds,
    items:
      items ??
      [
        { description: "E2E sealed carton", quantity: "10", unit: "box", specifications: "Double-wall" },
        { description: "E2E packing tape", quantity: "5", unit: "pack", specifications: "48mm" },
      ],
  };
}

async function createPublishedRfq(procurement, vendorIds, title) {
  const created = await procurement("POST", "/rfqs", rfqBody({ title, vendorIds }));
  if (created.status !== 201) throw new Error(`RFQ create failed: ${created.status} ${created.raw}`);
  const published = await procurement("POST", `/rfqs/${created.body.rfq.id}/publish`);
  if (published.status !== 200) throw new Error(`RFQ publish failed: ${published.status} ${published.raw}`);
  return published.body.rfq;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let browser = null;
let created = { rfqIds: [], quotationIds: [] };

try {
  await mkdir(OUT, { recursive: true });
  console.log(`VendorBridge Week 2 E2E verification against ${BASE}`);
  console.log(`Database: ${parsedDb.hostname}:${parsedDb.port}${parsedDb.pathname} (loopback disposable)`);

  const identity = await prisma.$queryRawUnsafe(
    "SELECT current_database() AS db, inet_server_port() AS port",
  );
  console.log(`Confirmed database: ${identity[0].db} on port ${identity[0].port}`);
  check(
    "database is the disposable local e2e instance",
    identity[0].db === "vendorbridge_e2e" && Number(identity[0].port) === 55432,
    `${identity[0].db}:${identity[0].port}`,
  );

  // Snapshot the register before the run creates anything. Cleanup compares
  // against this instead of hard-coded totals, so the suite is honest on a
  // freshly seeded database and on one that already holds demo fixtures.
  const [usersBefore, vendorsBefore, quotationsBefore, liveQuotationsBefore] = await Promise.all([
    prisma.user.count(),
    prisma.vendor.count(),
    prisma.quotation.count(),
    prisma.quotation.count({ where: { supersededAt: null } }),
  ]);
  const baseline = {
    users: usersBefore,
    vendors: vendorsBefore,
    quotations: quotationsBefore,
    liveQuotations: liveQuotationsBefore,
  };

  const anon = httpClient();
  const procurement = await signIn(accounts.procurement);
  const nova = await signIn(accounts.nova);
  const zenith = await signIn(accounts.zenith);
  const apex = await signIn(accounts.apex);

  const vendorRegister = await procurement("GET", "/vendors?pageSize=100&status=all");
  const vendors = vendorRegister.body.items;
  const novaVendor = vendors.find((vendor) => vendor.name === "Nova Office Supplies");
  const zenithVendor = vendors.find((vendor) => vendor.name === "Zenith IT Solutions");
  const apexVendor = vendors.find((vendor) => vendor.name === "Apex Hardware");
  check(
    "seeded vendor accounts are linked to their vendor records",
    Boolean(novaVendor && zenithVendor && apexVendor && novaVendor.userId && zenithVendor.userId && apexVendor.userId),
  );

  // =========================================================================
  section("A. Procurement creates and publishes an RFQ through the UI");
  // =========================================================================
  browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars"],
  });
  const proc = await newBrowserSession(browser, accounts.procurement);
  const page = proc.page;

  const listBefore = await procurement("GET", "/rfqs?pageSize=100");
  await page.goto(`${BASE}/rfqs/new`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("#rfq-title");
  await settle(page);

  await clickText(page, 'button', "Review & publish");
  await page.waitForSelector('[role="alert"]', { timeout: 8000 }).catch(() => {});
  const invalidText = await textOf(page);
  const listAfterInvalid = await procurement("GET", "/rfqs?pageSize=100");
  check(
    "invalid empty RFQ shows inline validation and creates nothing",
    /Please fix \d+ field/.test(invalidText) && listAfterInvalid.body.total === listBefore.body.total,
    `total ${listBefore.body.total} -> ${listAfterInvalid.body.total}`,
  );
  await shot(page, "01-rfq-validation.png");

  await page.type("#rfq-title", TITLE);
  await page.type("#rfq-description", "E2E verification: packaging consumables for the Pune warehouse.");
  await setSelect(page, "#rfq-currency", "INR");
  await setNativeValue(page, "#rfq-deadline", localDeadline(12));

  const descriptions = ['E2E sealed carton', 'E2E packing tape'];
  const quantities = ["10", "5"];
  const specifications = ["Double-wall corrugated", "48mm x 65m"];

  await setNativeValue(page, 'input[id$="-description"]', descriptions[0]);
  await setNativeValue(page, 'input[id$="-quantity"]', quantities[0]);
  await setNativeValue(page, 'input[id$="-specifications"]', specifications[0]);
  await page.select('select[id$="-unit"]', "box");

  await clickText(page, 'button', "Add item");
  await page.waitForFunction(
    () => document.querySelectorAll('input[id$="-description"]').length === 2,
    { timeout: 5000 },
  );
  const descriptionInputs = await page.$$('input[id$="-description"]');
  const quantityInputs = await page.$$('input[id$="-quantity"]');
  const specInputs = await page.$$('input[id$="-specifications"]');
  const unitSelects = await page.$$('select[id$="-unit"]');

  await descriptionInputs[1].type(descriptions[1]);
  await setHandleValue(quantityInputs[1], quantities[1]);
  await specInputs[1].type(specifications[1]);
  await setHandleValue(unitSelects[1], "pack");
  await unitSelects.forEach((handle) => handle.dispose());

  const assigned = await page.evaluate(
    (names) => {
      const labels = Array.from(document.querySelectorAll("label"));
      let count = 0;
      for (const name of names) {
        const label = labels.find((node) => node.textContent.includes(name));
        const box = label?.querySelector('input[type="checkbox"]');
        if (box && !box.checked) {
          box.click();
          count += 1;
        }
      }
      return count;
    },
    ["Nova Office Supplies", "Zenith IT Solutions"],
  );
  check("two vendors can be assigned in the form", assigned === 2, `${assigned} selected`);
  await settle(page);
  await shot(page, "02-create-rfq-filled.png");

  await clickText(page, 'button', "Review & publish");
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const dialogText = await page.$eval('[role="dialog"]', (node) => node.innerText);
  check(
    "publish confirmation names the requirement, vendors and deadline",
    dialogText.includes(TITLE) && dialogText.includes("2 assigned vendors"),
  );
  await clickText(page, '[role="dialog"] button', "Publish RFQ");
  await page.waitForFunction(() => /\/rfqs\/\d+$/.test(location.pathname), { timeout: 20000 });
  await settle(page);

  const rfqId = Number(page.url().split("/").pop());
  created.rfqIds.push(rfqId);
  const createdDetail = await procurement("GET", `/rfqs/${rfqId}`);
  const rfqA = createdDetail.body.rfq;
  const items = rfqA.items;

  check("RFQ received a unique RFQ-#### reference", /^RFQ-\d{4,}$/.test(rfqA.reference), rfqA.reference);
  check(
    "RFQ persisted with title, description, currency and 2 line items",
    rfqA.title === TITLE &&
      rfqA.currency === "INR" &&
      rfqA.items.length === 2 &&
      items[0].description === descriptions[0] &&
      Number(items[0].quantity) === 10 &&
      items[0].unit === "box" &&
      Number(items[1].quantity) === 5 &&
      items[1].unit === "pack",
  );
  check(
    "RFQ is open and assigned to exactly Nova and Zenith",
    rfqA.status === "open" &&
      rfqA.effectiveStatus === "open" &&
      rfqA.assignments.length === 2 &&
      rfqA.assignments.every((entry) => [novaVendor.id, zenithVendor.id].includes(entry.vendorId)),
  );
  check(
    "deadline is stored in the future",
    new Date(rfqA.deadline).getTime() > Date.now(),
    rfqA.deadline,
  );

  const detailText = await textOf(page);
  check(
    "detail page renders the saved reference, vendors, items and status",
    detailText.includes(rfqA.reference) &&
      detailText.includes("Nova Office Supplies") &&
      detailText.includes("Zenith IT Solutions") &&
      detailText.includes(descriptions[0]) &&
      detailText.includes(descriptions[1]) &&
      /\bopen\b/i.test(detailText),
  );
  await shot(page, "03-rfq-detail.png");

  await page.reload({ waitUntil: "networkidle0" });
  await settle(page);
  check(
    "RFQ survives a full page reload",
    (await textOf(page)).includes(rfqA.reference) && (await textOf(page)).includes(TITLE),
  );

  // Setup RFQs for isolation, empty, single-quotation and expiry scenarios.
  const rfqB = await createPublishedRfq(procurement, [apexVendor.id], `${PREFIX} Unassigned ${stamp}`);
  const rfqC = await createPublishedRfq(procurement, [apexVendor.id], `${PREFIX} Empty comparison ${stamp}`);
  const rfqD = await createPublishedRfq(procurement, [apexVendor.id], `${PREFIX} Single quotation ${stamp}`);
  const rfqE = await createPublishedRfq(procurement, [novaVendor.id], `${PREFIX} Expired ${stamp}`);
  const rfqDraft = (await procurement("POST", "/rfqs", rfqBody({ title: `${PREFIX} Draft ${stamp}`, vendorIds: [novaVendor.id] }))).body.rfq;
  const rfqCancelled = await createPublishedRfq(procurement, [novaVendor.id], `${PREFIX} Cancelled ${stamp}`);
  created.rfqIds.push(rfqB.id, rfqC.id, rfqD.id, rfqE.id, rfqDraft.id, rfqCancelled.id);

  // =========================================================================
  section("B. Assigned vendor access and quotation submission (Nova)");
  // =========================================================================
  const novaSession = await newBrowserSession(browser, accounts.nova);
  const novaPage = novaSession.page;

  await novaPage.goto(`${BASE}/rfqs`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(novaPage);
  const novaListText = await textOf(novaPage);
  check("assigned RFQ appears in the vendor's list", novaListText.includes(rfqA.reference));

  const searchInput = 'input[placeholder*="Search reference"]';
  await novaPage.click(searchInput, { clickCount: 3 });
  await novaPage.type(searchInput, TITLE);
  await novaPage.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await settle(novaPage, 500);
  const filteredText = await textOf(novaPage);
  check("vendor list search narrows to the assigned RFQ", filteredText.includes(rfqA.reference) && filteredText.includes("E2E Test"));
  await shot(novaPage, "04-vendor-rfq-list.png");

  await novaPage.goto(`${BASE}/rfqs/${rfqA.id}`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(novaPage);
  const novaDetailText = await textOf(novaPage);
  check(
    "vendor sees the procurement-created details",
    novaDetailText.includes(TITLE) &&
      novaDetailText.includes(descriptions[0]) &&
      novaDetailText.includes(descriptions[1]) &&
      novaDetailText.includes(rfqA.reference),
  );
  check(
    "vendor detail does not leak another vendor's quotation",
    !novaDetailText.includes("Zenith") && !novaDetailText.includes("16,004"),
  );

  await novaPage.goto(`${BASE}/rfqs/${rfqA.id}/quotation`, { waitUntil: "networkidle0", timeout: 45000 });
  await novaPage.waitForSelector('input[id^="price-"]');
  await settle(novaPage);
  const priceInputs = await novaPage.$$('input[id^="price-"]');
  await priceInputs[0].type("1200");
  await priceInputs[1].type("340");
  await setNativeValue(novaPage, "#delivery-days", "12");
  await setNativeValue(novaPage, "#tax-percent", "18");
  await setNativeValue(novaPage, "#shipping-amount", "1500");
  await setNativeValue(novaPage, "#delivery-terms", "Freight included, Pune warehouse");
  await setNativeValue(novaPage, "#quotation-notes", "Nova E2E quote: six-month price validity.");
  await shot(novaPage, "05-vendor-quotation-form.png");

  await clickText(novaPage, 'button[type="submit"]', "Submit quotation");
  await novaPage.waitForFunction(() => /\/rfqs\/\d+$/.test(location.pathname), { timeout: 20000 });
  await settle(novaPage);
  const novaAfterSubmit = await textOf(novaPage);
  check(
    "quotation submits and the vendor sees its own total",
    novaAfterSubmit.includes("Your quotation") && novaAfterSubmit.includes("17,666.00") && novaAfterSubmit.includes("Revision 1"),
  );
  await shot(novaPage, "06-vendor-quotation-saved.png");

  const novaQuotationResponse = await nova("GET", `/rfqs/${rfqA.id}`);
  const novaQuote = novaQuotationResponse.body.myQuotation;
  check(
    "quotation is linked to the RFQ and authenticated vendor with server totals",
    novaQuote.rfqId === rfqA.id &&
      novaQuote.vendorId === novaVendor.id &&
      novaQuote.currency === "INR" &&
      novaQuote.subtotal === "13700.00" &&
      novaQuote.taxAmount === "2466.00" &&
      novaQuote.total === "17666.00" &&
      novaQuote.deliveryDays === 12,
  );
  created.quotationIds.push(novaQuote.id);

  await novaPage.reload({ waitUntil: "networkidle0" });
  await settle(novaPage);
  check(
    "quotation survives reload",
    (await textOf(novaPage)).includes("17,666.00") && (await textOf(novaPage)).includes("Nova E2E quote"),
  );

  const unassignedUi = await novaPage.goto(`${BASE}/rfqs/${rfqB.id}`, { waitUntil: "networkidle0" });
  await settle(novaPage);
  const unassignedText = await textOf(novaPage);
  check(
    "vendor opening an unassigned RFQ sees a not-found error, no data",
    (unassignedUi?.status() ?? 0) < 400 &&
      unassignedText.includes("RFQ not found") &&
      !unassignedText.includes(`${PREFIX} Unassigned ${stamp}`),
  );
  await shot(novaPage, "07-vendor-unassigned-rfq.png");

  // =========================================================================
  section("C. Second assigned vendor submits a different quotation (Zenith)");
  // =========================================================================
  const zenSession = await newBrowserSession(browser, accounts.zenith);
  const zenPage = zenSession.page;
  await zenPage.goto(`${BASE}/rfqs/${rfqA.id}/quotation`, { waitUntil: "networkidle0", timeout: 45000 });
  await zenPage.waitForSelector('input[id^="price-"]');
  await settle(zenPage);
  const zenPrices = await zenPage.$$('input[id^="price-"]');
  await zenPrices[0].type("1100");
  await zenPrices[1].type("360");
  await setNativeValue(zenPage, "#delivery-days", "9");
  await setNativeValue(zenPage, "#tax-percent", "18");
  await setNativeValue(zenPage, "#shipping-amount", "900");
  await setNativeValue(zenPage, "#delivery-terms", "Delivered duty paid");
  await setNativeValue(zenPage, "#quotation-notes", "Zenith E2E quote: 9-day dispatch.");
  await clickText(zenPage, 'button[type="submit"]', "Submit quotation");
  await zenPage.waitForFunction(() => /\/rfqs\/\d+$/.test(location.pathname), { timeout: 20000 });
  await settle(zenPage);
  const zenText = await textOf(zenPage);
  check(
    "second vendor's total is stored and rendered",
    zenText.includes("16,004.00") && zenText.includes("Your quotation"),
  );
  const zenQuote = (await zenith("GET", `/rfqs/${rfqA.id}`)).body.myQuotation;
  check(
    "second quotation has its own prices, timeline and notes",
    zenQuote.vendorId === zenithVendor.id &&
      zenQuote.subtotal === "12800.00" &&
      zenQuote.taxAmount === "2304.00" &&
      zenQuote.shippingAmount === "900.00" &&
      zenQuote.total === "16004.00" &&
      zenQuote.deliveryDays === 9,
  );

  check(
    "each vendor sees only its own quotation via the API",
    (await nova("GET", `/rfqs/${rfqA.id}`)).body.myQuotation.total === "17666.00" &&
      !JSON.stringify((await nova("GET", `/rfqs/${rfqA.id}`)).body).includes("16004") &&
      !JSON.stringify((await zenith("GET", `/rfqs/${rfqA.id}`)).body).includes("17666"),
  );
  check(
    "vendor access to the staff quotation register is forbidden",
    (await nova("GET", `/rfqs/${rfqA.id}/quotations`)).status === 403 &&
      (await nova("GET", `/rfqs/${rfqA.id}/comparison`)).status === 403,
  );

  // Single-quotation RFQ D (Apex) for the one-column case.
  const apexQuote = await apex("PUT", `/rfqs/${rfqD.id}/quotation`, {
    deliveryDays: 5,
    deliveryTerms: "Ex-works",
    notes: "Apex single-quotation E2E.",
    taxPercent: "5",
    shippingAmount: "100",
    items: rfqD.items.map((item) => ({ rfqItemId: item.id, unitPrice: "500" })),
  });
  check(
    "single vendor quotation saved for RFQ D",
    apexQuote.status === 201 && apexQuote.body.quotation.total === "7975.00",
    `status ${apexQuote.status} total ${apexQuote.body?.quotation?.total}`,
  );

  // =========================================================================
  section("D. Procurement quotation list, comparison and sorting");
  // =========================================================================
  await page.goto(`${BASE}/rfqs/${rfqA.id}/quotations`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("table tbody tr");
  await settle(page);
  const registerText = await textOf(page);
  check(
    "register shows both persisted quotations for this RFQ",
    registerText.includes("Nova Office Supplies") &&
      registerText.includes("Zenith IT Solutions") &&
      registerText.includes("17,666.00") &&
      registerText.includes("16,004.00") &&
      registerText.includes("2 of 2 invited vendors responded"),
  );
  await shot(page, "08-quotations-register.png");

  await setSelect(page, 'select[aria-label="Sort quotations"]', "total_desc");
  await settle(page);
  const firstRowDesc = await page.$eval("table tbody tr", (row) => row.innerText);
  check("sorting quotations highest-first updates the table", firstRowDesc.includes("Nova Office Supplies"));
  await setSelect(page, 'select[aria-label="Sort quotations"]', "vendor");
  await settle(page);
  const firstRowVendor = await page.$eval("table tbody tr", (row) => row.innerText);
  check("sorting quotations by vendor A-Z updates the table", firstRowVendor.includes("Nova Office Supplies"));

  await page.goto(`${BASE}/rfqs/${rfqA.id}/compare`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector("table");
  await settle(page);
  const comparisonText = await textOf(page);
  const comparisonLc = comparisonText.toLowerCase();
  check(
    "comparison renders both quotations side by side",
    comparisonLc.includes("nova office supplies") &&
      comparisonLc.includes("zenith it solutions") &&
      comparisonLc.includes("side-by-side comparison") &&
      comparisonText.includes("1,200.00") &&
      comparisonText.includes("1,100.00") &&
      comparisonText.includes("12 day(s)") &&
      comparisonText.includes("9 day(s)"),
  );
  check(
    "notes are visible to procurement in the comparison",
    comparisonText.includes("Nova E2E quote") && comparisonText.includes("Zenith E2E quote"),
  );
  check(
    "comparison documents the currency and cost basis",
    comparisonText.includes("Comparison basis") &&
      comparisonText.includes("INR") &&
      comparisonText.includes("tax included") &&
      comparisonText.includes("delivery included"),
  );
  const comparisonApi = await procurement("GET", `/rfqs/${rfqA.id}/comparison`);
  check(
    "server marks exactly the lowest comparable quotation",
    comparisonApi.body.summary.quotationCount === 2 &&
      comparisonApi.body.summary.comparableCount === 2 &&
      comparisonApi.body.summary.excludedCount === 0 &&
      comparisonApi.body.lowest.vendorId === zenithVendor.id &&
      comparisonApi.body.summary.lowestTotal === "16004.00" &&
      comparisonApi.body.quotations.filter((entry) => entry.isLowest).length === 1,
  );
  check(
    "comparison highlights the lowest vendor in the UI",
    comparisonLc.includes("lowest comparable total") &&
      comparisonLc.includes("zenith it solutions") &&
      comparisonText.includes("16,004.00"),
  );
  check(
    "comparison is explicitly not an award",
    comparisonText.includes("no award") || comparisonText.includes("never awards"),
  );
  await shot(page, "09-comparison.png");

  await setSelect(page, 'select[aria-label="Sort comparison columns"]', "vendor");
  await settle(page);
  const headerOrder = await page.$$eval("table thead th", (headers) =>
    headers.map((header) => header.innerText.split("\n")[0].trim().toLowerCase()),
  );
  check(
    "comparison column sort reorders vendors A-Z",
    headerOrder.indexOf("nova office supplies") > -1 &&
      headerOrder.indexOf("nova office supplies") < headerOrder.indexOf("zenith it solutions"),
    headerOrder.join(" | "),
  );
  await setSelect(page, 'select[aria-label="Sort comparison columns"]', "submitted");
  await settle(page);
  const submittedOrder = await page.$$eval("table thead th", (headers) =>
    headers.map((header) => header.innerText.split("\n")[0].trim().toLowerCase()),
  );
  check(
    "comparison column sort by newest submission reorders vendors",
    submittedOrder.indexOf("zenith it solutions") > -1 &&
      submittedOrder.indexOf("zenith it solutions") < submittedOrder.indexOf("nova office supplies"),
    submittedOrder.join(" | "),
  );

  await page.goto(`${BASE}/rfqs/${rfqC.id}/compare`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(page);
  const emptyComparison = await textOf(page);
  check(
    "RFQ without quotations shows a real empty state, no fabricated values",
    emptyComparison.includes("No quotations to compare") && !emptyComparison.includes("Lowest comparable total"),
  );
  check(
    "empty comparison API reports no lowest price",
    (await procurement("GET", `/rfqs/${rfqC.id}/comparison`)).body.lowest === null,
  );
  await shot(page, "10-empty-comparison.png");

  await page.goto(`${BASE}/rfqs/${rfqD.id}/compare`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(page);
  const singleText = await textOf(page);
  const sortControls = await page.$$('select[aria-label="Sort comparison columns"]');
  check(
    "a single quotation displays correctly without a multi-vendor sort control",      singleText.includes("1 saved quotation") &&
      singleText.includes("Apex Hardware") &&
      singleText.includes("7,975.00") &&
      sortControls.length === 0,
  );
  await shot(page, "11-single-quotation-comparison.png");

  // Incomparable quotation: mutate only this run's test quotation in the
  // disposable database, verify it is excluded, then restore it.
  const apexStored = await prisma.quotation.findFirst({ where: { rfqId: rfqD.id } });
  created.quotationIds.push(apexStored.id);
  await prisma.quotation.update({ where: { id: apexStored.id }, data: { currency: "USD" } });
  const excludedApi = await procurement("GET", `/rfqs/${rfqD.id}/comparison`);
  await page.goto(`${BASE}/rfqs/${rfqD.id}/compare`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(page);
  const excludedText = await textOf(page);
  check(
    "currency-mismatched quotation is excluded and not highlighted",
    excludedApi.body.summary.excludedCount === 1 &&
      excludedApi.body.lowest === null &&
      excludedText.includes("Excluded") &&
      excludedText.includes("Quoted in USD") &&
      !excludedText.includes("Lowest comparable total"),
  );
  await shot(page, "12-incomparable-quotation.png");
  await prisma.quotation.update({ where: { id: apexStored.id }, data: { currency: "INR" } });

  section("E. RFQ list sorting, filtering and empty states");
  await page.goto(`${BASE}/rfqs`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(page);
  const listText = await textOf(page);
  // The register is paginated and may already hold earlier demo records, so the
  // list check proves it renders with live status counts; the search check below
  // proves this run's RFQ is in it, with its reference, status and single row.
  const listRows = await page.$$("table tbody tr");
  check(
    "RFQ list renders with live status counts",
    listRows.length > 0 && /All/i.test(listText) && /Open/i.test(listText),
    `${listRows.length} row(s)`,
  );
  await page.click('input[placeholder*="Search reference"]', { clickCount: 3 });
  await page.type('input[placeholder*="Search reference"]', TITLE);
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await settle(page, 500);
  const searchText = await textOf(page);
  const rows = await page.$$eval("table tbody tr", (items) => items.length);
  check(
    "search narrows the procurement list to the test RFQ",
    searchText.includes(rfqA.reference) && rows === 1 && /open now/i.test(searchText),
    `${rows} row(s)`,
  );
  await shot(page, "13-rfq-list-search.png");

  await page.click('input[placeholder*="Search reference"]', { clickCount: 3 });
  await page.type('input[placeholder*="Search reference"]', "zzz-no-such-rfq-e2e");
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await settle(page, 500);
  const noMatchText = await textOf(page);
  check("no-match search shows an informative empty state", noMatchText.includes("No RFQs match those filters"));
  await shot(page, "14-rfq-list-empty.png");

  await clickText(page, "button", "Clear filters");
  await settle(page, 500);
  await setSelect(page, 'select[aria-label="Sort RFQs"]', "reference");
  await settle(page, 500);
  const sortedRefs = await page.$$eval("table tbody tr td:first-child .font-mono", (nodes) =>
    nodes.map((node) => node.textContent.trim()),
  );
  check(
    "reference sort orders the list ascending",
    sortedRefs.length > 1 && [...sortedRefs].sort().join(",") === sortedRefs.join(","),
    sortedRefs.slice(0, 4).join(", "),
  );

  // =========================================================================
  section("F. Authorization and negative API checks");
  // =========================================================================
  check(
    "anonymous users get 401 on RFQ and quotation data",
    (await anon("GET", "/rfqs")).status === 401 &&
      (await anon("GET", `/rfqs/${rfqA.id}`)).status === 401 &&
      (await anon("GET", `/rfqs/${rfqA.id}/comparison`)).status === 401 &&
      (await anon("POST", "/rfqs", { title: "x" })).status === 401 &&
      (await anon("PUT", `/rfqs/${rfqA.id}/quotation`, {})).status === 401,
  );

  const vendorCreate = await nova("POST", "/rfqs", rfqBody({ title: `${PREFIX} Forbidden ${stamp}`, vendorIds: [] }));
  const vendorEdit = await nova("PUT", `/rfqs/${rfqA.id}`, rfqBody({ title: "hacked", vendorIds: [] }));
  const vendorPublish = await nova("POST", `/rfqs/${rfqA.id}/publish`);
  const vendorClose = await nova("POST", `/rfqs/${rfqA.id}/close`);
  const vendorAssign = await nova("PUT", `/rfqs/${rfqA.id}/vendors`, { vendorIds: [novaVendor.id] });
  check(
    "vendors cannot create, edit, publish, close or assign RFQs",
    [vendorCreate, vendorEdit, vendorPublish, vendorClose, vendorAssign].every((response) => response.status === 403),
    [vendorCreate, vendorEdit, vendorPublish, vendorClose, vendorAssign].map((r) => r.status).join(","),
  );

  check(
    "vendor cannot read or submit against an unassigned RFQ",
    (await nova("GET", `/rfqs/${rfqB.id}`)).status === 404 &&
      (await nova("PUT", `/rfqs/${rfqB.id}/quotation`, {
        deliveryDays: 3,
        items: rfqB.items.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
      })).status === 403,
  );

  const tampered = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 15,
    deliveryTerms: "Tampered terms",
    notes: "Nova revision 2 with tampered ownership fields.",
    taxPercent: "18",
    shippingAmount: "1600",
    vendorId: apexVendor.id,
    rfqId: rfqB.id,
    currency: "USD",
    total: "1",
    subtotal: "1",
    submittedAt: "2000-01-01T00:00:00.000Z",
    items: [
      { rfqItemId: items[0].id, unitPrice: "1250", lineTotal: "1" },
      { rfqItemId: items[1].id, unitPrice: "340", lineTotal: "1" },
    ],
  });
  check(
    "tampered vendor/currency/total/timestamp fields are ignored (revision policy)",
    tampered.status === 200 &&
      tampered.body.quotation.vendorId === novaVendor.id &&
      tampered.body.quotation.rfqId === rfqA.id &&
      tampered.body.quotation.currency === "INR" &&
      tampered.body.quotation.total === "18356.00" &&
      tampered.body.quotation.revision === 2,
    `status ${tampered.status} total ${tampered.body?.quotation?.total}`,
  );
  check(
    "a vendor's revised quotation does not expose the other vendor's data",
    !JSON.stringify(tampered.body).includes("16004") &&
      !JSON.stringify(tampered.body).includes("Zenith E2E quote") &&
      !JSON.stringify((await nova("GET", `/rfqs/${rfqA.id}`)).body).includes("16004"),
  );

  await page.goto(`${BASE}/rfqs/${rfqA.id}/compare`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(page);
  const comparisonAfterRevision = await textOf(page);
  const comparisonAfterApi = await procurement("GET", `/rfqs/${rfqA.id}/comparison`);
  check(
    "comparison reflects the saved revision with live server data",
    comparisonAfterRevision.includes("18,356.00") &&
      comparisonAfterRevision.includes("1,250.00") &&
      comparisonAfterRevision.includes("15 day(s)") &&
      comparisonAfterApi.body.summary.lowestTotal === "16004.00" &&
      comparisonAfterApi.body.lowest.vendorId === zenithVendor.id,
  );
  await shot(page, "16-comparison-after-revision.png");

  const novaRelogin = await newBrowserSession(browser, accounts.nova);
  await novaRelogin.page.goto(`${BASE}/rfqs/${rfqA.id}`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(novaRelogin.page);
  const reloginText = await textOf(novaRelogin.page);
  check(
    "a new sign-in still sees the persisted quotation revision",
    reloginText.includes("18,356.00") &&
      reloginText.includes("Revision 2") &&
      !reloginText.toLowerCase().includes("zenith"),
  );
  await shot(novaRelogin.page, "17-vendor-relogin-persistence.png");
  await novaRelogin.context.close();

  const rfqCountBeforeValidation = await prisma.rfq.count();
  const pastDeadline = await procurement("POST", "/rfqs", {
    ...rfqBody({ title: `${PREFIX} Past deadline ${stamp}`, vendorIds: [novaVendor.id] }),
    deadline: new Date(Date.now() - 3600_000).toISOString(),
  });
  const noItems = await procurement("POST", "/rfqs", {
    ...rfqBody({ title: `${PREFIX} No items ${stamp}`, vendorIds: [novaVendor.id] }),
    items: [],
  });
  const duplicateVendors = await procurement("POST", "/rfqs", rfqBody({
    title: `${PREFIX} Duplicate vendors ${stamp}`,
    vendorIds: [novaVendor.id, novaVendor.id],
  }));
  const missingVendor = await procurement("POST", "/rfqs", rfqBody({
    title: `${PREFIX} Missing vendor ${stamp}`,
    vendorIds: [9999999],
  }));
  const rfqCountAfterValidation = await prisma.rfq.count();
  check(
    "past deadlines, empty line items, duplicate or unknown vendors are rejected without creating an RFQ",
    [pastDeadline, noItems, duplicateVendors, missingVendor].every((response) => response.status === 422) &&
      rfqCountBeforeValidation === rfqCountAfterValidation,
    [pastDeadline, noItems, duplicateVendors, missingVendor].map((r) => r.status).join(",") +
      ` (rows ${rfqCountBeforeValidation}->${rfqCountAfterValidation})`,
  );

  // Captured with the valid revision already saved: everything below is a
  // payload the API must reject, and none of them may add, remove or rewrite a
  // row — append-only history included.
  const quoteRowsBefore = await prisma.quotation.count({ where: { rfqId: rfqA.id } });
  const liveQuoteCountBefore = await prisma.quotation.count({
    where: { rfqId: rfqA.id, vendorId: novaVendor.id, supersededAt: null },
  });
  const totalBefore = (
    await prisma.quotation.findFirst({
      where: { rfqId: rfqA.id, vendorId: novaVendor.id, supersededAt: null },
      select: { total: true },
    })
  ).total.toFixed(2);

  const missingPrice = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 4,
    items: [{ rfqItemId: items[0].id, unitPrice: "100" }],
  });
  const negativePrice = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 4,
    items: [
      { rfqItemId: items[0].id, unitPrice: "-5" },
      { rfqItemId: items[1].id, unitPrice: "10" },
    ],
  });
  const malformedPrice = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 4,
    items: [
      { rfqItemId: items[0].id, unitPrice: "not-a-number" },
      { rfqItemId: items[1].id, unitPrice: "10" },
    ],
  });
  const foreignItem = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 4,
    items: [
      { rfqItemId: rfqB.items[0].id, unitPrice: "10" },
      { rfqItemId: items[1].id, unitPrice: "10" },
    ],
  });
  const badTax = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 4,
    taxPercent: "101",
    items: items.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
  });
  check(
    "invalid quotation payloads are rejected with 422",
    [missingPrice, negativePrice, malformedPrice, foreignItem, badTax].every((response) => response.status === 422),
    [missingPrice, negativePrice, malformedPrice, foreignItem, badTax].map((r) => r.status).join(","),
  );

  const quoteRowsAfter = await prisma.quotation.count({ where: { rfqId: rfqA.id } });
  const liveQuoteCountAfter = await prisma.quotation.count({
    where: { rfqId: rfqA.id, vendorId: novaVendor.id, supersededAt: null },
  });
  const totalAfter = (
    await prisma.quotation.findFirst({
      where: { rfqId: rfqA.id, vendorId: novaVendor.id, supersededAt: null },
      select: { total: true },
    })
  ).total.toFixed(2);
  check(
    "rejected submissions did not mutate the database",
    quoteRowsBefore === quoteRowsAfter &&
      liveQuoteCountBefore === liveQuoteCountAfter &&
      totalBefore === totalAfter &&
      totalAfter === "18356.00",
    `rows ${quoteRowsBefore}->${quoteRowsAfter}, live bids for Nova ${liveQuoteCountBefore}->${liveQuoteCountAfter}, ` +
      `Nova total ${totalBefore}->${totalAfter}`,
  );
  check(
    "one live quotation per vendor despite append-only revisions",
    (await prisma.quotation.count({ where: { rfqId: rfqA.id, vendorId: novaVendor.id, supersededAt: null } })) === 1,
  );
  const novaRevisions = await prisma.quotation.findMany({
    where: { rfqId: rfqA.id, vendorId: novaVendor.id },
    include: { items: true },
    orderBy: { revision: "asc" },
  });
  check(
    "superseded revisions keep their line items (append-only audit trail)",
    novaRevisions.length === 2 &&
      novaRevisions[0].supersededAt !== null &&
      novaRevisions[0].items.length > 0 &&
      novaRevisions[1].supersededAt === null,
    novaRevisions.map((row) => `rev ${row.revision} items ${row.items.length} superseded ${row.supersededAt !== null}`).join("; "),
  );

  check(
    "invalid RFQ ids and unknown filters are rejected",
    (await procurement("GET", "/rfqs/not-a-number")).status === 404 &&
      (await procurement("GET", "/rfqs/99999999")).status === 404 &&
      (await procurement("GET", "/rfqs?status=bogus")).status === 422 &&
      (await procurement("GET", `/rfqs/${rfqA.id}/quotations?sort=bogus`)).status === 400,
  );

  const republish = await procurement("POST", `/rfqs/${rfqA.id}/publish`);
  const closeDraft = await procurement("POST", `/rfqs/${rfqDraft.id}/close`);
  const editPublished = await procurement("PUT", `/rfqs/${rfqA.id}`, rfqBody({ title: "edited", vendorIds: [novaVendor.id] }));
  const reassignPublished = await procurement("PUT", `/rfqs/${rfqA.id}/vendors`, { vendorIds: [novaVendor.id] });
  check(
    "invalid lifecycle transitions are rejected with 409",
    [republish, closeDraft, editPublished, reassignPublished].every((response) => response.status === 409),
    [republish, closeDraft, editPublished, reassignPublished].map((r) => r.status).join(","),
  );

  const draftVendorGet = await nova("GET", `/rfqs/${rfqDraft.id}`);
  const draftSubmit = await nova("PUT", `/rfqs/${rfqDraft.id}/quotation`, {
    deliveryDays: 2,
    items: rfqDraft.items.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
  });
  check(
    "draft RFQs are invisible to vendors and reject submissions",
    draftVendorGet.status === 404 && draftSubmit.status === 409,
    `GET ${draftVendorGet.status}, PUT ${draftSubmit.status}`,
  );

  const cancelResponse = await procurement("POST", `/rfqs/${rfqCancelled.id}/cancel`);
  const cancelledSubmit = await nova("PUT", `/rfqs/${rfqCancelled.id}/quotation`, {
    deliveryDays: 2,
    items: rfqCancelled.items.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
  });
  check(
    "cancelled RFQs reject submissions",
    cancelResponse.status === 200 && cancelledSubmit.status === 409,
    `cancel ${cancelResponse.status}, submit ${cancelledSubmit.status}`,
  );

  // Expiry: move only this run's disposable test RFQ deadline into the past.
  await prisma.rfq.update({ where: { id: rfqE.id }, data: { deadline: new Date(Date.now() - 60_000) } });
  const expiredDetail = await nova("GET", `/rfqs/${rfqE.id}`);
  const expiredSubmit = await nova("PUT", `/rfqs/${rfqE.id}/quotation`, {
    deliveryDays: 2,
    items: rfqE.items.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
  });
  check(
    "expired RFQ reports the reason and rejects submissions with 409",
    expiredDetail.body.submission.canSubmit === false &&
      /deadline has passed/i.test(expiredDetail.body.submission.reason) &&
      expiredSubmit.status === 409 &&
      expiredSubmit.body.error.code === "rfq_expired",
    `submit ${expiredSubmit.status}/${expiredSubmit.body?.error?.code}`,
  );
  await novaPage.goto(`${BASE}/rfqs/${rfqE.id}/quotation`, { waitUntil: "networkidle0" });
  await settle(novaPage);
  const expiredText = await textOf(novaPage);
  check(
    "expired RFQ quotation page is locked in the UI",
    expiredText.includes("not accepting quotations") && expiredText.includes("deadline has passed"),
  );
  await shot(novaPage, "15-expired-quotation-locked.png");

  // Close RFQ A and verify submissions are refused afterwards.
  const closeA = await procurement("POST", `/rfqs/${rfqA.id}/close`);
  const afterClose = await nova("PUT", `/rfqs/${rfqA.id}/quotation`, {
    deliveryDays: 2,
    items: items.map((item) => ({ rfqItemId: item.id, unitPrice: "999" })),
  });
  const novaAfterClose = await nova("GET", `/rfqs/${rfqA.id}`);
  check(
    "closing an RFQ stops new submissions (409) and keeps quotations readable",
    closeA.status === 200 &&
      afterClose.status === 409 &&
      novaAfterClose.body.myQuotation.total === "18356.00" &&
      novaAfterClose.body.submission.canSubmit === false,
    `close ${closeA.status}, submit ${afterClose.status}`,
  );

  check(
    "authenticated RFQ responses are not publicly cacheable",
    (await procurement("GET", "/rfqs")).cacheControl === "no-store" &&
      (await procurement("GET", `/rfqs/${rfqA.id}/quotations`)).cacheControl === "no-store" &&
      (await nova("GET", `/rfqs/${rfqA.id}`)).cacheControl === "no-store",
  );

  const vendorScope = await nova("GET", "/rfqs?pageSize=100");
  check(
    "vendor RFQ listing is scoped to assigned RFQs only",
    vendorScope.body.items.every((entry) => entry.id !== rfqB.id) &&
      vendorScope.body.items.some((entry) => entry.id === rfqA.id),
  );
  check(
    "vendor listing pagination cannot widen access",
    (await nova("GET", "/rfqs?page=1&pageSize=1")).body.items.every((entry) => entry.id !== rfqB.id),
  );

  // =========================================================================
  section("G. Database persistence and integrity");
  // =========================================================================
  const dbRfq = await prisma.rfq.findUnique({
    where: { id: rfqA.id },
    include: {
      items: { orderBy: { position: "asc" } },
      assignments: true,
      quotations: { include: { items: true } },
    },
  });
  // Append-only: a revision leaves the superseded bid in the table, so select
  // the live row per vendor rather than assuming one row per vendor.
  const dbNova = dbRfq.quotations.find(
    (quotation) => quotation.vendorId === novaVendor.id && quotation.supersededAt === null,
  );
  const dbZenith = dbRfq.quotations.find(
    (quotation) => quotation.vendorId === zenithVendor.id && quotation.supersededAt === null,
  );
  const dbNovaSuperseded = dbRfq.quotations.filter(
    (quotation) => quotation.vendorId === novaVendor.id && quotation.supersededAt !== null,
  );
  check(
    "database holds the RFQ with its unique reference and 2 items",
    dbRfq.reference === rfqA.reference &&
      dbRfq.items.length === 2 &&
      dbRfq.items[0].quantity.toFixed(3) === "10.000" &&
      dbRfq.items[1].quantity.toFixed(3) === "5.000",
  );
  check(
    "exactly two assignment rows point at the two assigned vendors",
    dbRfq.assignments.length === 2 &&
      new Set(dbRfq.assignments.map((row) => row.vendorId)).size === 2 &&
      dbRfq.assignments.every((row) => [novaVendor.id, zenithVendor.id].includes(row.vendorId)),
  );
  check(
    "live quotation rows link to the correct RFQ and vendors",
    Boolean(dbNova) &&
      Boolean(dbZenith) &&
      dbNova.rfqId === rfqA.id &&
      dbZenith.rfqId === rfqA.id &&
      dbNova.vendorId === novaVendor.id &&
      dbZenith.vendorId === zenithVendor.id,
  );
  check(
    "the superseded Nova revision is retained for audit",
    dbNovaSuperseded.length === 1 &&
      dbNovaSuperseded[0].revision === 1 &&
      dbNovaSuperseded[0].items.length === 2 &&
      dbNovaSuperseded[0].rfqId === rfqA.id,
    `superseded revisions for Nova: ${dbNovaSuperseded.map((q) => `rev ${q.revision} items ${q.items.length}`).join(", ")}`,
  );
  check(
    "stored prices, totals, notes and delivery data match the submissions",
    dbNova.total.toFixed(2) === "18356.00" &&
      dbNova.revision === 2 &&
      dbNova.deliveryDays === 15 &&
      dbNova.notes === "Nova revision 2 with tampered ownership fields." &&
      dbNova.subtotal.toFixed(2) === "14200.00" &&
      dbNova.taxAmount.toFixed(2) === "2556.00" &&
      dbNova.shippingAmount.toFixed(2) === "1600.00" &&
      dbNova.items.length === 2 &&
      dbNova.items.some((line) => line.unitPrice.toFixed(2) === "1250.00" && line.lineTotal.toFixed(2) === "12500.00") &&
      dbZenith.total.toFixed(2) === "16004.00" &&
      dbZenith.revision === 1 &&
      dbZenith.deliveryDays === 9 &&
      dbZenith.notes === "Zenith E2E quote: 9-day dispatch.",
  );
  check(
    "RFQ status reflects publish then close, with timestamps",
    dbRfq.status === "closed" &&
      Boolean(dbRfq.publishedAt) &&
      Boolean(dbRfq.closedAt) &&
      dbRfq.publishedAt <= dbRfq.closedAt,
  );
  const orphanRows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM quotation_items qi LEFT JOIN quotations q ON q.id = qi.quotation_id WHERE q.id IS NULL",
  );
  const duplicateRows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*)::int AS count FROM (SELECT quotation_id, rfq_item_id FROM quotation_items WHERE quotation_id IN (" +
      dbRfq.quotations.map((q) => q.id).join(",") +
      ") GROUP BY quotation_id, rfq_item_id HAVING COUNT(*) > 1) dup",
  );
  check(
    "no orphaned or duplicated quotation line items",
    orphanRows[0].count === 0 && duplicateRows[0].count === 0,
    `orphans ${orphanRows[0].count}, duplicates ${duplicateRows[0].count}`,
  );
  check(
    "revision advanced in place: one live row plus one superseded row per vendor",
    dbNova.revision === 2 &&
      dbRfq.quotations.length === 3 &&
      dbRfq.quotations.filter((q) => q.supersededAt === null).length === 2,
    `total rows ${dbRfq.quotations.length}, live ${dbRfq.quotations.filter((q) => q.supersededAt === null).length}`,
  );

  check(
    "no browser runtime errors were observed",
    proc.pageErrors.length === 0 && novaSession.pageErrors.length === 0 && zenSession.pageErrors.length === 0,
    [...proc.pageErrors, ...novaSession.pageErrors, ...zenSession.pageErrors].join("; "),
  );
  const failedDbErrors = results.filter((result) => result.status === "FAIL");

  // =========================================================================
  section("H. Cleanup");
  // =========================================================================
  const removed = await prisma.rfq.deleteMany({ where: { title: { startsWith: PREFIX, contains: stamp } } });
  const remaining = await prisma.rfq.count({ where: { title: { startsWith: PREFIX, contains: stamp } } });
  const [users, vendorsLeft, quotationsLeft, liveLeft] = await Promise.all([
    prisma.user.count(),
    prisma.vendor.count(),
    prisma.quotation.count(),
    prisma.quotation.count({ where: { supersededAt: null } }),
  ]);
  // Append-only allows a delete only through the RFQ cascade (an RFQ that no
  // longer exists cannot be the subject of a live bid). Deleting this run's
  // RFQs must therefore take their whole quotation history with them and leave
  // the register exactly as it was before the run.
  const surviving = await prisma.quotation.findMany({
    where: { id: { in: created.quotationIds } },
    select: { id: true, supersededAt: true },
  });
  check(
    "test RFQs and their quotation history were removed",
    remaining === 0 && surviving.length === 0,
    `${removed.count} RFQ(s) removed, surviving quotation rows ${surviving.length}/${created.quotationIds.length}`,
  );
  check(
    "the run left the register exactly as it found it",
    users === baseline.users &&
      vendorsLeft === baseline.vendors &&
      quotationsLeft === baseline.quotations &&
      liveLeft === baseline.liveQuotations,
    `users ${baseline.users}->${users}, vendors ${baseline.vendors}->${vendorsLeft}, ` +
      `quotations ${baseline.quotations}->${quotationsLeft}, live ${baseline.liveQuotations}->${liveLeft}`,
  );

  const passed = results.filter((result) => result.status === "PASS").length;
  const failed = results.filter((result) => result.status === "FAIL").length;
  console.log(`\n${passed} passed, ${failed} failed`);

  const report = {
    startedAt: new Date().toISOString(),
    appUrl: BASE,
    database: `${identity[0].db}@${parsedDb.hostname}:${parsedDb.port}`,
    rfq: {
      id: rfqA.id,
      reference: rfqA.reference,
      title: TITLE,
      items: rfqA.items.map((item) => ({ id: item.id, description: item.description, quantity: item.quantity, unit: item.unit })),
      vendors: [novaVendor.name, zenithVendor.name],
      quotations: [
        { vendor: novaVendor.name, total: "18356.00", revision: 2, deliveryDays: 15 },
        { vendor: zenithVendor.name, total: "16004.00", revision: 1, deliveryDays: 9 },
      ],
      lowest: zenithVendor.name,
    },
    results,
    cleanup: { removedRfqs: removed.count, remainingRfqs: remaining, users, vendors: vendorsLeft, quotations: quotationsLeft },
  };
  await writeFile(path.join(OUT, "results.json"), JSON.stringify(report, null, 2));
  console.log(`Evidence written to ${path.join(OUT, "results.json")}`);

  if (failed > 0) process.exitCode = 1;
  if (failedDbErrors.length > 0) {
    console.log("Failed checks:");
    for (const failure of failedDbErrors) console.log(` - ${failure.name}`);
  }
} catch (error) {
  console.error("\nE2E verification aborted:", error.message);
  console.error(error.stack);
  process.exitCode = 1;
  const leftover = await prisma.rfq
    .deleteMany({ where: { title: { startsWith: PREFIX, contains: stamp } } })
    .catch(() => ({ count: 0 }));
  console.log(`Cleaned up ${leftover.count} RFQ(s) from the aborted run.`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await prisma.$disconnect().catch(() => {});
}
