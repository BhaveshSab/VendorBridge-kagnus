-- Reconcile a database that carries the earlier experimental "append-only
-- quotation revisions" objects (superseded rows, mutation guards) with the
-- quotation model this application actually implements:
--
--   * one current quotation per (RFQ, vendor), revised in place via `revision`
--   * `quotations_append_only_*` triggers reject that update path, so they are
--     removed here
--
-- Everything is guarded with IF EXISTS, so fresh databases (which never had
-- these objects) apply this migration as a no-op and existing rows keep their
-- data. Nothing is dropped from a database created by this repository's own
-- migrations.

DROP TRIGGER IF EXISTS "quotations_append_only_update_trigger" ON "quotations";
DROP TRIGGER IF EXISTS "quotations_append_only_delete_trigger" ON "quotations";
DROP TRIGGER IF EXISTS "quotations_revision_insert_trigger" ON "quotations";
DROP TRIGGER IF EXISTS "quotations_deadline_commit_trigger" ON "quotations";

DROP TRIGGER IF EXISTS "quotation_items_append_only_trigger" ON "quotation_items";
DROP TRIGGER IF EXISTS "quotation_items_append_only_update_trigger" ON "quotation_items";
DROP TRIGGER IF EXISTS "quotation_items_append_only_delete_trigger" ON "quotation_items";
DROP TRIGGER IF EXISTS "quotation_items_insert_trigger" ON "quotation_items";
DROP TRIGGER IF EXISTS "quotation_items_same_rfq_trigger" ON "quotation_items";

DROP FUNCTION IF EXISTS "guard_quotation_revision_update"();
DROP FUNCTION IF EXISTS "guard_quotation_revision_delete"();
DROP FUNCTION IF EXISTS "validate_quotation_revision_insert"();
DROP FUNCTION IF EXISTS "guard_quotation_item_mutation"();
DROP FUNCTION IF EXISTS "enforce_quotation_deadline_at_commit"();
