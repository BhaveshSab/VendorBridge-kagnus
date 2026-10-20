# Week 3 — Approval, purchase order and invoice workflow

Completion report for the Kagnus Week 3 brief. Everything below was executed in this
workspace; results are quoted from actual command output, and anything that could not be
verified is listed under **Limitations** instead of being claimed.

---

## 1. What was built

Week 3 extends the existing Week 1/2 application (no second app, no mock data):

| Area | Endpoints | Screens |
| --- | --- | --- |
| Approvals | `GET /api/approvals`, `GET /api/approvals/queue`, `POST /api/approvals`, `GET /api/approvals/:id`, `POST /api/approvals/:id/approve`, `POST /api/approvals/:id/reject` | `/approvals`, `/approvals/:id` |
| Purchase orders | `GET /api/purchase-orders`, `POST /api/purchase-orders`, `GET /api/purchase-orders/:id`, `POST /api/purchase-orders/:id/cancel` | `/purchase-orders`, `/purchase-orders/:id` |
| Invoices | `GET /api/invoices`, `POST /api/invoices`, `GET /api/invoices/:id`, `GET /api/invoices/:id/pdf`, `POST /api/invoices/:id/send` | `/invoices`, `/invoices/:id`, `/invoices/:id/print` (outside the app shell) |

New files: `server/workflow.js`, `server/pdf.js`, `server/routes/approvals.js`,
`server/routes/purchaseOrders.js`, `server/routes/invoices.js`,
`src/pages/Approvals.tsx`, `src/pages/PurchaseOrders.tsx`, `src/pages/PurchaseOrderDetail.tsx`,
`src/pages/Invoices.tsx`, `src/pages/InvoiceDetail.tsx`, `src/pages/InvoicePrint.tsx`,
`src/components/InvoiceSheet.tsx`, `prisma/migrations/20261020120000_add_approval_po_invoices/`,
`prisma/migrations/20261020130000_reconcile_quotation_mutability/`.

Extended files: `prisma/schema.prisma`, `server/app.js`, `server/auth.js` (unchanged roles),
`server/email.js` (invoice delivery), `server/serializers.js`, `server/routes/rfqs.js`
(quotation lock), `src/App.tsx`, `src/components/ui.tsx`, `src/index.css`, `src/lib/*`,
`src/pages/RfqQuotations.tsx`, `src/components/AppLayout`/`constants` navigation,
`scripts/smoke-test.mjs`, `package.json` (`db:seed-demo`).

## 2. Data model

Added to `prisma/schema.prisma` and the forward-only migration
`20261020120000_add_approval_po_invoices`:

- **approval_requests** — `rfq_id`, `quotation_id` (unique), `quotation_revision`, `requester_id`,
  `status` (`pending`/`approved`/`rejected`), `request_remarks`, `requested_at`, `approver_id`,
  `decided_at`, `decision_remarks`, and a JSON `snapshot` of the reviewed quotation terms.
  A partial unique index (`approval_requests_one_active_per_rfq`) allows one pending/approved
  request per RFQ while still permitting rejected history.
- **approval_events** — immutable timeline (`requested`/`approved`/`rejected`), actor, remarks,
  timestamp.
- **purchase_orders** + **purchase_order_items** — unique `number`, unique `quotation_id`,
  unique `approval_request_id`, vendor/RFQ/creator links, currency, tax %, subtotal, tax,
  shipping, total, status (`issued`/`cancelled`), issued/cancelled timestamps and reason.
- **invoices** + **invoice_items** + **invoice_events** — unique `number`, unique
  `purchase_order_id`, RFQ/vendor/creator links, issue/due dates, status, totals snapshot,
  email delivery state (`email_status`, `email_provider`, `email_sent_at`, `email_attempts`,
  `email_error`) and an event log (`generated`, `email_sent`, `email_failed`,
  `email_not_configured`).
