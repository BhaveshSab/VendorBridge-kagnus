# VendorBridge — Week 1 Completion Report

**Project:** VendorBridge — Procurement & Vendor Management ERP
**Milestone:** Week 1 — Foundation & Vendor Management
**Branch:** `arena/90eb331b-vendorbridge-kagnus`
**Verified:** 19 October 2026
**Environment:** Windows 11 · Node.js v24.13.0 · PostgreSQL (managed Neon development database) · Chrome at 1440×900 and 390×844

**Status:** Every Week 1 acceptance criterion was exercised against the live database, the running API
and a real browser in this workspace. No fabricated data paths were found, three defects were fixed
during verification, and the remaining limitations are listed in §5.

---

## 1. Implemented features

### Authentication and authorization
- Public registration is backend-forced to the **Vendor** role and creates a linked **Pending** vendor profile; the form shows the account type as a read-only field.
- Sign-in, sign-out and session restoration use a signed JWT in an `httpOnly`, `sameSite=lax` cookie. The JWT is never returned in JSON.
- Password recovery issues single-use, 30-minute reset tokens. Delivery uses Resend when `RESEND_API_KEY` is set, otherwise a local mail outbox (`.mail-outbox.jsonl`).
- The development reset-token helper (`/api/auth/dev-reset-link`) is now **disabled by default** and only works when `ALLOW_DEV_RESET_LINK=true` and `NODE_ENV` is not `production`; the sign-in UI asks `/api/auth/capabilities` before rendering it.
- Login throttling (10 attempts per IP + email per 15 minutes) uses Redis when `REDIS_URL` is set, otherwise the `rate_limits` table, so counters survive restarts.
- Protected UI routes redirect anonymous visitors to `/login`; every API route is guarded server-side.

### Dashboard
- `/api/dashboard` reads live PostgreSQL data through Prisma: `totalVendors`, `statusCounts`, `categoryCounts` and the five most recently updated vendors for internal roles.
- Vendor accounts receive only their own profile and scoped metrics — no global totals, no recent-vendor list and no internal notes.
- The dashboard renders Total suppliers, the status donut, category bars and the recent-supplier snapshot from that response, with loading skeletons, an error state with retry, and roadmap placeholders for RFQs, approvals/orders and reports.
- Authenticated API responses carry `Cache-Control: no-store`.

### Vendor management
- Authorized staff can create, view, update, delete, search, filter by status/category, sort and paginate supplier records.
- Vendors can read only their own profile; global metadata and internal procurement notes are withheld from vendor sessions.
- Server-side validation (Zod) and duplicate-name protection are enforced; client-side validation surfaces per-field messages.

### Scripts added during verification
- `scripts/cleanup-test-data.mjs` (`npm run db:cleanup-tests`) removes only `@vendorbridge.test` accounts and vendors created by the suites — never seeded or real records.

---

## 2. Verification actually performed

### Commands

| Check | Command | Result |
| --- | --- | --- |
| Database connectivity and row counts | `npm run db:status` | **Pass** — connection OK, counts printed without record contents |
| Prisma migrations current | `npm run db:deploy` | **Pass** — both migrations applied (`init`, `add_rate_limits`) |
| TypeScript | `npm run typecheck` | **Pass**, exit 0 |
| Production build | `npm run build` | **Pass**, exit 0 (only the >500 kB chunk-size warning) |
| API end-to-end suite | `npm run test:api` | **Pass — 78 passed, 0 failed** (exit 0) against the live database |
| Whitespace/conflict check | `git diff --check` | **Pass** |
| JavaScript syntax | `node --check` on `server/**/*.js` and `scripts/*.js|mjs` | **Pass** |
| Dependency audit | `npm audit --omit=dev` | **Reported, not remediated** — 3 high findings in Prisma CLI tooling (`deepmerge-ts`); fix requires Prisma 7 (breaking), not applied without approval |
| Screenshot capture | `npm run screenshots` | **Pass** — all 9 captures regenerated from the running app |

### HTTP contract

| Check | Result |
| --- | --- |
| `GET /api/health` | 200, `"database":"connected"`, body limited to `ok`, `service`, `database`, `time` (no row counts) |
| Anonymous `/api/dashboard`, `/api/vendors`, `/api/auth/me` | 401 |
| Login response | 200; `Set-Cookie` is `HttpOnly` + `SameSite=Lax`; no token, JWT or password hash in JSON |
| Cookie replay (`/api/auth/me`) | 200 — session restored from the cookie alone |
| Authenticated `/api/dashboard` | 200 JSON, `Cache-Control: no-store`, keys `scope, statusCounts, categoryCounts, totalVendors, recentVendors` |
| Dashboard reconciliation | 16 suppliers = 12 active + 2 pending + 1 inactive + 1 blocked; category counts sum to 16; `recentVendors` limited to 5 |
| Vendor `/api/dashboard` | `scope: "vendor"`, no `recentVendors`, `hasVendorProfile: true`, metrics scoped to the caller |
| Vendor `/api/vendors` | 1 item (own record), no internal notes in the payload |
| Vendor `/api/vendors/meta` | 403 |
| Vendor reading another vendor | 403 |
| Manager/Admin create/delete vendor | Manager 403; Admin/Procurement allowed |
| Forged privileged role on registration | 201 created as `vendor` |
| `/api/auth/capabilities` | 200 `{ "devResetLink": false }` |
| `GET /api/auth/dev-reset-link` (flag off) | 404 — no token issued |
| Out-of-scope endpoints (`/rfqs`, `/quotations`, `/approvals`, `/purchase-orders`, `/invoices`, `/reports`, `/activity`) | 404, asserted by the suite |

### Browser walkthrough (real Chrome, live stack)

