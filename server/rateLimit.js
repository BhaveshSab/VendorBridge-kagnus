import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { prisma } from "./db.js";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MESSAGE = {
  error: {
    message: "Too many sign-in attempts. Please wait a few minutes and try again.",
    code: "rate_limited",
  },
};

/**
 * express-rate-limit store backed by the application database (Prisma).
 *
 * Unlike an in-memory Map, counters survive process restarts, are shared by
 * every Node.js instance pointed at the same database, and expired rows are
 * swept periodically so the table cannot grow without bound.
 */
class PrismaRateLimitStore {
  constructor({ windowMs = DEFAULT_WINDOW_MS, prefix = "vb:rl:" } = {}) {
    this.windowMs = windowMs;
    this.prefix = prefix;
    this.hitsSinceSweep = 0;
  }

  init(options) {
    if (options?.windowMs) this.windowMs = options.windowMs;
  }

  async increment(key) {
    const storeKey = this.prefix + key;
    const nowDate = new Date();
    const expiresAt = new Date(nowDate.getTime() + this.windowMs);
    const existing = await prisma.rateLimit.findUnique({ where: { key: storeKey } });
    const row =
      !existing || existing.resetAt.getTime() <= nowDate.getTime()
        ? await prisma.rateLimit.upsert({
            where: { key: storeKey },
            create: { key: storeKey, hits: 1, resetAt: expiresAt },
            update: { hits: 1, resetAt: expiresAt },
          })
        : await prisma.rateLimit.update({
            where: { key: storeKey },
            data: { hits: { increment: 1 } },
          });
    this.#scheduleSweep();
    return { totalHits: row.hits, resetTime: row.resetAt };
  }

  async decrement(key) {
    await prisma.rateLimit.updateMany({
      where: { key: this.prefix + key, hits: { gt: 0 } },
      data: { hits: { decrement: 1 } },
    });
  }

  async resetKey(key) {
    await prisma.rateLimit.deleteMany({ where: { key: this.prefix + key } });
  }

  #scheduleSweep() {
    this.hitsSinceSweep += 1;
    if (this.hitsSinceSweep < 50) return;
    this.hitsSinceSweep = 0;
    // Best-effort garbage collection of expired counters.
    prisma.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } }).catch(() => {});
  }
}

async function createRateLimitStore(prefix) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return new PrismaRateLimitStore({ prefix });

  // Redis-backed counters when Redis is configured (shared across instances).
  const { default: Redis } = await import("ioredis");
  const { RedisStore } = await import("rate-limit-redis");
  const client = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  client.on("error", (error) => console.error("[rate-limit] redis error", error));
  return new RedisStore({ prefix, sendCommand: (...args) => client.call(...args) });
}

/**
 * Builds a persistent rate limiter for the credential-sensitive auth endpoints.
 *
 * Counters live in Redis (when `REDIS_URL` is configured) or in the application
 * database, so they survive restarts and work across multiple Node.js
 * instances. Keys combine the client IP with the submitted email — the same
 * granularity the previous in-memory throttle used.
 */
export async function createAuthLimiter({
  limit = 10,
  windowMs = DEFAULT_WINDOW_MS,
  prefix = "vb:rl:",
  skipSuccessfulRequests = true,
  message = DEFAULT_MESSAGE,
} = {}) {
  const store = await createRateLimitStore(prefix);
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    store,
    message,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? "0.0.0.0")}:${String(req.body?.email ?? "")
        .trim()
        .toLowerCase()}`,
    validate: { xForwardedForHeader: false, forwardedHeader: false },
  });
}