- Foreign keys enforce the chain approval → quotation → RFQ → vendor → PO → invoice, with
  `RESTRICT` on documents and `CASCADE` on the audit timelines. Database checks reject negative
  amounts and `tax_percent` outside 0–100.

`20261020130000_reconcile_quotation_mutability` is defensive and idempotent: it drops
`IF EXISTS` the experimental append-only quotation triggers that existed on the development
database (see `docs/verification/neon-schema-before-reconcile.sql`) and is a no-op on a database
created by this repository's own migrations.

## 3. Workflow and invariants

1. Procurement (or admin) requests approval for a submitted, internally consistent quotation on
   an open/closed RFQ. The request stores a snapshot; the quotation is locked at that point, so
   the terms a manager reviews cannot be edited afterwards (`quotation_locked`, 409).
2. A manager approves or rejects with remarks. Decisions are terminal: a second decision returns
   `409 invalid_transition`; the requester can never decide their own request (`403`).
3. Only an approved request produces a purchase order. Generation runs in a transaction with a
   row lock on the approval, re-validates the snapshot against the live quotation (drift returns
   `409 quotation_changed`), and relies on the unique keys on `quotation_id`/`approval_request_id`
   so concurrent or repeated calls return the existing document instead of a duplicate.
4. Only an `issued` purchase order can be invoiced. Totals are copied from the persisted PO
   (never recomputed from client input), tax is applied once on the subtotal, and the invoice
   re-validates the PO amounts before writing (`409 document_inconsistent`).
5. Documents stay consistent if delivery fails: the invoice row exists, email state is recorded,
   and a retry sends again without creating another invoice.

## 4. Authorization

| Action | admin | procurement | manager | vendor |
| --- | --- | --- | --- | --- |
| List/view approvals | ✓ | ✓ | ✓ | 403 (`router.use(requireAuth, requireRole(...))`) |
| Request approval | ✓ | ✓ | 403 | 403 |
| Approve / reject | ✓ | 403 | ✓ (not own request) | 403 |
| List/view purchase orders | ✓ | ✓ | ✓ | own vendor only |
| Generate / cancel PO | ✓ | ✓ | 403 | 403 |
| List/view invoices | ✓ | ✓ | ✓ | own vendor only |
| Generate invoice, download PDF, send email | ✓ | ✓ | view + PDF only | own invoice PDF only |

Vendors are scoped through the Week 1 `vendor.userId` link; requests for another vendor's
documents return `404` (existence is not disclosed). Internal remarks, approval notes and email
errors are never serialized into vendor responses. All document responses carry
`Cache-Control: no-store`.

## 5. PDF and email

- **PDF** — `pdf-lib` (already a dependency) renders the invoice in memory from the persisted
  invoice row and its snapshot items. `GET /api/invoices/:id/pdf` returns
  `application/pdf` with `Content-Disposition: attachment; filename="INV-XXXX.pdf"` and uses the
  same authorization as the invoice itself. The print route renders the same persisted values in
  a layout without app navigation.
- **Documents are labelled** "system-generated pro forma invoice … does not replace a
  vendor-issued tax invoice".
- **Email** — reuses the existing Resend integration (`RESEND_API_KEY`, `EMAIL_FROM`). The
  recipient is always `vendor.email` on the PO's vendor record; there is no recipient parameter.
  Delivery outcomes:
  - no provider → `503 email_not_configured`, invoice preserved, event + state recorded;
  - provider error → `502 email_failed`, provider and a truncated error recorded, event logged;
  - success → `sent`, `email_sent_at`, attempt counter incremented, event logged;
  - retries never create another invoice.
  For local development `EMAIL_DEV_OUTBOX=true` opts into the file outbox (`.mail-outbox.jsonl`);
  it is ignored when `NODE_ENV=production`.

## 6. Sample documents (test data)

On the development database (`.env` → `neondb`):

- Approval `1` — RFQ `RFQ-0003`, quotation `3` (Apex Hardware, revision 1), requested by the
  procurement officer, approved by the manager with remarks.
