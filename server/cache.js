/**
 * Read-through cache for expensive, non-authoritative read models.
 *
 * Redis is optional: without a Redis target every call goes straight to the
 * loader, so local development and tests keep hitting PostgreSQL only. When
 * Redis is configured (Upstash on Vercel, for example) it backs the handful of
 * endpoints whose payload is expensive to compute and cheap to be a few seconds
 * stale (the dashboard summary and the vendor category index). Connection
 * handling — REST or TCP, Upstash or local — lives in redis.js.
 *
 * Two rules keep this safe:
 *   1. Fail open. If Redis is unreachable, slow, or returns garbage, the loader
 *      runs and the request still succeeds. A cache is never a dependency.
 *   2. Versioned keys. Writes bump a per-namespace version counter, so the next
 *      read misses immediately and stale entries are left to expire on their
 *      own TTL instead of being enumerated with SCAN.
 */
import { noteRedisFailure, redisTransport } from "./redis.js";

const PREFIX = "vb:cache:";
const versionKey = (namespace) => `${PREFIX}ver:${namespace}`;
const dataKey = (namespace, version, key) => `${PREFIX}${namespace}:v${version}:${key}`;

/**
 * Returns the cached JSON for `namespace`/`key`, otherwise runs `load()` and
 * stores its result for `ttlSeconds`. `load()` is called at most once per call
 * and its errors always propagate to the route, cache or no cache.
 */
export async function cachedJson(namespace, key, ttlSeconds, load) {
  const redis = await redisTransport();
  let cacheKey = null;

  if (redis) {
    try {
      const version = (await redis.call("GET", versionKey(namespace))) ?? "0";
      cacheKey = dataKey(namespace, version, key);
      const raw = await redis.call("GET", cacheKey);
      if (raw !== null) return JSON.parse(raw);
    } catch (error) {
      // Unreadable/unreachable cache: fall through to the database.
      cacheKey = null;
      noteRedisFailure(error);
    }
  }

  const value = await load();

  if (redis && cacheKey) {
    try {
      await redis.call("SET", cacheKey, JSON.stringify(value), "EX", ttlSeconds);
    } catch (error) {
      noteRedisFailure(error);
    }
  }

  return value;
}

/**
 * Invalidates every cached entry in the given namespaces by advancing their
 * version counter. Best effort: a failed bump only means the old entry lingers
 * until its TTL expires, so it never fails the write that triggered it.
 */
export async function invalidateCache(...namespaces) {
  if (namespaces.length === 0) return;
  const redis = await redisTransport();
  if (!redis) return;

  try {
    await Promise.all(namespaces.map((namespace) => redis.call("INCR", versionKey(namespace))));
  } catch (error) {
    noteRedisFailure(error);
  }
}
