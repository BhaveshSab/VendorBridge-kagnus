# VendorBridge — Week 1 Completion Report

**Project:** VendorBridge — Procurement & Vendor Management ERP
**Milestone:** Week 1 — Foundation & Vendor Management
**Status:** Complete for all three Week 1 deliverables. Weeks 2–4 are deliberately out of scope.

---

## 1. Implemented features

### Authentication
- Registration with per-field validation (name, email, phone, role, country, password strength); a vendor sign-up automatically creates a linked **Pending** vendor profile.
- Email + password login, logout and session restore through a signed JWT in an httpOnly cookie (8 h expiry, `sameSite=lax`).
- Forgot-password → single-use, 30-minute reset token → password reset.
- Login throttling (10 attempts per IP + email in 15 minutes → 429).
- Four roles: **Admin, Procurement Officer, Manager/Approver, Vendor**.
- All API routes guarded server-side (`requireAuth` / `requireRole`); the UI route guard only handles navigation, never authorization.
- React route guards redirect unauthenticated visitors to `/login` and keep signed-in users out of the auth screens.

### Dashboard
- Role-aware greeting and role label; the four summary cards from the design reference.
- Live **Active vendors** count; **Active RFQs**, **Pending approvals** and **PO value** show explicit
  "Available in Week 2/3" placeholders because those modules do not exist yet.
- Quick actions: add vendor, open vendor register, and a disabled "Create an RFQ" labelled *Week 2*.
- Vendor register snapshot (five most recently updated vendors) with status chips.
- Vendor status donut and vendor-by-category breakdown computed from stored records.
- "Scheduled for later weeks" card describing the Week 2, Week 3 and Week 4 scope.
- Skeleton loaders, empty states and an error state with retry. Vendors see their own profile instead
  of the internal register.

### Vendor management
- Create, list, view, update and delete vendors (Admin and Procurement Officer only).
- Fields: name, category, GSTIN, contact person, email, phone, address, city, country, status,
  rating and internal notes.
- Server-side search, status and category filters, five sort orders and pagination.
- Detail drawer with contact, billing details, compliance and record metadata.
- Unique vendor code (`VND-###`), duplicate-name protection (409), Zod validation with per-field
  messages (422).
- Vendors can read only their own record; all other vendor endpoints return 403.
- Data persists in PostgreSQL (managed instance, Prisma ORM) across refreshes, restarts and new sessions.

### Explicitly out of scope
RFQs, quotations, comparison, approvals, purchase orders, invoices, reports and the audit log are
**not implemented**. Their API routes return 404, their navigation entries are absent, and the
dashboard shows placeholder empty states instead of fabricated data.

---

## 2. Tests performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | Pass (no TypeScript errors) |
| `npm run build` | Pass (production bundle built into `dist/`) |
| `npm run test:api` | **64 / 64 assertions pass** against PostgreSQL (Prisma) |
| Browser walkthrough (1440 px + 390 px) | Login, registration, dashboard, vendor create/edit/delete, search and filters, drawer, profile, mobile layout |
| Removed-route check | `/rfqs` renders the not-found screen; `/api/rfqs` returns 404 |
| Automated screenshot run (`npm run screenshots`) | 9 screens captured from the live app into `docs/screenshots/` |

The API suite covers anonymous 401s, wrong-password rejection, cookie session refresh, all four
roles, vendor and manager role denials (403), vendor-scoped reads, cross-vendor access denial,
validation (422), duplicate-name conflict (409), create/update/delete, search, status and category
filters, pagination, invalid filter rejection, the dashboard contract, vendor registration creating
a Pending profile, duplicate email conflict, reset-token issuance and single use, logout, endpoint
scope and persistence across sessions.

Reproduce:

```bash
npm install
npm run seed -- --force
npm start            # http://localhost:4000
npm run test:api     # in a second terminal
```

---

## 3. Known limitations

- **Email delivery** — no SMTP provider is configured; reset links are returned by the API and shown in the UI, labelled as local demo mode.
- **Role selection at sign-up** — public registration lets a user choose Procurement/Approver/Vendor; there is no admin verification step in Week 1.
- **Weeks 2–4** — procurement workflow, document generation, reports and audit trail are intentionally not built.
- **Database hosting** — PostgreSQL must be reachable at `DATABASE_URL`; there is no embedded or offline fallback. The schema is versioned in `prisma/migrations/` and applied with `npm run db:deploy`.
- **Automated UI tests** — none; UI verification is a browser walkthrough plus the API suite.
- **Deployment** — no hosted URL; the app runs locally with `npm run dev` or `npm start`.
- **Bundle size** — ~481 kB (148 kB gzipped) in a single chunk; route-level code splitting is the next step.

---

## 4. Submission artefacts

| Artefact | Location |
| --- | --- |
| Source code | `src/` (front end), `server/` (API), `prisma/` (schema + migrations), `scripts/` (tests, screenshots) |
| Setup and configuration | [README.md](../README.md) §1–§3 |
| Demo accounts | [README.md](../README.md) §3 |
| Screenshots | `docs/screenshots/` (9 screens) |
| Demo data | recreated with `npm run seed -- --force` |
| API and architecture reference | [README.md](../README.md) §5–§6 |
