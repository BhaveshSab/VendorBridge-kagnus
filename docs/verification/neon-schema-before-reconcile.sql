-- Snapshot of the experimental append-only quotation objects that existed on the
-- development database before the reconcile migration. Kept for reference only.

CREATE CONSTRAINT TRIGGER quotations_deadline_commit_trigger AFTER INSERT ON public.quotations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_quotation_deadline_at_commit();

CREATE TRIGGER quotation_items_append_only_trigger BEFORE INSERT OR DELETE OR UPDATE ON public.quotation_items FOR EACH ROW EXECUTE FUNCTION guard_quotation_item_mutation();

CREATE TRIGGER quotations_append_only_delete_trigger BEFORE DELETE ON public.quotations FOR EACH ROW EXECUTE FUNCTION guard_quotation_revision_delete();

CREATE TRIGGER quotations_append_only_update_trigger BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION guard_quotation_revision_update();

CREATE TRIGGER quotations_revision_insert_trigger BEFORE INSERT ON public.quotations FOR EACH ROW EXECUTE FUNCTION validate_quotation_revision_insert();

CREATE OR REPLACE FUNCTION public.guard_quotation_revision_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public.guard_quotation_revision_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Quotation revisions are immutable and cannot be deleted.'
    USING ERRCODE = '23514', CONSTRAINT = 'quotations_append_only_delete';
END;
$function$


CREATE OR REPLACE FUNCTION public.validate_quotation_revision_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public.guard_quotation_item_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$


CREATE OR REPLACE FUNCTION public.enforce_quotation_deadline_at_commit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$


-- quotations columns
--   id integer nullable=NO default=nextval('quotations_id_seq'::regclass)
--   rfq_id integer nullable=NO default=-
--   vendor_id integer nullable=NO default=-
--   currency text nullable=NO default=-
--   delivery_days integer nullable=NO default=-
--   delivery_terms text nullable=YES default=-
--   notes text nullable=YES default=-
--   tax_percent numeric nullable=NO default=0
--   subtotal numeric nullable=NO default=-
--   tax_amount numeric nullable=NO default=-
--   shipping_amount numeric nullable=NO default=-
--   total numeric nullable=NO default=-
--   revision integer nullable=NO default=1
--   submitted_at timestamp without time zone nullable=NO default=-
--   updated_at timestamp without time zone nullable=NO default=-
--   status text nullable=NO default='submitted'::text
--   supersedes_id integer nullable=YES default=-
--   superseded_at timestamp without time zone nullable=YES default=-
