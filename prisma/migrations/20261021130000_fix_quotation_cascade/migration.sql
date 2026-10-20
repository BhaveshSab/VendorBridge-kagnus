-- Restore the referential actions the schema declares for quotations.
--
-- The Week 2 migration created both foreign keys with ON DELETE CASCADE, which
-- is what lets an RFQ or a vendor remove its own bids while the append-only
-- triggers keep blocking a direct DELETE of a quotation. A database provisioned
-- outside these migrations (the shared development database was) carries
-- ON DELETE RESTRICT instead: deleting an RFQ or a vendor that has quotations
-- then fails, and `npm run db:cleanup-tests` cannot remove test RFQs.
--
-- Re-creating the constraints is metadata-only — no rows are touched — and
-- converges the database on prisma/schema.prisma. The append-only trigger still
-- rejects a quotation delete while both its RFQ and vendor exist.

ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_rfq_id_fkey";
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_rfq_id_fkey"
  FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_vendor_id_fkey";
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
