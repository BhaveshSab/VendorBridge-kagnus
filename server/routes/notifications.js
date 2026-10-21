import { Router } from "express";
import { z } from "zod";
import { ApiError, parse, requireAuth } from "../auth.js";
import { now, prisma } from "../db.js";
import { notificationOut } from "../notify.js";

const router = Router();

// Every route is scoped to the signed-in user. There is deliberately no
// endpoint that accepts a user id: the session decides whose bell is read.
router.use(requireAuth);

const listQuerySchema = z.object({
  filter: z.enum(["all", "unread"]).optional().default("all"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

async function unreadCount(userId) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

router.get("/", async (req, res) => {
  const query = parse(listQuerySchema, req.query);
  const where = { userId: req.user.id, ...(query.filter === "unread" ? { readAt: null } : {}) };

  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.notification.count({ where }),
    unreadCount(req.user.id),
  ]);

  res.json({
    items: rows.map(notificationOut),
    total,
    page: query.page,
    pageSize: query.pageSize,
    unread,
  });
});

router.get("/unread-count", async (req, res) => {
  res.json({ count: await unreadCount(req.user.id) });
});

const idParam = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(404, "Notification not found.", { code: "not_found" });
  }
  return id;
};

router.post("/:id/read", async (req, res) => {
  const id = idParam(req.params.id);
  // Ownership is part of the lookup: another user's notification is reported as
  // not found, so ids cannot be probed.
  const owned = await prisma.notification.findFirst({ where: { id, userId: req.user.id }, select: { id: true } });
  if (!owned) throw new ApiError(404, "Notification not found.", { code: "not_found" });

  const result = await prisma.notification.updateMany({
    where: { id, userId: req.user.id, readAt: null },
    data: { readAt: now() },
  });
  res.json({ updated: result.count, unread: await unreadCount(req.user.id) });
});

router.post("/read-all", async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: req.user.id, readAt: null },
    data: { readAt: now() },
  });
  res.json({ updated: result.count, unread: 0 });
});

export default router;
