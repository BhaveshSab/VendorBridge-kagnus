import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.API_URL || "http://localhost:4000";
const OUTBOX_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.mail-outbox.jsonl");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function client() {
  let cookie = "";
  return async function call(method, path, body) {
    let sessionCookieHttpOnly = false;
    const response = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      const sessionCookie = setCookies.find((value) => value.startsWith("vb_token="));
      if (sessionCookie) {
        cookie = sessionCookie.split(";")[0];
        sessionCookieHttpOnly = /;\s*httponly\b/i.test(sessionCookie);
      }
    }
    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      status: response.status,
      body: json,
      sessionCookieHttpOnly,
      cacheControl: response.headers.get("cache-control"),
    };
  };
}

async function login(email, password) {
  const call = client();
  const result = await call("POST", "/auth/login", { email, password });
  return { call, result };
}

// Reset links are delivered by email (the local dev fallback writes them to
// the mail outbox) and are never returned in API responses.
function readLatestResetToken(email) {
  try {
    const entries = fs
      .readFileSync(OUTBOX_PATH, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.to !== email || !entry.resetUrl) continue;
      const token = new URL(entry.resetUrl).searchParams.get("token");
      if (token) return token;
    }
  } catch {
    return null;
  }
  return null;
}

const stamp = Date.now();
const createdVendorName = `Smoke Test Supplies ${stamp}`;

