# VendorBridge — Weeks 1–4 Completion Report

Final submission report for the Kagnus procurement platform. This report describes the code
that is deployed from `main`, the checks that were actually run, and the limitations that remain.

- **Live application:** <https://vendor-bridge-kagnus.vercel.app>
- **Notification delivery merged:** `354f1ba` on `main`
- **Database:** managed PostgreSQL (Neon) through Prisma
- **Last live verification:** 21 October 2026, 09:40 UTC

---

## 1. Delivered application

VendorBridge is one full-stack application: a React single-page front end, an Express API and a
PostgreSQL database. It covers the complete procurement lifecycle rather than a collection of
disconnected screens.

| Area | Delivered |
| --- | --- |
| Authentication | Registration, login, logout, session restore, forgotten-password reset, persistent rate limits |
| Vendor management | CRUD, search, status/category filters, pagination, vendor-scoped reads and redacted internal notes |
| RFQs and quotations | Draft → open → closed/cancelled lifecycle, assigned-vendor visibility, server-computed quotations, revisions and side-by-side comparison |
| Approvals | Manager/Admin review queue, requester/decision separation, immutable decision events and rejection remarks |
| Purchase orders | Generated only from approved quotations, vendor-scoped documents and cancellation with a reason |
| Invoices | Generated from purchase orders, server-rendered PDF, print view, Resend delivery with persisted sent/failed/not-configured status |
| Reports | Spend overview, monthly trend, category split, supplier performance and three CSV exports, all aggregated from stored documents |
| Activity | Append-only audit trail with actor snapshot, timestamp, IP/user agent, filters and record history |
| Notifications | Persistent per-user inbox with unread count, event writers, deep links, mark-one-read and mark-all-read |
| Access control | Server-enforced Admin/Procurement/Manager/Vendor permissions; vendors see only their own records |

### Notifications are event-driven

`server/notify.js` is called by the route that performs the action, after the business transaction
commits. The event set is:

- `rfq.published`, `rfq.closed`, `rfq.cancelled` → assigned vendors
- `quotation.submitted`, `quotation.revised` → RFQ creator
- `approval.requested` → Admin and Manager reviewers
- `approval.approved`, `approval.rejected` → requester and winning vendor
- `purchase_order.generated` → vendor and requester
- `invoice.generated` → vendor
- `invoice.email_sent`, `invoice.email_failed`, `invoice.email_not_configured` → procurement team and requester

The actor is excluded from their own notification, duplicate recipients are collapsed, and vendors
without a linked login are skipped. Notifications are written best-effort: a failed insert is
logged and never rolls back the document action.

### Analytics are computed, not hardcoded

`server/services/reports.js` aggregates issued purchase orders and invoices in SQL from `DECIMAL`
columns. The monthly series, category shares, supplier performance, win rates and cycle-time
metrics all come from stored rows; the browser only formats the values. Multi-currency periods
report the dominant currency and disclose orders in other currencies instead of summing unlike
amounts.

---

## 2. Live deployment verification

The checks below were run against the deployed URL, not a local build:

| Check | Result |
| --- | --- |
| `GET /api/health` | `200` — `{"ok":true,"service":"vendorbridge-api","database":"connected"}` |
| Anonymous `GET /api/notifications`, `/unread-count` | `401` |
| Procurement and vendor `GET /api/notifications` | `200`, session-scoped payload with `items`, `total`, `unread` |
| Vendor `GET /api/reports/overview` and `/api/activity` | `403` |
| Vendor `POST /api/notifications/999999/read` | `404` |
| Dashboard notification bell | Present; opens the All/Unread dialog and empty state |
| Spend overview | `200` — 5 issued POs, INR 14,80,822, 12 monthly buckets, 5 categories, 5 top suppliers |
| CSV export | `200`, `text/csv`, UTF-8 BOM, CRLF, 9 data rows |
| Invoice PDF | `200`, `application/pdf`, `INV-0001.pdf`, `%PDF-` signature |
| Activity feed | `200`, non-empty, actor and timestamp present |

The live notification table was empty at the time of the check. That is expected after deploying
the migration: historical actions predate the notification writer, and new actions populate the
bell from that point forward. The populated bell is demonstrated with a real local event in
[`docs/screenshots/37-week4-notifications.png`](screenshots/37-week4-notifications.png).

---

## 3. Checks run

| Check | Result |
| --- | --- |
| `npm run test:e2e:notifications` | **38 passed, 0 failed** — full output in [`docs/verification/week4/notifications.txt`](verification/week4/notifications.txt) |
| `npm run test:api` | **227 passed, 0 failed** |
| `npm run typecheck` | pass |
| `npm run build` | pass (one Vite chunk-size warning) |
| `prisma validate` | schema valid |
| `node --check` on changed server and test scripts | pass |
| `git diff --check` | clean |

