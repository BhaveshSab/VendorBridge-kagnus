import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import app, { apiErrorHandler } from "./app.js";
import { projectRoot } from "./db.js";
import { ensureDatabase } from "./ensureDb.js";

// Local entrypoint: starts PostgreSQL if needed, serves the built SPA from
// dist/ and listens on PORT. Vercel uses api/index.js instead and serves the
// static build itself, so none of this code runs in the serverless function.
await ensureDatabase();

const PORT = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === "production";

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

// Re-registered after the static layers so file-serving errors still get the
// JSON error shape instead of Express's default HTML 500 page.
app.use(apiErrorHandler);

app.listen(PORT, () => {
  console.log(`VendorBridge API listening on http://localhost:${PORT}`);
  console.log(`Node ${process.version} · ${isProduction ? "production" : "development"} mode`);
});
