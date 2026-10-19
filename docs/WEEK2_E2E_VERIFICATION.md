# Week 2 — RFQ & Quotation End-to-End Verification

**Date:** 19 October 2026
**Branch:** `feat/week2-rfq-quotations` (uncommitted; nothing pushed)
**App under test:** production build (`npm run build`) served by `node server/index.js` at `http://localhost:4100`
**Database:** disposable embedded PostgreSQL 18.4 at `127.0.0.1:55432`, database `vendorbridge_e2e`
**Browser:** headless Brave (Chromium) via the repository's existing `puppeteer-core`, desktop 1440×900

**Result: 74/74 end-to-end checks passed, with no product defects found in the exercised Week 2 paths.**
The managed Neon development database (`neondb`, reachable from this machine during verification) does **not**
have the Week 2 migration applied; it was left untouched.

---

## 1. Environment and database safety

- `.env` points at the managed Neon database, so every command was run with an explicit
  `DATABASE_URL=postgresql://postgres:***@127.0.0.1:55432/vendorbridge_e2e`.
- `scripts/e2e-week2.mjs` refuses to start unless the host is loopback and the database name contains `e2e`.
  It also verifies `current_database()` and `inet_server_port()` before writing.
- The local cluster did not exist before this run (`.db-data` absent); it was initialised by the app's
  embedded-Postgres bootstrap, migrated and seeded, and is removed after verification.
- `npx prisma migrate status` → `vendorbridge_e2e` at `127.0.0.1:55432`, 3 migrations, schema up to date.
- Seeded fixtures only: 6 users, 16 vendors (no new accounts, no credential or vendor-record changes).
- Test RFQs use titles prefixed `E2E Test`; cleanup deletes only rows whose title contains this run's stamp.
  Cascade removes line items, assignments and quotations.

## 2. End-to-end workflow completed

| Step | Evidence |
| --- | --- |
| Procurement signs in through the UI and submits an empty form | Inline `Please fix N fields` alert; RFQ count 0 → 0 (no partial record) |
| Creates and publishes an RFQ with 2 line items, INR, future deadline and 2 invited vendors | **RFQ-0045**, status `open`, reference `RFQ-0045`, deadline 31 Oct 2026 |
| Detail page renders reference, status, deadline, both line items and both vendors | screenshot 03; survives full reload |
| Nova Office Supplies signs in, sees only its invitation, submits a quotation | 10 × ₹1,200 + 5 × ₹340, 18% tax, ₹1,500 delivery, 12 days, notes; total **₹17,666.00**, revision 1, survives reload |
| Zenith IT Solutions signs in and submits different pricing/timeline | 10 × ₹1,100 + 5 × ₹360, 18% tax, ₹900 delivery, 9 days, notes; total **₹16,004.00** |
| Procurement reviews the register and side-by-side comparison | 2 of 2 invited vendors; both quotations, notes, timelines and totals |
| Nova revises its quotation with tampered ownership fields | revision 2, total **₹18,356.00**, still linked to Nova, served as INR |
| Comparison after revision | updated total/unit price reflected; **Zenith ₹16,004.00 remains lowest** |
| RFQ closed and vendor re-submission attempted | 409; saved quotations remain readable |

Test records existed only for the duration of the run: **7 RFQs and 3 quotation rows created (Nova, Zenith, Apex),
7 RFQs removed**; final counts 6 users, 16 vendors, 0 quotations, 0 `E2E Test` RFQs.

## 3. Expected outcomes

| # | Expected outcome | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Procurement officer can create and view RFQs | **Pass** | UI create + publish; detail API/DB rows |
| 2 | Required details, assigned vendors, deadline, unique ID, status | **Pass** | `RFQ-0045`, 2 items, 2 assignments, `open`, future UTC deadline |
| 3 | Only assigned vendors can view an RFQ | **Pass** | Nova 200 on RFQ A; Nova 404 on unassigned RFQ B; draft 404 |
| 4 | Assigned vendors submit prices, timeline, notes | **Pass** | Both quotations persisted with lines, 12/9 days and notes |
| 5 | Procurement sees multiple quotations side by side | **Pass** | Register (2 rows) and comparison (2 columns) |
| 6 | Comparable prices/timelines and lowest valid price highlighted | **Pass** | Server recalculation matches; exactly one `isLowest` (Zenith ₹16,004.00) |
| 7 | Sorting, filtering and empty states | **Pass** | Register sorts, comparison column sort, RFQ search/empty, reference sort |
| 8 | Data persists and links to the right RFQ/vendor | **Pass** | Reload, new sign-in, fresh API sessions, DB FK inspection |
| 9 | Server-side authorization blocks unauthorized access/submissions | **Pass** | 401/403/404/409/422 matrix below; DB unchanged |
| 10 | No hard-coded RFQ/quotation/comparison data | **Pass** | Revision immediately changes API/UI totals; DB rows drive every figure |

