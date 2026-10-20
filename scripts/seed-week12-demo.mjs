/**
 * Week 1 + Week 2 + Week 3 demo data seeder (instructor checklist).
 *
 * On top of the base `npm run seed` users and vendors this creates:
 *   - 1 draft RFQ with 2 line items
 *   - 1 published (open) RFQ with a deadline 7 days out, assigned to 3 vendors
 *   - 1 published RFQ whose deadline is yesterday, 3 line items priced in INR,
 *     assigned to 5 vendors, with 5 quotations:
 *       A Nova      — valid bid
 *       B Zenith    — valid bid, higher total than A
 *       C Apex      — lowest valid bid (winner)
 *       D BluePeak  — line-for-line identical to C but submitted 2 hours later
 *                    (so the earliest-submission tie-break must pick C)
 *       E GreenLeaf — disqualified: quoted in USD while the RFQ is priced in INR
 *
 * Week 3 adds the whole approval-to-invoice chain for the winning bid:
 *   - 1 approval request approved by the manager (remarks + full history)
 *   - 1 purchase order generated from that approval (unique PO number)
 *   - 1 invoice generated from that purchase order (30-day term)
 *   - 1 request still waiting in the approver queue (open RFQ)
 *   - 1 request the manager rejected with written remarks
 *
 * Everything except those two documented data touches (Vendor D's submission
 * time and Vendor E's currency) goes through the real HTTP API, so references,
 * line totals, document numbers and stored totals are computed by the
 * application itself.
 *
 * The run is idempotent: existing demo records are reused, never duplicated,
 * so a second run only reports what is already there.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/vendorbridge \
 *   APP_URL=http://localhost:4100 \
 *   node scripts/seed-week12-demo.mjs
 */
import { hashPassword } from "../server/auth.js";

const BASE = (process.env.APP_URL || "http://localhost:4100").replace(/\/$/, "");
const PREFIX = "Demo:";

