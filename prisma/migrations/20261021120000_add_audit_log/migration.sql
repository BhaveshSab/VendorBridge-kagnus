-- Week 4 — immutable audit trail.
--
-- One row per state-changing action. The actor's name/email/role are copied
-- into the row so the history is still readable after the account is deleted
-- (actor_id becomes NULL through ON DELETE SET NULL). Triggers below reject any
-- UPDATE or DELETE, so an entry cannot be rewritten or removed through the
-- application, the Prisma client or a stray SQL statement.

CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_id" INTEGER,
    "actor_name" TEXT NOT NULL,
    "actor_email" TEXT,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "guard_audit_log_append_only"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
    BEFORE UPDATE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "guard_audit_log_append_only"();

CREATE TRIGGER "audit_logs_no_delete"
    BEFORE DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "guard_audit_log_append_only"();