Desktop (1440×900):
- Login as admin and procurement; dashboard shows Total suppliers 16, donut 12/2/1/1, category bars and the five most recent vendors from the API.
- Vendor register: 16 records, 8 per page, 2 pages; search `Nova` returns exactly 1 record; status filter `Pending` returns exactly the 2 pending vendors; sort `Name A–Z` reorders correctly; paging shows `9–16 of 16`.
- Created "E2E Verification Co" through the form → toast, total 17, row present; edited rating to 4.5 and status to Active → row and status cards updated (Active 13); deleted it through the confirmation dialog → toast, total back to 16.
- Validation: submitting `x` / `not-an-email` / `1` kept the dialog open and showed three inline field errors with `aria-invalid` set.
- Persistence: a vendor created independently of the UI appeared after a full page reload (`17` total, `3` pending) and was deleted through the UI.
- Empty state: after deleting, a no-match search showed "No suppliers match those filters" instead of stale rows.
- Registration: new self-service account landed on a scoped vendor dashboard showing only its own Pending profile (`MY SUPPLIER PROFILE 1`, 100% pending), with no global totals.
- Logout: session cleared, redirected to `/login`; visiting `/vendors` while signed out redirected to `/login`.
- Forgot password: generic "Check your inbox" confirmation with **no** reset link or token in the DOM (dev helper disabled), while the message was delivered to the server-side mail outbox.

Mobile (390×844):
- Hamburger navigation opens the "Navigation menu" dialog; dashboard cards stack; the recent-vendor table drops to the two essential columns; quick actions wrap without overflow.

Screenshots in `docs/screenshots/` were regenerated against this build (login, register, forgot password, dashboard, vendor register, add-vendor form, vendor detail, profile, vendor dashboard). They contain seeded demo business data only — no passwords, cookies, tokens or environment values.

---

## 3. Defects found and fixed during verification

| # | Defect | Fix |
| --- | --- | --- |
| 1 | **"Total vendors" card showed the filtered count.** With a search active it read `1` while the status cards still showed register-wide totals (13/2/2). | Total is derived from the register-wide status counts (vendor sessions keep their own single record). Verified: total stays 16 under an active search. |
| 2 | **Development reset-token endpoint was open by default.** Any unauthenticated caller could obtain a live reset token for any email whenever `NODE_ENV` was not `production`. | Endpoint now requires `ALLOW_DEV_RESET_LINK=true` and a non-production environment; new `/api/auth/capabilities` lets the UI hide its dev panels; both `/forgot-password` and `/reset-password` respect it. Documented in `.env.example`. |
| 3 | **Misleading startup warning** — the API logged "Unable to connect to remote database" because the embedded-Postgres probe ran against the managed host before Prisma connected. | Remote hosts skip the local probe entirely; startup log is now clean. |

Housekeeping in the same branch: stale "73 assertions" documentation corrected to 78, test data
cleanup script added, and the unused `.agents/` skill documentation (4.8 MB, including committed
`__pycache__` binaries) removed from the repository.

---

## 4. Security notes

- `.env` remains gitignored and was never staged; no connection string, JWT secret, password, cookie or reset token appears in this report, the README, screenshots or commit contents.
- Test accounts are created only under the reserved `@vendorbridge.test` domain and were removed with `npm run db:cleanup-tests` before the final commit; the database is back to the 4 seeded users and 16 seeded vendors.
- Seeding is explicit, refuses to overwrite non-empty tables, is blocked in production, and destructive reseeding requires `ALLOW_DESTRUCTIVE_SEED=true`.
- Passwords are bcrypt hashes; sessions are signed JWTs in httpOnly cookies; reset tokens are single-use and expire after 30 minutes; auth endpoints are rate-limited persistently.
- The Neon role password for the development database has been exposed outside the repository (shared in chat during setup). Rotate it in the provider console; only the local `.env` needs updating.

---

## 5. Known limitations and work not run

| Item | Status |
| --- | --- |
| Automated UI test suite | **Not written.** UI verification was a manual browser walkthrough (documented in §2); the API suite is the automated regression net. |
| Deployed preview / hosted URL | **Not available.** No deployment target is provisioned in this environment; the app runs locally via `npm run dev` or `npm start`. |
| Prisma dependency audit | **Open.** 3 high findings (`deepmerge-ts` via Prisma CLI). Remediation requires a Prisma 7 major upgrade, which needs approval and a migration pass. |
| Neon idle connection resets | Observed twice during the walkthrough: the first request after an idle drop returned 503 `database_unavailable` with a clear message; retrying the same action succeeded. Not a data-integrity issue, but the UI has no automatic retry. |
| Weeks 2–4 modules | **Intentionally out of scope.** RFQ, quotation, approval, purchase-order, invoice, report and audit routes return 404 and the dashboard labels them as roadmap items rather than faking numbers. |
| CI pipeline | **None.** All checks in §2 were run manually in this workspace. |
| Seed accounts in production | Demo fixtures exist only in the server-side seed script and must not be loaded into production. |

---

## 6. Submission artefacts

| Artefact | Location / status |
| --- | --- |
| Source | `src/`, `server/`, `prisma/`, `scripts/` |
| Setup, API and configuration guide | [README.md](../README.md) |
| API test suite | `scripts/smoke-test.mjs` — 78 assertions, executed |
| Test-data cleanup | `scripts/cleanup-test-data.mjs` (`npm run db:cleanup-tests`) |
| Database status utility | `scripts/db-status.js` |
| Screenshots | `docs/screenshots/` — 9 captures regenerated 19 Oct 2026 |
| Branch | `arena/90eb331b-vendorbridge-kagnus` (pushed; commit hash in the handover message) |
