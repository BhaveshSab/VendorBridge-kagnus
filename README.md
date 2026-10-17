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
| Front end | React 19, TypeScript, Vite 7, Tailwind CSS 4, React Router 7, Framer Motion, Lucide icons |
| Back end | Node.js (ESM), Express 5, Zod validation |
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

# 3. Apply the database schema and seed demo data
npm run db:deploy
npm run seed

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
| `npm run db:studio` | Open Prisma Studio against the configured database |
| `npm run seed` | Re-seed (add `-- --force` to wipe and reseed) |
| `npm run test:api` | 64-check end-to-end API smoke test (see §7) |
| `npm run screenshots` | Regenerate the screenshots in `docs/screenshots/` (needs the app running) |
| `npm run typecheck` | TypeScript check |

The server also seeds 4 demo users and 16 vendors across 8 categories automatically when the
`users` table is empty, so a freshly migrated database is immediately usable.

---

## 3. Demo accounts

| Role | Email | Password | What they can do |
| --- | --- | --- | --- |
| Admin | `admin@vendorbridge.dev` | `Admin@123` | Full vendor management plus every read view |
| Procurement Officer | `procurement@vendorbridge.dev` | `Procure@123` | Create, update, delete and search vendors |
| Manager/Approver | `manager@vendorbridge.dev` | `Manager@123` | Read-only access to the vendor register and dashboard |
| Vendor | `vendor@vendorbridge.dev` | `Vendor@123` | View and maintain only their own vendor profile |

The sign-in screen lists these accounts as clickable shortcuts (one click prefills the form).

---

## 4. Features delivered

### 4.1 Authentication (requirement 1)

- Registration with per-field validation (names, email, phone, role, country, password strength).
- Vendor sign-up automatically creates a linked **Pending** vendor profile, so a vendor account
  is never orphaned.
- Email + password login, logout, and session restore via a signed JWT in an httpOnly cookie
  (8 hour expiry, `sameSite=lax`, `secure` in production).
- Forgot-password → single-use, 30-minute reset token → password reset.
- Login throttling: 10 attempts per IP + email within 15 minutes returns `429`.
- Four roles: **Admin, Procurement Officer, Manager/Approver, Vendor**.
- Every API route is guarded server-side (`requireAuth` / `requireRole`). Role restrictions are
  enforced on the backend, not just hidden in the UI.
- React route guards redirect unauthenticated users to `/login` and keep signed-in users out of
  the auth screens.

### 4.2 Dashboard (requirement 2)

- Role-aware greeting, role label and the four summary cards from the design reference.
- **Active vendors** is live from the database; **Active RFQs**, **Pending approvals** and
  **PO value** display an explicit placeholder because those modules arrive in Weeks 2–3.
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
- Vendors can only read their own record; every other vendor endpoint returns `403`.
- Records are stored in PostgreSQL and survive refreshes, restarts and new sessions.

### 4.4 Technical requirements (requirement 4)

- Approved stack, single repository, `src/` (front end) and `server/` (API + database) separated.
- Configuration through environment variables (`PORT`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
  `DATABASE_URL`, `CLIENT_ORIGIN`, `NODE_ENV`); no secrets in front-end code.
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
| `GET` | `/api/dashboard` | Signed in (role-aware scope) |
| `GET` | `/api/vendors` | Signed in (vendors see only themselves) |
| `GET` | `/api/vendors/meta` | Signed in |
| `GET` | `/api/vendors/:id` | Signed in (vendors only their own) |
| `POST` | `/api/vendors` | Admin, Procurement |
| `PUT` | `/api/vendors/:id` | Admin, Procurement |
| `DELETE` | `/api/vendors/:id` | Admin, Procurement |
| `GET` | `/api/health` | Public |

### Role permission matrix

| Capability | Admin | Procurement | Manager | Vendor |
| --- | --- | --- | --- | --- |
| View dashboard | ✅ | ✅ | ✅ | ✅ (own profile) |
| View vendor register | ✅ | ✅ | ✅ | own record only |
| Create / update / delete vendors | ✅ | ✅ | ❌ | ❌ |

