-- Append-only quotation revisions and database-level deadline enforcement.
--
-- 1. Revisions no longer overwrite the vendor's previous bid. The superseded
--    row keeps its line items and gains `superseded_at`; only the newest row is
--    live. The partial unique index below preserves the invariant the old
--    `quotations_rfq_id_vendor_id_key` enforced (at most one live bid per
--    vendor per RFQ) while letting history coexist underneath it.
--
-- 2. `quotations_deadline_guard` re-checks the deadline inside the database at
--    insert time, so a bid validated by Node.js before the deadline can never
--    be committed after it, no matter how busy the event loop is.
--
-- 3. The delete guards make vendor pricing physically unremovable: a quotation
--    or its line items can only disappear through a cascade whose parent (the
--    RFQ or the vendor) is itself being deleted, never on its own.
--
-- Every statement is idempotent, so a database that still carries objects from
-- an earlier experimental append-only attempt converges on the same shape as a
-- freshly created one.

-- ---------------------------------------------------------------------------
-- 0. Remove leftovers that are not part of this repository's schema: the
--    experimental `status` / `supersedes_id` columns, their checks and the
--    indexes built on them. `superseded_at` is kept (it is the real column).
-- ---------------------------------------------------------------------------
ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_status_check";
ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_superseded_state_check";
DROP INDEX IF EXISTS "quotations_one_current_per_vendor_rfq_key";
DROP INDEX IF EXISTS "quotations_revision_chain_idx";
DROP INDEX IF EXISTS "quotations_supersedes_id_key";
ALTER TABLE "quotations" DROP COLUMN IF EXISTS "supersedes_id";
ALTER TABLE "quotations" DROP COLUMN IF EXISTS "status";

-- ---------------------------------------------------------------------------
-- 1. Append-only history: superseded rows stay, and only one row per
--    (RFQ, vendor) is ever live.
-- ---------------------------------------------------------------------------
ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMP(3);

DROP INDEX IF EXISTS "quotations_rfq_id_vendor_id_key";

-- Revisions of the same bid can never collide on their number.
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_rfq_id_vendor_id_revision_key"
  ON "quotations" ("rfq_id", "vendor_id", "revision");

-- The live bid per vendor per RFQ (Prisma cannot express a partial index).
CREATE UNIQUE INDEX IF NOT EXISTS "quotations_active_rfq_vendor_key"
  ON "quotations" ("rfq_id", "vendor_id")
  WHERE "superseded_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Deadline enforcement, evaluated by PostgreSQL at insert time.
--    clock_timestamp() is the real wall-clock time (CURRENT_TIMESTAMP would
--    freeze at transaction start), so the check is as strict as the database
--    can make it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vb_assert_quotation_deadline() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "rfqs"
    WHERE "id" = NEW."rfq_id"
      AND "status" = 'open'
      AND "deadline" > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'quotations_deadline_guard: quotation for RFQ % submitted after the deadline', NEW."rfq_id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotations_deadline_guard ON quotations;
CREATE TRIGGER quotations_deadline_guard
  BEFORE INSERT ON quotations
  FOR EACH ROW EXECUTE FUNCTION vb_assert_quotation_deadline();

-- ---------------------------------------------------------------------------
-- 3. Never delete vendor pricing. Deleting a quotation while its vendor and its
--    RFQ still exist is a hard delete of a bid and is rejected; a cascade that
--    comes with the RFQ or the vendor themselves has no parent rows left and is
--    allowed, so "delete this vendor/RFQ" keeps working.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vb_block_quotation_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "vendors" WHERE "id" = OLD."vendor_id")
     AND EXISTS (SELECT 1 FROM "rfqs" WHERE "id" = OLD."rfq_id") THEN
    RAISE EXCEPTION 'quotations are append-only: row % cannot be deleted (mark it superseded instead)', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotations_append_only_delete ON quotations;
CREATE TRIGGER quotations_append_only_delete
  BEFORE DELETE ON quotations
  FOR EACH ROW EXECUTE FUNCTION vb_block_quotation_delete();

CREATE OR REPLACE FUNCTION vb_block_quotation_item_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "quotations" WHERE "id" = OLD."quotation_id") THEN
    RAISE EXCEPTION 'quotation line items are append-only: row % cannot be deleted', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotation_items_append_only_delete ON quotation_items;
CREATE TRIGGER quotation_items_append_only_delete
  BEFORE DELETE ON quotation_items
  FOR EACH ROW EXECUTE FUNCTION vb_block_quotation_item_delete();
