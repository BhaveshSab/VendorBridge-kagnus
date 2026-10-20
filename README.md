# VendorBridge — Procurement & Vendor Management ERP

Weeks 1–3 deliverable for the Kagnus programme: **Foundation & Vendor Management**,
**RFQs, Quotations & Comparison**, and **Approvals, Purchase Orders & Invoices**.
VendorBridge is a full-stack application — a React single-page front end talking to an
Express + PostgreSQL back end through Prisma ORM — implementing authentication, role-aware
navigation, a procurement dashboard, complete vendor management, the end-to-end
RFQ → quotation → comparison workflow, and the approval → purchase order → invoice workflow
with server-rendered PDFs and transactional email. Modules scheduled for Week 4 (reports and
the audit log) are intentionally not implemented; their dashboard areas show explicit
"scheduled" states instead of fabricated numbers.

---

## 1. Tech stack

| Layer | Choice |
| --- | --- |
| Front end | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7 (lazy-loaded routes), TanStack Query, Framer Motion, Lucide icons |
| Back end | Node.js (ESM), Express 5, Zod validation, express-rate-limit, pdf-lib (server-rendered invoices), Resend email API |
| Cache / counters | Upstash Redis through either its REST API (`UPSTASH_REDIS_REST_URL` + token) or a `rediss://` TCP URL |
| Auth | bcrypt password hashing + signed JWT in an httpOnly cookie |
| Database | PostgreSQL (managed instance) through Prisma ORM 6, schema in `prisma/schema.prisma` |

The database connection comes from a single `DATABASE_URL` environment variable. Prisma owns
the schema, migrations and typed queries; no native database driver is compiled during install.

---

## 2. Quick start

```bash
# 1. Install dependencies (also generates the Prisma Client)
npm install

# 2. Configure environment
cp .env.example .env      # set DATABASE_URL (PostgreSQL) and JWT_SECRET

# 3. Generate Prisma Client, apply migrations, seed an empty development DB,
#    and verify connection/table counts (review DATABASE_URL first)
npm run db:setup

# 4. Run the API (port 4000) and the Vite dev server (port 5173) together
npm run dev
# open http://localhost:5173
```

Other scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | API + Vite dev server (frontend proxies `/api` to the API) |
| `npm run dev:server` | API only, with file watching |
| `npm run build` | Type-check and build the production front end into `dist/` |
| `npm start` | Production server: serves `dist/` **and** the API on port 4000 |
| `npm run db:generate` | Regenerate the Prisma Client after editing the schema |
| `npm run db:migrate` | Create and apply a development migration (`prisma migrate dev`) |
| `npm run db:deploy` | Apply committed migrations to an existing database |
| `npm run db:status` | Check database connectivity and print row counts (no record contents) |
| `npm run db:setup` | Generate Prisma Client, apply migrations, seed an empty development DB and verify counts |
| `npm run db:studio` | Open Prisma Studio against the configured database |
| `npm run seed` | Add the demo fixture only when both users and vendors tables are empty; never overwrites existing data |
| `npm run test:api` | 179-check end-to-end API smoke test, Week 1 + Week 2 (see §7) |
| `node scripts/e2e-week2.mjs` | 74-check Week 2 browser E2E suite (app running + disposable `*e2e*` database) |
| `npm run db:cleanup-tests` | Remove only `@vendorbridge.test` accounts/vendors created by the test suites |
| `npm run screenshots` | Regenerate the screenshots in `docs/screenshots/` (needs the app running) |
| `npm run typecheck` | TypeScript check |

Demo data is loaded only by the explicit development `npm run seed` command (also included in
`npm run db:setup`) and only when both the `users` and `vendors` tables are empty. The server does
not seed data on startup, and demo seeding is disabled in production. Do not use demo credentials
or fixtures in a production database.

---

## 3. Demo accounts

In a disposable development database, the server-only seed script creates one account per role
for smoke testing. Credentials are not bundled into the browser login page. Seed accounts are
fixtures only; never use them in production.

---

## 4. Features delivered

### 4.1 Authentication (requirement 1)

- Public registration validates names, email, phone, country and password, and always creates a
  **Vendor** account with a linked **Pending** vendor profile. Public clients cannot choose an
  internal or elevated role.
- Admin, Procurement and Manager records exist only in the server-side development seed fixture; do
  not load these demo accounts into production.
- Email + password login, logout, and session restore via a signed JWT in an httpOnly cookie
  (8 hour expiry, `sameSite=lax`, `secure` in production).
- Forgot-password → single-use, 30-minute reset token → password reset. Reset emails use Resend
  when `RESEND_API_KEY` is configured; local development falls back to a mail outbox and a
  development-only direct-link helper. Configure `CLIENT_ORIGIN` to your public HTTPS app URL
  in production. Reset tokens are never exposed by production endpoints.
