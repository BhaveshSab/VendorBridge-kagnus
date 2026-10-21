-- Week 4 — per-user notifications.
--
-- One row per recipient, written from the same application code that performs
-- the underlying action. `read_at` is the only mutable column; deleting a user
-- removes their notifications, and deleting a vendor nulls the historical
-- vendor reference instead of deleting the notification.

CREATE TABLE "notifications" (
  "id" SERIAL NOT NULL,
  "user_id" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "link" TEXT,
  "vendor_id" INTEGER,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_user_id_read_at_created_at_idx"
  ON "notifications" ("user_id", "read_at", "created_at");

CREATE INDEX "notifications_user_id_created_at_idx"
  ON "notifications" ("user_id", "created_at");

CREATE INDEX "notifications_vendor_id_idx"
  ON "notifications" ("vendor_id");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_vendor_id_fkey"
  FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
