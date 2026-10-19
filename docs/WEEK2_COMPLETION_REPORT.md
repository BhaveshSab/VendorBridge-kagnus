# VendorBridge — Week 2 Completion Report

**Project:** VendorBridge — Procurement & Vendor Management ERP
**Milestone:** Week 2 — RFQs, Quotations & Comparison
**Branch (local only):** `feat/week2-rfq-quotations` (based on `main` @ `1c70de8`)
**Verified:** 19 October 2026
**Environment:** Windows 11 · Node.js v24.13.0 · PostgreSQL 18 (temporary embedded instance for verification) · Chrome/Brave at 1440×900

**Status:** The complete RFQ → quotation → comparison workflow is implemented end to end and was exercised
against the running API and a real browser. **Nothing was pushed to GitHub**, and `README.md` was deliberately
not modified in this pass.

---

## 1. What was implemented

### Data model (Prisma + migration)

| Model | Table | Purpose |
| --- | --- | --- |
| `Rfq` | `rfqs` | Reference, title, description, currency, status, deadline, creator, lifecycle timestamps |
| `RfqItem` | `rfq_items` | Ordered requested lines: description, `DECIMAL(12,3)` quantity, unit, specifications |
| `RfqAssignment` | `rfq_assignments` | Join model RFQ ↔ Vendor with `UNIQUE(rfq_id, vendor_id)` |
| `Quotation` | `quotations` | One per `(rfq_id, vendor_id)`; currency, delivery days/terms, notes, tax percent, subtotal/tax/shipping/total as `DECIMAL(14,2)`, revision |
| `QuotationItem` | `quotation_items` | Unit price and server-calculated line total per RFQ line, unique per quotation |

The migration [`prisma/migrations/20261019140000_add_rfq_quotations/migration.sql`](../prisma/migrations/20261019140000_add_rfq_quotations/migration.sql)
is additive only: it creates the five tables, indexes, foreign keys and CHECK constraints
(`status IN (...)`, currency pattern, positive quantities, non-negative money, tax 0–100, revision ≥ 1).
No Week 1 table is altered, truncated or reseeded.

### Lifecycle and business rules

- `draft → open → closed` and `draft|open → cancelled`. Closed/cancelled are terminal. Invalid transitions return `409 invalid_transition`.
- Drafts are editable and assignments can be replaced; **publishing locks line items and vendor assignments**.
- Publishing requires ≥ 1 line item, ≥ 1 assigned vendor and a deadline in the future.
- An RFQ whose deadline passes while `open` is reported as **expired** (`effectiveStatus`) and rejects submissions; procurement can still close it.
- References (`RFQ-0001`…) come from the existing `counters` table inside the creation transaction (`nextSequence`), with a `UNIQUE` index and a retry on unique-violation collisions.
- One quotation per vendor per RFQ (`UNIQUE(rfq_id, vendor_id)`). Revision policy: a vendor may resubmit before the deadline; it replaces the previous revision, increments `revision`, and earlier revisions are **not** retained.
- Money is computed only on the server: `line = round(unit price × quantity)`, `subtotal = Σ line`, `tax = round(subtotal × tax% / 100)`, `total = subtotal + tax + shipping`, using Prisma `Decimal` with half-up rounding. Clients cannot submit currency, totals, vendor id or timestamps.
- Comparison basis: `total`, same currency as the RFQ, tax and shipping included. Quotations are excluded from the lowest-price highlight when the currency differs, requested lines are missing, or stored totals disagree with a server recalculation.

### Access rules (enforced in the API)

| Capability | Admin | Procurement | Manager | Vendor |
| --- | --- | --- | --- | --- |
| List/read RFQs | all | all | all | only published RFQs assigned to their vendor record |
| Create/edit/publish/close/cancel RFQs | ✅ | ✅ | ❌ | ❌ |
| Replace vendor assignments (draft only) | ✅ | ✅ | ❌ | ❌ |
| Read all quotations / comparison | ✅ | ✅ | ✅ (read-only) | ❌ |
| Submit/revise own quotation | ❌ | ❌ | ❌ | assigned vendor only |

