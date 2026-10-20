/**
 * The one Redis connection used by both the read cache (cache.js) and the rate
 * limiter (rateLimit.js).
 *
 * Upstash hands out two different connection styles, and a deployment has to
 * work with whichever one an operator copied into the environment:
 *
 *   REST   https://<db>.upstash.io  +  UPSTASH_REDIS_REST_TOKEN
 *          Preferred on Vercel: one HTTPS request per command, no TCP socket
 *          to open per invocation and nothing to leak between cold starts.
 *   TCP    rediss://default:<password>@<db>.upstash.io:6379  (ioredis)
 *          Works locally and anywhere a long-lived socket is fine.
 *
 * Both expose the same `call(command, ...args)` surface, so neither caller has
 * to know which one is configured. The Vercel Upstash integration has shipped
 * both `UPSTASH_REDIS_REST_*` and `KV_REST_API_*` names, so both are accepted.
 *
 * Everything here fails open. An unreachable, misconfigured or slow Redis
 * never fails a request: callers fall back to PostgreSQL, and a short cooldown
 * keeps a dead endpoint from costing a connection timeout on every call.
 */
import { createHash } from "node:crypto";

const REST_TIMEOUT_MS = 1500;
const TCP_COMMAND_TIMEOUT_MS = 1500;
const TCP_CONNECT_TIMEOUT_MS = 2000;

// After a failure, stop attempting Redis for a while. Requests in that window
// pay no timeout at all instead of one per cache/rate-limit call.
const COOLDOWN_MS = 30_000;

const REST_URL_KEYS = ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"];
const REST_TOKEN_KEYS = ["UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_TOKEN"];
// `REDIS_URL`/`KV_URL`/`UPSTASH_REDIS_URL` are the redis:// aliases different
// Upstash and Vercel integrations have injected over time.
const TCP_URL_KEYS = ["REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL"];

let transportPromise = null;
let cooldownUntil = 0;
let warned = false;

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

/**
 * Resolves the configured destination without connecting to it.
 *
 * Returns `{ kind: "rest", url, token }`, `{ kind: "tcp", url }`, or `null`
 * when no Redis is configured. A REST URL pasted into REDIS_URL is understood
 * rather than rejected — that is the single most common deployment mistake.
 */
export function resolveRedisConfig() {
  const tcpUrl = firstEnv(TCP_URL_KEYS);
  const restUrlEnv = firstEnv(REST_URL_KEYS);
  const tokenEnv = firstEnv(REST_TOKEN_KEYS);

  const restUrl = restUrlEnv || (/^https?:\/\//i.test(tcpUrl) ? tcpUrl : "");
  if (restUrl) {
    let parsed;
    try {
      parsed = new URL(restUrl);
    } catch {
      return null;
    }
    // Some copy/paste flows carry the token in the URL's password slot.
    const token = tokenEnv || (parsed.password ? decodeURIComponent(parsed.password) : "");
    parsed.username = "";
    parsed.password = "";
    const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    return { kind: "rest", url: base, token };
  }

  if (/^rediss?:\/\//i.test(tcpUrl)) return { kind: "tcp", url: tcpUrl };
  return null;
}

/** True while the last failure's cooldown is still running. */
export function redisCooldownActive() {
  return Date.now() < cooldownUntil;
}

/** Starts the cooldown and logs the first failure of an outage, not every one. */
export function noteRedisFailure(error) {
  cooldownUntil = Date.now() + COOLDOWN_MS;
  if (warned) return;
  warned = true;
  const message = error?.message || String(error ?? "unknown error");
  console.error(`[redis] unavailable, falling back to PostgreSQL: ${message}`);
}

/** Test hook: forget the cached client and any active cooldown. */
export function resetRedisTransport() {
  transportPromise = null;
  cooldownUntil = 0;
  warned = false;
}

function createRestTransport({ url, token }) {
  if (!token) {
    throw new Error(
      "Upstash REST URL is configured but the REST token is missing (set UPSTASH_REDIS_REST_TOKEN or KV_REST_API_TOKEN).",
    );
  }

  // Upstash does not keep a per-connection script cache, so SCRIPT LOAD is
  // answered locally and EVALSHA is issued as EVAL with the body we kept.
  // That is what rate-limit-redis' Lua counters need to work over REST.
  const scripts = new Map();

  const restCall = async (args) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.map((value) => String(value))),
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Upstash REST ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("Upstash REST returned a non-JSON body");
    }
    if (body?.error) throw new Error(`Upstash REST: ${body.error}`);
    return body?.result ?? null;
  };

  const call = async (...rawArgs) => {
    const args = rawArgs.length === 1 && Array.isArray(rawArgs[0]) ? rawArgs[0] : rawArgs;
    const command = String(args[0] ?? "").toUpperCase();

    if (command === "SCRIPT" && String(args[1] ?? "").toUpperCase() === "LOAD") {
      const source = String(args[2] ?? "");
      const sha = createHash("sha1").update(source).digest("hex");
      scripts.set(sha, source);
      return sha;
    }
    if (command === "EVALSHA") {
      const source = scripts.get(String(args[1]));
      if (source) return restCall(["EVAL", source, ...args.slice(2)]);
    }
    return restCall(args);
  };

  return { kind: "rest", call };
}

async function createTcpTransport(url) {
  const { default: Redis } = await import("ioredis");
  const client = new Redis(url, {
    // Fail fast: a Redis outage must never hold an API request open.
    commandTimeout: TCP_COMMAND_TIMEOUT_MS,
    connectTimeout: TCP_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    // Give up instead of reconnecting forever in the background; the cooldown
    // below creates a fresh client once the endpoint looks healthy again.
    retryStrategy: (attempt) => (attempt > 4 ? null : Math.min(attempt * 250, 1000)),
  });

  // ioredis emits 'error' for socket failures; without a listener that would
  // crash the process, which is exactly the outage behaviour we are avoiding.
  client.on("error", noteRedisFailure);
  client.on("end", () => {
    transportPromise = null;
  });

  return {
    kind: "tcp",
    call: (...args) => client.call(...args),
  };
}

/**
 * The shared transport, or `null` when Redis is unconfigured, cooling down
 * after a failure, or unusable. Callers treat `null` as "use PostgreSQL".
 */
export async function redisTransport() {
  const config = resolveRedisConfig();
  if (!config || redisCooldownActive()) return null;

  if (!transportPromise) {
    transportPromise = (config.kind === "rest"
      ? Promise.resolve().then(() => createRestTransport(config))
      : createTcpTransport(config.url)
    ).catch((error) => {
      transportPromise = null;
      noteRedisFailure(error);
      return null;
    });
  }

  return transportPromise;
}