The notification suite creates a real RFQ → quotation → approval → purchase order → invoice →
email-attempt chain, asserts recipients and per-user scope, verifies cross-user `404`, unread
counts and mark-all-read, then removes the chain. It ran against the configured development
database with `NOTIFY_E2E_ALLOW_REMOTE=1`; the output records that override.

The Week 2 (76-check) and Week 3 (106-check) browser suites were run in their own sessions and
their results remain under [`docs/verification/week2/`](verification/week2/) and
[`docs/verification/week3/`](verification/week3/). They were not re-run during this deployment
check.

The 80-check Week 4 browser harness has not been re-run against a disposable local database after
the notification work. Its archived JSON still contains the 11 notification checks from before the
subsystem existed, and is labelled as historical. The notification portion is now delegated to
the 38-check suite; the remaining report/audit/PDF/email browser checks are covered by the archive
and the live checks above.

---

## 4. Security and access

- Every API route is guarded by `requireAuth` or `requireRole`; hiding UI is never the only control.
- Notification queries use `req.user.id`; there is no endpoint that accepts another user's id, and
  another user's row is reported as `404`.
- Vendors cannot read the aggregate spend reports or the audit trail (`403`).
- The audit trail is append-only at the database level. Both a raw `UPDATE` and a raw `DELETE` are
  refused by triggers; the 227-check suite executes both attempts.
- `.env` is gitignored. The repository contains no database password, JWT secret, session cookie or
  provider API key.
- Test data is created under the reserved `@vendorbridge.test` domain and `npm run db:cleanup-tests`
  removes it, including its notifications. Audit rows intentionally remain because the trail cannot
  be rewritten.

---

## 5. Submission package

| Artefact | Location |
| --- | --- |
| Source repository | <https://github.com/BhaveshSab/VendorBridge-kagnus> (`main`) |
| Setup, configuration and API documentation | [`README.md`](../README.md) |
| Week 2 report | [`docs/WEEK2_COMPLETION_REPORT.md`](WEEK2_COMPLETION_REPORT.md) |
| Week 3 report | [`docs/WEEK3_COMPLETION_REPORT.md`](WEEK3_COMPLETION_REPORT.md) |
| Week 4 report | [`docs/WEEK4_COMPLETION_REPORT.md`](WEEK4_COMPLETION_REPORT.md) |
| Notification lifecycle evidence | [`docs/verification/week4/notifications.txt`](verification/week4/notifications.txt) |
| Lifecycle, reports and notification screenshots | [`docs/screenshots/`](screenshots/) |
| Historical Week 4 QA archive | [`docs/verification/week4/WEEK4_E2E_REPORT.md`](verification/week4/WEEK4_E2E_REPORT.md) |

---

## 6. Known limitations

- Notifications are in-app only. There is no email, push or realtime channel, no per-type
  preferences, and no retention job.
- Vendor recipients exist only where a vendor record has a linked login account; imported vendors
  without an account have no bell to notify.
- The notification tests exercise publish, quotation, approval-request, approval-approval, PO,
  invoice and email events. Rejection, RFQ close/cancel and quotation revision use the same writers
  but are not separately asserted by the focused suite.
- The full 80-check Week 4 browser harness and its JSON archive have not been regenerated because
  they require a disposable loopback PostgreSQL database and browser fixture. The report and JSON
  are marked historical, and the fresh 38-check notification output is the current evidence.
- The Week 2/3 browser suites were not re-run during this deployment check; their last recorded
  results are preserved in their evidence directories.
- There is no CI pipeline; all checks are run manually in the workspace.
- `npm audit --omit=dev` still reports the Prisma CLI `deepmerge-ts` advisory. Remediation requires
  a Prisma 7 major upgrade and was not applied without approval.
- Neon occasionally drops an idle connection; the API returns an explicit `503 database_unavailable`
  and the action succeeds on retry. There is no automatic client retry.
- Demo accounts and demo data exist in the deployed database so a reviewer can exercise the
  workflow. They are fixtures, not production identities, and must be removed or rotated before any
  real use.

---

## 7. Reproduce locally

```bash
git clone https://github.com/BhaveshSab/VendorBridge-kagnus.git
cd VendorBridge-kagnus
npm install
cp .env.example .env             # set DATABASE_URL and JWT_SECRET
npm run db:setup                # generate client, apply migrations, seed an empty DB
npm run dev                     # API :4000, Vite :5173
```

Useful checks:

```bash
npm run test:api
npm run test:e2e:notifications   # app running
npm run typecheck
npm run build
```

For a disposable local database, start PostgreSQL and point `DATABASE_URL` at a database whose
name contains `e2e`; the browser harnesses refuse to write to a non-disposable database.