- Login throttling: 10 attempts per IP + email within 15 minutes returns `429`. Counters are
  stored in Redis (when `REDIS_URL` is set) or PostgreSQL via `express-rate-limit`, so they
  survive restarts and work across multiple Node.js instances.
- Read caching: with `REDIS_URL` set, the dashboard summary (20 s) and the vendor category index
  (60 s) are served through Redis (`server/cache.js`). Writes advance a per-namespace version, so
  the next read after a change recomputes. Without Redis — or if it is unreachable — every read
  goes straight to PostgreSQL; the cache never fails a request.
- Four roles: **Admin, Procurement Officer, Manager/Approver, Vendor**.
- Every API route is guarded server-side (`requireAuth` / `requireRole`). Role restrictions are
  enforced on the backend, not just hidden in the UI.
- React route guards redirect unauthenticated users to `/login` and keep signed-in users out of
  login/registration, while recovery pages remain available from Profile and emailed reset links.

### 4.2 Dashboard (requirement 2)

- Role-aware greeting, role label and the four summary cards from the design reference.
- **Total suppliers**, status totals, recent vendors and category breakdown are fetched from
  `/api/dashboard` and computed from PostgreSQL. Vendors see only their own profile metrics.
- **Active RFQs** is live (computed server-side into `rfqSummary`); **Pending approvals** and
  **PO value** still show explicit `—` / *Scheduled release* placeholders because those modules
  arrive in Weeks 3–4.
- Quick actions: add a vendor, open the vendor register, and create an RFQ (enabled in Week 2;
  staff get the create form, vendors get their invitation list).
- Vendor register snapshot (five most recently updated vendors) with status chips.
- Vendor status donut and vendor-by-category breakdown, both computed from stored records.
- "Scheduled for upcoming milestones" card lists the Week 3/4 modules with their scope.
- Skeleton loaders, empty states and an error state with retry; vendors see their own profile
  instead of the internal register.

### 4.3 Vendor management (requirement 3)

- Create, list, view, update and delete vendors — restricted to Admin and Procurement Officer.
- Fields: name, category, GSTIN, contact person, email, phone, address, city, country,
  status (Active / Pending / Inactive / Blocked), rating (0–5) and internal notes.
- Server-side search (name, code, email, contact, city), status and category filters, five sort
  orders and pagination.
- Vendor detail drawer with contact, billing details, compliance, rating and record metadata.
- Unique vendor code per record (`VND-001`…), duplicate-name protection (`409`) and full
  Zod validation (`422` with per-field messages).
- Vendors can only read their own record; cross-vendor reads and global vendor metadata return `403`.
- Internal procurement notes are redacted from vendor-facing API responses.
- Records are stored in PostgreSQL and survive refreshes, restarts and new sessions.

### 4.4 Technical requirements (requirement 4)

