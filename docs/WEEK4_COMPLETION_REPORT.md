# Week 4 — Reports, spend analytics and the audit trail

Completion report for the Kagnus Week 4 brief. Everything below was executed in this
workspace; results are quoted from actual command output, and anything that could not be
verified is listed under **Limitations** instead of being claimed.

---

## 1. What was built

Week 4 extends the existing Week 1–3 application (no second app, no mock data):

| Area | Endpoints | Screens |
| --- | --- | --- |
| Spend analytics | `GET /api/reports/overview` | `/reports` |
| Supplier performance | `GET /api/reports/vendors` | `/reports` |
| CSV exports | `GET /api/reports/export?type=spend\|purchase-orders\|invoices` | `/reports` (three buttons) |
| Audit trail | `GET /api/activity`, `GET /api/activity/:id` | `/activity` |
| Per-user notifications | `GET /api/notifications`, `GET /api/notifications/unread-count`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all` | bell in the top bar |

New files: `server/audit.js`, `server/routes/reports.js`, `server/routes/activity.js`,
`server/notify.js`, `server/routes/notifications.js`, `src/components/NotificationBell.tsx`,
`scripts/e2e-week4-notifications.mjs`,
`server/services/reports.js`, `src/pages/Reports.tsx`, `src/pages/Activity.tsx`,
`scripts/seed-week4-demo.mjs`, and five migrations:
`20261021120000_add_audit_log`, `20261021130000_fix_quotation_cascade`,
`20261021131000_fix_quotation_item_cascade`, `20261021132000_audit_actor_without_fk`,
`20261021160000_add_notifications`.

Extended files: `prisma/schema.prisma`, `server/app.js` (route mounting),
`server/routes/{auth,vendors,rfqs,approvals,purchaseOrders,invoices}.js` (audit writes),
`src/App.tsx` (lazy routes), `src/components/AppLayout.tsx` and `src/lib/constants.ts`
(navigation, action colours), `src/components/charts.tsx` (donut/bar primitives reused),
`src/lib/format.ts` (compact money), `src/pages/Dashboard.tsx` (Week 4 entry card),
`scripts/smoke-test.mjs`, `scripts/screenshots.mjs`, `package.json`, `README.md`.

## 2. Data model

- **audit_logs** — one row per state-changing action: `action`, `entity_type`, `entity_id`,
  `summary`, JSON `metadata`, nullable `actor_id` **without a foreign key**, plus actor
  name/email/role, IP address, user agent and `created_at`. A `BEFORE UPDATE` and a
  `BEFORE DELETE` trigger raise an integrity error, so the trail is append-only for the API,
  Prisma Studio and raw SQL alike.
  - `actor_id` is deliberately a historical reference: an `ON DELETE SET NULL` foreign key
    would itself mutate an append-only row, so `20261021132000_audit_actor_without_fk`
    removes it (its name is historical — the column was never created with an FK in a fresh
    database, and the migration is a no-op there).
- **Indexes** — `(created_at DESC, id DESC)` for the feed, `(entity_type, entity_id)` for a
  record's history, `(actor_id)`, `(action)` for facet counts.
- **notifications** — one row per recipient (`user_id`), event `type`, `title`, `body`, optional
  `entity_type`/`entity_id`/`link`, optional vendor reference, nullable `read_at` and `created_at`.
  The user FK cascades; the vendor FK is `SET NULL`, so a removed supplier does not erase the
  history of a notification. `(user_id, read_at, created_at)` serves the unread badge and
  `(user_id, created_at)` the inbox.
- **Quotation cascade reconciliation** — `20261021130000_fix_quotation_cascade` and
  `20261021131000_fix_quotation_item_cascade` align the live database with
  `schema.prisma`: deleting an RFQ or a vendor still removes that RFQ's bids (their line
  items first), while the existing append-only delete guards keep a bid from being deleted
  on its own. Both are idempotent.

### Reported figures are derived, never stored

`server/services/reports.js` reads persisted documents only:

- spend follows **issued** purchase orders (cancelled orders excluded) and invoices are
  counted by issue date;
- every KPI, trend bucket, category share and top-supplier row is aggregated in SQL from
  `DECIMAL` columns — the browser only formats;
- purchase orders can be priced in different currencies, so totals are **never summed across
  currencies**. The overview selects the dominant currency for the period, returns a bucket
  per currency and states how many orders sit outside the detailed breakdown;
- cycle-time and approval-turnaround metrics use the timestamps stored on the documents, and
  return `null` (rendered as “—”) when no sample exists instead of a fabricated `0`;
- the CSV exporter writes a UTF-8 BOM, CRLF rows, quoted fields, and prefixes cells starting
  with `=`, `+`, `-` or `@` so a vendor name cannot become a spreadsheet formula.

## 3. Audit coverage

`server/audit.js` owns a fixed catalogue of 23 actions across 17 entity categories:
`auth.login`, `auth.login_failed`, `auth.password_reset`, `vendor.created/updated/deleted`,
`rfq.created/updated/vendors_updated/published/closed/cancelled`,
`quotation.submitted/revised`, `approval.requested/approved/rejected`,
`purchase_order.generated/cancelled`, `invoice.generated`, and
`invoice.email_sent/email_failed/email_not_configured`.

Writes are made **inside the business transaction** (`strict: true`, the default) for every
document change, so a change cannot commit without its audit row. Authentication events pass
`strict: false`: a successful sign-in must not fail because the audit insert hiccuped, and
the failure is logged instead.

Each entry stores an actor **snapshot** (name, email, role) taken at write time, so the trail
stays readable after the account is deleted. Failed and successful sign-ins both record the
IP from `X-Forwarded-For` (falling back to the socket address), truncated to 64 characters,
and the user agent truncated to 200.

## 4. Authorization

| Action | admin | procurement | manager | vendor |
| --- | --- | --- | --- | --- |
| Read spend overview / supplier performance | ✓ | ✓ | ✓ | 403 (router-level `requireRole`) |
| Export CSV | ✓ | ✓ | ✓ | 403 |
| Read the audit trail and entry detail | ✓ | ✓ | ✓ | 403 |

The role check is applied once with `router.use(requireAuth, requireRole(...))` in both new
routers, so there is no per-route path that forgets it. Report and audit responses carry
`Cache-Control: no-store` like every other `/api` response, and a vendor sees only their own
documents through the existing PO/invoice endpoints — never aggregate spend.

## 5. Verification actually run

| Command | Target | Result |
| --- | --- | --- |
| `npm run test:api` | configured PostgreSQL database (Neon `neondb`) via `http://localhost:4000` | **227 passed, 0 failed** |
| `npm run typecheck` | repo | pass (`tsc -b --pretty false`) |
| `npm run build` | repo | pass (Vite chunk-size warning only) |
| `npx prisma migrate status` | configured database | **11 migrations found — Database schema is up to date!** |
| `npm run db:status` | configured database | connection OK; users/vendors/RFQs/quotations/counters/rate limits present |
| `npm run db:seed-week4` | configured database through the real API | first run created four chains (RFQ-0113…0116); re-run reported all four as *already seeded*, and the overview then read **5 orders · INR 14,80,822 · 5 months** |
| `npm run db:cleanup-tests` | configured database | removed only 5 `@vendorbridge.test` accounts, 5 test vendors, 13 `[smoke]` RFQs and 19 test notifications; demo data untouched |
| `npm run db:deploy` | configured database | applied `20261021160000_add_notifications` |
| `NOTIFY_E2E_ALLOW_REMOTE=1 npm run test:e2e:notifications` | configured database through `http://localhost:4000` | **38 passed, 0 failed** (events, recipients, actor exclusion, scope, persistence; chain removed afterwards) |
| `node --check` on new/changed server and script files | repo | pass |

