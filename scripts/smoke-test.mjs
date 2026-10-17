const BASE = process.env.API_URL || "http://localhost:4000";

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
      if (sessionCookie) cookie = sessionCookie.split(";")[0];
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
    return { status: response.status, body: json };
  };
}

async function login(email, password) {
  const call = client();
  const result = await call("POST", "/auth/login", { email, password });
  return { call, result };
}

const stamp = Date.now();
const createdVendorName = `Smoke Test Supplies ${stamp}`;

async function main() {
  console.log(`VendorBridge API smoke test against ${BASE}`);

  section("1. Authentication and session handling");
  const anon = client();
  check("anonymous /vendors returns 401", (await anon("GET", "/vendors")).status === 401);
  check("anonymous /dashboard returns 401", (await anon("GET", "/dashboard")).status === 401);
  check("anonymous /auth/me returns 401", (await anon("GET", "/auth/me")).status === 401);

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
  check("session payload hides password hashes", !JSON.stringify(procurementLogin.body).includes("password_hash"));
  check("procurement role is returned", procurementLogin.body?.user?.role === "procurement");
  const me = await procurement("GET", "/auth/me");
  check("session survives a refresh via cookie", me.status === 200 && me.body?.user?.role === "procurement");

  const { call: admin, result: adminLogin } = await login("admin@vendorbridge.dev", "Admin@123");
  check("admin can sign in", adminLogin.status === 200);
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
    "category counts reconcile with the register",
    dashboard.body?.categoryCounts?.reduce((sum, item) => sum + item.count, 0) === dashboard.body?.totalVendors,
  );
  check("recent vendors are limited to five", (dashboard.body?.recentVendors?.length ?? 0) <= 5);

  const vendorDashboard = await vendor("GET", "/dashboard");
  check("vendor dashboard scope is returned", vendorDashboard.body?.scope === "vendor");
  check("vendor dashboard exposes their own profile", vendorDashboard.body?.vendor?.name === "Nova Office Supplies");

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
  check("vendor registration returns a session cookie", Boolean(registered.body?.token));
  const newVendorProfile = await anonB("GET", "/vendors");
  check("vendor registration creates a pending vendor profile", newVendorProfile.body?.items?.[0]?.status === "Pending");
  check(
    "registered vendor is linked to the new account",
    newVendorProfile.body?.items?.[0]?.name === `New Vendor ${stamp}`,
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
  check("forgot-password issues a reset token", Boolean(resetRequest.body?.resetToken));
  const token = resetRequest.body?.resetToken;

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
    token: restoreRequest.body?.resetToken,
    password: "Admin@123",
  });
  check("demo admin password restored", restore.status === 200);

  const logoutClient = client();
  await logoutClient("POST", "/auth/login", { email: "procurement@vendorbridge.dev", password: "Procure@123" });
  const logout = await logoutClient("POST", "/auth/logout");
  check("logout succeeds", logout.status === 200);
  check("session is cleared after logout", (await logoutClient("GET", "/auth/me")).status === 401);

  section("6. Removed module endpoints");
  for (const path of ["/rfqs", "/quotations", "/approvals", "/purchase-orders", "/invoices", "/reports", "/activity"]) {
    check(`${path} is not exposed`, (await procurement("GET", path)).status === 404);
  }

  section("7. Persistence");
  const freshClient = await login("procurement@vendorbridge.dev", "Procure@123");
  const persisted = await freshClient.call("GET", `/vendors/${vendorId}`);
  check("created vendor persists in a new session", persisted.status === 200 && persisted.body?.vendor?.id === vendorId);
  const deleted = await freshClient.call("DELETE", `/vendors/${vendorId}`);
  check("procurement can delete a vendor", deleted.status === 200);
  check("deleted vendor is gone", (await freshClient.call("GET", `/vendors/${vendorId}`)).status === 404);

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
