import "dotenv/config";

let prisma;

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  ({ prisma } = await import("../server/db.js"));
  await prisma.$connect();

  const [users, vendors, rfqs, quotations, passwordResets, counters, rateLimits] = await Promise.all([
    prisma.user.count(),
    prisma.vendor.count(),
    prisma.rfq.count(),
    prisma.quotation.count(),
    prisma.passwordReset.count(),
    prisma.counter.count(),
    prisma.rateLimit.count(),
  ]);

  console.log("Database connection: OK");
  console.log("Application data counts:");
  console.log(JSON.stringify({ users, vendors, rfqs, quotations, passwordResets, counters, rateLimits }, null, 2));
} catch (error) {
  const code = error?.code ? ` (${error.code})` : "";
  console.error(`Database status check failed${code}.`);
  console.error("Check DATABASE_URL, run npm run db:generate, and apply migrations with npm run db:deploy.");
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect().catch(() => {});
}
