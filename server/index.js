import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { ApiError, authenticateOptional } from "./auth.js";
import { projectRoot } from "./db.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import vendorRoutes from "./routes/vendors.js";
import { seed } from "./seed.js";

await seed();

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (isProduction) {
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'");
  }
  const origin = req.headers.origin;
  const allowed = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map((value) => value.trim());
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "vendorbridge-api", time: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/vendors", vendorRoutes);
app.use("/api/dashboard", dashboardRoutes);

app.use("/api", (_req, _res, next) => {
  next(new ApiError(404, "API route not found.", { code: "not_found" }));
});

const distDir = path.join(projectRoot, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || path.extname(req.path)) {
      next();
      return;
    }
    res.sendFile("index.html", { root: distDir });
  });
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .send("VendorBridge API is running. Start the frontend with `npm run dev` or build it with `npm run build`.");
  });
}

app.use((error, req, res, _next) => {
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
  console.error(`[api] ${req.method} ${req.originalUrl}`, error);
  res.status(500).json({
    error: { message: "Something went wrong on our side. Please try again.", code: "server_error" },
  });
});

app.listen(PORT, () => {
  console.log(`VendorBridge API listening on http://localhost:${PORT}`);
  console.log(`Node ${process.version} · ${isProduction ? "production" : "development"} mode`);
});
