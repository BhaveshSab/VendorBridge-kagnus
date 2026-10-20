import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { prisma } from "./db.js";
import { noteRedisFailure, redisTransport, resolveRedisConfig } from "./redis.js";

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

/**
 * Express-rate-limit store that prefers Redis (Upstash in production) and
 * silently falls back to the PostgreSQL store whenever Redis is unreachable or
 * slow. Sign-in must never fail — or wait on a timeout — because the cache
 * backend is down: a missed counter degrades to a database round trip, not a
 * 500, and never blocks a legitimate login.
 */
class FailOpenStore {
  constructor({ primary, fallback }) {
    this.primary = primary;
    this.fallback = fallback;
  }

  init(options) {
    // RedisStore.init() loads its Lua scripts; if that fails the limiter must
    // still be usable, so the rejection is swallowed here and every operation
    // then falls through to PostgreSQL.
    Promise.resolve()
      .then(() => this.primary?.init?.(options))
      .catch(noteRedisFailure);
    this.fallback.init?.(options);
  }

  async #attempt(run) {
    if (this.primary) {
      try {
        return await run(this.primary);
      } catch (error) {
        // Starts the shared cooldown, so a prolonged outage costs no latency
        // per request instead of one Redis timeout each time.
        noteRedisFailure(error);
      }
    }
    return run(this.fallback);
  }

  increment(key) {
    return this.#attempt((store) => store.increment(key));
  }

  decrement(key) {
    return this.#attempt((store) => store.decrement(key));
  }

  resetKey(key) {
    return this.#attempt((store) => store.resetKey(key));
  }
}

async function createRateLimitStore(prefix) {
  const fallback = new PrismaRateLimitStore({ prefix });
  if (!resolveRedisConfig()) return fallback;

  // Redis-backed counters when Redis is configured (shared across instances).
  // The transport is the single connection shared with the read cache, so a
  // serverless instance holds at most one connection to Upstash. Construction
  // is allowed to succeed while Redis is down: the commands themselves fail
  // open onto PostgreSQL, and the store starts using Redis again by itself
  // once the cooldown expires.
  try {
    const { RedisStore } = await import("rate-limit-redis");
    const primary = new RedisStore({
      prefix,
      sendCommand: (...args) => redisCall(...args),
    });
    return new FailOpenStore({ primary, fallback });
  } catch (error) {
    noteRedisFailure(error);
    return fallback;
  }
}

/**
 * Sends a raw command through the shared transport. Rejects (rather than
 * resolving `null`) when Redis is unavailable or cooling down, because
 * rate-limit-redis has no notion of "no reply" — the rejection is what makes
 * FailOpenStore choose the database.
 */
async function redisCall(...args) {
  const transport = await redisTransport();
  if (!transport) throw new Error("redis is not configured or is cooling down");
  return transport.call(...args);
}

/**
 * Builds a persistent rate limiter for the credential-sensitive auth endpoints.
 *
 * Counters live in Redis (when a Redis target is configured — see redis.js,
 * which accepts an Upstash REST URL plus token or a `rediss://` TCP URL) or in
 * the application database, so they survive restarts and work across multiple
 * Node.js instances. A Redis outage degrades to the database instead of
 * failing the request. Keys combine the client IP with the submitted email — the same
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
