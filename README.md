# VendorBridge — Procurement & Vendor Management ERP

Week 1 deliverable for the Kagnus programme: **Foundation & Vendor Management**.
VendorBridge is a full-stack application — a React single-page front end talking to an
Express + PostgreSQL back end through Prisma ORM — implementing authentication, role-aware
navigation, a procurement dashboard, and complete vendor management. Modules scheduled for Weeks 2–4
(RFQs, quotations, approvals, orders, invoices, reports, audit) are intentionally not
implemented; their areas on the dashboard show explicit "available in Week 2/3/4" states.

---

## 1. Tech stack

| Layer | Choice |
| --- | --- |
| Front end | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7 (lazy-loaded routes), TanStack Query, Framer Motion, Lucide icons |
| Back end | Node.js (ESM), Express 5, Zod validation, express-rate-limit, Resend email API |
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
| `npm run test:api` | 73-check end-to-end API smoke test (see §7) |
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
- Four roles: **Admin, Procurement Officer, Manager/Approver, Vendor**.
- Every API route is guarded server-side (`requireAuth` / `requireRole`). Role restrictions are
  enforced on the backend, not just hidden in the UI.
- React route guards redirect unauthenticated users to `/login` and keep signed-in users out of
  login/registration, while recovery pages remain available from Profile and emailed reset links.

### 4.2 Dashboard (requirement 2)

- Role-aware greeting, role label and the four summary cards from the design reference.
- **Total suppliers**, status totals, recent vendors and category breakdown are fetched from
  `/api/dashboard` and computed from PostgreSQL. Vendors see only their own profile metrics.
- **Active RFQs**, **Pending approvals** and **PO value** display explicit placeholders because
  those APIs/modules are not implemented in this milestone.
- Quick actions: add a vendor, open the vendor register, and a clearly disabled "Create an RFQ"
  action labelled *Week 2*.
- Vendor register snapshot (five most recently updated vendors) with status chips.
- Vendor status donut and vendor-by-category breakdown, both computed from stored records.
- "Scheduled for later weeks" card lists the Week 2/3/4 modules with their scope.
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
  `DATABASE_URL`, `CLIENT_ORIGIN`, `NODE_ENV`, plus optional `REDIS_URL`, `RESEND_API_KEY` and
  `EMAIL_FROM`); no secrets in front-end code.
- Reusable UI components (buttons, fields, cards, modal, table, badges, skeleton, empty and
  error states) and consistent API error handling on both sides.
- Security headers, a CORS allow-list, `x-powered-by` disabled, parameterised Prisma queries and
  foreign keys enforced at the database level.

---

## 5. Architecture

```
src/                 React SPA
  components/        AppLayout, guards, UI kit, vendor form, charts
  context/           Auth and toast providers
  lib/               API client, types, formatting, hooks
  pages/             auth/, Dashboard, Vendors, Profile, NotFound
prisma/
  schema.prisma      PostgreSQL models, relations and indexes
  migrations/        committed SQL migrations (init included)
server/
  auth.js            password hashing, JWT, guards, validation error mapping
  db.js              shared Prisma Client, sequences and user mapping
  seed.js            demo users and vendors
  serializers.js     response shapes and role permissions
  routes/            auth.js, vendors.js, dashboard.js
  index.js           Express app, security headers, SPA fallback
scripts/
  smoke-test.mjs     end-to-end API test suite
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
| `Counter` | `counters` | Atomic sequence for vendor codes (`VND`) |

`Vendor` has two relations to `User`: the vendor's own account (`user_id`) and the staff member
who created the record (`created_by`), both `ON DELETE SET NULL`.

### Migrations

```bash
npx prisma migrate dev --name <change>   # author a migration locally
npm run db:deploy                        # apply committed migrations in any environment
npm run db:studio                        # browse data
```

Migrations live in `prisma/migrations/` and are part of the repository. The initial migration
(`init`) creates the core tables, indexes and foreign keys. `npm run seed` inserts the demo fixture
only into a development database with no users or vendors. It never overwrites existing records.
A destructive reseed is blocked unless `ALLOW_DESTRUCTIVE_SEED=true` is explicitly set, and is
never permitted when `NODE_ENV=production`.

---

## 7. Testing

```bash
npm run db:deploy    # ensure the PostgreSQL schema exists
npm run dev:server   # in one terminal
npm run test:api     # in another
```

The suite runs against the real PostgreSQL database configured in `DATABASE_URL`.

`scripts/smoke-test.mjs` performs **73 assertions** against the running API when executed, covering:

1. Authentication — health readiness, 401s for anonymous access, wrong-password rejection,
   HttpOnly cookie session refresh, all four roles signing in, no JWT/password hashes in JSON responses,
   logout clearing the session.
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
6. Scope guard — Week 2–4 endpoints (`/rfqs`, `/quotations`, `/approvals`, `/purchase-orders`,
   `/invoices`, `/reports`, `/activity`) are not exposed.
7. Persistence — created vendors survive into a new session, and deletion is permanent.

Note: the smoke test registers a throwaway vendor account. Only if the configured database is
disposable development data, explicitly set `ALLOW_DESTRUCTIVE_SEED=true` before using
`npm run seed -- --force` to reset it. This command truncates application tables.

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
  `RESEND_API_KEY` and `CLIENT_ORIGIN`; direct reset-token lookup is disabled in production.
- **Role provisioning**: public registration is limited to Vendor accounts. Procurement and Manager
  accounts must be provisioned outside public sign-up; there is no admin invitation UI or email
  verification workflow in Week 1.
- **Weeks 2–4 are not implemented**: RFQs, quotations, approvals, purchase orders, invoices,
  reports and the audit log are deliberately out of scope. Their dashboard areas show explicit
  empty states instead of fabricated data.
- **Database hosting**: the API needs a reachable PostgreSQL instance; there is no embedded or
  offline fallback. The current database is a managed Neon instance whose connection string lives
  in `.env`, so it must be provisioned before the app can start.
- **Automated UI tests**: none yet — verification is the API smoke suite plus a browser walkthrough.
- **Deployment**: no hosted URL; run locally with `npm run dev` or `npm start`.
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
| Screenshots of authentication, dashboard and vendor management | ✅ 9 screens in `docs/screenshots/` |
| Completion report | ✅ [docs/COMPLETION_REPORT.md](docs/COMPLETION_REPORT.md) |
| Working source code pushed to the assigned GitHub repository | ✅ [BhaveshSab/VendorBridge-kagnus](https://github.com/BhaveshSab/VendorBridge-kagnus), branch `main` |
| PostgreSQL + Prisma ORM instead of a local database file | ✅ PostgreSQL schema and 73 API checks are defined |

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
