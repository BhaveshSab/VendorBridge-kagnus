-- Week 2 audit hardening: retain every quotation revision and enforce the
-- RFQ submission deadline at the PostgreSQL transaction commit boundary.

ALTER TABLE "quotations"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'submitted',
  ADD COLUMN "supersedes_id" INTEGER,
  ADD COLUMN "superseded_at" TIMESTAMP(3);

ALTER TABLE "quotations" DROP CONSTRAINT IF EXISTS "quotations_rfq_id_vendor_id_key";
DROP INDEX IF EXISTS "quotations_rfq_id_vendor_id_key";

-- Prior revisions were overwritten by the old application, so the currently
-- stored bid becomes the first preserved row in the new immutable chain.
UPDATE "quotations" SET "revision" = 1;

-- Replace cascading foreign keys so deleting a parent cannot erase bid history.
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_rfq_id_fkey";
ALTER TABLE "quotations" DROP CONSTRAINT "quotations_vendor_id_fkey";
ALTER TABLE "quotation_items" DROP CONSTRAINT "quotation_items_quotation_id_fkey";
ALTER TABLE "quotation_items" DROP CONSTRAINT "quotation_items_rfq_item_id_fkey";
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quotations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotation_items"
  ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quotation_items_rfq_item_id_fkey" FOREIGN KEY ("rfq_item_id") REFERENCES "rfq_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_status_check" CHECK ("status" IN ('submitted', 'superseded')),
  ADD CONSTRAINT "quotations_superseded_state_check" CHECK (
    ("status" = 'submitted' AND "superseded_at" IS NULL) OR
    ("status" = 'superseded' AND "superseded_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "quotations_supersedes_id_fkey" FOREIGN KEY ("supersedes_id")
    REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "quotations_supersedes_id_key" ON "quotations"("supersedes_id");
CREATE UNIQUE INDEX "quotations_rfq_id_vendor_id_revision_key"
  ON "quotations"("rfq_id", "vendor_id", "revision");
CREATE UNIQUE INDEX "quotations_one_current_per_vendor_rfq_key"
  ON "quotations"("rfq_id", "vendor_id") WHERE "status" = 'submitted';
CREATE INDEX "quotations_revision_chain_idx"
  ON "quotations"("rfq_id", "vendor_id", "revision" DESC);

-- Only the one-way submitted -> superseded transition may update an existing
-- quotation. All bid content, pricing, ownership and timestamps remain immutable.
CREATE OR REPLACE FUNCTION "guard_quotation_revision_update"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" <> 'submitted'
     OR NEW."status" <> 'superseded'
     OR NEW."superseded_at" IS NULL
     OR (to_jsonb(NEW) - 'status' - 'superseded_at' - 'updated_at')
        IS DISTINCT FROM
        (to_jsonb(OLD) - 'status' - 'superseded_at' - 'updated_at') THEN
    RAISE EXCEPTION 'Quotation revisions are append-only; only the current revision may be superseded.'
      USING ERRCODE = '23514', CONSTRAINT = 'quotations_append_only_update';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quotations_append_only_update_trigger"
BEFORE UPDATE ON "quotations"
FOR EACH ROW EXECUTE FUNCTION "guard_quotation_revision_update"();

CREATE OR REPLACE FUNCTION "guard_quotation_revision_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Quotation revisions are immutable and cannot be deleted.'
    USING ERRCODE = '23514', CONSTRAINT = 'quotations_append_only_delete';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quotations_append_only_delete_trigger"
BEFORE DELETE ON "quotations"
FOR EACH ROW EXECUTE FUNCTION "guard_quotation_revision_delete"();

-- A revision must form a contiguous chain for the same RFQ/vendor pair.
CREATE OR REPLACE FUNCTION "validate_quotation_revision_insert"()
RETURNS TRIGGER AS $$
DECLARE
  previous "quotations"%ROWTYPE;
BEGIN
  NEW."submitted_at" := clock_timestamp() AT TIME ZONE 'UTC';
  NEW."updated_at" := NEW."submitted_at";
  IF NEW."status" <> 'submitted' OR NEW."superseded_at" IS NOT NULL THEN
    RAISE EXCEPTION 'New quotation revisions must be current submissions.'
      USING ERRCODE = '23514', CONSTRAINT = 'quotations_new_revision_state';
  END IF;

  IF NEW."revision" = 1 THEN
    IF NEW."supersedes_id" IS NOT NULL THEN
      RAISE EXCEPTION 'The initial quotation revision cannot supersede another row.'
        USING ERRCODE = '23514', CONSTRAINT = 'quotations_revision_chain_check';
    END IF;
  ELSE
    IF NEW."supersedes_id" IS NULL THEN
      RAISE EXCEPTION 'Every revised quotation must link to its previous revision.'
        USING ERRCODE = '23514', CONSTRAINT = 'quotations_revision_chain_check';
    END IF;
    SELECT * INTO previous FROM "quotations" WHERE "id" = NEW."supersedes_id";
    IF NOT FOUND
       OR previous."rfq_id" <> NEW."rfq_id"
       OR previous."vendor_id" <> NEW."vendor_id"
       OR previous."revision" <> NEW."revision" - 1
       OR previous."status" <> 'superseded' THEN
      RAISE EXCEPTION 'Quotation revision chain is invalid.'
        USING ERRCODE = '23514', CONSTRAINT = 'quotations_revision_chain_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quotations_revision_insert_trigger"
BEFORE INSERT ON "quotations"
FOR EACH ROW EXECUTE FUNCTION "validate_quotation_revision_insert"();

-- A bid line is immutable after insertion and cannot be deleted, including by
-- cascading deletes from a vendor, quotation, RFQ or RFQ item.
CREATE OR REPLACE FUNCTION "guard_quotation_item_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Quotation line items are immutable and cannot be deleted.'
      USING ERRCODE = '23514', CONSTRAINT = 'quotation_items_append_only_delete';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Quotation line items are immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'quotation_items_append_only_update';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM "quotations" q
      JOIN "rfq_items" ri ON ri."id" = NEW."rfq_item_id"
     WHERE q."id" = NEW."quotation_id"
       AND q."status" = 'submitted'
       AND q."rfq_id" = ri."rfq_id"
  ) THEN
    RAISE EXCEPTION 'Quotation line item must belong to the same RFQ as its quotation.'
      USING ERRCODE = '23514', CONSTRAINT = 'quotation_items_same_rfq_check';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "quotation_items_append_only_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "quotation_items"
FOR EACH ROW EXECUTE FUNCTION "guard_quotation_item_mutation"();

-- Deferred constraint trigger: this runs at transaction commit, not when the
-- request first reaches Node. clock_timestamp() is intentional: PostgreSQL's
-- CURRENT_TIMESTAMP is fixed at transaction start and can be stale after waits.
-- The RFQ row is locked in the API transaction too, serializing submission with
-- close/cancel lifecycle changes.
CREATE OR REPLACE FUNCTION "enforce_quotation_deadline_at_commit"()
RETURNS TRIGGER AS $$
DECLARE
  rfq_status TEXT;
  rfq_deadline TIMESTAMP(3);
BEGIN
  SELECT "status", "deadline"
    INTO rfq_status, rfq_deadline
    FROM "rfqs"
   WHERE "id" = NEW."rfq_id"
   FOR SHARE;

  IF NOT FOUND
     OR rfq_status <> 'open'
     OR (clock_timestamp() AT TIME ZONE 'UTC') > rfq_deadline THEN
    RAISE EXCEPTION 'Quotation cannot be committed because the RFQ is closed or its deadline has passed.'
      USING ERRCODE = '23514', CONSTRAINT = 'quotations_rfq_deadline_check';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "quotations_deadline_commit_trigger"
AFTER INSERT ON "quotations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_quotation_deadline_at_commit"();
