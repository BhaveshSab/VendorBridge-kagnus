# VendorBridge — Week 1 Completion Report

**Project:** VendorBridge — Procurement & Vendor Management ERP
**Milestone:** Week 1 — Foundation & Vendor Management
**Status:** Frontend build and static checks pass. Database-backed end-to-end verification remains pending in this workspace.

---

## 1. Implemented features

### Authentication and authorization
- Public registration is backend-forced to the **Vendor** role and creates a linked **Pending** vendor profile.
- Sign-in, sign-out and session restoration use a signed JWT in an `httpOnly` cookie. The JWT is not returned in JSON.
- Password recovery uses single-use, expiring reset tokens; production delivery requires configured email service credentials.
- Protected UI routes and API routes require authentication. Vendor writes and other restricted operations are checked on the backend.
- Vendor sessions do not receive internal procurement notes or company-wide dashboard/vendor metadata.

### Dashboard
- `/api/dashboard` reads supplier records from PostgreSQL and returns `totalVendors`, status counts, category counts and the latest five vendors for internal roles.
- The dashboard displays the live total-suppliers metric, vendor status donut, category bars and recent supplier snapshot from that response.
- Vendor accounts receive only their own profile and scoped metrics; their response contains no global totals or recent-vendor list.
- React Query revalidates API-backed data on page mounts and window focus. Loading, empty and API-error states are present.
- RFQ, approval and purchase-order metrics remain explicit placeholders because those APIs are not in scope for this milestone.

### Vendor management
- Authorized staff can create, view, update, delete, search, filter, sort and paginate supplier records.
- Vendors can read only their own profile. Global metadata is restricted to internal roles, and internal notes are redacted from vendor-facing responses.
- Input validation, duplicate-name protection, role checks and database persistence are implemented.

### Database and seeding
- Prisma migrations define the PostgreSQL schema.
- `npm run db:setup` generates the Prisma Client, applies migrations, seeds an empty development database and prints aggregate row counts.
- Seeding is explicit, does not run when the server starts, skips databases that already contain users or vendors, and is disabled in production. Destructive reseeding requires an explicit environment opt-in.
- `npm run db:status` checks connectivity/schema and prints row counts without exposing record contents.

---

## 2. Verification performed in this workspace

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `node --check` for API, seed, and smoke-test scripts | Pass |
| `git diff --check` | Pass |
| Vite frontend on port 5173 | Responds successfully |
| API on port 4000 | Not running in this workspace; dashboard proxy request returned HTTP 500 |
| `npm run test:api` | Not run: no `.env`, generated Prisma Client, or reachable database/API is configured here |
| Browser end-to-end walkthrough | Not run in this workspace |
| `npm audit --omit=dev` | Reports 3 high-severity findings through Prisma tooling / `deepmerge-ts`; the suggested fix requires a breaking Prisma major upgrade, so dependencies were not changed |

The API smoke-test script now defines **73 assertions**, including dashboard count reconciliation, health readiness, role restrictions, vendor data scoping, internal-note redaction and JWT non-disclosure. Those assertions have **not** been executed against a live database in this workspace. A separately configured local database is not attached to this checkout.

To run the database-backed checks in the configured local environment:

```bash
npm run db:status
npm run dev:server
# in another terminal
npm run test:api
```

A successful `/api/health` response includes `"database":"connected"`. `/api/dashboard` requires a signed-in session; use an internal test account to verify aggregate metrics and a Vendor account to verify profile-only metrics.

---

## 3. Security notes and known limitations

- **Credential handling:** keep database URLs and JWT secrets in the ignored local `.env`; rotate any credentials that may have been exposed. No database secret is committed to this branch.
- **Dependency audit:** three high-severity findings remain in Prisma-related tooling / `deepmerge-ts`. The available automated remediation would make a breaking Prisma major upgrade; no dependency override or upgrade was applied.
- **Seed data:** demo accounts and supplier fixtures are server-side development fixtures only. Do not seed them into production.
- **Workflow scope:** RFQs, quotations, approvals, purchase orders, invoices, reports and audit history are intentionally not implemented; their API routes are not available.
- **Testing scope:** live API tests and a full browser walkthrough still need to be run against the user's configured database because this workspace has no `.env`, generated Prisma Client or API process.
- **Email delivery:** password-reset email requires configured Resend credentials in production. Local development uses the mail outbox helper.

---

## 4. Submission artefacts

| Artefact | Location / status |
| --- | --- |
| Source | `src/`, `server/`, `prisma/`, `scripts/` |
| Setup, API and configuration guide | [README.md](../README.md) |
| API smoke tests | `scripts/smoke-test.mjs` (73 assertions defined; live run pending) |
| Database status utility | `scripts/db-status.js` |
| Screenshots | Existing captures under `docs/screenshots/`; not regenerated in this verification pass |
| Current working branch | `arena/90eb331b-vendorbridge-kagnus` (not pushed by this verification pass) |
