import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `prisma migrate deploy` with deployment-safe diagnostics.
 *
 * Vercel's build log only shows `exited with 1` when a migration fails, which
 * hides the two migration states that actually need a human decision:
 *
 *   P3018 — the SQL itself failed (e.g. a column that already exists because the
 *           database was changed outside Prisma).
 *   P3009 — an earlier failed migration is still recorded, so Prisma refuses to
 *           touch the database at all until it is resolved.
 *
 * Both are recoverable, but only with `prisma migrate resolve` run once against
 * that database. This script prints the exact command instead of leaving the
 * next deploy to guess, and retries once on a transient connection error so a
 * paused Neon branch does not fail the build.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "prisma", "migrations");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");

/** Legacy folders that were deleted from the repo but can return via a merge. */
function warnAboutDuplicateTimestamps() {
  const names = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const byTimestamp = new Map();
  for (const name of names) {
    const timestamp = name.split("_")[0];
    byTimestamp.set(timestamp, [...(byTimestamp.get(timestamp) ?? []), name]);
  }

  for (const [timestamp, folders] of byTimestamp) {
    if (folders.length > 1) {
      console.warn(
        `[migrate] WARNING: ${folders.length} migrations share the timestamp ${timestamp}:\n` +
          folders.map((folder) => `[migrate]   - ${folder}`).join("\n") +
          "\n[migrate] Prisma orders them by folder name. If one of these is an obsolete migration\n" +
          "[migrate] brought back by a merge, delete it before it is applied to a real database.",
      );
    }
  }
}

function migrateDeploy() {
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  return { status: result.status ?? 1, output };
}

const TRANSIENT = /P1001|P1002|P1017|ECONNRESET|ETIMEDOUT|Timed out|Can't reach database server|too many connections/i;

function failedMigrationName(output) {
  return (
    output.match(/Migration name:\s*(\S+)/)?.[1] ??
    output.match(/The `([^`]+)` migration started at/)?.[1] ??
    null
  );
}

warnAboutDuplicateTimestamps();

let result = migrateDeploy();

if (result.status !== 0 && TRANSIENT.test(result.output)) {
  console.warn("[migrate] Transient database error. Retrying `prisma migrate deploy` once in 10s...");
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  result = migrateDeploy();
}

if (result.status !== 0) {
  const name = failedMigrationName(result.output);

  console.error("\n[migrate] `prisma migrate deploy` failed; the build cannot continue.");
  if (name) {
    console.error(`[migrate] Blocking migration: ${name}`);
    console.error("[migrate] Resolve it once against this database, then redeploy:");
    console.error(`[migrate]   npx prisma migrate resolve --rolled-back "${name}"  # migration did not apply (or is obsolete)`);
    console.error(`[migrate]   npx prisma migrate resolve --applied "${name}"     # database already has this change`);
    console.error("[migrate] See README §6 → \"When a deploy fails on a migration\".");
  } else {
    console.error("[migrate] No failed migration was named in the output above; check DATABASE_URL.");
  }
  process.exit(1);
}

console.log("[migrate] Database schema is up to date.");
