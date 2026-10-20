-- The quotation line-item foreign keys were provisioned with ON DELETE RESTRICT
-- on the shared development database, which prevents an RFQ or a vendor from
-- cascading through its bids (and blocks `npm run db:cleanup-tests`). The schema
-- and the original Week 2 migration both declare CASCADE. Re-create the two
-- constraints to match; no rows are changed.

ALTER TABLE "quotation_items" DROP CONSTRAINT IF EXISTS "quotation_items_quotation_id_fkey";
ALTER TABLE "quotation_items"
  ADD CONSTRAINT "quotation_items_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_items" DROP CONSTRAINT IF EXISTS "quotation_items_rfq_item_id_fkey";
ALTER TABLE "quotation_items"
  ADD CONSTRAINT "quotation_items_rfq_item_id_fkey"
  FOREIGN KEY ("rfq_item_id") REFERENCES "rfq_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