- `PO-0001` — ₹4,17,000.00 subtotal + ₹75,060.00 tax (18%) + ₹2,500.00 delivery = **₹4,94,560.00**.
- `INV-0001` — same totals, PO `PO-0001`, RFQ `RFQ-0003`, quotation revision 1, issued
  `2026-10-20` with a 30-day due date (`2026-11-19`), email `sent` via the development outbox
  (no real inbox was contacted).
- Approval `2` — RFQ-0027 (open RFQ), Zenith IT Solutions: still **pending**, so the approver
  queue and the dashboard tile show real work to do.
- Approval `3` — RFQ-0028 "Warehouse shelving": **rejected** with the written reason
  "21-day delivery misses the shutdown window…", which exercises the rejection path and its
  timeline.

All of it is produced by `npm run db:seed-demo` (`scripts/seed-week12-demo.mjs`), which is
idempotent and drives the real HTTP API, so the numbers, links and state transitions are created
by the application rather than inserted by hand. Re-running it adds nothing.

Screenshots (synthetic/test data only):

| File | Content |
| --- | --- |
| `docs/verification/week3/01…08` | Disposable-DB browser run: requested, approved, PO, invoice, print, email sent, vendor PO, rejected |
| `docs/screenshots/27-week3-approvals.png` | Approvals queue on the dev database |
| `docs/screenshots/28-week3-approval-detail.png` | Approved request with timeline |
| `docs/screenshots/29-week3-purchase-order.png` | PO document layout |
| `docs/screenshots/30-week3-invoice.png` | Invoice with delivery panel |
| `docs/screenshots/31-week3-invoice-print.png` | Print view (no app chrome) |
| `docs/screenshots/32-week3-vendor-invoices.png` | Vendor-scoped invoice list |
| `docs/screenshots/33-invoice-email-failed.png` | Provider failure surfaced truthfully (no false success) |

## 7. Verification actually run

| Command | Target | Result |
| --- | --- | --- |
| `node scripts/e2e-week3.mjs` | disposable embedded PostgreSQL 18 on `127.0.0.1:55432/vendorbridge_e2e` and a real browser (Brave 1440×900) | **106 passed, 0 failed** (`docs/verification/week3/results.json`), 8 screenshots refreshed, test RFQs cleaned up (5/5) |
| `npm run test:api` (Week 1/2 suite) | the same code against the disposable DB and the dev database | 189 passed, 0 failed (both) |
| `npm run test:api` after the deployment repair | Neon dev database | **190 passed, 0 failed** |
| `node scripts/migrate-deploy.mjs` | fresh embedded PostgreSQL 18 + Neon | 6/6 migrations apply to an empty database; a second run reports *up to date*; a simulated `P3009` prints the blocking migration and the exact `migrate resolve` command, then exits 1 |
| `npx prisma migrate diff` (database vs `schema.prisma`) | fresh migrated database | no drift |
| `node .tmp/week3-neon.mjs` (live flow) | dev database via `http://localhost:4100` | **34 passed, 0 failed** — approval → `PO-0001` → `INV-0001` → PDF → email → vendor isolation → integrity |
| `node .tmp/email-failure.mjs` | disposable DB with an intentionally invalid provider key, then the dev outbox | **14 passed, 0 failed** — `502 email_failed`, `failed` persisted, safe error stored, retry sends, one invoice |
| `npm run typecheck` | repo | pass |
| `npm run build` | repo | pass (Vite chunk-size warning only) |
| `npx prisma validate` | schema | pass |
| `npx prisma migrate status` | dev database | 5 migrations, schema up to date |
| `node --check` on changed server/script files | repo | pass |
| `git diff --check` | repo | pass |

Covered by the disposable-run harness (all passing): anonymous 401s, vendor/manager/procurement
role boundaries, self-approval refusal, stale/second decisions, PO from pending/rejected/
cancelled paths, duplicate and concurrent PO/invoice generation (“exactly one” asserted),
tampered totals/vendor/status ignored, PDF bytes/type/filename, print view without app chrome,
email to the vendor address only, retry without duplication, `no-store` headers, validation
error envelope (422), and database relationship checks (no quotation with two POs, no PO with two
invoices).

