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

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  args: ["--hide-scrollbars", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

try {
  const guest = await openPage(browser);
  await capture(guest, "/login", "01-login.png");
  await capture(guest, "/register", "02-register.png");
  await capture(guest, "/forgot-password", "03-forgot-password.png");

  const procurement = await openPage(browser, await sessionToken(accounts.procurement));
  await capture(procurement, "/dashboard", "04-dashboard.png");
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

  const vendor = await openPage(browser, await sessionToken(accounts.vendor));
  await capture(vendor, "/dashboard", "09-vendor-dashboard.png");
} finally {
  await browser.close();
}
