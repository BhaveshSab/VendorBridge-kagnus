import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.APP_URL || "http://localhost:4000";
const OUT = path.resolve("docs/screenshots");
const BROWSER_PATH =
  process.env.CHROME_PATH || "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe";
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 };

const accounts = {
  procurement: { email: "procurement@vendorbridge.dev", password: "Procure@123" },
  vendor: { email: "vendor@vendorbridge.dev", password: "Vendor@123" },
  zenith: { email: "zenith@vendorbridge.dev", password: "Vendor@123" },
  apex: { email: "apex@vendorbridge.dev", password: "Vendor@123" },
};

async function sessionToken(account) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(account),
  });
  if (!res.ok) throw new Error(`Login failed for ${account.email}: ${res.status}`);
  const header = res.headers.getSetCookie().find((value) => value.startsWith("vb_token="));
  return header.split(";")[0].slice("vb_token=".length);
}

async function api(token, method, route, body) {
  const res = await fetch(`${BASE}/api${route}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${method} ${route} failed with ${res.status}: ${json?.error?.message ?? text}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Real demo data for the Week 2 screenshots. Rows are written through the same
// authenticated API the product uses — no fixtures are injected into the UI.
// ---------------------------------------------------------------------------
async function ensureDemoRfq() {
  const procurementToken = await sessionToken(accounts.procurement);
  const register = await api(procurementToken, "GET", "/vendors?pageSize=100");
  const byName = (name) => register.items.find((vendor) => vendor.name === name);
  const nova = byName("Nova Office Supplies");
  const zenith = byName("Zenith IT Solutions");
  const apex = byName("Apex Hardware");
  if (!nova || !zenith || !apex) {
    throw new Error(
      "The seeded demo vendors (Nova, Zenith, Apex) are missing. Run `npm run seed` against an empty development database first.",
    );
  }

  const existing = await api(procurementToken, "GET", "/rfqs?search=Office%20furniture%20procurement&status=open&pageSize=5");
  let rfq = existing.items[0];
  if (!rfq) {
    const created = await api(procurementToken, "POST", "/rfqs", {
      title: "Office furniture procurement — Q2",
      description:
        "Ergonomic seating and height-adjustable desks for the Bengaluru office. Deliver to the 4th floor reception, freight included.",
      currency: "INR",
      deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      vendorIds: [nova.id, zenith.id, apex.id],
      items: [
        {
          description: "Ergonomic mesh office chair",
          quantity: 20,
          unit: "unit",
          specifications: "Adjustable lumbar support, 5-year warranty",
        },
        {
          description: "Height-adjustable standing desk",
          quantity: 10,
          unit: "unit",
          specifications: "120 × 70 cm, dual motor",
        },
        {
          description: "Monitor arm",
          quantity: 10,
          unit: "unit",
          specifications: "Single 32-inch display, clamp mount",
        },
      ],
    });
    rfq = created.rfq;
    await api(procurementToken, "POST", `/rfqs/${rfq.id}/publish`);
  }

  const detail = await api(procurementToken, "GET", `/rfqs/${rfq.id}`);
  const items = detail.rfq.items;
  const quotes = [
    { account: accounts.vendor, prices: [4200, 18500, 3200], tax: "18", shipping: "1500", days: 12 },
    { account: accounts.zenith, prices: [3980, 17900, 3450], tax: "18", shipping: "2500", days: 9 },
    { account: accounts.apex, prices: [4400, 17200, 3100], tax: "18", shipping: "1000", days: 15 },
  ];
  for (const quote of quotes) {
    const token = await sessionToken(quote.account);
    await api(token, "PUT", `/rfqs/${rfq.id}/quotation`, {
      deliveryDays: quote.days,
      deliveryTerms: "Freight included, delivered to site",
      notes: "Prices valid for 30 days. Installation scheduled after delivery.",
      taxPercent: quote.tax,
      shippingAmount: quote.shipping,
      items: items.map((item, index) => ({ rfqItemId: item.id, unitPrice: quote.prices[index] })),
    });
  }

  return { rfqId: rfq.id, procurementToken, vendorToken: await sessionToken(accounts.vendor) };
}

async function openPage(browser, token) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  if (token) {
    await page.setCookie({ name: "vb_token", value: token, domain: "localhost", path: "/" });
  }
  page.on("pageerror", (error) => console.error(`page error: ${error.message}`));
  return page;
}

async function settle(page, delay = 700) {
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function capture(page, route, file) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(page);
  await page.screenshot({ path: path.join(OUT, file), fullPage: false });
  console.log(`captured ${file}`);
}

async function shot(page, file, { fullPage = false } = {}) {
  await settle(page);
  await page.screenshot({ path: path.join(OUT, file), fullPage });
  console.log(`captured ${file}`);
}

await mkdir(OUT, { recursive: true });

const { rfqId, procurementToken, vendorToken } = await ensureDemoRfq();
console.log(`demo RFQ ready: ${rfqId}`);

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  // --- Week 1 screens ------------------------------------------------------
  const guest = await openPage(browser);
  await capture(guest, "/login", "01-login.png");
  await capture(guest, "/register", "02-register.png");
  await capture(guest, "/forgot-password", "03-forgot-password.png");

  const procurement = await openPage(browser, procurementToken);
  await capture(procurement, "/dashboard", "04-dashboard.png");
  await procurement.click('button[aria-label="Notifications"]');
  await procurement.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await settle(procurement, 500);
  await shot(procurement, "37-week4-notifications.png");
  await procurement.keyboard.press("Escape").catch(() => {});
  await capture(procurement, "/vendors", "05-vendors.png");

  await procurement.goto(`${BASE}/vendors?new=1`, { waitUntil: "networkidle0", timeout: 45000 });
  await procurement.waitForSelector('[role="dialog"]', { timeout: 8000 }).catch(() => {});
  await settle(procurement);
  await procurement.screenshot({ path: path.join(OUT, "06-vendor-form.png"), fullPage: false });
  console.log("captured 06-vendor-form.png");

  await procurement.goto(`${BASE}/vendors`, { waitUntil: "networkidle0", timeout: 45000 });
  await settle(procurement, 400);
  await procurement.click("tbody tr");
  await settle(procurement, 900);
  await procurement.screenshot({ path: path.join(OUT, "07-vendor-detail.png"), fullPage: false });
  console.log("captured 07-vendor-detail.png");

  await capture(procurement, "/profile", "08-profile.png");

  // --- Week 2 screens ------------------------------------------------------
  await capture(procurement, "/rfqs", "10-rfq-list.png");
  await capture(procurement, `/rfqs/${rfqId}`, "11-rfq-detail.png");
  await capture(procurement, `/rfqs/${rfqId}/quotations`, "12-quotations.png");
  await capture(procurement, `/rfqs/${rfqId}/compare`, "13-quotation-comparison.png");

  await procurement.goto(`${BASE}/rfqs/new`, { waitUntil: "networkidle0", timeout: 45000 });
  try {
    await procurement.waitForSelector("#rfq-title", { timeout: 20000 });
  } catch (error) {
    const diagnostics = await procurement.evaluate(async () => {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      return {
        me: response.status,
        role: (await response.json().catch(() => null))?.user?.role ?? null,
        h1: Array.from(document.querySelectorAll("h1")).map((node) => node.textContent),
        body: document.body.innerText.slice(0, 300),
      };
    });
    console.error("create RFQ page diagnostics", JSON.stringify(diagnostics));
    throw error;
  }
  await settle(procurement);
  await procurement.type("#rfq-title", "IT hardware refresh — FY26");
  await procurement.type("#rfq-description", "Laptops and docking stations for the Bengaluru and Pune offices.");
  const firstItem = await procurement.$('input[id$="-description"]');
  if (firstItem) await firstItem.type("14-inch business laptop");
  await shot(procurement, "14-create-rfq.png", { fullPage: true });

  // --- Week 4 screens ------------------------------------------------------
  await capture(procurement, "/reports", "33-week4-reports.png");
  await procurement.select('select[aria-label="Reporting period"]', "365");
  await settle(procurement, 1000);
  await shot(procurement, "34-week4-reports-trend.png", { fullPage: true });
  await capture(procurement, "/activity", "35-week4-activity.png");
  await procurement.select('select[aria-label="Filter by record type"]', "purchase_order");
  await settle(procurement, 1000);
  await shot(procurement, "35-week4-activity.png");
  await procurement.click("tbody tr");
  await settle(procurement, 1200);
  await shot(procurement, "36-week4-audit-detail.png");

  // Cookies are shared across pages in one browser, so the vendor session is
  // established only after every procurement capture is finished.
  const vendor = await openPage(browser, vendorToken);
  await capture(vendor, "/dashboard", "09-vendor-dashboard.png");
  await capture(vendor, "/rfqs", "15-vendor-rfq-list.png");
  await capture(vendor, `/rfqs/${rfqId}/quotation`, "16-vendor-quotation-form.png");
  await capture(vendor, `/rfqs/${rfqId}`, "17-vendor-rfq-detail.png");
} finally {
  await browser.close();
}
