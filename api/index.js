// Vercel serverless entrypoint. Vercel invokes the Express app directly —
// no listen() and no static file handling (the platform serves dist/ and
// routes /api/* here via vercel.json rewrites).
import app from "../server/app.js";

export default app;