const DB_URL = process.env.DATABASE_URL || "";
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(2);
}
if (!DB_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}
let dbTarget = DB_URL;
try {
  const parsed = new URL(DB_URL);
  dbTarget = `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!loopback && !process.env.ALLOW_REMOTE_SEED) {
    console.error(
      `Refusing to write to remote database ${dbTarget}. This seeder targets a disposable development database; ` +
        "set ALLOW_REMOTE_SEED=true only if you are certain it is safe.",
    );
    process.exit(2);
  }
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(2);
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const failures = [];
const notes = [];
function report(name, ok, detail = "") {
  console.log(`  [${ok ? "OK" : "FAIL"}] ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

/**
 * Remote development databases (Neon and friends) drop idle connections and
 * wake slowly, so every call is retried a few times before it is reported.
 * Retries are safe because the seeder is idempotent.
 */
async function retrying(action, label, attempts = 5) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const wait = 800 * attempt;
        console.log(`  (retry ${attempt}/${attempts - 1} for ${label} in ${wait}ms)`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  throw lastError;
}

// --------------------------------------------------------------------------
// Minimal cookie-keeping API client
// --------------------------------------------------------------------------
function makeClient() {
  let cookie = "";
  return async function call(method, path, body) {
    return retrying(async () => {
      const response = await fetch(`${BASE}/api${path}`, {
        method,
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
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
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      // A sleeping serverless database answers 503; retry instead of failing.
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
  if (result.status !== 200) {
    throw new Error(`Login failed for ${email}: ${result.status} ${result.body?.error?.message ?? ""}`);
  }
  return call;
}

const rfqTitles = {
  draft: `${PREFIX} Stationery restock (draft, 2 items)`,
  open: `${PREFIX} IT peripherals procurement (open, 3 vendors)`,
  closed: `${PREFIX} Ergonomic workstations (closed, 5 quotes)`,
};

// Prices are chosen so the comparison result is unambiguous:
//   C = D = 494,560.00 (lowest, tie broken by submission time)
//   A = 528,100.00     E = 548,660.00 (excluded: USD)
//   B = 577,480.00     (highest)
const closedItems = [
  { description: "Ergonomic office chair with lumbar support", quantity: "20", unit: "pcs" },
  { description: "Height-adjustable standing desk 140 cm", quantity: "10", unit: "pcs" },
  { description: "Mono laser printer with network card", quantity: "5", unit: "pcs" },
];

const quotes = {
  A: { email: "vendor@vendorbridge.dev", prices: ["9000", "15000", "23000"], tax: "18", shipping: "3000", delivery: 7 },
  B: { email: "zenith@vendorbridge.dev", prices: ["9800", "16500", "25000"], tax: "18", shipping: "4000", delivery: 10 },
  C: { email: "apex@vendorbridge.dev", prices: ["8500", "14200", "21000"], tax: "18", shipping: "2500", delivery: 12 },
  D: { email: "bluepeak@vendorbridge.dev", prices: ["8500", "14200", "21000"], tax: "18", shipping: "2500", delivery: 12 },
  E: { email: "greenleaf@vendorbridge.dev", prices: ["9200", "15800", "24000"], tax: "18", shipping: "3500", delivery: 9 },
};

// --------------------------------------------------------------------------
// Step 0 — vendor logins that the base seed does not create
// --------------------------------------------------------------------------
async function ensureVendorAccount(email, vendorName) {
  const password = "Vendor@123";
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        firstName: "Demo",
        lastName: vendorName.split(" ")[0],
        email,
        phone: "+91 90000 11111",
        country: "India",
        role: "vendor",
        additionalInfo: `${vendorName} — account manager`,
        passwordHash: await hashPassword(password),
        createdAt: new Date(),
      },
    });
    notes.push(`created vendor login ${email}`);
  }
  const vendor = await prisma.vendor.findFirst({ where: { name: vendorName } });
  if (!vendor) throw new Error(`Vendor record "${vendorName}" not found. Run npm run seed first.`);
  if (vendor.userId !== user.id) {
    await prisma.vendor.update({ where: { id: vendor.id }, data: { userId: user.id } });
    notes.push(`linked ${vendorName} to ${email}`);
  }
  return vendor;
}

// --------------------------------------------------------------------------
// Step 1 — RFQs
// --------------------------------------------------------------------------
async function findRfq(title) {
  return prisma.rfq.findFirst({ where: { title } });
}

async function createRfqIfMissing(admin, title, payload) {
  const existing = await findRfq(title);
  if (existing) return existing;
  const created = await admin("POST", "/rfqs", { title, ...payload });
  if (created.status !== 201) {
    throw new Error(
      `Creating "${title}" failed: ${created.status} ${created.body?.error?.message ?? ""} ${
        JSON.stringify(created.body?.error?.fields ?? {}) || ""
      }`,
    );
  }
  notes.push(`created RFQ ${created.body.rfq.reference}`);
  return created.body.rfq;
}

async function main() {
  failures.length = 0;
  notes.length = 0;
  console.log(`Week 1/2 demo seeder → API ${BASE}, database ${dbTarget}`);

  const [nova, zenith, apex] = [
    await prisma.vendor.findFirst({ where: { name: "Nova Office Supplies" } }),
    await prisma.vendor.findFirst({ where: { name: "Zenith IT Solutions" } }),
    await prisma.vendor.findFirst({ where: { name: "Apex Hardware" } }),
  ];
  const bluepeak = await ensureVendorAccount("bluepeak@vendorbridge.dev", "BluePeak Logistics");
  const greenleaf = await ensureVendorAccount("greenleaf@vendorbridge.dev", "GreenLeaf Facilities");
  if (!nova || !zenith || !apex) throw new Error("Base vendor records missing. Run npm run seed first.");

  const admin = await login("admin@vendorbridge.dev", "Admin@123");
  report("admin sign-in", true);

  // --- 1. draft RFQ ------------------------------------------------------
  const draft = await createRfqIfMissing(admin, rfqTitles.draft, {
    description: "Two line items, still a draft: nothing is visible to vendors until it is published.",
    currency: "INR",
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    items: [
      { description: "A4 copier paper ream 500 sheets", quantity: "60", unit: "pack" },
      { description: "Gel ink pen blue (box of 100)", quantity: "12", unit: "box" },
    ],
    vendorIds: [],
  });
  const draftRow = await prisma.rfq.findUnique({ where: { id: draft.id }, include: { items: true } });
  report(
    "draft RFQ exists with 2 line items",
    draftRow.status === "draft" && draftRow.items.length === 2 && !draftRow.publishedAt,
    `${draftRow.reference} status=${draftRow.status} items=${draftRow.items.length}`,
  );

  // --- 2. open RFQ (deadline +7 days, 3 vendors) --------------------------
  const open = await createRfqIfMissing(admin, rfqTitles.open, {
    description: "Published and accepting quotations for the next seven days.",
    currency: "INR",
    deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    items: [
      { description: "27-inch QHD business monitor", quantity: "15", unit: "pcs" },
      { description: "USB-C docking station", quantity: "15", unit: "pcs" },
      { description: "Wireless keyboard and mouse set", quantity: "25", unit: "set" },
    ],
    vendorIds: [nova.id, zenith.id, apex.id],
  });
  if (open.status === "draft") {
    const published = await admin("POST", `/rfqs/${open.id}/publish`);
    if (published.status !== 200) throw new Error(`Publishing open RFQ failed: ${published.status}`);
    notes.push(`published ${open.reference}`);
  }
  const openRow = await findRfq(rfqTitles.open);
  const daysToDeadline = Math.round((openRow.deadline.getTime() - Date.now()) / 864e5);
  report(
    "open RFQ published, deadline ~7 days out, 3 vendors",
    openRow.status === "open" && daysToDeadline >= 6 && daysToDeadline <= 7,
    `${openRow.reference} status=${openRow.status} deadline in ${daysToDeadline}d`,
  );
  report(
    "open RFQ is assigned to 3 vendors",
    (await prisma.rfqAssignment.count({ where: { rfqId: openRow.id } })) === 3,
  );

  // --- 3. closed RFQ (5 vendors) -----------------------------------------
  const closed = await createRfqIfMissing(admin, rfqTitles.closed, {
    description:
      "Comparison demo: five suppliers quoted, one tie broken on submission time and one bid disqualified for currency.",
    currency: "INR",
    deadline: new Date(Date.now() + 2 * 864e5).toISOString(),
    items: closedItems,
    vendorIds: [nova.id, zenith.id, apex.id, bluepeak.id, greenleaf.id],
  });
  if (closed.status === "draft") {
    const published = await admin("POST", `/rfqs/${closed.id}/publish`);
    if (published.status !== 200) throw new Error(`Publishing closed RFQ failed: ${published.status}`);
    notes.push(`published ${closed.reference}`);
  }

  const rfqDetail = await admin("GET", `/rfqs/${closed.id}`);
  const rfqItems = rfqDetail.body?.rfq?.items ?? [];
  report("closed RFQ has 3 line items", rfqItems.length === 3, `${closed.reference}`);

  // --- 4. five quotations ------------------------------------------------
  const vendorIds = {
    A: nova.id,
    B: zenith.id,
    C: apex.id,
    D: bluepeak.id,
    E: greenleaf.id,
  };

  for (const [label, config] of Object.entries(quotes)) {
    const existing = await prisma.quotation.findFirst({
      where: { rfqId: closed.id, vendorId: vendorIds[label], supersededAt: null },
    });
    if (existing) {
      report(`quotation ${label} already present`, true, `total ${existing.total.toFixed(2)}`);
      continue;
    }
    const vendorCall = await login(config.email, "Vendor@123");
    const submitted = await vendorCall("PUT", `/rfqs/${closed.id}/quotation`, {
      deliveryDays: config.delivery,
      deliveryTerms: "Delivered to the Bengaluru office in one consignment.",
      notes: `Demo bid ${label}.`,
      taxPercent: config.tax,
      shippingAmount: config.shipping,
      items: rfqItems.map((item, index) => ({
        rfqItemId: item.id,
        unitPrice: config.prices[index],
      })),
    });
    if (submitted.status !== 201 && submitted.status !== 200) {
      throw new Error(`Quotation ${label} submission failed: ${submitted.status} ${submitted.body?.error?.message ?? ""}`);
    }
    notes.push(`submitted quotation ${label} (${config.email})`);
    report(`quotation ${label} submitted`, true, `revision ${submitted.body.revision}`);
  }

  // Documented direct data touches (the API intentionally does not accept them):
  //   D — same terms as C but submitted two hours later, to exercise the
  //       earliest-submission tie-break.
  //   E — quoted in a currency other than the RFQ's, to exercise exclusion.
  const cRow = await prisma.quotation.findFirst({
    where: { rfqId: closed.id, vendorId: vendorIds.C, supersededAt: null },
  });
  const dRow = await prisma.quotation.findFirst({
    where: { rfqId: closed.id, vendorId: vendorIds.D, supersededAt: null },
  });
  const eRow = await prisma.quotation.findFirst({
    where: { rfqId: closed.id, vendorId: vendorIds.E, supersededAt: null },
  });

  const dTarget = new Date(cRow.submittedAt.getTime() + 2 * 3600_000);
  // Vendor D must sit exactly two hours behind Vendor C so the tie-break has a
  // clear, documented winner regardless of how fast the submissions landed.
  if (Math.abs(dRow.submittedAt.getTime() - dTarget.getTime()) > 60_000) {
    await prisma.quotation.update({
      where: { id: dRow.id },
      data: { submittedAt: dTarget, updatedAt: dTarget },
    });
    notes.push("set Vendor D submission two hours after Vendor C");
  }
  if (eRow.currency !== "USD") {
    await prisma.quotation.update({ where: { id: eRow.id }, data: { currency: "USD" } });
    notes.push("set Vendor E quotation currency to USD");
  }
  report(
    "Vendor D ties Vendor C and submits later",
    (await prisma.quotation.findUnique({ where: { id: dRow.id } })).submittedAt >
      (await prisma.quotation.findUnique({ where: { id: cRow.id } })).submittedAt,
  );
  report(
    "Vendor E quoted in USD",
    (await prisma.quotation.findUnique({ where: { id: eRow.id } })).currency === "USD",
  );

  // --- 5. past deadline + close ------------------------------------------
  const yesterday = new Date(Date.now() - 864e5);
  const current = await prisma.rfq.findUnique({ where: { id: closed.id }, select: { deadline: true, status: true } });
  if (current.deadline.getTime() > yesterday.getTime()) {
    await prisma.rfq.update({
      where: { id: closed.id },
      data: { deadline: yesterday, updatedAt: new Date() },
    });
    notes.push("set closed RFQ deadline to yesterday");
  }
  if ((await prisma.rfq.findUnique({ where: { id: closed.id }, select: { status: true } })).status === "open") {
    const closedResult = await admin("POST", `/rfqs/${closed.id}/close`);
    if (closedResult.status !== 200) throw new Error(`Closing RFQ failed: ${closedResult.status}`);
    notes.push(`closed ${closed.reference}`);
  }

  const closedRow = await prisma.rfq.findUnique({ where: { id: closed.id } });
  const quotationCount = await prisma.quotation.count({ where: { rfqId: closed.id } });
  report(
    "closed RFQ: published, deadline in the past, 5 quotations",
    closedRow.status === "closed" &&
      closedRow.publishedAt !== null &&
      closedRow.deadline.getTime() < Date.now() &&
      quotationCount === 5,
    `${closedRow.reference} status=${closedRow.status} quotes=${quotationCount} deadline=${closedRow.deadline.toISOString()}`,
  );

  // --- 6. comparison result ---------------------------------------------
  const comparison = await admin("GET", `/rfqs/${closed.id}/comparison`);
  const summary = comparison.body?.summary ?? {};
  const lowest = comparison.body?.lowest ?? {};
  const excluded = comparison.body?.excluded ?? [];
  report(
    "comparison: 4 comparable, 1 excluded",
    summary.comparableCount === 4 && summary.excludedCount === 1,
    `comparable=${summary.comparableCount} excluded=${summary.excludedCount}`,
  );
  report(
    "comparison: Vendor C wins the tie on earliest submission",
    Boolean(lowest) && lowest.vendorId === vendorIds.C && Number(lowest.total) === 494560,
    `${lowest.vendorName ?? "-"} total=${lowest.total ?? "-"}`,
  );
  report(
    "comparison: Vendor E excluded for currency",
    excluded.length === 1 &&
      excluded[0]?.vendorId === vendorIds.E &&
      (excluded[0]?.reasons?.[0] ?? "").includes("USD"),
    (excluded[0]?.reasons ?? []).join("; "),
  );

  // --- 7. approval → purchase order → invoice for the winning bid --------
  const procurement = await login("procurement@vendorbridge.dev", "Procure@123");
  const manager = await login("manager@vendorbridge.dev", "Manager@123");
  report("procurement and manager sign-in", true);

  /** Creates the request once; later runs find it by its (unique) quotation. */
  async function ensureApproval(quotationId, requestRemarks) {
    const existing = await prisma.approvalRequest.findUnique({ where: { quotationId } });
    if (existing) {
      report(`approval for quotation ${quotationId} already present`, true, `status=${existing.status}`);
      return existing;
    }
    const created = await procurement("POST", "/approvals", { quotationId, remarks: requestRemarks });
    if (created.status !== 201) {
      throw new Error(
        `Approval request for quotation ${quotationId} failed: ${created.status} ${created.body?.error?.message ?? ""}`,
      );
    }
    notes.push(`requested approval for quotation ${quotationId}`);
    report(`approval requested for quotation ${quotationId}`, created.body.approval.status === "pending");
    return prisma.approvalRequest.findUnique({ where: { quotationId } });
  }

  const approved = await ensureApproval(
    cRow.id,
    "Demo: please approve the lowest compliant workstation bid.",
  );
  if (approved.status === "pending") {
    const decision = await manager("POST", `/approvals/${approved.id}/approve`, {
      remarks: "Approved: lowest compliant bid, delivery inside the required window.",
    });
    if (decision.status !== 200) {
      throw new Error(`Approving request ${approved.id} failed: ${decision.status} ${decision.body?.error?.message ?? ""}`);
    }
    notes.push(`manager approved approval request ${approved.id}`);
  }
  const approvedRow = await prisma.approvalRequest.findUnique({
    where: { id: approved.id },
    include: { events: true },
  });
  report(
    "approval history keeps requester, approver, remarks and both timestamps",
    approvedRow.status === "approved" &&
      approvedRow.events.length >= 2 &&
      Boolean(approvedRow.approverId) &&
      Boolean(approvedRow.decidedAt) &&
      Boolean(approvedRow.requestRemarks) &&
      Boolean(approvedRow.decisionRemarks),
    `status=${approvedRow.status} events=${approvedRow.events.length}`,
  );

  const poCreated = await procurement("POST", "/purchase-orders", { approvalRequestId: approvedRow.id });
  if (poCreated.status !== 201 && poCreated.status !== 200) {
    throw new Error(`Generating the purchase order failed: ${poCreated.status} ${poCreated.body?.error?.message ?? ""}`);
  }
  if (poCreated.body.created) notes.push(`generated purchase order ${poCreated.body.purchaseOrder.number}`);
  const poRow = await prisma.purchaseOrder.findUnique({
    where: { id: poCreated.body.purchaseOrder.id },
    include: { items: true },
  });
  const lineSum = poRow.items.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  report(
    "purchase order has a unique number and correct totals",
    /^PO-\d{4,}$/.test(poRow.number) &&
      poRow.items.length === 3 &&
      Math.abs(lineSum - Number(poRow.subtotal)) < 0.01 &&
      Math.abs(Number(poRow.subtotal) + Number(poRow.taxAmount) + Number(poRow.shippingAmount) - Number(poRow.total)) < 0.01,
    `${poRow.number} total=${poRow.total.toFixed(2)}`,
  );
  report(
    "purchase order is linked to its quotation, RFQ and approved request",
    poRow.quotationId === cRow.id && poRow.rfqId === closed.id && poRow.vendorId === vendorIds.C && poRow.approvalRequestId === approvedRow.id,
    `quotation ${poRow.quotationId}, rfq ${poRow.rfqId}, vendor ${poRow.vendorId}`,
  );

  const duplicatePo = await procurement("POST", "/purchase-orders", { approvalRequestId: approvedRow.id });
  report(
    "a second PO for the same approval reuses the existing document",
    duplicatePo.status === 200 &&
      duplicatePo.body.created === false &&
      duplicatePo.body.purchaseOrder.number === poRow.number,
    `${duplicatePo.status} ${duplicatePo.body?.purchaseOrder?.number ?? ""}`,
  );

  const dueDate = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const invoiceCreated = await procurement("POST", "/invoices", { purchaseOrderId: poRow.id, dueDate });
  if (invoiceCreated.status !== 201 && invoiceCreated.status !== 200) {
    throw new Error(`Generating the invoice failed: ${invoiceCreated.status} ${invoiceCreated.body?.error?.message ?? ""}`);
  }
  if (invoiceCreated.body.created) notes.push(`generated invoice ${invoiceCreated.body.invoice.number}`);
  let invoiceRow = await prisma.invoice.findUnique({
    where: { id: invoiceCreated.body.invoice.id },
    include: { items: true },
  });
  // Documented direct touch: an invoice created before due dates existed gets
  // the same 30-day term this seeder asks for, so the demo document is complete.
  if (!invoiceRow.dueDate) {
    await prisma.invoice.update({
      where: { id: invoiceRow.id },
      data: { dueDate: new Date(invoiceRow.issueDate.getTime() + 30 * 864e5), updatedAt: new Date() },
    });
    notes.push(`set a 30-day due date on ${invoiceRow.number}`);
    invoiceRow = await prisma.invoice.findUnique({ where: { id: invoiceRow.id }, include: { items: true } });
  }
  report(
    "invoice carries the purchase order totals and a 30-day term",
    invoiceRow.purchaseOrderId === poRow.id &&
      invoiceRow.items.length === 3 &&
      invoiceRow.currency === poRow.currency &&
      Math.abs(Number(invoiceRow.total) - Number(poRow.total)) < 0.01 &&
      Boolean(invoiceRow.dueDate) &&
      invoiceRow.dueDate > invoiceRow.issueDate,
    `${invoiceRow.number} total=${invoiceRow.total.toFixed(2)} due=${invoiceRow.dueDate.toISOString().slice(0, 10)} email=${invoiceRow.emailStatus}`,
  );

  const duplicateInvoice = await procurement("POST", "/invoices", { purchaseOrderId: poRow.id });
  report(
    "a second invoice for the same PO reuses the existing document",
    duplicateInvoice.status === 200 &&
      duplicateInvoice.body.created === false &&
      duplicateInvoice.body.invoice.number === invoiceRow.number,
    `${duplicateInvoice.status} ${duplicateInvoice.body?.invoice?.number ?? ""}`,
  );

  // Delivery is only attempted when explicitly requested: the demo vendors have
  // addresses that must not receive real mail by accident.
  if (process.env.DEMO_SEND_INVOICE_EMAIL === "true") {
    const sent = await procurement("POST", `/invoices/${invoiceRow.id}/send`);
    report(
      "invoice email delivery demonstrated",
      sent.status === 200 && sent.body?.delivery?.status === "sent",
      sent.status === 200 ? sent.body.delivery.provider : `${sent.status} ${sent.body?.error?.code ?? ""}`,
    );
  } else {
    // A previously seeded invoice keeps whatever state its earlier send left
    // (sent/failed/not_configured). Only an invoice created by this run has to
    // still be unsent, because no delivery was requested.
    report(
      "invoice delivery state is recorded (set DEMO_SEND_INVOICE_EMAIL=true to send)",
      ["not_sent", "sent", "failed", "not_configured"].includes(invoiceRow.emailStatus) &&
        (!invoiceCreated.body.created || invoiceRow.emailStatus === "not_sent"),
      `emailStatus=${invoiceRow.emailStatus}`,
    );
  }

  // --- 8. a request waiting in the approver queue -------------------------
  // The open RFQ needs at least one quotation before anything can be reviewed.
  const openDeadline = await prisma.rfq.findUnique({ where: { id: openRow.id }, select: { deadline: true } });
  if (openDeadline.deadline.getTime() < Date.now() + 3600_000) {
    await prisma.rfq.update({
      where: { id: openRow.id },
      data: { deadline: new Date(Date.now() + 7 * 864e5), updatedAt: new Date() },
    });
    notes.push("moved the open RFQ deadline seven days out");
  }
  const openDetail = await admin("GET", `/rfqs/${openRow.id}`);
  const openItems = openDetail.body?.rfq?.items ?? [];
  const openBids = [
    { email: "vendor@vendorbridge.dev", vendorId: nova.id, prices: ["18200", "6400", "2150"], deliveryDays: 6 },
    { email: "zenith@vendorbridge.dev", vendorId: zenith.id, prices: ["17600", "6200", "2300"], deliveryDays: 9 },
  ];
  for (const config of openBids) {
    const existing = await prisma.quotation.findFirst({
      where: { rfqId: openRow.id, vendorId: config.vendorId, supersededAt: null },
    });
    if (existing) continue;
    const vendorCall = await login(config.email, "Vendor@123");
    const submitted = await vendorCall("PUT", `/rfqs/${openRow.id}/quotation`, {
      deliveryDays: config.deliveryDays,
      deliveryTerms: "Delivered to the Bengaluru office in one consignment.",
      notes: "Demo bid for the open RFQ.",
      taxPercent: "18",
      shippingAmount: "1200",
      items: openItems.map((item, index) => ({ rfqItemId: item.id, unitPrice: config.prices[index] })),
    });
    if (submitted.status !== 201 && submitted.status !== 200) {
      throw new Error(`Open-RFQ quotation for ${config.email} failed: ${submitted.status} ${submitted.body?.error?.message ?? ""}`);
    }
    notes.push(`submitted an open-RFQ quotation as ${config.email}`);
  }
  const zenithOpenQuote = await prisma.quotation.findFirst({
    where: { rfqId: openRow.id, vendorId: zenith.id, supersededAt: null },
  });
  const queueRequest = await ensureApproval(
    zenithOpenQuote.id,
    "Demo: awaiting a manager decision for the open RFQ.",
  );
  report(
    "one request is waiting in the approver queue",
    queueRequest.status === "pending",
    `request ${queueRequest.id} status=${queueRequest.status}`,
  );

  // --- 9. a rejected request with written remarks -------------------------
  const rejectedTitle = `${PREFIX} Warehouse shelving (approval rejected)`;
  const rejectedRfq = await createRfqIfMissing(admin, rejectedTitle, {
    description: "Approval demo: the manager rejects this bid and asks the vendor to re-quote.",
    currency: "INR",
    deadline: new Date(Date.now() + 5 * 864e5).toISOString(),
    items: [
      { description: "Heavy-duty warehouse shelving unit, 2 m", quantity: "18", unit: "pcs" },
      { description: "Pallet jack, 2.5 t capacity", quantity: "2", unit: "pcs" },
    ],
    vendorIds: [apex.id, nova.id],
  });
  if (rejectedRfq.status === "draft") {
    const published = await admin("POST", `/rfqs/${rejectedRfq.id}/publish`);
    if (published.status !== 200) throw new Error(`Publishing the rejection demo RFQ failed: ${published.status}`);
    notes.push(`published ${rejectedRfq.reference}`);
  }
  const rejectedDetail = await admin("GET", `/rfqs/${rejectedRfq.id}`);
  const rejectedItems = rejectedDetail.body?.rfq?.items ?? [];
  let rejectedQuote = await prisma.quotation.findFirst({
    where: { rfqId: rejectedRfq.id, vendorId: apex.id, supersededAt: null },
  });
  if (!rejectedQuote) {
    const apexCall = await login("apex@vendorbridge.dev", "Vendor@123");
    const submitted = await apexCall("PUT", `/rfqs/${rejectedRfq.id}/quotation`, {
      deliveryDays: 21,
      deliveryTerms: "Ex-works, collection from the Pune warehouse.",
      notes: "Demo bid for the rejection case.",
      taxPercent: "18",
      shippingAmount: "4200",
      items: rejectedItems.map((item, index) => ({
        rfqItemId: item.id,
        unitPrice: index === 0 ? "7400" : "18500",
      })),
    });
    if (submitted.status !== 201 && submitted.status !== 200) {
      throw new Error(`Rejection-case quotation failed: ${submitted.status} ${submitted.body?.error?.message ?? ""}`);
    }
    notes.push("submitted the rejection-case quotation as apex@vendorbridge.dev");
    rejectedQuote = await prisma.quotation.findUnique({ where: { id: submitted.body.quotation.id } });
  }
  const rejectedRequest = await ensureApproval(
    rejectedQuote.id,
    "Demo: shelving quote for the shutdown weekend.",
  );
  if (rejectedRequest.status === "pending") {
    const decision = await manager("POST", `/approvals/${rejectedRequest.id}/reject`, {
      remarks: "Rejected: 21-day delivery misses the shutdown window. Please re-quote with a 10-day lead time.",
    });
    if (decision.status !== 200) {
      throw new Error(`Rejecting request ${rejectedRequest.id} failed: ${decision.status} ${decision.body?.error?.message ?? ""}`);
    }
    notes.push(`manager rejected approval request ${rejectedRequest.id}`);
  }
  const rejectedRow = await prisma.approvalRequest.findUnique({
    where: { id: rejectedRequest.id },
    include: { events: true },
  });
  report(
    "rejected request keeps its written reason and history",
    rejectedRow.status === "rejected" &&
      Boolean(rejectedRow.decisionRemarks) &&
      rejectedRow.events.some((event) => event.type === "rejected" && Boolean(event.remarks)),
    `status=${rejectedRow.status} events=${rejectedRow.events.length}`,
  );

  // --- summary ------------------------------------------------------------
  const [rfqCount, quoteCount, approvalCount, poCount, invoiceCount] = [
    await prisma.rfq.count(),
    await prisma.quotation.count({ where: { supersededAt: null } }),
    await prisma.approvalRequest.count(),
    await prisma.purchaseOrder.count(),
    await prisma.invoice.count(),
  ];
  console.log(
    `\nDatabase now holds ${rfqCount} RFQs, ${quoteCount} live quotations, ${approvalCount} approval requests, ${poCount} purchase orders and ${invoiceCount} invoices.`,
  );
  if (notes.length) {
    console.log("Changes made by this run:");
    for (const note of notes) console.log(`  - ${note}`);
  } else {
    console.log("No changes were needed; demo data was already present.");
  }
  console.log("\nDemo credentials (from npm run seed): admin/procurement/manager/vendor @vendorbridge.dev");

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll Week 1/2/3 demo checks passed.");
  }
}

try {
  // A dropped connection to a remote dev database restarts the pass; every
  // step below reuses existing records, so nothing is duplicated.
  await retrying(main, "demo seed pass", 4);
} catch (error) {
  console.error(`Seeder failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
