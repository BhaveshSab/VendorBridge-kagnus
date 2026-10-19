import "dotenv/config";

let prisma;
let now;
let nextSequence;
const dayMs = 24 * 60 * 60 * 1000;
const tag = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

async function ensureSixActiveVendors(tx, createdBy) {
  const vendors = await tx.vendor.findMany({
    where: { status: "Active" }, orderBy: { id: "asc" }, take: 6,
  });
  for (let i = vendors.length; i < 6; i += 1) {
    const suffix = `${tag}-${i + 1}`;
    vendors.push(await tx.vendor.create({
      data: {
        code: `DEMO-${suffix}`,
        name: `Comparison Demo Vendor ${i + 1} ${tag}`,
        category: "IT Equipment",
        email: `comparison-demo-${suffix}@example.invalid`,
        country: "India",
        city: "Ludhiana",
        contactName: `Demo Contact ${i + 1}`,
        status: "Active",
        rating: 4,
        createdBy,
        createdAt: now(),
        updatedAt: now(),
      },
    }));
  }
  return vendors;
}

async function createRfq(tx, { title, description, status, deadline, creatorId, vendors, items }) {
  const sequence = await nextSequence("RFQ", tx);
  const timestamp = now();
  return tx.rfq.create({
    data: {
      reference: `RFQ-${String(sequence).padStart(4, "0")}`,
      title,
      description,
      currency: "INR",
      status,
      deadline,
      createdBy: creatorId,
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: status === "open" ? timestamp : null,
      items: { create: items.map((item, index) => ({ position: index + 1, ...item })) },
      assignments: { create: vendors.map((vendor) => ({ vendorId: vendor.id, assignedAt: timestamp })) },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });
}

async function createBid(tx, rfq, vendor, { prices, currency = "INR", submittedAt = now() }) {
  const lines = rfq.items.map((item, index) => {
    const lineTotal = prices[index] * Number(item.quantity);
    return { rfqItemId: item.id, unitPrice: prices[index].toFixed(2), lineTotal: lineTotal.toFixed(2) };
  });
  const subtotal = lines.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  return tx.quotation.create({
    data: {
      rfqId: rfq.id,
      vendorId: vendor.id,
      currency,
      deliveryDays: 7,
      deliveryTerms: "Demo delivery",
      notes: "Comparison engine demo submission",
      taxPercent: "0.00",
      subtotal: subtotal.toFixed(2),
      taxAmount: "0.00",
      shippingAmount: "0.00",
      total: subtotal.toFixed(2),
      revision: 1,
      status: "submitted",
      submittedAt,
      updatedAt: submittedAt,
      items: { create: lines },
    },
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set; no database was modified.");
  ({ prisma, now, nextSequence } = await import("../server/db.js"));

  const base = await prisma.$transaction(async (tx) => {
    const creator = await tx.user.findFirst({
      where: { role: { in: ["procurement", "admin"] } }, orderBy: { id: "asc" },
    });
    if (!creator) throw new Error("No procurement/admin user found. Run the normal demo seed first.");
    const vendors = await ensureSixActiveVendors(tx, creator.id);
    const openDraft = await createRfq(tx, {
      title: `Demo — Draft and publish flow ${tag}`,
      description: "Draft RFQ assigned to three active vendors; publish to test the workflow.",
      status: "draft",
      deadline: new Date(Date.now() + 7 * dayMs),
      creatorId: creator.id,
      vendors: vendors.slice(0, 3),
      items: [
        { description: "Workstation laptops", quantity: "4", unit: "pcs", specifications: "16 GB RAM, 512 GB SSD" },
        { description: "USB-C docking stations", quantity: "4", unit: "pcs", specifications: "Dual display support" },
      ],
    });
    // Seed as open/future so PostgreSQL's deferred deadline trigger accepts
    // the bids. After they commit, this RFQ is changed to closed/past-deadline.
    const comparison = await createRfq(tx, {
      title: `Demo — Five-bid comparison and tie-break ${tag}`,
      description: "Comparison fixture with three valid bids, an exact tie, and one USD bid excluded by currency.",
      status: "open",
      deadline: new Date(Date.now() + dayMs),
      creatorId: creator.id,
      vendors: vendors.slice(0, 5),
      items: [
        { description: "Servers", quantity: "1", unit: "unit", specifications: "Rack server" },
        { description: "Racks", quantity: "1", unit: "unit", specifications: "42U cabinet" },
        { description: "Switches", quantity: "1", unit: "unit", specifications: "48-port managed switch" },
      ],
    });
    return { vendors, openDraft, comparison };
  }, { timeout: 60000 });

  const [vendorA, vendorB, vendorC, vendorD, vendorE] = base.vendors;
  let bids;
  await prisma.$transaction(async (tx) => {
    const a = await createBid(tx, base.comparison, vendorA, { prices: [100000, 15000, 20000] });
    const b = await createBid(tx, base.comparison, vendorB, { prices: [105000, 17000, 22000] });
    const c = await createBid(tx, base.comparison, vendorC, { prices: [80000, 12000, 18000] });

    // The DB insert trigger normally stamps real PostgreSQL time. For this
    // isolated fixture, briefly bypass that one trigger to synthesize D's
    // requested +2h timestamp; it is re-enabled before the transaction commits.
    await tx.$executeRawUnsafe('ALTER TABLE "quotations" DISABLE TRIGGER "quotations_revision_insert_trigger"');
    let d;
    try {
      d = await createBid(tx, base.comparison, vendorD, {
        prices: [80000, 12000, 18000],
        submittedAt: new Date(c.submittedAt.getTime() + 2 * 60 * 60 * 1000),
      });
    } finally {
      await tx.$executeRawUnsafe('ALTER TABLE "quotations" ENABLE TRIGGER "quotations_revision_insert_trigger"');
    }
    const e = await createBid(tx, base.comparison, vendorE, {
      currency: "USD", prices: [70000, 10000, 15000],
    });
    bids = [a, b, c, d, e];
  }, { timeout: 30000 });

  const closedAt = now();
  const closedRfq = await prisma.rfq.update({
    where: { id: base.comparison.id },
    data: {
      status: "closed",
      deadline: new Date(Date.now() - dayMs),
      closedAt,
      updatedAt: closedAt,
    },
  });
  console.log(JSON.stringify({
    activeVendors: base.vendors.map(({ id, code, name }) => ({ id, code, name })),
    openDraftRfq: {
      id: base.openDraft.id,
      reference: base.openDraft.reference,
      deadline: base.openDraft.deadline,
      url: `/rfqs/${base.openDraft.id}`,
    },
    closedComparisonRfq: {
      id: closedRfq.id,
      reference: closedRfq.reference,
      status: closedRfq.status,
      deadline: closedRfq.deadline,
      comparisonUrl: `/rfqs/${closedRfq.id}/compare`,
    },
    bids: bids.map((bid, i) => ({
      vendor: ["A", "B", "C — Winner", "D — Tie-breaker", "E — USD excluded"][i],
      quotationId: bid.id,
      total: bid.total.toFixed(2),
      currency: bid.currency,
      submittedAt: bid.submittedAt.toISOString(),
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Unable to seed the RFQ comparison demo:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma?.$disconnect();
  });
