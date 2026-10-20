import { Router } from "express";
import { z } from "zod";
import { auditCatalog, auditOut, STAFF_ROLES } from "../audit.js";
import { ApiError, parse, requireAuth, requireRole } from "../auth.js";
import { prisma } from "../db.js";
import { resolveRange } from "../services/reports.js";

const router = Router();

// The audit trail records internal review decisions, IP addresses and vendor
// pricing, so it is staff-only for every role except vendors.
router.use(requireAuth, requireRole(...STAFF_ROLES));

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(40).optional(),
  actorId: z.coerce.number().int().positive().optional(),
  from: z.string().trim().max(10).optional(),
  to: z.string().trim().max(10).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function buildFilters(query) {
  const where = {};
  if (query.action) where.action = query.action;
  if (query.entityType) where.entityType = query.entityType;
  if (query.entityId) where.entityId = query.entityId;
  if (query.actorId) where.actorId = query.actorId;

  if (query.from || query.to) {
    const range = resolveRange({ from: query.from, to: query.to });
    where.createdAt = { gte: range.from, lt: range.to };
  }

  if (query.q) {
    where.OR = [
      { summary: { contains: query.q, mode: "insensitive" } },
      { actorName: { contains: query.q, mode: "insensitive" } },
      { actorEmail: { contains: query.q, mode: "insensitive" } },
      { entityType: { contains: query.q, mode: "insensitive" } },
      { entityId: { equals: query.q } },
    ];
  }

  return where;
}

router.get("/", async (req, res) => {
  const query = parse(querySchema, req.query);
  const where = buildFilters(query);

  // Facet counts ignore the action/entity filters so the dropdowns always offer
  // every option available for the current search and date window.
  const facetWhere = { ...buildFilters({ ...query, action: undefined, entityType: undefined }) };

  const [rows, total, actionRows, entityRows, actors] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["action"], where: facetWhere, _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ["entityType"], where: facetWhere, _count: { _all: true } }),
    prisma.auditLog.groupBy({
      by: ["actorId", "actorName", "actorRole"],
      where: facetWhere,
      _count: { _all: true },
    }),
  ]);

  const labels = new Map(auditCatalog().map((entry) => [entry.value, entry.label]));
  const actions = actionRows
    .map((row) => ({
      value: row.action,
      label: labels.get(row.action) || row.action,
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const entityTypes = entityRows
    .map((row) => ({ value: row.entityType, count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  res.json({
    items: rows.map(auditOut),
    total,
    page: query.page,
    pageSize: query.pageSize,
    facets: {
      actions,
      entityTypes,
      actors: actors
        .filter((row) => row.actorId !== null)
        .map((row) => ({
          id: row.actorId,
          name: row.actorName,
          role: row.actorRole,
          count: row._count._all,
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 50),
    },
  });
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "Audit entry not found.", { code: "not_found" });
  }

  const row = await prisma.auditLog.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "Audit entry not found.", { code: "not_found" });

  // The same record's history, oldest first — the detail drawer shows the chain
  // an entry belongs to without a second round trip.
  const related = row.entityId
    ? await prisma.auditLog.findMany({
        where: { entityType: row.entityType, entityId: row.entityId, id: { not: row.id } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 25,
      })
    : [];

  res.json({ event: auditOut(row), related: related.map(auditOut) });
});

export default router;
