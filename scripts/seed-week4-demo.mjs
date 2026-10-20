/**
 * Week 4 demo data seeder — reports and the audit trail.
 *
 * Creates four complete procurement chains through the real HTTP API, one in
 * each of the last four months, so the Reports page has a multi-month trend,
 * four supplier categories and a realistic spend split:
 *
 *   Demo W4: Ergonomic workspace refresh   — Aurora Workspaces  (Furniture)   ~3 months ago
 *   Demo W4: Regional freight contract     — Northwind Logistics (Logistics) ~2 months ago
 *   Demo W4: Platform licence & onboarding — Brightline Software (Software)  ~1 month ago
 *   Demo W4: Quarterly deep clean          — Greenfield Facilities (Facilities) this month
 *
 * Each chain is: RFQ → published → vendor quotation → approval request →
 * manager decision → purchase order → invoice → RFQ closed. Every document is
 * produced by the application itself (numbers, totals and tax are never written
 * by this script). Only the timestamps are backdated afterwards, so the trend
 * chart has history; the audit trail records the real actions as they happen.
 *
 * The run is idempotent: a scenario whose RFQ already exists is skipped.
 *
 * Usage (against a running API):
 *   APP_URL=http://localhost:4000 ALLOW_REMOTE_SEED=true \
 *   node scripts/seed-week4-demo.mjs
 */
import { prisma } from "../server/db.js";

const BASE = (process.env.APP_URL || "http://localhost:4000").replace(/\/$/, "");
const PREFIX = "Demo W4:";
const DAY = 86_400_000;

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}
try {
  const parsed = new URL(process.env.DATABASE_URL);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!loopback && !process.env.ALLOW_REMOTE_SEED) {
    console.error(
      `Refusing to write to remote database ${parsed.hostname}. Set ALLOW_REMOTE_SEED=true only if it is a development database.`,
    );
    process.exit(2);
  }
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(2);
}

const failures = [];
function report(name, ok, detail = "") {
  console.log(`  [${ok ? "OK" : "FAIL"}] ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function retrying(action, label, attempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError?.message || lastError}`);
}

function makeClient() {
  let cookie = "";
  return async function call(method, path, body) {
    return retrying(async () => {
      const response = await fetch(`${BASE}/api${path}`, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookies = response.headers.getSetCookie?.() ?? [];
      for (const line of setCookies) {
        if (line.startsWith("vb_token=")) cookie = line.split(";")[0];
      }
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (response.status === 503 && json?.error?.code === "database_unavailable") {
        throw new Error(`database unavailable (${method} ${path})`);
      }
      return { status: response.status, body: json };
    }, `${method} ${path}`);
  };
}

async function login(email, password) {
  const call = makeClient();
  const result = await call("POST", "/auth/login", { email, password });
  if (result.status !== 200) throw new Error(`Login failed for ${email} (${result.status})`);
  return call;
}

async function must(promise, label) {
  const result = await promise;
  if (result.status >= 400) {
    throw new Error(`${label} failed (${result.status}): ${JSON.stringify(result.body?.error || result.body)}`);
  }
  return result;
}

function monthStart(monthsAgo) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 12, 10, 0, 0));
  return date;
}