Additional cases: RFQ with no quotations → explicit empty state and `lowest: null`; single quotation →
one-column comparison, lowest banner, no multi-vendor sort control; currency-corrupted quotation (only this
run's test row, disposable DB) → excluded with reason and no highlight.

## 4. Authorization and negative tests

| Case | Observed |
| --- | --- |
| Anonymous `/rfqs`, `/rfqs/:id`, `/rfqs/:id/comparison`, `POST /rfqs`, quotation PUT | **401** |
| Vendor create / edit / publish / close / assign | **403** each |
| Vendor reads unassigned RFQ B | **404** (no reference disclosure) |
| Vendor submits against unassigned RFQ B | **403** |
| Vendor reads staff quotation register or comparison | **403** |
| Vendor payload adds `vendorId`, `rfqId`, `currency: USD`, `total: 1`, `submittedAt: 2000-…` | **200** revision; stored vendor/RFQ/currency stay correct, total recalculated, timestamp preserved |
| Missing line price / negative price / `"not-a-number"` / foreign `rfqItemId` / tax 101% | **422** each |
| Invalid IDs (`/rfqs/abc`, `/rfqs/99999999`), unknown status, unknown quotation sort | **404, 404, 422, 400** |
| Publish twice / close a draft / edit a published RFQ / reassign after publish | **409** each |
| Draft RFQ: vendor GET / PUT | **404 / 409** |
| Cancelled RFQ submission | **409** |
| Expired RFQ submission (deadline moved into the past on the disposable test row) | **409**, `code: rfq_expired`; UI shows the locked state |
| Closed RFQ submission | **409**; existing quotation totals unchanged |
| Forbidden/invalid attempts | quotation count 2 → 2, Nova total unchanged by rejects |
| Cache headers | `Cache-Control: no-store` on authenticated RFQ, vendor and staff quotation responses |
| Vendor list scoping and pagination | No unassigned RFQs on page 1 or with `pageSize=1` |

## 5. Commands actually run

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (chunk-size warning only) |
| `npx prisma validate` | schema valid |
| `npx prisma generate` | exit 0 |
| `npx prisma migrate deploy` (local e2e DB) | 3 migrations applied |
| `npx prisma migrate status` | schema up to date |
| `npm run seed` | seeded |
| `API_URL=http://localhost:4100 npm run test:api` (local DB exported) | **179 passed, 0 failed** |
| `APP_URL=http://localhost:4100 node scripts/e2e-week2.mjs` | **74 passed, 0 failed** (exit 0) |
| `node --check` on `server/**/*.js` and `scripts/*.mjs` | pass |
| `git diff --check` | pass |
| `git log origin/main..HEAD` | 0 commits; README untouched; nothing pushed |

## 6. Defects and blockers

1. **Test harness can target a different database than the app (test tooling, not product).**
   `scripts/smoke-test.mjs` reaches the API at `API_URL` but loads `server/db.js` (and therefore `.env`)
   for its direct quotation mutation. Running it with a local API while `.env` points at the managed Neon
   database connected to `neondb` and failed with Prisma `P2021` (`public.quotations` missing) before any
   write. Re-running with `DATABASE_URL` set to the API's database passed 179/179.
   *Expected:* the suite should fail fast or guard direct DB access when `API_URL` and `DATABASE_URL` do not
   describe the same instance. This is reported, not changed.
2. **Week 2 migration is pending on the managed Neon development database.** The `quotations` table does not
   exist there, so the Week 2 app cannot run against it until `npm run db:deploy` is executed in that
   environment. Per instructions, no migration was applied to Neon and no production/shared data was modified.
3. **No product defects were found** in the Week 2 RFQ, quotation, comparison, authorization or persistence
   behaviour exercised above.

## 7. Limitations

- No deployment was performed; verification used the local production build only.
- Expiry was simulated by moving this run's disposable test RFQ deadline into the past, not by changing the
  system clock. Closed and cancelled states were exercised through the real API.
- The "incomparable quotation" case requires a currency mismatch that the API correctly refuses to create;
  it was produced by mutating only this run's quotation row in the disposable database, then restored.
- Browser verification was desktop-only (1440×900). Mobile layout and assistive-technology checks were not
  part of this run.
- Two vendor accounts (Nova, Zenith) plus Apex for single-quotation cases were used; no concurrency race
  between vendors was attempted here (covered by the 179-test API suite).

## 8. Evidence

- Harness: [`scripts/e2e-week2.mjs`](../scripts/e2e-week2.mjs) (existing `puppeteer-core` + Prisma; no new test framework)
- Machine-readable results: [`results.json`](verification/week2/results.json)
- Screenshots (17), containing only seeded demo business data and disposable test records:
  [`docs/verification/week2/`](verification/week2/)
  - `01-rfq-validation.png`, `02-create-rfq-filled.png`, `03-rfq-detail.png`
  - `04-vendor-rfq-list.png`, `05-vendor-quotation-form.png`, `06-vendor-quotation-saved.png`
  - `07-vendor-unassigned-rfq.png`, `08-quotations-register.png`, `09-comparison.png`
  - `10-empty-comparison.png`, `11-single-quotation-comparison.png`, `12-incomparable-quotation.png`
  - `13-rfq-list-search.png`, `14-rfq-list-empty.png`, `15-expired-quotation-locked.png`
  - `16-comparison-after-revision.png`, `17-vendor-relogin-persistence.png`

No passwords, cookies, tokens, password hashes or database connection strings appear in this report, the
harness output, `results.json` or the screenshots.