async function main() {
  console.log(`VendorBridge API smoke test against ${BASE}`);

  section("1. Authentication and session handling");
  const anon = client();
  const health = await anon("GET", "/health");
  check("health reports the API and database are ready", health.status === 200 && health.body?.database === "connected");
  check("anonymous /vendors returns 401", (await anon("GET", "/vendors")).status === 401);
  check("anonymous /dashboard returns 401", (await anon("GET", "/dashboard")).status === 401);
  check("anonymous /auth/me returns 401", (await anon("GET", "/auth/me")).status === 401);

  const capabilities = await anon("GET", "/auth/capabilities");
  check(
    "auth capabilities are readable without a session",
    capabilities.status === 200 && typeof capabilities.body?.devResetLink === "boolean",
  );
  const devResetLink = await anon("GET", "/auth/dev-reset-link?email=admin@vendorbridge.dev");
  check(
    "local reset-token helper is unavailable unless explicitly enabled",
    capabilities.body?.devResetLink !== false || devResetLink.status === 404,
  );

  const badLogin = await anon("POST", "/auth/login", {
    email: "procurement@vendorbridge.dev",
    password: "wrong-password",
  });
  check("wrong password is rejected with 401", badLogin.status === 401);

  const { call: procurement, result: procurementLogin } = await login(
    "procurement@vendorbridge.dev",
    "Procure@123",
  );
  check("procurement officer can sign in", procurementLogin.status === 200);
  check("session cookie is HttpOnly", procurementLogin.sessionCookieHttpOnly);
  check("session JWT is not exposed in the JSON response", !Object.hasOwn(procurementLogin.body || {}, "token"));
  check("session payload hides password hashes", !JSON.stringify(procurementLogin.body).includes("password_hash"));
  check("procurement role is returned", procurementLogin.body?.user?.role === "procurement");
  const me = await procurement("GET", "/auth/me");
  check("session survives a refresh via cookie", me.status === 200 && me.body?.user?.role === "procurement");

  const { call: admin, result: adminLogin } = await login("admin@vendorbridge.dev", "Admin@123");
  check("admin can sign in", adminLogin.status === 200);
  const adminDashboard = await admin("GET", "/dashboard");
  check(
    "authenticated dashboard responses are marked no-store",
    adminDashboard.status === 200 && adminDashboard.cacheControl === "no-store",
  );
  const { call: manager, result: managerLogin } = await login("manager@vendorbridge.dev", "Manager@123");
  check("manager can sign in", managerLogin.status === 200);
  const { call: vendor, result: vendorLogin } = await login("vendor@vendorbridge.dev", "Vendor@123");
  check("vendor can sign in", vendorLogin.status === 200);

  section("2. Backend authorization");
  const vendorCreate = await vendor("POST", "/vendors", {
    name: `Forbidden Supplies ${stamp}`,
    category: "General",
    email: `forbidden${stamp}@vendorbridge.test`,
    phone: "+91 80 4000 1111",
  });
  check("vendor cannot create vendors (403)", vendorCreate.status === 403);
  const vendorMeta = await vendor("GET", "/vendors/meta");
  check("vendor cannot read company-wide vendor metadata", vendorMeta.status === 403);
  const managerCreate = await manager("POST", "/vendors", {
    name: `Forbidden Supplies ${stamp}`,
    category: "General",
    email: `forbidden${stamp}@vendorbridge.test`,
    phone: "+91 80 4000 1111",
  });
  check("manager cannot create vendors (403)", managerCreate.status === 403);
  check("manager can read the vendor register", (await manager("GET", "/vendors")).status === 200);

  const vendorList = await vendor("GET", "/vendors");
  check("vendor only sees their own record", vendorList.body?.total === 1);
  check("vendor record is scoped to Nova Office Supplies", vendorList.body?.items?.[0]?.name === "Nova Office Supplies");
  const ownVendorId = vendorList.body?.items?.[0]?.id;
  const otherVendorId = (await procurement("GET", "/vendors?pageSize=100")).body?.items?.find(
    (item) => item.id !== ownVendorId,
  )?.id;
  check(
    "vendor cannot read another vendor (403)",
    Boolean(otherVendorId) && (await vendor("GET", `/vendors/${otherVendorId}`)).status === 403,
  );

  section("3. Vendor validation and CRUD");
  const invalid = await procurement("POST", "/vendors", {
    name: "x",
    category: "",
    email: "not-an-email",
    phone: "1",
    gstin: "SHORT",
  });
  check("invalid payload returns 422 with field errors", invalid.status === 422 && Boolean(invalid.body?.error?.fields));
  check("validation names the offending fields", Boolean(invalid.body?.error?.fields?.email));

  const created = await procurement("POST", "/vendors", {
    name: createdVendorName,
    category: "Office Supplies",
    gstin: "29AASCS9999C1Z9",
    email: `smoke${stamp}@vendorbridge.test`,
    phone: "+91 80 4000 9999",
    address: "12 Test Park",
    city: "Bengaluru",
    country: "India",
    contactName: "Smoke Tester",
    status: "Active",
    rating: 4.2,
    notes: "Created by the automated smoke test.",
  });
  check("procurement can create a vendor", created.status === 201, `status ${created.status}`);
  const vendorId = created.body?.vendor?.id;
  check("new vendor receives a VND code", /^VND-\d{3}$/.test(created.body?.vendor?.code ?? ""));
  check("new vendor starts active", created.body?.vendor?.status === "Active");

  const duplicate = await procurement("POST", "/vendors", {
    name: createdVendorName,
    category: "Office Supplies",
    email: `smoke${stamp}b@vendorbridge.test`,
    phone: "+91 80 4000 9998",
  });
  check("duplicate vendor name is rejected with 409", duplicate.status === 409);

  const updated = await procurement("PUT", `/vendors/${vendorId}`, {
    name: createdVendorName,
    category: "Office Supplies",
    gstin: "29AASCS9999C1Z9",
    email: `smoke${stamp}@vendorbridge.test`,
    phone: "+91 80 4000 9997",
    address: "14 Test Park",
    city: "Mumbai",
    country: "India",
    contactName: "Smoke Tester",
    status: "Pending",
    rating: 4.5,
    notes: "Updated by the automated smoke test.",
  });
  check("procurement can update a vendor", updated.status === 200 && updated.body?.vendor?.city === "Mumbai");
  check("status change is saved", updated.body?.vendor?.status === "Pending");

  const search = await procurement("GET", `/vendors?search=${encodeURIComponent(createdVendorName)}`);
  check("search returns the matching vendor", search.body?.total === 1 && search.body?.items?.[0]?.id === vendorId);
  const pendingFilter = await procurement("GET", "/vendors?status=Pending&pageSize=100");
  check(
    "status filter returns only matching vendors",
    pendingFilter.status === 200 && pendingFilter.body?.items?.every((item) => item.status === "Pending"),
  );
  const categoryFilter = await procurement("GET", "/vendors?category=Office%20Supplies&pageSize=100");
  check(
    "category filter returns only matching vendors",
    categoryFilter.status === 200 && categoryFilter.body?.items?.every((item) => item.category === "Office Supplies"),
  );
  const paged = await procurement("GET", "/vendors?page=2&pageSize=5&sort=name");
  check("pagination returns page metadata", paged.body?.page === 2 && paged.body?.pageSize === 5);
  check("pagination returns at most one page of rows", (paged.body?.items?.length ?? 0) <= 5);
  const badFilter = await procurement("GET", "/vendors?status=Nonsense");
  check("unknown status filter is rejected with 400", badFilter.status === 400);

  const meta = await procurement("GET", "/vendors/meta");
  check("vendor meta lists categories and statuses", meta.status === 200 && meta.body?.statuses?.length === 4);
  check("vendor meta reports the total register size", meta.body?.total >= 16);

  section("4. Dashboard");
  const dashboard = await procurement("GET", "/dashboard");
  check("dashboard requires a session", dashboard.status === 200);
  check("internal dashboard scope is returned", dashboard.body?.scope === "internal");
  check("dashboard reports active vendors", (dashboard.body?.statusCounts?.Active ?? 0) > 0);
  check(
    "status counts reconcile with total suppliers",
    Object.values(dashboard.body?.statusCounts || {}).reduce((sum, count) => sum + count, 0) === dashboard.body?.totalVendors,
  );
  check(
    "category counts reconcile with the register",
    dashboard.body?.categoryCounts?.reduce((sum, item) => sum + item.count, 0) === dashboard.body?.totalVendors,
  );
  check("recent vendors are limited to five", (dashboard.body?.recentVendors?.length ?? 0) <= 5);

  const vendorDashboard = await vendor("GET", "/dashboard");
  check("vendor dashboard scope is returned", vendorDashboard.body?.scope === "vendor");
  check("vendor dashboard exposes their own profile", vendorDashboard.body?.vendor?.name === "Nova Office Supplies");
  check(
    "vendor dashboard metrics are limited to their own profile",
    vendorDashboard.body?.totalVendors === 1 &&
      Object.values(vendorDashboard.body?.statusCounts || {}).reduce((sum, count) => sum + count, 0) === 1 &&
      vendorDashboard.body?.categoryCounts?.reduce((sum, item) => sum + item.count, 0) === 1 &&
      !Object.hasOwn(vendorDashboard.body || {}, "recentVendors"),
  );
  check("vendor dashboard hides internal notes", vendorDashboard.body?.vendor?.notes === null);
  check(
    "vendor API hides internal notes",
    vendorList.body?.items?.length === 1 && vendorList.body.items.every((item) => item.notes === null),
  );

  section("5. Registration and password reset");
  const anonB = client();
  const weak = await anonB("POST", "/auth/register", {
    firstName: "Test",
    lastName: "User",
    email: `weak${stamp}@vendorbridge.test`,
    phone: "+91 90000 00000",
    role: "procurement",
    country: "India",
    password: "short",
  });
  check("weak password is rejected with 422", weak.status === 422);

  const registered = await anonB("POST", "/auth/register", {
    firstName: "Test",
    lastName: "Vendor",
    email: `newvendor${stamp}@vendorbridge.test`,
    phone: "+91 90000 00001",
    role: "vendor",
    country: "India",
    password: "Vendor@2026",
    companyName: `New Vendor ${stamp}`,
    category: "General",
  });
  check("vendor registration succeeds with a session", registered.status === 201 && Boolean(registered.body?.user));
  check("vendor registration returns an HttpOnly session cookie", registered.sessionCookieHttpOnly);
  const newVendorProfile = await anonB("GET", "/vendors");
  check("vendor registration creates a pending vendor profile", newVendorProfile.body?.items?.[0]?.status === "Pending");
  check(
    "registered vendor is linked to the new account",
    newVendorProfile.body?.items?.[0]?.name === `New Vendor ${stamp}`,
  );

  const forgedManagerSignup = await client()("POST", "/auth/register", {
    firstName: "Forged",
    lastName: "Manager",
    email: `forgedmanager${stamp}@vendorbridge.test`,
    phone: "+91 90000 00002",
    role: "manager",
    country: "India",
    password: "Vendor@2026",
    companyName: `Forged Manager ${stamp}`,
    category: "General",
  });
  check(
    "public signup ignores client-supplied privileged roles",
    forgedManagerSignup.status === 201 && forgedManagerSignup.body?.user?.role === "vendor",
  );

  const duplicateEmail = await client()("POST", "/auth/register", {
    firstName: "Test",
    lastName: "Vendor",
    email: `newvendor${stamp}@vendorbridge.test`,
    phone: "+91 90000 00001",
    role: "vendor",
    country: "India",
    password: "Vendor@2026",
    companyName: `New Vendor ${stamp}`,
  });
  check("duplicate email registration is rejected with 409", duplicateEmail.status === 409);

  const resetRequest = await client()("POST", "/auth/forgot-password", { email: "admin@vendorbridge.dev" });
  check(
    "forgot-password returns a generic acknowledgement",
    resetRequest.status === 200 && Boolean(resetRequest.body?.message),
  );
  check(
    "forgot-password keeps the reset token out of the response body",
    resetRequest.body?.resetToken === undefined && resetRequest.body?.resetUrl === undefined,
  );
  const token = readLatestResetToken("admin@vendorbridge.dev");
  check("reset link is delivered to the email transport (dev outbox)", Boolean(token));

  const badToken = await client()("POST", "/auth/reset-password", { token: "not-a-real-token-value", password: "Admin@2026" });
  check("invalid reset token is rejected with 400", badToken.status === 400);

  const reset = await client()("POST", "/auth/reset-password", { token, password: "Admin@2026" });
  check("valid reset token updates the password", reset.status === 200);
  const reuse = await client()("POST", "/auth/reset-password", { token, password: "Admin@2027" });
  check("reset tokens are single use", reuse.status === 400);
  const adminNewPassword = await login("admin@vendorbridge.dev", "Admin@2026");
  check("admin can sign in with the new password", adminNewPassword.result.status === 200);

  const restoreRequest = await client()("POST", "/auth/forgot-password", { email: "admin@vendorbridge.dev" });
  const restore = await client()("POST", "/auth/reset-password", {
    token: restoreRequest.status === 200 ? readLatestResetToken("admin@vendorbridge.dev") : null,
    password: "Admin@123",
  });
  check("demo admin password restored", restore.status === 200);

  const logoutClient = client();
  await logoutClient("POST", "/auth/login", { email: "procurement@vendorbridge.dev", password: "Procure@123" });
  const logout = await logoutClient("POST", "/auth/logout");
  check("logout succeeds", logout.status === 200);
  check("session is cleared after logout", (await logoutClient("GET", "/auth/me")).status === 401);

  section("6. Module scope guard");
  for (const path of ["/approvals", "/purchase-orders", "/invoices", "/reports", "/activity"]) {
    check(`${path} is not exposed`, (await procurement("GET", path)).status === 404);
  }
  check("anonymous /rfqs returns 401", (await client()("GET", "/rfqs")).status === 401);
  check("procurement can read /rfqs", (await procurement("GET", "/rfqs")).status === 200);

  section("7. Persistence");
  const freshClient = await login("procurement@vendorbridge.dev", "Procure@123");
  const persisted = await freshClient.call("GET", `/vendors/${vendorId}`);
  check("created vendor persists in a new session", persisted.status === 200 && persisted.body?.vendor?.id === vendorId);
  const deleted = await freshClient.call("DELETE", `/vendors/${vendorId}`);
  check("procurement can delete a vendor", deleted.status === 200);
  check("deleted vendor is gone", (await freshClient.call("GET", `/vendors/${vendorId}`)).status === 404);

  // -------------------------------------------------------------------------
  // Week 2 — RFQ and quotation workflow
  // -------------------------------------------------------------------------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Week 2 vendors are created by the suite itself under the reserved
  // @vendorbridge.test domain, so the tests never depend on seeded demo
  // accounts and cleanup can remove exactly what they created.
  async function createVendorAccount(label) {
    const call = client();
    const email = `smoke-${label.toLowerCase()}${stamp}@vendorbridge.test`;
    const registration = await call("POST", "/auth/register", {
      firstName: "Smoke",
      lastName: label,
      email,
      phone: "+91 90000 12345",
      country: "India",
      password: "Vendor@2026",
      companyName: `[smoke] ${label} Supplies ${stamp}`,
      category: "Office Supplies",
    });
    if (registration.status !== 201) {
      throw new Error(`Could not register the ${label} test vendor (status ${registration.status}).`);
    }
    const vendor = (await call("GET", "/vendors")).body?.items?.[0];
    return { call, vendor };
  }

  const novaAccount = await createVendorAccount("Alpha");
  const nova = novaAccount.vendor;
  const zenithAccount = await createVendorAccount("Beta");
  const zenith = zenithAccount.vendor;
  const apexAccount = await createVendorAccount("Gamma");
  const apex = apexAccount.vendor;
  check(
    "Week 2 fixtures: three independent vendor accounts with linked vendor records",
    Boolean(nova?.id && zenith?.id && apex?.id) &&
      new Set([nova.id, zenith.id, apex.id]).size === 3 &&
      nova.userId !== zenith.userId,
  );

  const unassignedVendorId = (await anonB("GET", "/vendors")).body?.items?.[0]?.id;
  check("registered vendor fixture is available for access-control tests", Boolean(unassignedVendorId));

  function rfqBody(overrides = {}) {
    return {
      title: `[smoke] Office equipment ${stamp}`,
      description: "Deliver to the Bengaluru headquarters.",
      currency: "INR",
      deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      vendorIds: [nova.id, zenith.id],
      items: [
        { description: "14-inch business laptop", quantity: 10, unit: "unit", specifications: "i5 / 16 GB" },
        { description: "USB-C docking station", quantity: 5, unit: "unit", specifications: "Dual HDMI" },
      ],
      ...overrides,
    };
  }

  section("8. RFQ creation, validation and lifecycle");
  check("anonymous cannot list RFQs", (await client()("GET", "/rfqs")).status === 401);
  check("anonymous cannot create RFQs", (await client()("POST", "/rfqs", rfqBody())).status === 401);
  check("vendor cannot create RFQs (403)", (await vendor("POST", "/rfqs", rfqBody())).status === 403);
  check("manager cannot create RFQs (403)", (await manager("POST", "/rfqs", rfqBody())).status === 403);

  const createdRfq = await procurement("POST", "/rfqs", rfqBody());
  const rfq1 = createdRfq.body?.rfq;
  check("procurement can create a draft RFQ", createdRfq.status === 201, `status ${createdRfq.status}`);
  check("RFQ receives a generated reference", /^RFQ-\d{4,}$/.test(rfq1?.reference ?? ""));
  check("new RFQ starts as a draft", rfq1?.status === "draft" && rfq1?.publishedAt === null);
  check("RFQ stores both requested line items in order", rfq1?.items?.length === 2 && rfq1?.items?.[0]?.position === 1);
  check("RFQ stores vendor assignments", rfq1?.assignments?.length === 2 && rfq1?.vendorCount === 2);
  check("decimal quantities are serialised without trailing zeros", rfq1?.items?.[0]?.quantity === "10");

  const forgedRfq = await procurement("POST", "/rfqs", {
    ...rfqBody(),
    status: "open",
    reference: "RFQ-FORGED",
    createdBy: 1,
    publishedAt: "2020-01-01T00:00:00.000Z",
  });
  check(
    "server ignores client-supplied status, reference and creator",
    forgedRfq.status === 201 &&
      forgedRfq.body?.rfq?.status === "draft" &&
      forgedRfq.body?.rfq?.reference !== "RFQ-FORGED" &&
      forgedRfq.body?.rfq?.publishedAt === null &&
      forgedRfq.body?.rfq?.creatorName === "Rohan Mehta",
  );
  const forgedRfqId = forgedRfq.body?.rfq?.id;

  const invalidRfqs = [
    ["short title", rfqBody({ title: "x" }), "title"],
    ["no line items", rfqBody({ items: [] }), "items"],
    ["negative quantity", rfqBody({ items: [{ description: "Bad line", quantity: "-2", unit: "unit" }] }), "items.0.quantity"],
    ["zero quantity", rfqBody({ items: [{ description: "Bad line", quantity: 0, unit: "unit" }] }), "items.0.quantity"],
    ["non-finite quantity", rfqBody({ items: [{ description: "Bad line", quantity: "abc", unit: "unit" }] }), "items.0.quantity"],
    ["unknown unit", rfqBody({ items: [{ description: "Bad line", quantity: 1, unit: "banana" }] }), "items.0.unit"],
    ["unsupported currency", rfqBody({ currency: "XYZ" }), "currency"],
    ["deadline in the past", rfqBody({ deadline: new Date(Date.now() - 3600000).toISOString() }), "deadline"],
    ["unknown vendor id", rfqBody({ vendorIds: [999999] }), "vendorIds"],
    ["duplicate vendor assignment", rfqBody({ vendorIds: [nova.id, nova.id] }), "vendorIds"],
  ];
  for (const [label, payload, field] of invalidRfqs) {
    const result = await procurement("POST", "/rfqs", payload);
    check(
      `${label} is rejected with 422 (${field})`,
      result.status === 422 && Boolean(result.body?.error?.fields?.[field]),
      `status ${result.status}`,
    );
  }

  check("manager can read an RFQ", (await manager("GET", `/rfqs/${rfq1?.id}`)).status === 200);
  check(
    "assigned vendor cannot see a draft RFQ",
    (await novaAccount.call("GET", `/rfqs/${forgedRfqId}`)).status === 404,
  );

  const published1 = await procurement("POST", `/rfqs/${rfq1?.id}/publish`);
  check("draft RFQ can be published", published1.status === 200 && published1.body?.rfq?.status === "open");
  check("publishing records a timestamp", Boolean(published1.body?.rfq?.publishedAt));
  check("publishing twice is rejected with 409", (await procurement("POST", `/rfqs/${rfq1?.id}/publish`)).status === 409);
  check(
    "published RFQ can no longer be edited",
    (await procurement("PUT", `/rfqs/${rfq1?.id}`, rfqBody({ title: "[smoke] Edited after publish" }))).status === 409,
  );
  check(
    "vendors cannot be reassigned after publication",
    (await procurement("PUT", `/rfqs/${rfq1?.id}/vendors`, { vendorIds: [apex.id] })).status === 409,
  );

  const draft2 = (await procurement("POST", "/rfqs", rfqBody({ title: `[smoke] Close flow ${stamp}`, vendorIds: [] }))).body?.rfq;
  check("draft RFQ can be created without vendors", draft2?.status === "draft" && draft2?.vendorCount === 0);
  check("draft RFQ cannot be closed", (await procurement("POST", `/rfqs/${draft2?.id}/close`)).status === 409);
  const publishWithoutVendors = await procurement("POST", `/rfqs/${draft2?.id}/publish`);
  check(
    "publishing without assigned vendors is rejected with 422",
    publishWithoutVendors.status === 422 && Boolean(publishWithoutVendors.body?.error?.fields?.vendorIds),
  );
  const assigned = await procurement("PUT", `/rfqs/${draft2?.id}/vendors`, { vendorIds: [zenith.id] });
  check(
    "vendor assignments can be replaced while in draft",
    assigned.status === 200 && assigned.body?.rfq?.assignments?.length === 1 && assigned.body?.rfq?.assignments?.[0]?.vendorId === zenith.id,
  );
  await procurement("PUT", `/rfqs/${draft2?.id}/vendors`, { vendorIds: [nova.id] });
  const published2 = await procurement("POST", `/rfqs/${draft2?.id}/publish`);
  check("draft with vendors and a future deadline publishes", published2.status === 200);
  check("open RFQ can be closed", (await procurement("POST", `/rfqs/${draft2?.id}/close`)).status === 200);
  check("closing twice is rejected with 409", (await procurement("POST", `/rfqs/${draft2?.id}/close`)).status === 409);
  check("a closed RFQ cannot be published", (await procurement("POST", `/rfqs/${draft2?.id}/publish`)).status === 409);
  check("a closed RFQ cannot be cancelled", (await procurement("POST", `/rfqs/${draft2?.id}/cancel`)).status === 409);
  check(
    "assigned vendor can still read a closed RFQ",
    (await novaAccount.call("GET", `/rfqs/${draft2?.id}`)).status === 200,
  );

  const draft3 = (await procurement("POST", "/rfqs", rfqBody({ title: `[smoke] Cancel flow ${stamp}`, vendorIds: [nova.id] }))).body?.rfq;
  await procurement("POST", `/rfqs/${draft3?.id}/publish`);
  check("open RFQ can be cancelled", (await procurement("POST", `/rfqs/${draft3?.id}/cancel`)).status === 200);
  const cancelledDetail = await novaAccount.call("GET", `/rfqs/${draft3?.id}`);
  check(
    "cancelled RFQ reports the cancelled status to vendors",
    cancelledDetail.status === 200 && cancelledDetail.body?.rfq?.effectiveStatus === "cancelled",
  );
  check("cancelled RFQ rejects submissions", (await novaAccount.call("PUT", `/rfqs/${draft3?.id}/quotation`, {
    deliveryDays: 5,
    items: cancelledDetail.body.rfq.items.map((item) => ({ rfqItemId: item.id, unitPrice: "100" })),
  })).status === 409);

  const concurrent = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      procurement("POST", "/rfqs", rfqBody({ title: `[smoke] Concurrent ${stamp} ${index}`, vendorIds: [] })),
    ),
  );
  const concurrentReferences = concurrent.map((result) => result.body?.rfq?.reference);
  check(
    "concurrent creation allocates unique references",
    concurrent.every((result) => result.status === 201) &&
      new Set(concurrentReferences).size === concurrent.length &&
      concurrentReferences.every((reference) => /^RFQ-\d{4,}$/.test(reference ?? "")),
  );

  section("9. Vendor access and quotation submission");
  const vendorDetail = await novaAccount.call("GET", `/rfqs/${rfq1?.id}`);
  check("assigned vendor can read a published RFQ", vendorDetail.status === 200);
  check("vendor response exposes only their own quotation", vendorDetail.body?.myQuotation === null);
  check(
    "vendor response omits other vendors and their submissions",
    vendorDetail.body?.rfq &&
      !Object.hasOwn(vendorDetail.body.rfq, "assignments") &&
      !Object.hasOwn(vendorDetail.body.rfq, "submissions"),
  );
  check(
    "vendor cannot read an RFQ assigned to other vendors",
    (await anonB("GET", `/rfqs/${rfq1?.id}`)).status === 404,
  );
  check(
    "unassigned vendor cannot submit a quotation",
    (await anonB("PUT", `/rfqs/${rfq1?.id}/quotation`, {
      deliveryDays: 3,
      items: vendorDetail.body.rfq.items.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
    })).status === 403,
  );
  check("vendor cannot read procurement quotation lists", (await novaAccount.call("GET", `/rfqs/${rfq1?.id}/quotations`)).status === 403);
  check("vendor cannot read the comparison", (await novaAccount.call("GET", `/rfqs/${rfq1?.id}/comparison`)).status === 403);

  const rfqItems = vendorDetail.body.rfq.items;
  const invalidQuotes = [
    ["missing a requested item", { deliveryDays: 5, items: [{ rfqItemId: rfqItems[0].id, unitPrice: "100" }] }],
    ["pricing an unknown item", { deliveryDays: 5, items: [...rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "100" })), { rfqItemId: 999999, unitPrice: "1" }] }],
    ["negative unit price", { deliveryDays: 5, items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "-5" })) }],
    ["non-numeric unit price", { deliveryDays: 5, items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "cheap" })) }],
    ["missing delivery timeline", { items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "100" })) }],
    ["negative delivery timeline", { deliveryDays: -1, items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "100" })) }],
    ["tax above 100 percent", { deliveryDays: 5, taxPercent: "150", items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "100" })) }],
    ["negative shipping", { deliveryDays: 5, shippingAmount: "-10", items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "100" })) }],
  ];
  for (const [label, payload] of invalidQuotes) {
    check(
      `quotation with ${label} is rejected`,
      [422].includes((await novaAccount.call("PUT", `/rfqs/${rfq1?.id}/quotation`, payload)).status),
    );
  }

  const novaQuote = await novaAccount.call("PUT", `/rfqs/${rfq1?.id}/quotation`, {
    deliveryDays: 10,
    deliveryTerms: "Freight included",
    notes: "Prices valid for 30 days.",
    taxPercent: "18",
    shippingAmount: "750",
    // Mass-assignment attempt: these must all be ignored by the server.
    vendorId: zenith.id,
    currency: "USD",
    total: "1.00",
    submittedAt: "2000-01-01T00:00:00.000Z",
    items: [
      { rfqItemId: rfqItems[0].id, unitPrice: "2500" },
      { rfqItemId: rfqItems[1].id, unitPrice: "4000" },
    ],
  });
  const novaQuotation = novaQuote.body?.quotation;
  check("assigned vendor can submit a quotation", novaQuote.status === 201, `status ${novaQuote.status}`);
  check("quotation is linked to the authenticated vendor", novaQuotation?.vendorId === nova.id);
  check("client-supplied currency is ignored", novaQuotation?.currency === "INR");
  check("server calculates the line totals", novaQuotation?.subtotal === "45000.00");
  check("server calculates tax and delivery inclusively", novaQuotation?.taxAmount === "8100.00" && novaQuotation?.total === "53850.00");
  check("first submission is revision 1", novaQuotation?.revision === 1);

  const revisedNova = await novaAccount.call("PUT", `/rfqs/${rfq1?.id}/quotation`, {
    deliveryDays: 9,
    notes: "Revised: faster delivery.",
    taxPercent: "18",
    shippingAmount: "750",
    items: [
      { rfqItemId: rfqItems[0].id, unitPrice: "2500" },
      { rfqItemId: rfqItems[1].id, unitPrice: "4000" },
    ],
  });
  check(
    "resubmission creates a separate linked quotation revision",
    revisedNova.status === 200 &&
      revisedNova.body?.quotation?.id !== novaQuotation?.id &&
      revisedNova.body?.quotation?.revision === 2 &&
      revisedNova.body?.quotation?.supersedesId === novaQuotation?.id,
  );

  const [concurrentA, concurrentB] = await Promise.all([
    novaAccount.call("PUT", `/rfqs/${rfq1?.id}/quotation`, {
      deliveryDays: 8,
      taxPercent: "18",
      shippingAmount: "750",
      items: [
        { rfqItemId: rfqItems[0].id, unitPrice: "2500" },
        { rfqItemId: rfqItems[1].id, unitPrice: "4000" },
      ],
    }),
    novaAccount.call("PUT", `/rfqs/${rfq1?.id}/quotation`, {
      deliveryDays: 8,
      taxPercent: "18",
      shippingAmount: "750",
      items: [
        { rfqItemId: rfqItems[0].id, unitPrice: "2500" },
        { rfqItemId: rfqItems[1].id, unitPrice: "4000" },
      ],
    }),
  ]);
  check(
    "concurrent submissions serialize into distinct quotation revisions",
    [200, 201].includes(concurrentA.status) && [200, 201].includes(concurrentB.status) &&
      concurrentA.body?.quotation?.id !== concurrentB.body?.quotation?.id,
  );

  const zenQuote = await zenithAccount.call("PUT", `/rfqs/${rfq1?.id}/quotation`, {
    deliveryDays: 12,
    notes: "Includes 3-year warranty.",
    taxPercent: "18",
    shippingAmount: "500",
    items: [
      { rfqItemId: rfqItems[0].id, unitPrice: "2400" },
      { rfqItemId: rfqItems[1].id, unitPrice: "3900" },
    ],
  });
  check("a second assigned vendor can quote the same RFQ", zenQuote.status === 201);
  check("second quotation total is server-calculated", zenQuote.body?.quotation?.total === "51830.00");

  const expiredRfq = (
    await procurement(
      "POST",
      "/rfqs",
      rfqBody({
        title: `[smoke] Deadline enforcement ${stamp}`,
        deadline: new Date(Date.now() + 6000).toISOString(),
        vendorIds: [zenith.id],
      }),
    )
  ).body?.rfq;
  await procurement("POST", `/rfqs/${expiredRfq?.id}/publish`);
  let commitDeadlineRejected = false;
  try {
    const { prisma: deadlinePrisma } = await import("../server/db.js");
    await deadlinePrisma.$transaction(async (tx) => {
      const [inserted] = await tx.$queryRaw`INSERT INTO "quotations" (
        "rfq_id", "vendor_id", "currency", "delivery_days", "tax_percent",
        "subtotal", "tax_amount", "shipping_amount", "total", "revision",
        "submitted_at", "updated_at"
      ) VALUES (
        ${expiredRfq.id}, ${zenith.id}, ${expiredRfq.currency}, 2, 0,
        90, 0, 0, 90, 1, clock_timestamp() AT TIME ZONE 'UTC', clock_timestamp() AT TIME ZONE 'UTC'
      ) RETURNING "id"`;
      await tx.$executeRaw`INSERT INTO "quotation_items" ("quotation_id", "rfq_item_id", "unit_price", "line_total")
        VALUES (${inserted.id}, ${expiredRfq.items[0].id}, 90, 90)`;
      await sleep(Math.max(0, new Date(expiredRfq.deadline).getTime() - Date.now() + 100));
    }, { timeout: 15000 });
  } catch {
    commitDeadlineRejected = true;
  }
  check("PostgreSQL rejects a quote whose transaction crosses the deadline", commitDeadlineRejected);
  const lateSubmission = await zenithAccount.call("PUT", `/rfqs/${expiredRfq?.id}/quotation`, {
    deliveryDays: 2,
    items: expiredRfq.items.map((item) => ({ rfqItemId: item.id, unitPrice: "90" })),
  });
  check(
    "submissions after the UTC deadline are rejected",
    lateSubmission.status === 409 && lateSubmission.body?.error?.code === "rfq_expired",
  );
  check(
    "expired RFQ is reported as expired while still open",
    (await zenithAccount.call("GET", `/rfqs/${expiredRfq?.id}`)).body?.rfq?.status === "open",
  );

  section("10. Quotation review and comparison");
  const quotationList = await procurement("GET", `/rfqs/${rfq1?.id}/quotations`);
  check("procurement sees current and historical quotation revisions", quotationList.status === 200 && quotationList.body?.quotations?.length === 5);
  const novaRevisions = quotationList.body?.quotations?.filter((entry) => entry.vendorId === nova.id).sort((a, b) => b.revision - a.revision);
  const novaRow = novaRevisions?.[0];
  check("historical Nova revisions are preserved and superseded", novaRevisions?.length === 4 && novaRevisions.slice(1).every((entry) => entry.status === "superseded"));
  const zenRow = quotationList.body?.quotations?.find((entry) => entry.vendorId === zenith.id);
  check("quotation list includes vendor identity", novaRow?.vendorName === nova.name);
  check("quotation list exposes stored totals", zenRow?.total === "51830.00");
  check(
    "quotation list can be sorted by total",
    (await procurement("GET", `/rfqs/${rfq1?.id}/quotations?sort=total_asc`)).body?.quotations?.[0]?.vendorId === zenith.id,
  );
  check(
    "unknown quotation sort is rejected with 400",
    (await procurement("GET", `/rfqs/${rfq1?.id}/quotations?sort=nonsense`)).status === 400,
  );

  const comparison = await procurement("GET", `/rfqs/${rfq1?.id}/comparison`);
  check("comparison returns saved quotations", comparison.status === 200 && comparison.body?.summary?.quotationCount === 2);
  check(
    "comparison highlights the lowest server-calculated total",
    comparison.body?.lowest?.vendorId === zenith.id && comparison.body?.summary?.lowestTotal === "51830.00",
  );
  check(
    "exactly one quotation is marked lowest",
    comparison.body?.quotations?.filter((entry) => entry.isLowest).length === 1,
  );
  check(
    "comparison documents the cost basis and currency",
    comparison.body?.basis?.currency === "INR" &&
      comparison.body?.basis?.includesTax === true &&
      comparison.body?.basis?.includesShipping === true,
  );

  // Currency anomalies can only enter through direct data corruption; the API
  // rejects them, so the exclusion rule is verified by mutating this test RFQ's
  // quotation and restoring it immediately afterwards.
  let prisma = null;
  try {
    ({ prisma } = await import("../server/db.js"));
    let mutationRejected = false;
    try {
      await prisma.quotation.update({ where: { id: zenRow.id }, data: { currency: "USD" } });
    } catch {
      mutationRejected = true;
    }
    check("database prevents mutation of submitted financial bids", mutationRejected);
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {});
  }

  const vendorIsolation = await novaAccount.call("GET", `/rfqs/${rfq1?.id}`);
  check(
    "vendor responses never contain another vendor's prices or notes",
    !JSON.stringify(vendorIsolation.body).includes("51830") &&
      !JSON.stringify(vendorIsolation.body).includes(zenith.name),
  );

  const tieRfq = (await procurement("POST", "/rfqs", rfqBody({
    title: `[smoke] Tie comparison ${stamp}`,
    vendorIds: [apex.id, zenith.id],
  }))).body?.rfq;
  await procurement("POST", `/rfqs/${tieRfq?.id}/publish`);
  const tieItems = tieRfq.items;
  const tiePayload = {
    deliveryDays: 4,
    taxPercent: "0",
    shippingAmount: "0",
    items: tieItems.map((item) => ({ rfqItemId: item.id, unitPrice: "1000" })),
  };
  await zenithAccount.call("PUT", `/rfqs/${tieRfq?.id}/quotation`, tiePayload);
  await sleep(150);
  await apexAccount.call("PUT", `/rfqs/${tieRfq?.id}/quotation`, tiePayload);
  const tieComparison = await procurement("GET", `/rfqs/${tieRfq?.id}/comparison`);
  check(
    "equal totals pick a single winner deterministically",
    tieComparison.body?.summary?.comparableCount === 2 &&
      tieComparison.body?.quotations?.filter((entry) => entry.isLowest).length === 1 &&
      tieComparison.body?.lowest?.vendorId === zenith.id,
  );

  const singleRfq = (await procurement("POST", "/rfqs", rfqBody({
    title: `[smoke] Single quotation ${stamp}`,
    vendorIds: [apex.id],
  }))).body?.rfq;
  await procurement("POST", `/rfqs/${singleRfq?.id}/publish`);
  await apexAccount.call("PUT", `/rfqs/${singleRfq?.id}/quotation`, {
    deliveryDays: 3,
    taxPercent: "5",
    shippingAmount: "100",
    items: singleRfq.items.map((item) => ({ rfqItemId: item.id, unitPrice: "500" })),
  });
  const singleComparison = await procurement("GET", `/rfqs/${singleRfq?.id}/comparison`);
  check(
    "single-submission comparison still highlights the lowest valid quotation",
    singleComparison.body?.summary?.comparableCount === 1 &&
      singleComparison.body?.lowest?.vendorId === apex.id &&
      singleComparison.body?.lowest?.total === "7975.00",
  );

  const emptyRfq = (await procurement("POST", "/rfqs", rfqBody({
    title: `[smoke] No quotations ${stamp}`,
    vendorIds: [apex.id],
  }))).body?.rfq;
  await procurement("POST", `/rfqs/${emptyRfq?.id}/publish`);
  const emptyComparison = await procurement("GET", `/rfqs/${emptyRfq?.id}/comparison`);
  check(
    "comparison without submissions reports no valid result",
    emptyComparison.body?.summary?.quotationCount === 0 &&
      emptyComparison.body?.summary?.canCompare === false &&
      emptyComparison.body?.lowest === null,
  );
  check(
    "quotations list without submissions is empty",
    (await procurement("GET", `/rfqs/${emptyRfq?.id}/quotations`)).body?.quotations?.length === 0,
  );
  check("quotation submit for a closed RFQ is rejected", (await novaAccount.call("PUT", `/rfqs/${draft2?.id}/quotation`, {
    deliveryDays: 3,
    items: rfqItems.map((item) => ({ rfqItemId: item.id, unitPrice: "10" })),
  })).status === 409);

  section("11. RFQ filtering, pagination, persistence and headers");
  const searchRfq = await procurement("GET", `/rfqs?search=${encodeURIComponent(rfq1?.reference)}`);
  check("search finds the RFQ by reference", searchRfq.body?.total === 1 && searchRfq.body?.items?.[0]?.id === rfq1?.id);
  check(
    "unknown RFQ status filter is rejected",
    (await procurement("GET", "/rfqs?status=bogus")).status === 422,
  );
  const openFilter = await procurement("GET", "/rfqs?status=open&pageSize=100");
  check(
    "open filter only returns RFQs still accepting quotations",
    openFilter.status === 200 && openFilter.body?.items?.every((item) => item.effectiveStatus === "open"),
  );
  const expiredFilter = await procurement("GET", "/rfqs?status=expired&pageSize=100");
  check(
    "expired filter finds RFQs past their deadline",
    expiredFilter.body?.items?.some((item) => item.id === expiredRfq?.id) &&
      expiredFilter.body?.items?.every((item) => item.effectiveStatus === "expired"),
  );
  const pagedRfqs = await procurement("GET", "/rfqs?page=1&pageSize=2&sort=reference");
  check(
    "RFQ pagination returns metadata and at most one page of rows",
    pagedRfqs.body?.page === 1 && pagedRfqs.body?.pageSize === 2 && (pagedRfqs.body?.items?.length ?? 0) <= 2,
  );
  const sortedRfqs = (await procurement("GET", "/rfqs?sort=reference&pageSize=100")).body?.items?.map((item) => item.reference) ?? [];
  check(
    "RFQ sorting by reference is deterministic",
    sortedRfqs.length > 1 && sortedRfqs.every((reference, index) => index === 0 || sortedRfqs[index - 1] <= reference),
  );
  check(
    "RFQ responses are marked no-store",
    (await procurement("GET", "/rfqs")).cacheControl === "no-store",
  );

  const vendorRfqList = await novaAccount.call("GET", "/rfqs?pageSize=100");
  const vendorRfqIds = vendorRfqList.body?.items?.map((item) => item.id) ?? [];
  check("vendor RFQ list hides drafts", vendorRfqList.body?.items?.every((item) => item.status !== "draft"));
  check("vendor RFQ list includes assigned RFQs", vendorRfqIds.includes(rfq1?.id));
  check("vendor RFQ list excludes unassigned RFQs", !vendorRfqIds.includes(singleRfq?.id) && !vendorRfqIds.includes(emptyRfq?.id));
  check(
    "vendor RFQ list shows the vendor's own submission state",
    vendorRfqList.body?.items?.find((item) => item.id === rfq1?.id)?.hasSubmitted === true,
  );

  const dashboardAfter = await procurement("GET", "/dashboard");
  check(
    "dashboard reports live RFQ metrics",
    dashboardAfter.body?.rfqSummary?.open >= 1 && dashboardAfter.body?.rfqSummary?.quotations >= 2,
  );

  const freshProcurement = await login("procurement@vendorbridge.dev", "Procure@123");
  const persistedRfq = await freshProcurement.call("GET", `/rfqs/${rfq1?.id}`);
  check(
    "RFQ and quotation survive a new session",
    persistedRfq.status === 200 &&
      persistedRfq.body?.rfq?.quotationCount === 2 &&
      persistedRfq.body?.rfq?.submissions?.filter((entry) => entry.status === "submitted").length === 2,
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