const SCENARIOS = [
  {
    key: "furniture",
    monthsAgo: 3,
    title: `${PREFIX} Ergonomic workspace refresh`,
    description: "Replace aging task chairs and add height-adjustable desks on the fourth floor.",
    vendor: {
      email: "week4.furniture@vendorbridge.dev",
      firstName: "Tara",
      lastName: "Reddy",
      companyName: "Aurora Workspaces",
      category: "Furniture",
      rating: 4.6,
    },
    items: [
      { description: "Ergonomic task chair with lumbar support", quantity: "24", unit: "pcs", specifications: "Adjustable arms" },
      { description: "Height-adjustable desk 140 cm", quantity: "12", unit: "pcs", specifications: "Electric, memory preset" },
    ],
    quote: { prices: ["8900", "15500"], taxPercent: "18", shippingAmount: "3200", deliveryDays: 18 },
    requestRemarks: "Two suppliers compared; Aurora offered the shorter lead time.",
    decisionRemarks: "Approved within the furniture budget for Q3.",
  },
  {
    key: "logistics",
    monthsAgo: 2,
    title: `${PREFIX} Regional freight contract`,
    description: "Monthly palletised freight between the Bengaluru warehouse and four regional hubs.",
    vendor: {
      email: "week4.logistics@vendorbridge.dev",
      firstName: "Sameer",
      lastName: "Khan",
      companyName: "Northwind Logistics",
      category: "Logistics",
      rating: 4.4,
    },
    items: [
      { description: "Palletised freight, Bengaluru → regional hubs", quantity: "40", unit: "unit", specifications: "Temperature-controlled" },
      { description: "Warehouse pallet storage (per pallet-month)", quantity: "120", unit: "unit", specifications: "Racked storage" },
    ],
    quote: { prices: ["2750", "480"], taxPercent: "12", shippingAmount: "0", deliveryDays: 7 },
    requestRemarks: "Renewal of the regional distribution contract.",
    decisionRemarks: "Approved — rates are 6% below the expiring contract.",
  },
  {
    key: "software",
    monthsAgo: 1,
    title: `${PREFIX} Platform licence & onboarding`,
    description: "Annual subscription for the procurement analytics platform plus implementation support.",
    vendor: {
      email: "week4.software@vendorbridge.dev",
      firstName: "Meera",
      lastName: "Joshi",
      companyName: "Brightline Software",
      category: "Software",
      rating: 4.7,
    },
    items: [
      { description: "Annual platform licence (50 seats)", quantity: "1", unit: "unit", specifications: "SSO included" },
      { description: "Implementation and onboarding workshop", quantity: "16", unit: "hour", specifications: "Remote" },
    ],
    quote: { prices: ["96000", "3500"], taxPercent: "18", shippingAmount: "0", deliveryDays: 5 },
    requestRemarks: "Three quotes reviewed; Brightline includes SSO at no extra cost.",
    decisionRemarks: "Approved for the new financial year.",
  },
  {
    key: "facilities",
    monthsAgo: 0,
    title: `${PREFIX} Quarterly deep clean`,
    description: "Quarterly deep-clean service for the headquarters plus washroom consumables.",
    vendor: {
      email: "week4.facilities@vendorbridge.dev",
      firstName: "Vikram",
      lastName: "Rao",
      companyName: "Greenfield Facilities",
      category: "Facilities",
      rating: 4.3,
    },
    items: [
      { description: "Quarterly deep-clean service (per visit)", quantity: "12", unit: "unit", specifications: "After hours" },
      { description: "Washroom consumables bundle", quantity: "30", unit: "pack", specifications: "Eco-certified" },
    ],
    quote: { prices: ["7200", "1150"], taxPercent: "18", shippingAmount: "1800", deliveryDays: 4 },
    requestRemarks: "Scheduled maintenance for the current quarter.",
    decisionRemarks: "Approved — same scope as last quarter.",
  },
];

async function ensureVendorAccount(scenario) {
  const password = "Demo@2026";
  const existing = await prisma.user.findUnique({ where: { email: scenario.vendor.email } });
  let vendor = await prisma.vendor.findFirst({ where: { account: { email: scenario.vendor.email } } });

  if (existing && vendor) {
    const call = await login(scenario.vendor.email, password);
    return { call, vendorId: vendor.id };
  }

  const registration = makeClient();
  const result = await must(
    registration("POST", "/auth/register", {
      firstName: scenario.vendor.firstName,
      lastName: scenario.vendor.lastName,
      email: scenario.vendor.email,
      phone: "+91 90000 44000",
      country: "India",
      password,
      companyName: scenario.vendor.companyName,
      category: scenario.vendor.category,
    }),
    `register ${scenario.vendor.companyName}`,
  );

  vendor = result.body.vendor;
  // Self-registered vendors start Pending; a demo supplier should look active.
  await prisma.vendor.update({
    where: { id: vendor.id },
    data: {
      status: "Active",
      rating: scenario.vendor.rating,
      city: "Bengaluru",
      address: "Procurement Park, Phase 2",
      contactName: `${scenario.vendor.firstName} ${scenario.vendor.lastName}`,
    },
  });

  const call = await login(scenario.vendor.email, password);
  return { call, vendorId: vendor.id };
}

async function backdate(scenario, chain, anchor) {
  const published = new Date(anchor.getTime());
  const quoted = new Date(anchor.getTime() + 1 * DAY + 3 * 3_600_000);
  const requested = new Date(anchor.getTime() + 2 * DAY + 1 * 3_600_000);
  const decided = new Date(anchor.getTime() + 2 * DAY + 4 * 3_600_000);
  const issued = new Date(anchor.getTime() + 3 * DAY + 2 * 3_600_000);
  const issueDay = new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), issued.getUTCDate()));

  await prisma.rfq.update({
    where: { id: chain.rfqId },
    data: {
      createdAt: anchor,
      updatedAt: issued,
      publishedAt: published,
      deadline: new Date(anchor.getTime() + 21 * DAY),
      closedAt: issued,
      status: "closed",
    },
  });
  await prisma.quotation.update({
    where: { id: chain.quotationId },
    data: { submittedAt: quoted, updatedAt: quoted },
  });
  await prisma.approvalRequest.update({
    where: { id: chain.approvalId },
    data: { requestedAt: requested, decidedAt: decided },
  });
  await prisma.approvalEvent.updateMany({
    where: { approvalId: chain.approvalId, type: "requested" },
    data: { createdAt: requested },
  });
  await prisma.approvalEvent.updateMany({
    where: { approvalId: chain.approvalId, type: "approved" },
    data: { createdAt: decided },
  });
  await prisma.purchaseOrder.update({
    where: { id: chain.purchaseOrderId },
    data: { issuedAt: issued, createdAt: issued, updatedAt: issued },
  });
  await prisma.invoice.update({
    where: { id: chain.invoiceId },
    data: {
      issueDate: issueDay,
      dueDate: new Date(issueDay.getTime() + 30 * DAY),
      createdAt: issued,
      updatedAt: issued,
    },
  });
}

