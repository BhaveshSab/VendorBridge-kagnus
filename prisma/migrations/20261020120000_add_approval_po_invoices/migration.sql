-- Week 3 - approval, purchase order and invoice workflow (generated, then hand-extended).
-- CreateTable
CREATE TABLE "approval_requests" (
    "id" SERIAL NOT NULL,
    "rfq_id" INTEGER NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "quotation_revision" INTEGER NOT NULL,
    "requester_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "request_remarks" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "approver_id" INTEGER,
    "decided_at" TIMESTAMP(3),
    "decision_remarks" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_events" (
    "id" SERIAL NOT NULL,
    "approval_id" INTEGER NOT NULL,
    "actor_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "rfq_id" INTEGER NOT NULL,
    "quotation_id" INTEGER NOT NULL,
    "approval_request_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "shipping_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issued_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" SERIAL NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "purchase_order_id" INTEGER NOT NULL,
    "rfq_id" INTEGER NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "tax_percent" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "shipping_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "issue_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3),
    "email_status" TEXT NOT NULL DEFAULT 'not_sent',
    "email_provider" TEXT,
    "email_sent_at" TIMESTAMP(3),
    "email_attempts" INTEGER NOT NULL DEFAULT 0,
    "email_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_events" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "actor_id" INTEGER,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_quotation_id_key" ON "approval_requests"("quotation_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_idx" ON "approval_requests"("status");

-- CreateIndex
CREATE INDEX "approval_requests_rfq_id_idx" ON "approval_requests"("rfq_id");

-- CreateIndex
CREATE INDEX "approval_requests_requester_id_idx" ON "approval_requests"("requester_id");

