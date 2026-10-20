import "dotenv/config";
import cookieParser from "cookie-parser";
import express from "express";
import { ApiError, authenticateOptional } from "./auth.js";
import { prisma } from "./db.js";
import approvalRoutes from "./routes/approvals.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import invoiceRoutes from "./routes/invoices.js";
import purchaseOrderRoutes from "./routes/purchaseOrders.js";
import rfqRoutes from "./routes/rfqs.js";
import vendorRoutes from "./routes/vendors.js";

// API-only Express app. It never calls listen() and never touches the local
// filesystem, so the same module runs as:
//   - a local Node process (server/index.js adds static files + listen)
//   - a Vercel serverless function (api/index.js re-exports this app)
const app = express();
const isProduction = process.env.NODE_ENV === "production";

function isDatabaseUnavailable(error) {
  return (
    error?.name === "PrismaClientInitializationError" ||
    error?.name === "PrismaClientRustPanicError" ||
    /^P10\d\d$/.test(String(error?.code || "")) ||
    ["P2021", "P2022", "P2024"].includes(error?.code)
  );
}

// P2028: an interactive transaction could not acquire a connection before the
// maxWait deadline. On a pooled managed database (Neon) this is contention, not
// a broken schema, so it is reported as retryable instead of a 500.
function isDatabaseBusy(error) {
  return error?.code === "P2028";
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use("/api", (_req, res, next) => {
  // Authenticated vendor and dashboard responses should never enter shared caches.
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (isProduction) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'",
    );
  }
  const origin = req.headers.origin;
  const allowed = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim());
  if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
  }
  next();
});

app.use(authenticateOptional);

app.get("/api/health", async (_req, res) => {
  try {
    // Check the tables this app requires without exposing record counts.
    await Promise.all([
      prisma.user.findFirst({ select: { id: true } }),
      prisma.vendor.findFirst({ select: { id: true } }),
    ]);
    res.json({
      ok: true,
      service: "vendorbridge-api",
      database: "connected",
      time: new Date().toISOString(),
    });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    res.status(503).json({
      ok: false,
      service: "vendorbridge-api",
      database: "unavailable",
      error: { message: "Database connection or schema is not ready.", code: "database_unavailable" },
      time: new Date().toISOString(),
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/rfqs", rfqRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use("/api", (_req, _res, next) => {
  next(new ApiError(404, "API route not found.", { code: "not_found" }));
});

export function apiErrorHandler(error, req, res, _next) {
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: { message: "Invalid JSON body.", code: "invalid_json" } });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: { message: error.message, code: error.code, fields: error.fields || undefined },
    });
    return;
  }
  if (isDatabaseBusy(error)) {
    console.error(`[db] ${error.code}: transaction could not start in time`);
    res.setHeader("Retry-After", "2");
    res.status(503).json({
      error: { message: "The database is busy right now. Please try again.", code: "database_busy" },
    });
    return;
  }
  if (isDatabaseUnavailable(error)) {
    console.error(`[db] ${error.code || error.name || "database error"}`);
    res.status(503).json({
      error: {
        message: "Database connection or schema is not ready. Check DATABASE_URL and run npm run db:deploy.",
        code: "database_unavailable",
      },
    });
    return;
  }
  console.error(`[api] ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({
    error: { message: "Something went wrong on our side. Please try again.", code: "server_error" },
  });
}

app.use(apiErrorHandler);

export default app;
