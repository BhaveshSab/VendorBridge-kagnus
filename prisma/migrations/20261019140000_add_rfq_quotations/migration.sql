-- CreateTable
CREATE TABLE "rfqs" (
    "id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "deadline" TIMESTAMP(3) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_items" (
    "id" SERIAL NOT NULL,
    "rfq_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "specifications" TEXT,

    CONSTRAINT "rfq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_assignments" (
    "id" SERIAL NOT NULL,
    "rfq_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotations" (
    "id" SERIAL NOT NULL,
    "rfq_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "delivery_days" INTEGER NOT NULL,
    "delivery_terms" TEXT,
    "notes" TEXT,
    "tax_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "shipping_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" SERIAL NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "rfq_item_id" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_reference_key" ON "rfqs"("reference");

-- CreateIndex
CREATE INDEX "rfqs_status_idx" ON "rfqs"("status");

-- CreateIndex
CREATE INDEX "rfqs_deadline_idx" ON "rfqs"("deadline");

-- CreateIndex
CREATE INDEX "rfqs_created_by_idx" ON "rfqs"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_items_rfq_id_position_key" ON "rfq_items"("rfq_id", "position");

-- CreateIndex
CREATE INDEX "rfq_items_rfq_id_idx" ON "rfq_items"("rfq_id");

-- CreateIndex
CREATE UNIQUE INDEX "rfq_assignments_rfq_id_vendor_id_key" ON "rfq_assignments"("rfq_id", "vendor_id");

-- CreateIndex
CREATE INDEX "rfq_assignments_vendor_id_idx" ON "rfq_assignments"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_rfq_id_vendor_id_key" ON "quotations"("rfq_id", "vendor_id");

-- CreateIndex
CREATE INDEX "quotations_rfq_id_idx" ON "quotations"("rfq_id");

-- CreateIndex
CREATE INDEX "quotations_vendor_id_idx" ON "quotations"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_items_quotation_id_rfq_item_id_key" ON "quotation_items"("quotation_id", "rfq_item_id");

-- CreateIndex
CREATE INDEX "quotation_items_rfq_item_id_idx" ON "quotation_items"("rfq_item_id");

-- AddForeignKey
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_assignments" ADD CONSTRAINT "rfq_assignments_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_assignments" ADD CONSTRAINT "rfq_assignments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_rfq_item_id_fkey" FOREIGN KEY ("rfq_item_id") REFERENCES "rfq_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business-rule constraints enforced by the database, in addition to the
-- Zod validation and lifecycle checks in the API.
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_status_check" CHECK ("status" IN ('draft', 'open', 'closed', 'cancelled'));
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "rfq_items" ADD CONSTRAINT "rfq_items_position_check" CHECK ("position" > 0);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_delivery_days_check" CHECK ("delivery_days" >= 0);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tax_percent_check" CHECK ("tax_percent" >= 0 AND "tax_percent" <= 100);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_amounts_check" CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "shipping_amount" >= 0 AND "total" >= 0);
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_revision_check" CHECK ("revision" >= 1);
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_prices_check" CHECK ("unit_price" >= 0 AND "line_total" >= 0);