async function main() {
  console.log(`Week 4 demo seeder against ${BASE}`);

  const health = await makeClient()("GET", "/health");
  if (health.status !== 200) throw new Error(`API is not ready at ${BASE} (health ${health.status}).`);
  report("API is reachable", true);

  const procurement = await login("procurement@vendorbridge.dev", "Procure@123");
  report("procurement demo account signs in", true);
  const manager = await login("manager@vendorbridge.dev", "Manager@123");
  report("manager demo account signs in", true);

  for (const scenario of SCENARIOS) {
    const existingRfq = await prisma.rfq.findFirst({ where: { title: scenario.title } });
    if (existingRfq) {
      report(`${scenario.key}: already seeded (${existingRfq.reference})`, true);
      continue;
    }

    const vendorSession = await ensureVendorAccount(scenario);
    report(`${scenario.key}: supplier account ${scenario.vendor.companyName}`, true);

    const anchor = monthStart(scenario.monthsAgo);

    const rfqResult = await must(
      procurement("POST", "/rfqs", {
        title: scenario.title,
        description: scenario.description,
        currency: "INR",
        deadline: new Date(Date.now() + 14 * DAY).toISOString(),
        vendorIds: [vendorSession.vendorId],
        items: scenario.items,
      }),
      `${scenario.key}: create RFQ`,
    );
    const rfq = rfqResult.body.rfq;

    await must(procurement("POST", `/rfqs/${rfq.id}/publish`), `${scenario.key}: publish RFQ`);

    const quotationResult = await must(
      vendorSession.call("PUT", `/rfqs/${rfq.id}/quotation`, {
        deliveryDays: scenario.quote.deliveryDays,
        deliveryTerms: "Freight included",
        notes: "Prices valid for 45 days.",
        taxPercent: scenario.quote.taxPercent,
        shippingAmount: scenario.quote.shippingAmount,
        items: rfq.items.map((item, index) => ({
          rfqItemId: item.id,
          unitPrice: scenario.quote.prices[index],
        })),
      }),
      `${scenario.key}: submit quotation`,
    );
    const quotation = quotationResult.body.quotation;

    const approvalResult = await must(
      procurement("POST", "/approvals", {
        quotationId: quotation.id,
        remarks: scenario.requestRemarks,
      }),
      `${scenario.key}: request approval`,
    );
    const approval = approvalResult.body.approval;

    await must(
      manager("POST", `/approvals/${approval.id}/approve`, { remarks: scenario.decisionRemarks }),
      `${scenario.key}: approve`,
    );

    const poResult = await must(
      procurement("POST", "/purchase-orders", { approvalRequestId: approval.id }),
      `${scenario.key}: generate purchase order`,
    );
    const purchaseOrder = poResult.body.purchaseOrder;

    const invoiceResult = await must(
      procurement("POST", "/invoices", {
        purchaseOrderId: purchaseOrder.id,
        dueDate: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10),
      }),
      `${scenario.key}: generate invoice`,
    );
    const invoice = invoiceResult.body.invoice;

    await must(procurement("POST", `/rfqs/${rfq.id}/close`), `${scenario.key}: close RFQ`);

    await backdate(
      scenario,
      {
        rfqId: rfq.id,
        quotationId: quotation.id,
        approvalId: approval.id,
        purchaseOrderId: purchaseOrder.id,
        invoiceId: invoice.id,
      },
      anchor,
    );

    report(
      `${scenario.key}: ${rfq.reference} → ${purchaseOrder.number} → ${invoice.number}`,
      true,
      `${invoice.currency} ${Number(invoice.total).toLocaleString("en-IN")}`,
    );
  }

  const overview = await procurement("GET", "/reports/overview?from=" + isoDaysAgo(120));
  if (overview.status === 200) {
    const totals = overview.body.totals;
    report(
      "reports overview reflects the seeded documents",
      totals.purchaseOrders >= 4,
      `${totals.purchaseOrders} orders · ${overview.body.currency} ${Number(totals.purchaseOrderValue).toLocaleString("en-IN")} · ${overview.body.spendByMonth.length} months`,
    );
  } else {
    report("reports overview is readable", false, `status ${overview.status}`);
  }

  const activity = await procurement("GET", "/activity?pageSize=1");
  if (activity.status === 200) {
    report("audit trail records the seeded actions", activity.body.total > 0, `${activity.body.total} entries`);
  } else {
    report("audit trail is readable", false, `status ${activity.status}`);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} step(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nWeek 4 demo data is ready.");
  }
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