-- CreateIndex
CREATE INDEX "approval_events_approval_id_idx" ON "approval_events"("approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_quotation_id_key" ON "purchase_orders"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_approval_request_id_key" ON "purchase_orders"("approval_request_id");

-- CreateIndex
CREATE INDEX "purchase_orders_vendor_id_idx" ON "purchase_orders"("vendor_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_items_purchase_order_id_idx" ON "purchase_order_items"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_purchase_order_id_position_key" ON "purchase_order_items"("purchase_order_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_purchase_order_id_key" ON "invoices"("purchase_order_id");

-- CreateIndex
CREATE INDEX "invoices_vendor_id_idx" ON "invoices"("vendor_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_email_status_idx" ON "invoices"("email_status");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_invoice_id_position_key" ON "invoice_items"("invoice_id", "position");

-- CreateIndex
CREATE INDEX "invoice_events_invoice_id_idx" ON "invoice_events"("invoice_id");

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "approval_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Workflow guarantees that Prisma cannot express in the schema
-- ---------------------------------------------------------------------------

-- At most one pending/approved approval per RFQ. Rejected rows fall outside the
-- index, so procurement can open a new request for a different quotation after
-- a rejection, while two simultaneous approvals can never both succeed.
CREATE UNIQUE INDEX "approval_requests_one_active_per_rfq"
  ON "approval_requests" ("rfq_id")
  WHERE "status" IN ('pending', 'approved');

-- State and money integrity.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_status_check"
  CHECK ("status" IN ('pending', 'approved', 'rejected'));

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_revision_check"
  CHECK ("quotation_revision" >= 1);

-- A decided request must carry its approver and decision timestamp; a pending
-- one must not.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decision_check"
  CHECK (
    ("status" = 'pending' AND "approver_id" IS NULL AND "decided_at" IS NULL)
    OR (
      "status" IN ('approved', 'rejected')
      AND "approver_id" IS NOT NULL
      AND "decided_at" IS NOT NULL
    )
  );

ALTER TABLE "approval_events" ADD CONSTRAINT "approval_events_type_check"
  CHECK ("type" IN ('requested', 'approved', 'rejected'));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check"
  CHECK ("status" IN ('issued', 'cancelled'));

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_money_check"
  CHECK (
    "tax_percent" >= 0 AND "tax_percent" <= 100
    AND "subtotal" >= 0 AND "tax_amount" >= 0 AND "shipping_amount" >= 0
    AND "total" = "subtotal" + "tax_amount" + "shipping_amount"
  );

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_cancel_check"
  CHECK (
    ("status" = 'issued' AND "cancelled_at" IS NULL AND "cancel_reason" IS NULL)
    OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL)
  );

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_money_check"
  CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "line_total" >= 0);

-- Invoices are issued once and are immutable; only email delivery state moves.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check"
  CHECK ("status" IN ('issued'));

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_email_status_check"
  CHECK ("email_status" IN ('not_sent', 'sent', 'failed', 'not_configured'));

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_money_check"
  CHECK (
    "tax_percent" >= 0 AND "tax_percent" <= 100
    AND "subtotal" >= 0 AND "tax_amount" >= 0 AND "shipping_amount" >= 0
    AND "total" = "subtotal" + "tax_amount" + "shipping_amount"
  );

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_dates_check"
  CHECK ("due_date" IS NULL OR "due_date" >= "issue_date");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_email_check"
  CHECK (
    ("email_status" = 'not_sent' AND "email_sent_at" IS NULL)
    OR ("email_status" = 'sent' AND "email_sent_at" IS NOT NULL)
    OR "email_status" IN ('failed', 'not_configured')
  );

ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_money_check"
  CHECK ("quantity" > 0 AND "unit_price" >= 0 AND "line_total" >= 0);

ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_type_check"
  CHECK ("type" IN ('generated', 'email_sent', 'email_failed', 'email_not_configured'));

-- ---------------------------------------------------------------------------
-- Cross-table relationship checks.
--
-- Foreign keys cannot express "this PO belongs to the same vendor and RFQ as
-- the quotation it was generated from", so each document carries a trigger that
-- re-validates the chain quotation -> approval -> purchase order -> invoice inside
-- the database. Application code checks the same relationships first so users
-- get a readable 4xx instead of a constraint error.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vb_assert_approval_consistency() RETURNS trigger AS $$
DECLARE
  quotation_rfq INTEGER;
BEGIN
  SELECT rfq_id INTO quotation_rfq FROM quotations WHERE id = NEW.quotation_id;
  IF quotation_rfq IS NULL THEN
    RAISE EXCEPTION 'approval request % references a missing quotation %', NEW.id, NEW.quotation_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF quotation_rfq <> NEW.rfq_id THEN
    RAISE EXCEPTION 'approval request % RFQ does not match its quotation', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS approval_requests_consistency ON approval_requests;
CREATE TRIGGER approval_requests_consistency
  BEFORE INSERT OR UPDATE OF rfq_id, quotation_id ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION vb_assert_approval_consistency();

CREATE OR REPLACE FUNCTION vb_assert_purchase_order_consistency() RETURNS trigger AS $$
DECLARE
  quotation_rfq INTEGER;
  quotation_vendor INTEGER;
  approval_status TEXT;
  approval_quotation INTEGER;
BEGIN
  SELECT rfq_id, vendor_id INTO quotation_rfq, quotation_vendor
    FROM quotations WHERE id = NEW.quotation_id;
  IF quotation_rfq IS NULL THEN
    RAISE EXCEPTION 'purchase order % references a missing quotation', NEW.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF quotation_rfq <> NEW.rfq_id OR quotation_vendor <> NEW.vendor_id THEN
    RAISE EXCEPTION 'purchase order % vendor/RFQ do not match its quotation', NEW.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT status, quotation_id INTO approval_status, approval_quotation
    FROM approval_requests WHERE id = NEW.approval_request_id;
  IF approval_status IS DISTINCT FROM 'approved' OR approval_quotation <> NEW.quotation_id THEN
    RAISE EXCEPTION 'purchase order % requires an approved approval for the same quotation', NEW.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_orders_consistency ON purchase_orders;
CREATE TRIGGER purchase_orders_consistency
  BEFORE INSERT OR UPDATE OF quotation_id, approval_request_id, rfq_id, vendor_id ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION vb_assert_purchase_order_consistency();

CREATE OR REPLACE FUNCTION vb_assert_invoice_consistency() RETURNS trigger AS $$
DECLARE
  order_rfq INTEGER;
  order_vendor INTEGER;
BEGIN
  SELECT rfq_id, vendor_id INTO order_rfq, order_vendor
    FROM purchase_orders WHERE id = NEW.purchase_order_id;
  IF order_rfq IS NULL THEN
    RAISE EXCEPTION 'invoice % references a missing purchase order', NEW.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF order_rfq <> NEW.rfq_id OR order_vendor <> NEW.vendor_id THEN
    RAISE EXCEPTION 'invoice % vendor/RFQ do not match its purchase order', NEW.number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_consistency ON invoices;
CREATE TRIGGER invoices_consistency
  BEFORE INSERT OR UPDATE OF purchase_order_id, rfq_id, vendor_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION vb_assert_invoice_consistency();