### What the 227 API checks cover (Week 4 additions)

1. Anonymous callers get `401` on every report and audit endpoint; vendors get `403` on all
   of them, including the CSV export.
2. Staff read the overview and supplier-performance payloads; the monthly trend sums to the
   reported awarded spend, category shares sum to 100%, and the currency buckets reconcile
   with the total.
3. Inverted ranges, malformed dates, over-long windows, unknown export types and an unknown
   `type` are rejected with `422` and field errors rather than a `500`.
4. CSV responses carry `text/csv; charset=utf-8`, an attachment `Content-Disposition`
   filename, a header row and `Cache-Control: no-store`.
5. The audit feed paginates, filters by action/record type/actor/date and search text, returns
   facet counts, and `GET /api/activity/:id` returns both the entry and the same record's
   related events.
6. Creating, updating and deleting a vendor produces audit rows with the actor's name and
   role; a direct `UPDATE` and a direct `DELETE` on `audit_logs` are **refused by the database
   triggers** (executed inside the suite, expecting an error).

Week 1–3 checks in the same suite (`auth`, vendor CRUD, dashboard, registration, reset
tokens, RFQ lifecycle, quotation integrity, approvals, PO and invoice generation) all still
pass, which is the regression evidence for the audit wiring added to those routes.

## 6. Demo data (test fixtures)

`npm run db:seed-week4` (`scripts/seed-week4-demo.mjs`) drives the real HTTP API and creates
four complete procurement chains, one in each of the last four months, so the Reports page
has a genuine trend, four supplier categories and a realistic spend split:

| RFQ | Supplier | Category | When |
| --- | --- | --- | --- |
| `RFQ-0113` — Ergonomic workspace refresh | Aurora Workspaces | Furniture | ~3 months ago |
| `RFQ-0114` — Regional freight contract | Northwind Logistics | Logistics | ~2 months ago |
| `RFQ-0115` — Platform licence & onboarding | Brightline Software | Software | ~1 month ago |
| `RFQ-0116` — Quarterly deep clean | Greenfield Facilities | Facilities | this month |

