/**
 * Week 4 — notification end-to-end verification.
 *
 * Drives the real procurement lifecycle over HTTP (RFQ → quotation → approval
 * → decision → purchase order → invoice → email attempt) and then reads
 * PostgreSQL to prove that:
 *   - each event writes a notification to the intended recipients;
 *   - the actor who performed the action is never notified of their own action;
 *   - vendors only see their own rows, and another user's notification cannot
 *     be marked read (404, not a silent success);
 *   - unread counts, mark-one-read and mark-all-read persist.
 *
 * The harness cleans up the documents it creates. Notifications are deleted by
 * (entity type, entity id), so unrelated demo notifications are untouched.
 *
 * Usage:
 *   APP_URL=http://localhost:4000 node scripts/e2e-week4-notifications.mjs
 *
 * Safety: point this at a disposable database. It refuses a remote database
 * unless NOTIFY_E2E_ALLOW_REMOTE=1 is set explicitly.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.APP_URL || "http://localhost:4000";
const PREFIX = "E2E Notify W4";
const stamp = Date.now().toString(36);
const DAY = 86_400_000;

const dbUrl = process.env.DATABASE_URL || "";
let parsedDb = null;
try {
  parsedDb = new URL(dbUrl);
} catch {
  parsedDb = null;
}
const loopback = parsedDb && ["127.0.0.1", "localhost", "::1"].includes(parsedDb.hostname);
const disposable = parsedDb && /e2e|test/i.test(parsedDb.pathname);
if (!loopback || !disposable) {
  if (process.env.NOTIFY_E2E_ALLOW_REMOTE !== "1") {
    console.error(
      "Refusing to run: DATABASE_URL is not a loopback database whose name contains 'e2e' or 'test'.\n" +
        "Set NOTIFY_E2E_ALLOW_REMOTE=1 only when this database is disposable.",
    );
    process.exit(2);
  }
  console.warn(`[warn] Running against non-disposable database ${parsedDb?.hostname}${parsedDb?.pathname ?? ""}`);
}

const prisma = new PrismaClient();
const results = [];
const created = { rfqId: null, approvalId: null, purchaseOrderId: null, invoiceId: null };

function check(id, name, condition, evidence = "") {
  const outcome = condition ? "PASS" : "FAIL";
  results.push({ id, name, outcome, evidence: String(evidence ?? "") });
  console.log(`  [${outcome}] ${id} ${name}${evidence ? ` — ${evidence}` : ""}`);
  return Boolean(condition);
}

function section(title) {
  console.log(`\n== ${title}`);
}

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
      // Neon can drop an idle pooled connection; a bounded request keeps the
      // harness from hanging forever instead of reporting the failure.
      signal: AbortSignal.timeout(30_000),
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
    return { status: response.status, body: json, text, headers: response.headers };
  };
}

async function signIn(account) {
  const call = httpClient();
  const response = await call("POST", "/auth/login", account);
  if (response.status !== 200) throw new Error(`Login failed for ${account.email}: ${response.status}`);
  return call;
}

const accounts = {
  procurement: { email: "procurement@vendorbridge.dev", password: "Procure@123" },
  manager: { email: "manager@vendorbridge.dev", password: "Manager@123" },
  admin: { email: "admin@vendorbridge.dev", password: "Admin@123" },
  vendor: { email: "vendor@vendorbridge.dev", password: "Vendor@123" },
  zenith: { email: "zenith@vendorbridge.dev", password: "Vendor@123" },
};

/** All notification rows for one user, newest first. */
function rowsFor(userId) {
  return prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

function findRow(rows, type, entityId) {
  return rows.find((row) => row.type === type && row.entityId === String(entityId)) ?? null;
}

async function unreadFromDb(userId) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

async function main() {
  console.log(`Week 4 notification verification against ${BASE}`);
  const anon = httpClient();
  const health = await anon("GET", "/health");
  if (health.status !== 200 || health.body?.database !== "connected") {
    throw new Error(`API is not ready (status ${health.status}). Start the server and retry.`);
  }

  const procurement = await signIn(accounts.procurement);
  const manager = await signIn(accounts.manager);
  const admin = await signIn(accounts.admin);
  const vendor = await signIn(accounts.vendor);
  const zenith = await signIn(accounts.zenith);

  const users = await prisma.user.findMany({
    where: { email: { in: Object.values(accounts).map((account) => account.email) } },
    select: { id: true, email: true, role: true },
  });
  const userId = Object.fromEntries(users.map((row) => [row.email, row.id]));
  const nova = await prisma.vendor.findFirst({ where: { userId: userId[accounts.vendor.email] }, select: { id: true, name: true } });
  if (!nova) throw new Error("Seeded vendor account is not linked to a vendor record.");
  const zenithVendor = await prisma.vendor.findFirst({ where: { userId: userId[accounts.zenith.email] }, select: { id: true } });

  // ---------------------------------------------------------------- baseline
  section("0. Baseline");
  const vendorBefore = await rowsFor(userId[accounts.vendor.email]);
  const zenithBefore = await rowsFor(userId[accounts.zenith.email]);
  check("N0-1", "Seeded accounts resolve to users", users.length === Object.keys(accounts).length, `${users.length} users`);

  // ------------------------------------------------------------------- RFQ
  section("1. RFQ publication notifies assigned vendors only");
  const createdRfq = await procurement("POST", "/rfqs", {
    title: `${PREFIX} ${stamp}`,
    description: "Week 4 notification QA record. Safe to remove.",
    currency: "INR",
    deadline: new Date(Date.now() + 7 * DAY).toISOString(),
    vendorIds: [nova.id],
    items: [{ description: "Notification QA item", quantity: 2, unit: "unit", specifications: "Harness only" }],
  });
  if (createdRfq.status !== 201) throw new Error(`RFQ create failed (${createdRfq.status}): ${createdRfq.text.slice(0, 300)}`);
  const rfq = createdRfq.body.rfq;
  created.rfqId = rfq.id;

  const published = await procurement("POST", `/rfqs/${rfq.id}/publish`);
  if (published.status !== 200) throw new Error(`RFQ publish failed (${published.status}): ${published.text.slice(0, 300)}`);

  const vendorAfterPublish = await rowsFor(userId[accounts.vendor.email]);
  const rfqInvite = findRow(vendorAfterPublish, "rfq.published", rfq.id);
  check("N1-1", "Assigned vendor receives rfq.published for the real RFQ", Boolean(rfqInvite), rfqInvite ? `#${rfqInvite.id}` : "missing");
  check("N1-2", "The invitation deep-links to the RFQ", rfqInvite?.link === `/rfqs/${rfq.id}`, rfqInvite?.link ?? "no link");
  check(
    "N1-3",
    "Publishing adds exactly one notification for the vendor",
    vendorAfterPublish.length === vendorBefore.length + 1,
    `${vendorBefore.length} → ${vendorAfterPublish.length}`,
  );
  const actorRfqRows = (await rowsFor(userId[accounts.procurement.email])).filter(
    (row) => row.entityType === "rfq" && row.entityId === String(rfq.id),
  );
  check("N1-4", "The staff actor is not notified of their own publish", actorRfqRows.length === 0, `${actorRfqRows.length} rows`);
  const zenithAfterPublish = await rowsFor(userId[accounts.zenith.email]);
  check(
    "N1-5",
    "An unassigned vendor receives nothing for this RFQ",
    findRow(zenithAfterPublish, "rfq.published", rfq.id) === null && zenithAfterPublish.length === zenithBefore.length,
    `${zenithBefore.length} → ${zenithAfterPublish.length}`,
  );

  // ------------------------------------------------------------- quotation
  section("2. Vendor quotation notifies the RFQ creator");
  const quoted = await vendor("PUT", `/rfqs/${rfq.id}/quotation`, {
    deliveryDays: 9,
    deliveryTerms: "Delivered to site",
    notes: "Notification QA quotation.",
    taxPercent: 18,
    shippingAmount: 250,
    items: rfq.items.map((item) => ({ rfqItemId: item.id, unitPrice: 1500 })),
  });
  if (quoted.status !== 201) throw new Error(`Quotation failed (${quoted.status}): ${quoted.text.slice(0, 300)}`);
  const quote = quoted.body.quotation;

  const procurementRows = await rowsFor(userId[accounts.procurement.email]);
  const quoteNotice = findRow(procurementRows, "quotation.submitted", rfq.id);
  check("N2-1", "RFQ creator receives quotation.submitted", Boolean(quoteNotice), quoteNotice ? `#${quoteNotice.id}` : "missing");
  check(
    "N2-2",
    "The quotation notification links to the comparison page",
    quoteNotice?.link === `/rfqs/${rfq.id}/quotations`,
    quoteNotice?.link ?? "no link",
  );
  const vendorAfterQuote = await rowsFor(userId[accounts.vendor.email]);
  check(
    "N2-3",
    "The submitting vendor is not notified of their own quotation",
    vendorAfterQuote.filter((row) => row.type === "quotation.submitted" && row.entityId === String(rfq.id)).length === 0,
  );

  // -------------------------------------------------------------- approval
  section("3. Approval requested notifies reviewers, not the requester");
  const requested = await procurement("POST", "/approvals", { quotationId: quote.id });
  if (requested.status !== 201) throw new Error(`Approval request failed (${requested.status}): ${requested.text.slice(0, 300)}`);
  const approval = requested.body.approval;
  created.approvalId = approval.id;

  const managerRows = await rowsFor(userId[accounts.manager.email]);
  const adminRows = await rowsFor(userId[accounts.admin.email]);
  const managerRequest = findRow(managerRows, "approval.requested", approval.id);
  const adminRequest = findRow(adminRows, "approval.requested", approval.id);
  check("N3-1", "Manager reviewer receives approval.requested", Boolean(managerRequest), managerRequest ? `#${managerRequest.id}` : "missing");
  check("N3-2", "Admin reviewer receives approval.requested", Boolean(adminRequest), adminRequest ? `#${adminRequest.id}` : "missing");
  check(
    "N3-3",
    "The request names the RFQ and vendor and links to the approval",
    Boolean(managerRequest?.body.includes(rfq.reference) && managerRequest?.body.includes(nova.name)) &&
      managerRequest?.link === `/approvals/${approval.id}`,
    managerRequest?.body?.slice(0, 90),
  );
  check(
    "N3-4",
    "The requesting procurement user is not notified of their own request",
    (await rowsFor(userId[accounts.procurement.email])).filter(
      (row) => row.type === "approval.requested" && row.entityId === String(approval.id),
    ).length === 0,
  );

  // -------------------------------------------------------------- decision
  section("4. Decision notifies the requester and the vendor");
  const decided = await manager("POST", `/approvals/${approval.id}/approve`, { remarks: `QA ${stamp}` });
  if (decided.status !== 200) throw new Error(`Approval decision failed (${decided.status}): ${decided.text.slice(0, 300)}`);

  const requesterApproved = findRow(await rowsFor(userId[accounts.procurement.email]), "approval.approved", approval.id);
  const vendorApproved = findRow(await rowsFor(userId[accounts.vendor.email]), "approval.approved", approval.id);
  check("N4-1", "Requester receives approval.approved", Boolean(requesterApproved), requesterApproved ? `#${requesterApproved.id}` : "missing");
  check("N4-2", "Winning vendor receives approval.approved", Boolean(vendorApproved), vendorApproved ? `#${vendorApproved.id}` : "missing");
  check(
    "N4-3",
    "The deciding manager is not notified of their own decision",
    (await rowsFor(userId[accounts.manager.email])).filter(
      (row) => row.type.startsWith("approval.") && row.type !== "approval.requested" && row.entityId === String(approval.id),
    ).length === 0,
  );
  check("N4-4", "The decision body carries the remarks", Boolean(requesterApproved?.body.includes(`QA ${stamp}`)), requesterApproved?.body);
  check(
    "N4-5",
    "The decision links to the RFQ both roles can open",
    requesterApproved?.link === `/rfqs/${rfq.id}` && vendorApproved?.link === `/rfqs/${rfq.id}`,
    `${requesterApproved?.link ?? "none"} / ${vendorApproved?.link ?? "none"}`,
  );

  // -------------------------------------------------------- purchase order
  section("5. Purchase order notifies the vendor");
  const po = await procurement("POST", "/purchase-orders", { approvalRequestId: approval.id });
  if (po.status !== 201 && po.status !== 200) throw new Error(`PO generation failed (${po.status}): ${po.text.slice(0, 300)}`);
  const purchaseOrder = po.body.purchaseOrder;
  created.purchaseOrderId = purchaseOrder.id;

  const vendorPo = findRow(await rowsFor(userId[accounts.vendor.email]), "purchase_order.generated", purchaseOrder.id);
  check("N5-1", "Vendor receives purchase_order.generated", Boolean(vendorPo), vendorPo ? `#${vendorPo.id}` : "missing");
  check(
    "N5-2",
    "The PO notification links to the purchase order and carries the number",
    Boolean(vendorPo?.link === `/purchase-orders/${purchaseOrder.id}` && vendorPo?.body.includes(purchaseOrder.number)),
    vendorPo?.link ?? "no link",
  );
  check(
    "N5-3",
    "The procurement actor is not notified of the PO they issued",
    (await rowsFor(userId[accounts.procurement.email])).filter(
      (row) => row.type === "purchase_order.generated" && row.entityId === String(purchaseOrder.id),
    ).length === 0,
  );
  check(
    "N5-4",
    "A vendor outside the chain receives nothing",
    findRow(await rowsFor(userId[accounts.zenith.email]), "purchase_order.generated", purchaseOrder.id) === null,
  );

  // ---------------------------------------------------------------- invoice
  section("6. Invoice and email events");
  const invoiceResponse = await procurement("POST", "/invoices", { purchaseOrderId: purchaseOrder.id });
  if (invoiceResponse.status !== 201 && invoiceResponse.status !== 200) {
    throw new Error(`Invoice generation failed (${invoiceResponse.status}): ${invoiceResponse.text.slice(0, 300)}`);
  }
  const invoice = invoiceResponse.body.invoice;
  created.invoiceId = invoice.id;

  const vendorInvoice = findRow(await rowsFor(userId[accounts.vendor.email]), "invoice.generated", invoice.id);
  check("N6-1", "Vendor receives invoice.generated", Boolean(vendorInvoice), vendorInvoice ? `#${vendorInvoice.id}` : "missing");
  check(
    "N6-2",
    "The invoice notification links to the invoice and names it",
    Boolean(vendorInvoice?.link === `/invoices/${invoice.id}` && vendorInvoice?.body.includes(invoice.number)),
    vendorInvoice?.link ?? "no link",
  );

  const send = await procurement("POST", `/invoices/${invoice.id}/send`);
  const emailType = send.status === 200 ? "invoice.email_sent" : "invoice.email_not_configured";
  const adminEmail = findRow(await rowsFor(userId[accounts.admin.email]), emailType, invoice.id);
  const vendorEmail = findRow(await rowsFor(userId[accounts.vendor.email]), emailType, invoice.id);
  check(
    "N6-3",
    "An email attempt produces an operational notification for the team",
    (send.status === 200 || send.status === 503) && Boolean(adminEmail),
    `send ${send.status} (${emailType}), notification ${adminEmail ? `#${adminEmail.id}` : "missing"}`,
  );
  check(
    "N6-4",
    "Delivery feedback is not reported to the vendor whose invoice it is",
    vendorEmail === null,
    vendorEmail ? `unexpected #${vendorEmail.id}` : "none",
  );

  // ------------------------------------------------------------------ scope
  section("7. Per-user API scope, unread count and mark-read lifecycle");
  const vendorList = await vendor("GET", "/notifications?pageSize=50");
  const vendorDb = await rowsFor(userId[accounts.vendor.email]);
  check(
    "N7-1",
    "GET /notifications returns only the signed-in user's rows",
    vendorList.status === 200 &&
      Array.isArray(vendorList.body?.items) &&
      vendorList.body.items.length <= 50 &&
      vendorList.body.items.every((row) => vendorDb.some((saved) => saved.id === row.id)) &&
      vendorList.body.total === vendorDb.length,
    `api ${vendorList.body?.items?.length}/${vendorList.body?.total}, db ${vendorDb.length}`,
  );

  const managerList = await manager("GET", "/notifications?pageSize=50");
  const managerDb = await rowsFor(userId[accounts.manager.email]);
  check(
    "N7-2",
    "A different account receives a different, isolated list",
    managerList.status === 200 &&
      managerList.body.items.every((row) => managerDb.some((saved) => saved.id === row.id)) &&
      !managerList.body.items.some((row) => vendorList.body.items.some((other) => other.id === row.id)),
    `manager ${managerList.body?.total}, vendor ${vendorList.body?.total}`,
  );

  const crossTarget = vendorDb.find((row) => row.readAt === null);
  if (!crossTarget) throw new Error("Expected an unread vendor notification to test cross-user access.");
  const cross = await manager("POST", `/notifications/${crossTarget.id}/read`);
  const crossRow = await prisma.notification.findUnique({ where: { id: crossTarget.id } });
  check("N7-3", "Another user's notification cannot be marked read (404)", cross.status === 404, `status ${cross.status}`);
  check("N7-4", "The denied read did not mutate the owner's row", crossRow?.readAt === null, String(crossRow?.readAt));

  const vendorUnreadBefore = await unreadFromDb(userId[accounts.vendor.email]);
  const countResponse = await vendor("GET", "/notifications/unread-count");
  check(
    "N7-5",
    "Unread count matches the stored unread rows",
    countResponse.status === 200 && countResponse.body?.count === vendorUnreadBefore,
    `api ${countResponse.body?.count}, db ${vendorUnreadBefore}`,
  );

  const markOne = await vendor("POST", `/notifications/${crossTarget.id}/read`);
  const afterOne = await prisma.notification.findUnique({ where: { id: crossTarget.id } });
  check(
    "N7-6",
    "Marking one notification read persists and decrements the count",
    markOne.status === 200 &&
      markOne.body?.updated === 1 &&
      markOne.body?.unread === vendorUnreadBefore - 1 &&
      Boolean(afterOne?.readAt),
    `updated ${markOne.body?.updated}, unread ${markOne.body?.unread}`,
  );
  const repeat = await vendor("POST", `/notifications/${crossTarget.id}/read`);
  check(
    "N7-7",
    "Repeating mark-read is idempotent",
    repeat.status === 200 && repeat.body?.updated === 0 && repeat.body?.unread === vendorUnreadBefore - 1,
    `updated ${repeat.body?.updated}`,
  );

  const unreadOnly = await vendor("GET", "/notifications?filter=unread&pageSize=50");
  check(
    "N7-8",
    "filter=unread returns only unread rows",
    unreadOnly.status === 200 &&
      unreadOnly.body.items.length === unreadOnly.body.unread &&
      unreadOnly.body.items.every((row) => row.readAt === null),
    `${unreadOnly.body?.items?.length ?? 0} rows, unread ${unreadOnly.body?.unread}`,
  );

  const markAll = await vendor("POST", "/notifications/read-all");
  check(
    "N7-9",
    "Mark-all-read clears the stored unread count",
    markAll.status === 200 && markAll.body?.unread === 0 && (await unreadFromDb(userId[accounts.vendor.email])) === 0,
    `updated ${markAll.body?.updated}, db unread ${await unreadFromDb(userId[accounts.vendor.email])}`,
  );

  const anonList = await anon("GET", "/notifications");
  const anonCount = await anon("GET", "/notifications/unread-count");
  check(
    "N7-10",
    "Anonymous callers cannot read a bell (401)",
    anonList.status === 401 && anonCount.status === 401,
    `${anonList.status}/${anonCount.status}`,
  );

  const vendorRoles = await vendor("GET", "/activity");
  check("N7-11", "Notifications do not widen audit access for vendors (403)", vendorRoles.status === 403, `status ${vendorRoles.status}`);

  // ------------------------------------------------------------ persistence
  section("8. Persistence across a new session");
  const freshVendor = await signIn(accounts.vendor);
  const freshList = await freshVendor("GET", "/notifications?pageSize=50");
  check(
    "N8-1",
    "A new session reads the same persisted rows and read state",
    freshList.status === 200 &&
      freshList.body.items.length === vendorList.body.items.length &&
      freshList.body.items.every((row) => row.readAt !== null),
    `${freshList.body?.items?.length ?? 0} rows`,
  );

  return results;
}

async function cleanup() {
  section("Cleanup");
  const entityFilters = [
    ["rfq", created.rfqId],
    ["approval", created.approvalId],
    ["purchase_order", created.purchaseOrderId],
    ["invoice", created.invoiceId],
  ]
    .filter(([, id]) => id !== null)
    .map(([entityType, id]) => ({ entityType, entityId: String(id) }));
  if (entityFilters.length > 0) {
    const removed = await prisma.notification.deleteMany({ where: { OR: entityFilters } });
    console.log(`  removed ${removed.count} notification row(s)`);
  }
  if (created.invoiceId) {
    await prisma.invoice.deleteMany({ where: { id: created.invoiceId } });
  }
  if (created.purchaseOrderId) {
    await prisma.purchaseOrder.deleteMany({ where: { id: created.purchaseOrderId } });
  }
  if (created.approvalId) {
    await prisma.approvalRequest.deleteMany({ where: { id: created.approvalId } });
  }
  if (created.rfqId) {
    await prisma.rfq.delete({ where: { id: created.rfqId } }).catch((error) => {
      console.error(`  RFQ cleanup failed: ${error.message}`);
    });
  }
}

let failed = 0;
try {
  const results = await main();
  failed = results.filter((row) => row.outcome === "FAIL").length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
} catch (error) {
  failed = 1;
  console.error(`\n[FATAL] ${error.message}`);
} finally {
  await cleanup().catch((error) => console.error(`cleanup error: ${error.message}`));
  await prisma.$disconnect();
}
process.exitCode = failed > 0 ? 1 : 0;
