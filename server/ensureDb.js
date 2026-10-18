import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execSync } from "node:child_process";
import { projectRoot } from "./db.js";

let pgInstance = null;

function isPortOpen(port, host = "127.0.0.1", timeout = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeout);
    socket.once("connect", () => {
      status = true;
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

export async function ensureDatabase() {
  const dbUrl = process.env.DATABASE_URL || "";
  let port = 5432;
  let host = "127.0.0.1";
  let dbName = "vendorbridge";

  try {
    const parsed = new URL(dbUrl);
    if (parsed.port) port = Number(parsed.port);
    if (parsed.hostname) host = parsed.hostname;
    if (parsed.pathname && parsed.pathname.length > 1) {
      dbName = parsed.pathname.slice(1);
    }
  } catch {
    // fallback to defaults
  }

  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const isOpen = await isPortOpen(port, host);

  if (isOpen) {
    return;
  }

  if (!isLocal) {
    console.warn(`[db] Unable to connect to remote database at ${host}:${port}`);
    return;
  }

  console.log(`[db] Local PostgreSQL not running on ${host}:${port}. Starting embedded PostgreSQL...`);
  try {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    const dbDir = path.resolve(projectRoot, ".db-data");

    // Clean up stale pid lock if server was previously killed
    const pidFile = path.join(dbDir, "postmaster.pid");
    if (fs.existsSync(pidFile)) {
      try {
        fs.unlinkSync(pidFile);
      } catch {}
    }

    pgInstance = new EmbeddedPostgres({
      databaseDir: dbDir,
      user: "postgres",
      password: "password",
      port,
      persistent: true,
    });

    const isInitialized = fs.existsSync(path.join(dbDir, "PG_VERSION"));
    if (!isInitialized) {
      await pgInstance.initialise();
    }

    await pgInstance.start();

    try {
      await pgInstance.createDatabase(dbName);
    } catch {
      // Database might already exist in persistent directory
    }

    console.log(`[db] Embedded PostgreSQL started successfully on port ${port} (database: ${dbName})`);

    const cleanup = async () => {
      if (pgInstance) {
        console.log("[db] Stopping embedded PostgreSQL...");
        try {
          await pgInstance.stop();
        } catch {}
        pgInstance = null;
      }
    };

    process.once("SIGINT", async () => {
      await cleanup();
      process.exit(0);
    });
    process.once("SIGTERM", async () => {
      await cleanup();
      process.exit(0);
    });
  } catch (err) {
    console.error("[db] Could not initialize embedded PostgreSQL:", err.message);
  }
}