Each chain is RFQ → publish → vendor quotation → approval request → manager decision →
purchase order → invoice → RFQ close. The script never writes numbers, totals or tax itself;
only the timestamps are backdated afterwards so the trend chart has history, and the audit
trail keeps the real actions as they happened. It refuses to run with `NODE_ENV=production`,
refuses a remote database unless `ALLOW_REMOTE_SEED=true`, and skips a scenario whose RFQ
already exists (idempotent — a second run adds no documents, only the sign-in audit rows it
produces itself).

Totals on the configured development database at the time of writing: 21 RFQs, 20 quotations,
7 approvals, 5 purchase orders, 5 invoices and **180+ audit entries across 17 distinct
actions** (the exact count grows with every test run, because the trail cannot be trimmed).
The seeder also verifies itself: it re-reads `/api/reports/overview` and `/api/activity` and
prints the order count, awarded value, month count and audit entry count it finds.

Screenshots (synthetic data only):

| File | Content |
| --- | --- |
| `docs/screenshots/33-week4-reports.png` | Reports page: KPI cards, monthly spend, category split, top suppliers |
| `docs/screenshots/34-week4-reports-trend.png` | 12-month period with the full trend and supplier performance table |
| `docs/screenshots/35-week4-activity.png` | Activity trail with filters, facets and action chips |
| `docs/screenshots/36-week4-audit-detail.png` | Audit entry drawer with metadata and the record's other events |

## 7. Migrations and configuration

```bash
npm run db:deploy        # scripts/migrate-deploy.mjs → prisma migrate deploy
npm run db:seed-week4    # four backdated chains (app must be running)
npm run test:api         # 227-check API suite
```

Week 4 adds no environment variables: reports and the trail read the same `DATABASE_URL`,
and CSV exports are generated on the server without an external service. No credentials are
stored in the repository; `.env` is gitignored.

The audit trail also has a documented operational consequence: because rows cannot be
deleted, `npm run db:cleanup-tests` removes test accounts, vendors, RFQs and their notifications
but leaves the audit entries those actions produced. That is intentional — the trail is evidence, not cache.

## 8. Independent Week 4 QA (2026-10-21)

The separate harness `scripts/e2e-week4.mjs` (80 HTTP, browser and database checks) was run against a
disposable loopback PostgreSQL database after the 227-check API suite passed. Its archived run
predates the notification subsystem and recorded **69 passed, 0 failed and 11 `FAIL — NOT
IMPLEMENTED`** for the then-missing bell. That section now delegates to
`scripts/e2e-week4-notifications.mjs`; against the configured database it records **38 passed, 0
failed**, including the event writers, actor exclusion, vendor scoping, cross-user `404`,
mark-read/mark-all-read and persistence. Its full output is
[`docs/verification/week4/notifications.txt`](verification/week4/notifications.txt). Reports, CSV
exports (including the formula-injection guard), audit immutability triggers, PDF, print, email
delivery, role enforcement and mobile layout all passed. Re-run `scripts/e2e-week4.mjs` against a
fresh disposable database to refresh the archived JSON. Evidence:
[`docs/verification/week4-e2e-results.json`](verification/week4-e2e-results.json),
[`WEEK4_E2E_REPORT.md`](verification/week4/WEEK4_E2E_REPORT.md), CSV exports under
`docs/verification/week4/exports/` and screenshots under `docs/screenshots/week4/`.

> **Current status of the QA archive.** The 80-check archive above is a historical run from before
the notification subsystem landed. The current notification evidence is the 38-check output linked
above; the rest of the Week 4 outcomes remain covered by the archived run, the 227-check API suite
and the Week 3 browser suite. The archive JSON has not been regenerated because doing so requires a
disposable loopback PostgreSQL database and its browser fixture.

## 9. Known limitations / not verified

- **Notifications are in-app only.** There is no email, push or realtime channel, no per-type
  preference screen and no retention job; the bell polls the unread count every 30 seconds. Vendor
  recipients exist only where the vendor record is linked to a login account, so imported vendors
  without an account have no bell to notify.
- **No dedicated Week 4 lifecycle browser suite.** `scripts/e2e-week4.mjs` covers the Week 4
  screens, CSV, PDF/print/email, roles and persistence through a real browser, but it does not
  recreate the entire RFQ → approval → invoice lifecycle from scratch; that path is covered by the
  227-check API suite and the Week 2/3 browser suites.
- **Screenshots use development data**, including the backdated demo chains. They are
  fixtures for review, not operational documents.
- **Reports have no scheduled delivery or Excel output** — on-demand JSON and three CSV
  exports only. There is no forecasting.
- **The audit trail has no retention policy, log shipping or CSV export.** Staff read it in
  the app with filters and pagination; the retention story is “keep everything”, which the
  append-only triggers enforce.
- **IP addresses** come from `X-Forwarded-For` and are only as trustworthy as the proxy in
  front of the API (Vercel sets it correctly; a direct client connection can forge it).
- **Concurrency** is exercised with parallel HTTP requests against one PostgreSQL instance,
  not with a distributed load generator. The report queries are read-only and scale with the
  indexes listed in §2.