- Approved stack, single repository, `src/` (front end) and `server/` (API + database) separated.
- Configuration through environment variables (`PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
  `DATABASE_URL`, `CLIENT_ORIGIN`, `NODE_ENV`); no secrets in front-end code.
- Optional Redis (rate-limit counters and the dashboard/vendor cache):
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or `REDIS_URL=rediss://…` for the
  TCP endpoint. Both work in production; with neither set — or while Redis is unreachable —
  counters use PostgreSQL and reads go straight to the database (see section 4.7).
- Transactional email for invoice delivery and password resets: `RESEND_API_KEY` and
  `EMAIL_FROM`. `EMAIL_DEV_OUTBOX=true` writes messages to a local outbox in development.
- Reusable UI components (buttons, fields, cards, modal, table, badges, skeleton, empty and
  error states) and consistent API error handling on both sides.
- Security headers, a CORS allow-list, `x-powered-by` disabled, parameterised Prisma queries and
  foreign keys enforced at the database level.

### 4.5 RFQs, quotations & comparison (Week 2 requirements)

- **Create & publish RFQs** (Admin/Procurement): title, requirements, ordered line items with
  description, quantity, unit and specifications, a single clearly selected currency, a future
  submission deadline and vendor assignments. Client validation mirrors the server's Zod rules, so
  invalid or missing fields produce field-level errors and never create a partial RFQ.
- **Lifecycle**: `draft → open → closed` (+ `draft|open → cancelled`), `409` on invalid transitions,
  publishing locks line items and assignments, unique `RFQ-####` references generated atomically,
  and an open RFQ past its deadline reports an `expired` effective status that refuses submissions.
- **Vendor visibility**: only assigned vendors can read a published RFQ; unassigned RFQs return
  `404` (references are never disclosed), and quotation lists/comparison are `403` for vendors.
- **Quotations**: an assigned vendor submits per-line unit prices, delivery timeline, delivery
  terms, notes, tax and shipping — one quotation per RFQ, resubmittable as a new revision before
  the deadline. All money (line totals, subtotal, tax, total) is calculated on the server; the
  client cannot set vendor id, currency, totals, owner or timestamps.
- **Quotation register & side-by-side comparison**: per-line vendor prices, delivery timelines and
  notes shown to authorized staff, server-recomputed totals on a stated basis (same currency, tax
  and shipping included), the lowest valid comparable quotation highlighted exactly once, and
  incomparable quotations excluded with explicit reasons. Comparison never awards anything.
- **Sorting, filters and empty states**: search, lifecycle tabs with counts, sorting and pagination
  on the RFQ list; explicit zero-quotation, single-quotation and no-comparison states instead of
  fabricated values.
- **Persistence**: every view reads PostgreSQL — RFQs, assignments, quotations and comparison
  results survive reloads, re-login and server restarts; nothing in the front end is hard-coded.

### 4.6 Approvals, purchase orders & invoices (Week 3 requirements)

- **Approval management** (Admin/Procurement request, Manager/Admin decide): a reviewer sees the
  pending queue with status counts derived from the database; each decision stores the reviewer,
  the timestamp and free-text remarks, and appends to an immutable event timeline
  (requested → approved/rejected) that the UI renders in order.
- **Exactly one decision** is possible: `POST /api/approvals/:id/approve|reject` locks the approval
  row, re-reads it and updates `WHERE status = 'pending'`, so a second click — or a second manager —
  gets a `409` instead of overwriting the first decision. Self-approval is rejected with `403`, and
  only Admin/Manager can decide at all (procurement and vendors are refused server-side).
- **A quotation can be reviewed once**, and an RFQ can only ever have one pending or approved
  request. Rejected requests stay on record and remain searchable by status.
- **Reviewed terms cannot drift**: requesting approval stores a versioned snapshot of the
  quotation (revision, totals, line items). Approval, PO and invoice generation all re-validate the
  live rows against that snapshot and the server-side money calculation, and refuse to continue if
  anything changed (`409 quotation_changed`).
- **Purchase orders** are generated from an approved request only — a pending or rejected request
  returns `409 approval_required`. The document carries a unique sequential number (`PO-0001`),
  the vendor from the quotation, the reviewed line items (description, quantity, unit, unit price,
  line total), the currency and the tax/shipping/total figures, and is linked to its source
  quotation, RFQ and approval (`purchase_order.quotation_id`, `rfq_id`, `approval_request_id` are
  unique/foreign keyed).
- **Duplicate generation is prevented twice over**: a unique index on `approval_request_id` plus a
  row lock inside the transaction. A second click returns the existing document with `created:
  false` instead of creating another.
- **Invoices** are generated from an issued purchase order only (a cancelled PO returns `409`), copy
  the approved subtotal, tax, delivery charge and total without recomputing them, carry a unique
  `INV-0001` number, an issue date and a 30-day (configurable) due date, and are linked to the
  purchase order, RFQ and vendor. One invoice per purchase order is enforced by a unique index and
  the same lock-then-return strategy.
- **PDF and print**: `GET /api/invoices/:id/pdf` renders the invoice server-side with pdf-lib
  (vendor, PO/RFQ references, line items, totals, payment terms) and streams it as
  `application/pdf` with a `Content-Disposition` filename; purchase orders have the same download.
  The print route renders the same document, so `window.print()` produces the identical layout.
- **Email delivery with real feedback**: `POST /api/invoices/:id/send` renders the PDF, sends it to
  the vendor address on file through Resend, and records `sent` / `failed` / `not_configured` with
  the provider, attempt count, timestamp and a redacted error message — each transition also
  appends an invoice event, so the UI can show the last attempt and its error.
- **Vendor scope**: vendors can read only their own purchase orders and invoices (another vendor's
  document is reported as `404`, never `403`, so ids cannot be probed) and can never generate or
  send documents. Every list is `Cache-Control: no-store`.

### 4.7 Redis in production

- `server/redis.js` is the single connection used by the cache (`server/cache.js`) and the rate
  limiter (`server/rateLimit.js`). It accepts an Upstash **REST** URL plus token (recommended on
  Vercel — one HTTPS request per command, nothing to leak between serverless invocations) or a
  **TCP** `rediss://` URL through ioredis. `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` names are
  both recognised, and a REST URL pasted into `REDIS_URL` is understood rather than ignored.
- Everything fails open: if Redis is slow, misconfigured or down, sign-in falls back to the
  PostgreSQL counter store (still enforcing the limit) and reads go to the database. A short
  cooldown stops a dead endpoint from costing a timeout on every request. Redis is never a hard
  dependency, so a cache outage cannot turn the login page into a `500`.

---

## 5. Architecture

```
src/                 React SPA
  components/        AppLayout, guards, UI kit, vendor form, RFQ form, invoice sheet, charts
  context/           Auth and toast providers
  lib/               API client, types, formatting, RFQ helpers, hooks
  pages/             auth/, Dashboard, Vendors, Profile, RfqList/Create/Detail/Quotation(s)/Comparison,
                     Approvals, PurchaseOrders, PurchaseOrderDetail, Invoices, InvoiceDetail, InvoicePrint, NotFound
prisma/
  schema.prisma      PostgreSQL models, relations and indexes
  migrations/        committed SQL migrations (init, rate limits, RFQ quotations, Week 3 documents,
                     append-only quotation revisions)
server/
  auth.js            password hashing, JWT, guards, validation error mapping
  db.js              shared Prisma Client, sequences and user mapping
  seed.js            demo users and vendors
  serializers.js     response shapes and role permissions
  money.js           server-side rounding and quotation money totals
  workflow.js        approval snapshots, document consistency checks, row locks, numbering
  pdf.js             pdf-lib invoice and purchase-order documents
  email.js           Resend delivery plus the development outbox
  cache.js           versioned read cache in front of expensive read models
  redis.js           single Upstash REST/TCP connection, fail-open with cooldown
  rateLimit.js       Redis-first, database-backed rate limiter
  routes/            auth.js, vendors.js, rfqs.js, dashboard.js, approvals.js, purchaseOrders.js, invoices.js
  index.js           Express app, security headers, SPA fallback
scripts/
  smoke-test.mjs     end-to-end API test suite (Weeks 1–3, 190 checks)
  e2e-week2.mjs      Week 2 browser E2E suite (76 checks)
  e2e-week3.mjs      Week 3 browser E2E suite (106 checks: approval → PO → invoice, PDF, email)
  seed-week12-demo.mjs  idempotent demo data: RFQs, quotations, approvals, PO, invoice
  screenshots.mjs    screenshot capture for the submission pack
```

### API endpoints

| Method | Path | Access |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Public |
| `POST` | `/api/auth/login` | Public |
| `POST` | `/api/auth/logout` | Public (clears session) |
| `GET` | `/api/auth/me` | Signed in |
| `POST` | `/api/auth/forgot-password` | Public |
| `POST` | `/api/auth/reset-password` | Public (needs a valid token) |
| `GET` | `/api/auth/dev-reset-link` | Development only (disabled in production) |
| `GET` | `/api/dashboard` | Admin/Procurement/Manager: aggregate metrics; Vendor: own profile metrics only |
| `GET` | `/api/rfqs` | Signed in (vendors: only published RFQs assigned to them; search, status, sort, pagination) |
| `POST` | `/api/rfqs` | Admin, Procurement |
| `GET` | `/api/rfqs/:id` | Signed in (vendor: assigned + published only, otherwise `404`) |
| `PUT` | `/api/rfqs/:id` | Admin, Procurement (draft only; `409` after publish) |
| `PUT` | `/api/rfqs/:id/vendors` | Admin, Procurement (draft only) |
| `POST` | `/api/rfqs/:id/publish` | Admin, Procurement |
| `POST` | `/api/rfqs/:id/close` | Admin, Procurement |
| `POST` | `/api/rfqs/:id/cancel` | Admin, Procurement |
| `GET` | `/api/rfqs/:id/quotations` | Admin, Procurement, Manager (vendors `403`) |
| `GET` | `/api/rfqs/:id/comparison` | Admin, Procurement, Manager (vendors `403`) |
| `PUT` | `/api/rfqs/:id/quotation` | Vendor assigned to the RFQ (create or revise; identity from session, never from payload) |
| `GET` | `/api/approvals`, `/api/approvals/queue`, `/api/approvals/:id` | Admin, Procurement, Manager |
| `POST` | `/api/approvals` | Admin, Procurement (one request per quotation, one active per RFQ) |
| `POST` | `/api/approvals/:id/approve`, `/api/approvals/:id/reject` | Admin, Manager (never the requester) |
| `GET` | `/api/purchase-orders`, `/api/purchase-orders/:id` | Staff: all; Vendor: own documents only |
| `POST` | `/api/purchase-orders` | Admin, Procurement (approved request only; duplicate returns the existing PO) |
| `POST` | `/api/purchase-orders/:id/cancel` | Admin, Procurement (no invoice yet) |
| `GET` | `/api/invoices`, `/api/invoices/:id`, `/api/invoices/:id/pdf` | Staff: all; Vendor: own documents only |
| `POST` | `/api/invoices` | Admin, Procurement (issued PO only; duplicate returns the existing invoice) |
| `POST` | `/api/invoices/:id/send` | Admin, Procurement (records sent/failed/not_configured) |
| `GET` | `/api/vendors` | Signed in (vendors see only themselves) |
| `GET` | `/api/vendors/meta` | Admin, Procurement, Manager (vendors are denied global metadata) |
| `GET` | `/api/vendors/:id` | Signed in (vendors only their own) |
| `POST` | `/api/vendors` | Admin, Procurement |
| `PUT` | `/api/vendors/:id` | Admin, Procurement |
| `DELETE` | `/api/vendors/:id` | Admin, Procurement |
| `GET` | `/api/health` | Public (API and required database tables readiness; no row counts) |

### Role permission matrix

| Capability | Admin | Procurement | Manager | Vendor |
| --- | --- | --- | --- | --- |
| View dashboard | ✅ | ✅ | ✅ | ✅ (own profile) |
| View vendor register | ✅ | ✅ | ✅ | own record only |
| Create / update / delete vendors | ✅ | ✅ | ❌ | ❌ |
| Create / edit / publish / close / cancel RFQs | ✅ | ✅ | ❌ | ❌ |
| View RFQs | all | all | all | assigned + published only |
| Submit / revise quotations | ❌ | ❌ | ❌ | ✅ (own, assigned) |
| View all quotations & comparison | ✅ | ✅ | ✅ (read-only) | ❌ |
| Request approval for a quotation | ✅ | ✅ | ❌ | ❌ |
| Approve / reject a request | ✅ | ❌ | ✅ (never own request) | ❌ |
| Generate / cancel purchase orders | ✅ | ✅ | ❌ | ❌ |
| Generate invoices, download PDFs, send email | ✅ | ✅ | ❌ | ❌ (own PDF read only) |
| View purchase orders & invoices | all | all | all | own documents only |

---

## 6. Database

PostgreSQL managed through Prisma ORM. The connection string is read from `DATABASE_URL`; database
connection credentials are not hard-coded and `.env` is gitignored. Server-side seed accounts are
development-only fixtures and must never be loaded into production.

### Models

| Model | Table | Purpose |
| --- | --- | --- |
| `User` | `users` | Accounts, role, bcrypt password hash |
| `PasswordReset` | `password_resets` | Single-use reset tokens with expiry |
| `Vendor` | `vendors` | Vendor master data, status, rating, optional account link |
| `Rfq` | `rfqs` | Reference, title, currency, status, deadline, creator, lifecycle timestamps |
| `RfqItem` | `rfq_items` | Ordered requested lines: description, quantity, unit, specifications |
| `RfqAssignment` | `rfq_assignments` | RFQ ↔ vendor join, `UNIQUE(rfq_id, vendor_id)` |
| `Quotation` | `quotations` | One live bid per vendor per RFQ: delivery, notes, tax/shipping/total, `revision`, `superseded_at` |
| `QuotationItem` | `quotation_items` | Unit price + server-calculated line total per RFQ line (never deleted) |
| `Counter` | `counters` | Atomic sequence for vendor codes (`VND`), RFQ references (`RFQ`), `PO` and `INV` numbers |
| `RateLimit` | `rate_limits` | Persistent rate-limit counters used when Redis is absent or unavailable |
| `ApprovalRequest` | `approval_requests` | Quote under review: requester, approver, status, remarks, timestamps, JSON snapshot |
| `ApprovalEvent` | `approval_events` | Append-only timeline (requested / approved / rejected) with actor and remarks |
| `PurchaseOrder` | `purchase_orders` | Unique `PO-####`, links to RFQ + quotation + approval, totals, status, cancellation |
| `PurchaseOrderItem` | `purchase_order_items` | Snapshot of the approved line items (description, quantity, unit, price, line total) |
| `Invoice` | `invoices` | Unique `INV-####`, one per purchase order, issue/due dates, email delivery state |
| `InvoiceItem` | `invoice_items` | Invoice line items copied from the purchase order |
| `InvoiceEvent` | `invoice_events` | Timeline for generation and each email attempt

`Vendor` has two relations to `User`: the vendor's own account (`user_id`) and the staff member
who created the record (`created_by`), both `ON DELETE SET NULL`.

### Migrations

```bash
npx prisma migrate dev --name <change>   # author a migration locally
npm run db:deploy                        # apply committed migrations in any environment
npm run db:studio                        # browse data
```

Migrations live in `prisma/migrations/` and are part of the repository. The initial migration
(`init`) creates the core tables, indexes and foreign keys; `add_rate_limits` and
`20261019140000_add_rfq_quotations` follow, then the Week 3 migrations add the approval, purchase
order and invoice tables with their CHECK constraints, and
`20261020150000_append_only_quotation_revisions` adds `superseded_at`, the partial unique index for
live bids, a `BEFORE INSERT` trigger that rejects late quotations at the database clock, and
delete guards that make vendor pricing physically append-only. `npm run seed` inserts the demo fixture
only into a development database with no users or vendors. It never overwrites existing records.
A destructive reseed is blocked unless `ALLOW_DESTRUCTIVE_SEED=true` is explicitly set, and is
never permitted when `NODE_ENV=production`.

### When a deploy fails on a migration

`vercel.json` runs `node scripts/migrate-deploy.mjs`, which wraps `prisma migrate deploy`, retries
once on a transient connection error and names the blocking migration when it gives up. Two codes
stop a build, and both are fixed **once, against that database**, not in the code:

| Code | Meaning | Fix |
| --- | --- | --- |
| `P3018` | The migration's SQL failed — most often `column "…" already exists` because the schema was changed outside Prisma (`db push`, a manual SQL run) | `npx prisma migrate resolve --rolled-back "<migration_name>"`, then redeploy |
| `P3009` | An earlier migration is still recorded as failed, so Prisma refuses to apply anything else | resolve that migration first; its name is in the error and the wrapper prints the command |

Use `--rolled-back` when the migration did not (fully) apply and must run again, and `--applied`
when the database already contains those objects. Both only edit Prisma's `_prisma_migrations`
bookkeeping rows — no table data is touched. Confirm with `npx prisma migrate status` (it must say
*Database schema is up to date*), then redeploy.

Do not restore a deleted migration folder through a merge: Prisma applies every folder in
`prisma/migrations/`, and a resurrected migration is either applied twice or fails against a
database that already has its objects. `scripts/migrate-deploy.mjs` prints a warning when two
folders share a timestamp, which is how such a resurrection shows up.

---

## 7. Testing

```bash
npm run db:deploy    # ensure the PostgreSQL schema exists
npm run dev:server   # in one terminal
npm run test:api     # in another
```

The suite runs against the real PostgreSQL database configured in `DATABASE_URL`.

`scripts/smoke-test.mjs` performs **190 assertions** against the running API when executed, covering:

1. Authentication — health readiness, 401s for anonymous access, wrong-password rejection,
   HttpOnly cookie session refresh, all four roles signing in, no JWT/password hashes in JSON responses,
   logout clearing the session, `Cache-Control: no-store` on authenticated responses, and the local
   reset-token helper being unreachable unless explicitly enabled.
2. Backend authorization — vendor and manager blocked (403) from vendor writes, manager read
   access, vendor-scoped reads, cross-vendor access denied, and global vendor metadata restricted.
3. Vendor management — 422 validation with field errors, create with `VND-###` code, duplicate
   name conflict (409), update, search, status and category filters, sorting, pagination,
   invalid filter rejection (400), meta endpoint.
4. Dashboard — internal and vendor scopes, status/category counts reconciling with supplier
   totals, recent-vendor limit, and vendor isolation from global counts and internal notes.
5. Registration and password reset — weak password rejection, public sign-up forced to the Vendor
   role even when a privileged role is submitted, vendor sign-up creating a Pending profile,
   duplicate email conflict, reset token issuance, single-use tokens, password change and sign-in
   with the new password.
6. Module scope guard — Weeks 3–4 endpoints (`/approvals`, `/purchase-orders`, `/invoices`,
   `/reports`, `/activity`) are not exposed; `/api/rfqs` is live and covered by the checks below.
7. Persistence — created vendors survive into a new session, and deletion is permanent.Note: the smoke test registers throwaway accounts under the reserved `@vendorbridge.test` domain.
Run `npm run db:cleanup-tests` afterwards to delete only those records; seeded demo data and real
vendor records are never touched. Only if the configured database is disposable development data,
explicitly set `ALLOW_DESTRUCTIVE_SEED=true` before using `npm run seed -- --force` to reset it.
That command truncates application tables and should not be used on shared data.

Week 2 coverage inside the same suite: RFQ creation and Zod validation (422 field errors),
client-supplied `status`/`reference`/`createdBy` ignored, lifecycle `409`s (duplicate publish,
edit/assign after publish, double close), publish rules (≥1 line, ≥1 vendor, future deadline),
unique references under concurrent creation, vendor scoping (unassigned `404`, unassigned submit
`403`, quotation/comparison `403` for vendors), server-computed money and tamper resistance,
single-submission/revision policy, deadline-expired `409`, comparison sorting and lowest-price
highlight with exclusion reasons, currency-mismatch exclusion, filters, pagination metadata,
`Cache-Control: no-store`, and persistence across a fresh session.

`scripts/e2e-week2.mjs` is a separate **76-check browser suite** driven through a real browser
against the running app: the procurement → two vendors → comparison workflow, negative
authorization cases with status codes, empty/boundary states, append-only revisions, and read-only
database verification. It refuses to run unless `DATABASE_URL` points at a loopback database whose
name contains `e2e`, and it deletes only the RFQs/quotations it created. Full report:
[`docs/WEEK2_E2E_VERIFICATION.md`](docs/WEEK2_E2E_VERIFICATION.md) with machine-readable results in
`docs/verification/week2/results.json`.

`scripts/e2e-week3.mjs` is a **106-check browser suite** for the Week 3 flow: procurement requests
approval in the UI, the manager approves, the PO is generated and opened, the invoice is generated,
downloaded as a PDF (verified by its `%PDF-` header) and printed, email delivery is exercised
through the outbox provider, vendors are scoped to their own documents, and the negative cases are
proven — unapproved quotations cannot become a PO, a second PO/invoice returns the existing
document, cancelled POs cannot be invoiced, self-approval is refused, unauthorised roles get 403,
invalid transitions get 409, and concurrent clicks produce exactly one document. Results:
`docs/verification/week3/results.json`, report:
[`docs/WEEK3_COMPLETION_REPORT.md`](docs/WEEK3_COMPLETION_REPORT.md).

Front-end type-checking runs as part of `npm run build` (`tsc -b`).

---

## 8. Screenshots

Captured from the running application (`npm run screenshots` drives a local Chromium browser;
set `CHROME_PATH` if Brave/Chrome is installed elsewhere).

| Authentication | Dashboard |
| --- | --- |
| ![Login](docs/screenshots/01-login.png) | ![Dashboard](docs/screenshots/04-dashboard.png) |
| ![Register](docs/screenshots/02-register.png) | ![Vendor register](docs/screenshots/05-vendors.png) |

| Vendor management | Account |
| --- | --- |
| [Add vendor form](docs/screenshots/06-vendor-form.png) · [Vendor details](docs/screenshots/07-vendor-detail.png) | [Profile & security](docs/screenshots/08-profile.png) |
| [Forgot password](docs/screenshots/03-forgot-password.png) | [Vendor dashboard](docs/screenshots/09-vendor-dashboard.png) |

| RFQ & quotation workflow (Week 2) | Vendor side (Week 2) |
| --- | --- |
| [RFQ list](docs/screenshots/10-rfq-list.png) | [Vendor RFQ list](docs/screenshots/15-vendor-rfq-list.png) |
| [Create RFQ](docs/screenshots/14-create-rfq.png) | [Vendor quotation form](docs/screenshots/16-vendor-quotation-form.png) |
| [RFQ detail](docs/screenshots/11-rfq-detail.png) | [Vendor RFQ detail](docs/screenshots/17-vendor-rfq-detail.png) |
| [Quotation register](docs/screenshots/12-quotations.png) | — |
| [Quotation comparison](docs/screenshots/13-quotation-comparison.png) | — |

| Approval-to-invoice workflow (Week 3) | Documents (Week 3) |
| --- | --- |
| [Approval queue](docs/screenshots/27-week3-approvals.png) | [Purchase order](docs/screenshots/29-week3-purchase-order.png) |
| [Approval decision](docs/screenshots/28-week3-approval-detail.png) | [Invoice](docs/screenshots/30-week3-invoice.png) |
| [Vendor invoices](docs/screenshots/32-week3-vendor-invoices.png) | [Invoice print view](docs/screenshots/31-week3-invoice-print.png) |

E2E evidence (validation errors, empty states, expiry, revision, comparison) lives in
[`docs/verification/week2/`](docs/verification/week2/) — 17 captures plus `results.json` — and the
Week 3 run in [`docs/verification/week3/`](docs/verification/week3/).

### Demo data

```bash
npm run db:seed-demo      # idempotent: reuses whatever already exists
```

On top of the base seed this creates the Week 1–3 demo records through the real API: one draft RFQ,
one open RFQ (deadline +7 days), one closed RFQ with five quotations (tie-break and currency
exclusion), the approval → PO → invoice chain for the winning bid, one request still pending in the
approver queue, and one request rejected with written remarks. It refuses to touch a remote
database unless `ALLOW_REMOTE_SEED=true` is set, never runs with `NODE_ENV=production`, and only
touches records titled `Demo:`.

---

## 9. Design notes

The UI follows the supplied VendorBridge wireframes: a dark green top bar, light sidebar,
flat cards, uppercase table headers, compact rows, and green/amber/red status chips. Craft
rules applied throughout: a 4px spacing grid, a single restrained accent colour, flat
elevation (borders instead of shadows), no gradients, no zebra striping, consistent radii,
and short motion that respects `prefers-reduced-motion`.

---

## 10. Known limitations (documented honestly)

- **Email delivery**: password-reset links are dispatched through Resend when `RESEND_API_KEY` is
  set (sender configurable via `EMAIL_FROM`). Without a provider configured, development runs
  write the message to a local mail outbox (`.mail-outbox.jsonl`). Production must configure
  `RESEND_API_KEY` and `CLIENT_ORIGIN`. The optional `/api/auth/dev-reset-link` helper returns a
  live token, so it is disabled unless `ALLOW_DEV_RESET_LINK=true` **and** `NODE_ENV` is not
  `production`; the sign-in UI only renders its local helper when the server reports it enabled.
- **Dependency audit**: `npm audit --omit=dev` reports the Prisma CLI's `deepmerge-ts` advisory
  (high). The fix is a Prisma 7 upgrade, which was not applied without approval.
- **Neon connection resets**: the managed database occasionally drops an idle connection, which
  surfaces as a 503 `database_unavailable` on the first request after the drop; retrying the same
  action succeeds. The API returns an explicit error instead of fabricating data.
- **Role provisioning**: public registration is limited to Vendor accounts. Procurement and Manager
  accounts must be provisioned outside public sign-up; there is no admin invitation UI or email
  verification workflow in Week 1.
- **Weeks 3–4 are not implemented**: approvals, purchase orders, invoices, reports and the audit
  log are deliberately out of scope (those routes return `404`). Their dashboard areas show
  explicit empty states instead of fabricated data. RFQ attachments (drag-and-drop uploads) and
  per-line tax/shipping from the wireframe are also out of scope — tax, shipping and delivery are
  quotation-level, with per-line prices.
- **Database hosting**: the API needs a reachable PostgreSQL instance; there is no embedded or
  offline fallback. The current database is a managed Neon instance whose connection string lives
  in `.env`, so it must be provisioned before the app can start.
- **Automated UI tests**: the 74-check Week 2 browser suite (`scripts/e2e-week2.mjs`, Chromium at
  1440×900) covers the RFQ workflow end to end; Week 1 flows still rely on the 179-check API suite
  plus a manual walkthrough. The E2E harness only accepts a loopback database whose name contains
  `e2e` — run it against staging by mistake and it will refuse rather than write there.
- **Deployment**: Vercel hosts the Vite build plus `api/index.js` (Express as one serverless
  function, `maxDuration` 30s) and Neon hosts PostgreSQL; migrations run during the build via
  `npm run db:deploy`. The serverless function is stateless, so rate limits use Redis when
  `REDIS_URL` is set and the `rate_limits` table otherwise. Run locally with `npm run dev` or
  `npm start`.
- **Bundle size**: route-level code splitting (`React.lazy` + `<Suspense>`) builds one chunk per
  page, so users only download the code for the route they visit.

---

## 11. Submission checklist

| Requirement | Status |
| --- | --- |
| Registration, login, logout, session handling | ✅ implemented & tested |
| Forgot-password / reset flow | ✅ functional (link emailed via Resend; dev outbox fallback) |
| Protected pages and protected backend endpoints | ✅ server-enforced |
| Four roles with role-based authorization on the backend | ✅ verified by tests |
| Dashboard layout, summary cards, quick actions, empty states | ✅ |
| Vendor create/read/update/delete, search, filters, status indicators | ✅ |
| Validation + API error handling | ✅ client and server |
| Vendor data persisted in the database | ✅ PostgreSQL via Prisma |
| Vendor management restricted to authorized roles | ✅ |
| README with setup, configuration, run instructions | ✅ this file |
| Screenshots of authentication, dashboard and vendor management | ✅ 17 screens in `docs/screenshots/` (9 Week 1 + 8 Week 2) |
| RFQ → quotation → comparison workflow | ✅ implemented & verified end to end (74-check browser suite, [report](docs/WEEK2_E2E_VERIFICATION.md)) |
| Week 2 completion report | ✅ [docs/WEEK2_COMPLETION_REPORT.md](docs/WEEK2_COMPLETION_REPORT.md) |
| Completion report | ✅ [docs/COMPLETION_REPORT.md](docs/COMPLETION_REPORT.md) — features, commands actually run, audit findings and limitations |
| Working source code pushed to the assigned GitHub repository | ✅ [BhaveshSab/VendorBridge-kagnus](https://github.com/BhaveshSab/VendorBridge-kagnus), branch `feat/week2-rfq-quotations` |
| PostgreSQL + Prisma ORM instead of a local database file | ✅ PostgreSQL schema; 179 API checks pass against it |

### Getting the code

```bash
git clone https://github.com/BhaveshSab/VendorBridge-kagnus.git
cd VendorBridge-kagnus

npm install                 # installs dependencies and generates the Prisma Client
cp .env.example .env        # set DATABASE_URL (PostgreSQL) and JWT_SECRET

npm run db:setup            # generate client, migrate, seed empty dev DB, and show row counts
npm run dev                 # API on :4000, Vite on :5173
```

`.env`, `node_modules/`, `dist/` and the local `server.log` / `server.pid` are ignored, so no
credentials or generated artefacts are committed. `prisma/migrations/` **is** committed; run
`npm run db:deploy` to recreate the PostgreSQL schema on another machine.