The vendor relationship is always resolved from the authenticated session (`currentVendorFor`); unassigned RFQs return `404` to avoid disclosing references, and submissions for another vendor are impossible because `vendorId` is never read from the request.

### API endpoints added

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/api/rfqs` | Signed in (role-scoped; search, status, sort, pagination) |
| `POST` | `/api/rfqs` | Admin, Procurement |
| `GET` | `/api/rfqs/:id` | Signed in (vendor: assigned + published only) |
| `PUT` | `/api/rfqs/:id` | Admin, Procurement (draft only) |
| `PUT` | `/api/rfqs/:id/vendors` | Admin, Procurement (draft only) |
| `POST` | `/api/rfqs/:id/publish` | Admin, Procurement |
| `POST` | `/api/rfqs/:id/close` | Admin, Procurement |
| `POST` | `/api/rfqs/:id/cancel` | Admin, Procurement |
| `GET` | `/api/rfqs/:id/quotations` | Admin, Procurement, Manager |
| `GET` | `/api/rfqs/:id/comparison` | Admin, Procurement, Manager |
| `PUT` | `/api/rfqs/:id/quotation` | Vendor assigned to the RFQ (create or revise) |

`GET /api/dashboard` now also returns `rfqSummary` (open/expired/draft/closed counts and quotation count for staff; assigned/open/submitted for vendors).
`GET /api/auth/me` permissions gained `manageRfqs`, `viewQuotations` and `submitQuotations`.

### Frontend

New role-aware routes under the existing `AppLayout`:

- `/rfqs` — RFQ list with search, lifecycle tabs with counts, sorting and pagination; vendors see only their invitations and submission state.
- `/rfqs/new` and `/rfqs/:id/edit` — two-column Create RFQ form (details + line items, vendor assignment rail), client validation mirroring the Zod rules, explicit “Save draft” vs “Review & publish” with a confirmation that explains the deadline and vendor visibility.
- `/rfqs/:id` — detail with requirements, line items, lifecycle actions, invited vendors and live submission state; vendors see only their own quotation and a clear locked/expired state.
- `/rfqs/:id/quotation` — vendor submission/revise form in a line-item table with unit price, quantity, live line totals, delivery timeline, terms, notes, tax and shipping, plus a server-total disclaimer.
- `/rfqs/:id/quotations` — procurement quotation register with sorting and a line-item/notes detail modal.
- `/rfqs/:id/compare` — side-by-side matrix by vendor with per-item unit prices, tax, shipping, delivery timeline, notes, a highlighted lowest column, excluded quotations with reasons and explicit empty/single/no-comparison states.

The dashboard’s “Active RFQs” card is now live, and the RFQ quick action is enabled; Week 3/4 modules (approvals, PO, reports) remain explicit roadmap items with no routes.

---

## 2. Verification actually performed

Everything below was executed in this workspace. The API and tests ran against a **temporary embedded PostgreSQL 18 instance** (isolated data directory, removed afterwards) because outbound TCP 5432 to the managed Neon endpoint timed out from this machine during the session. The Neon database was not modified.

| Check | Command | Result |
| --- | --- | --- |
| Prisma client generation | `npx prisma generate` | Pass |
| Migration applied (fresh DB) | `npx prisma migrate deploy` | **Pass** — `init`, `add_rate_limits`, `add_rfq_quotations` |
| Development seed | `node server/seed.js` | Pass (dev-only fixture, empty database) |
| TypeScript | `npm run typecheck` | **Pass**, exit 0 |
| Production build | `npm run build` | **Pass**, exit 0 (only the existing >500 kB chunk warning) |
| API suite (Week 1 + Week 2) | `npm run test:api` | **Pass — 179 passed, 0 failed**, exit 0 |
| JavaScript syntax | `node --check` on all `server/**/*.js` and `scripts/*.mjs` | Pass |
| Whitespace/conflict check | `git diff --check` | Pass |
| Screenshot workflow | `APP_URL=http://localhost:4100 node scripts/screenshots.mjs` | **Pass** — 17 captures, including 8 new Week 2 screens |

### Week 2 coverage in `scripts/smoke-test.mjs`

- Authorization: anonymous/vendor/manager rejected from RFQ writes; managers may read; vendors blocked from quotation lists and comparison.
- RFQ creation and validation: title, items, quantity (0, negative, non-numeric, 4 decimals), unit, currency, past deadline, unknown vendor and duplicate assignment → `422` with field keys; client-supplied `status`, `reference`, `createdBy`, `publishedAt` ignored.
- Lifecycle: publish, duplicate publish `409`, edit after publish `409`, assignment after publish `409`, publish without vendors `422`, close twice `409`, cancel/publish closed `409`, vendor can still read a closed RFQ.
- Concurrency: 5 parallel RFQ creations yield 5 unique references; two simultaneous submissions from one vendor leave a single quotation row.
- Vendor flow: assigned read, unassigned `404`, unassigned submit `403`, cross-vendor submission impossible via `vendorId` (ignored), partial/unknown/negative/non-numeric prices `422`, delivery/tax/shipping bounds enforced, revision policy verified, deadline-expired submission `409 rfq_expired`.
- Comparison: persisted quotation list, deterministic sort, server totals, lowest highlight, single winner on ties, single-submission and zero-submission states, currency-mismatch exclusion (verified by mutating a test quotation and restoring it), vendor payloads never contain other vendors’ prices or names.
- Filters/pagination/headers/persistence: search, open/expired filters, invalid status `422`, pagination metadata, deterministic reference sort, `Cache-Control: no-store`, and persistence across a new session.

### Browser workflow

The screenshot script drives the real API to create a published RFQ assigned to three vendors (Nova, Zenith, Apex), submits three quotations from their own accounts, then captures:

`10-rfq-list.png`, `11-rfq-detail.png`, `12-quotations.png`, `13-quotation-comparison.png`, `14-create-rfq.png`, `15-vendor-rfq-list.png`, `16-vendor-quotation-form.png`, `17-vendor-rfq-detail.png`.

These are persisted rows produced through the UI’s API — no hard-coded values in the frontend.

---

## 3. Migration and deployment steps

```bash
npm install                        # also runs prisma generate
npx prisma migrate deploy          # applies init + add_rate_limits + add_rfq_quotations
npm run seed                       # ONLY on an empty disposable development database
npm run dev                        # API :4000, Vite :5173
npm run test:api                   # API_URL/DATABASE_URL must point at the dev database
```

In production/Vercel the build already runs `prisma generate`; apply `npx prisma migrate deploy` against the production
`DATABASE_URL` before serving the new API. No Week 1 data is rewritten by the migration.

---

## 4. Known limitations

- **Wireframe fidelity:** the supplied Kagnus wireframe was used as the layout reference for Create RFQ, Submit Quotation and Comparison. Attachments (drag-and-drop uploads) and per-line tax/shipping shown in the wireframe were **not** implemented: attachments need serverless storage and per-line charges would change the comparison model. Quotation-level tax, shipping and delivery are used instead, with per-line prices.
- **Sidebar:** the wireframe lists Approvals, Purchase orders, Invoices, Reports and Activity; only the Week 2 modules were added, and no placeholder routes exist for the later milestones.
- **Revision history:** revisions overwrite the single quotation row (`revision` counter only); no version history table.
- **Award/approval:** comparison highlights a lowest comparable quotation but never awards; approval and PO workflows remain out of scope.
- **Manager role:** read-only access to RFQs, quotations and comparison; no approval action.
- **Remote database:** the managed Neon endpoint was unreachable on port 5432 from this machine, so all verification used a disposable local PostgreSQL instance. The Neon database was neither migrated nor seeded during this pass.
- **Deployment:** no hosted deployment was performed and no commit was pushed; changes are local only.
- **README:** intentionally not updated in this pass, per instruction. Use this report for Week 2 documentation.
- **Dependency audit:** unchanged from Week 1 (3 high findings in Prisma CLI tooling; fix requires Prisma 7).