### Database safety

- Concurrency/negative testing ran against a **disposable loopback database**
  (`127.0.0.1:55432/vendorbridge_e2e`); the harness refuses to run unless `DATABASE_URL` is
  loopback and its name contains `e2e`, and removes only the five RFQs it created.
- The user's configured database is the Neon `neondb` development database named in `.env`. It
  was verified empty for these tables before migration/seed, and only demo/test records were
  written. No production database was touched, and no destructive reset was used.

## 8. Migrations and configuration

```bash
npm run db:deploy             # scripts/migrate-deploy.mjs → prisma migrate deploy
npm run seed                  # Week 1 users/vendors (only when the tables are empty)
npm run db:seed-demo          # Week 1/2 demo RFQs and comparison quotations (idempotent)
```

New/changed environment variables (documented in `.env.example`):

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | enables real invoice/reset email delivery |
| `EMAIL_FROM` | verified sender for Resend |
| `EMAIL_DEV_OUTBOX=true` | local-only opt-in to the file outbox; never active in production |

No credentials are stored in the repository; `.env` is gitignored.

### Deployment (Vercel + Neon)

`vercel.json` runs `npx prisma generate && node scripts/migrate-deploy.mjs && npm run build`; the
Vite bundle is served statically and `api/index.js` re-exports the Express app as one serverless
function. Migrations therefore run against Neon on every build, and a build stops when one needs a
human decision. Both blocking codes are fixed once per database, not in code:

| Code | Cause | Fix |
| --- | --- | --- |
| `P3018` | the migration's SQL failed — e.g. `column "superseded_at" already exists` because the schema had been changed outside Prisma | `npx prisma migrate resolve --rolled-back "<migration>"`, redeploy |
| `P3009` | an earlier migration is still recorded as failed, so Prisma applies nothing new | same, for the named migration (`--applied` when the objects already exist) |

The first Vercel build failed exactly this way: a merge from `main` restored the obsolete
`20261020120000_append_only_quotation_revisions` folder that the feature branch had already
superseded with `20261020150000_…`, and Neon already carried `superseded_at`. That folder is deleted
again, the failed row was resolved, and `scripts/migrate-deploy.mjs` now warns when two migration
folders share a timestamp (the signature of such a resurrection) and prints the resolve command for
`P3009`/`P3018` instead of leaving the build log with a bare exit code. The same merge had also
pasted the abandoned pre-`superseded_at` handler into `server/routes/rfqs.js`; those files are back
to the verified branch implementation.

## 9. Known limitations / not verified

- **No real email was delivered.** Delivery was verified through the local outbox and through a
  deliberately invalid Resend key (failure path). A real inbox test needs a valid `RESEND_API_KEY`
  and a verified sender domain.
- **Browser print** was verified by rendering the dedicated print route and confirming it
  contains the invoice content without application navigation; the OS print dialog itself was not
  automated.
- **Concurrency** is exercised with parallel HTTP requests (approval decision, PO, invoice) on a
  local PostgreSQL instance, not with a distributed load generator.
- **Demo data, not production data.** The development database now carries one approved, one
  pending and one rejected request plus `PO-0001`/`INV-0001`, all created by the demo seeder
  under the `Demo:` title prefix. They exist to review the screens; they are not operational
  documents.
- The reconcile migration intentionally removes an experimental trigger set that came from a
  different build (a snapshot is kept in
  `docs/verification/neon-schema-before-reconcile.sql`). Append-only revisions are now implemented
  properly by `20261020150000_append_only_quotation_revisions`: `superseded_at` instead of a
  mutable status column, a partial unique index for live bids, a deadline trigger evaluated with
  `clock_timestamp()`, and delete guards on quotations and their line items.