---

## 6. Database

PostgreSQL managed through Prisma ORM. The connection string is read from `DATABASE_URL`; no
credentials are hard-coded and `.env` is gitignored.

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
(`init`) creates the four tables, indexes and foreign keys. Demo data is loaded by
`npm run seed -- --force`, which truncates and re-inserts via Prisma transactions.

---

## 7. Testing

```bash
npm run db:deploy    # ensure the PostgreSQL schema exists
npm run dev:server   # in one terminal
npm run test:api     # in another
```

The suite runs against the real PostgreSQL database configured in `DATABASE_URL`.

`scripts/smoke-test.mjs` performs **64 assertions** against the running API and currently
passes 64/64, covering:

1. Authentication — 401s for anonymous access, wrong-password rejection, cookie session refresh,
   all four roles signing in, no password hashes in responses, logout clearing the session.
2. Backend authorization — vendor and manager blocked (403) from vendor writes, manager read
   access, vendor-scoped reads and cross-vendor access denied.
3. Vendor management — 422 validation with field errors, create with `VND-###` code, duplicate
   name conflict (409), update, search, status and category filters, sorting, pagination,
   invalid filter rejection (400), meta endpoint.
4. Dashboard — internal and vendor scopes, live status counts, category totals reconciling with
   the register, recent-vendor limit.
5. Registration and password reset — weak password rejection, vendor sign-up creating a Pending
   profile, duplicate email conflict, reset token issuance, single-use tokens, password change
   and sign-in with the new password.
6. Scope guard — Week 2–4 endpoints (`/rfqs`, `/quotations`, `/approvals`, `/purchase-orders`,
   `/invoices`, `/reports`, `/activity`) are not exposed.
7. Persistence — created vendors survive into a new session, and deletion is permanent.

Note: the smoke test registers a throwaway vendor account. Run `npm run seed -- --force` to
return to pristine demo data afterwards.

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

- **Email delivery**: no SMTP provider is configured, so password-reset links are returned by the
  API and displayed in the UI for local/demo use. The token, expiry and single-use logic are real.
- **Role selection at sign-up**: public registration lets a user pick Procurement/Approver/Vendor;
  there is no admin approval or email verification step in Week 1.
- **Weeks 2–4 are not implemented**: RFQs, quotations, approvals, purchase orders, invoices,
  reports and the audit log are deliberately out of scope. Their dashboard areas show explicit
  empty states instead of fabricated data.
- **Database hosting**: the API needs a reachable PostgreSQL instance; there is no embedded or
  offline fallback. The current database is a managed Neon instance whose connection string lives
  in `.env`, so it must be provisioned before the app can start.
- **Automated UI tests**: none yet — verification is the API smoke suite plus a browser walkthrough.
- **Deployment**: no hosted URL; run locally with `npm run dev` or `npm start`.
- **Bundle size**: the production JS bundle is ~481 kB (148 kB gzipped); route-level code
  splitting is a sensible next step.

---

## 11. Submission checklist

| Requirement | Status |
| --- | --- |
| Registration, login, logout, session handling | ✅ implemented & tested |
| Forgot-password / reset flow | ✅ functional (link surfaced in-app, no mailer) |
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
| PostgreSQL + Prisma ORM instead of a local database file | ✅ migrated, 64/64 API checks pass against PostgreSQL |

### Getting the code

```bash
git clone https://github.com/BhaveshSab/VendorBridge-kagnus.git
cd VendorBridge-kagnus

npm install                 # installs dependencies and generates the Prisma Client
cp .env.example .env        # set DATABASE_URL (PostgreSQL) and JWT_SECRET

npm run db:deploy           # apply the committed Prisma migrations
npm run seed                # load demo users and vendors
npm run dev                 # API on :4000, Vite on :5173
```

`.env`, `node_modules/`, `dist/` and the local `server.log` / `server.pid` are ignored, so no
credentials or generated artefacts are committed. `prisma/migrations/` **is** committed; run
`npm run db:deploy` to recreate the PostgreSQL schema on another machine.
