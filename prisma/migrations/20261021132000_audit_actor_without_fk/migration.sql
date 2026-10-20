-- The audit trail is append-only: triggers reject every UPDATE and DELETE on
-- audit_logs. A foreign key with ON DELETE SET NULL therefore made deleting a
-- user impossible — PostgreSQL tried to null actor_id, and the guard rejected
-- that UPDATE. Audit rows keep a snapshot of the actor's name, email and role,
-- so the foreign key is not needed: actor_id stays as a historical reference
-- without a constraint (an account can be removed, and the trail remains).

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_fkey";
