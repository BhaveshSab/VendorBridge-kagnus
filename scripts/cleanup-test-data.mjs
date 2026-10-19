import "dotenv/config";

// The smoke suite registers throwaway accounts under this reserved domain.
// Only records in that domain are removed — seeded demo fixtures and any real
// vendor data are never touched, and nothing is truncated.
const TEST_DOMAIN = "@vendorbridge.test";

let prisma;

try {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  ({ prisma } = await import("../server/db.js"));
  await prisma.$connect();

  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true },
  });
  const userIds = testUsers.map((user) => user.id);

  const vendorWhere = {
    OR: [
      { email: { endsWith: TEST_DOMAIN } },
      ...(userIds.length > 0 ? [{ userId: { in: userIds } }] : []),
    ],
  };

  // RFQs created by the Week 2 suite carry this reserved title prefix. Their
  // line items, assignments and quotations are removed by ON DELETE CASCADE.
  const rfqs = await prisma.rfq.deleteMany({ where: { title: { startsWith: "[smoke]" } } });

  const vendors = await prisma.vendor.deleteMany({ where: vendorWhere });
  const users =
    userIds.length > 0
      ? await prisma.user.deleteMany({ where: { id: { in: userIds } } })
      : { count: 0 };

  console.log(
    `Removed ${users.count} test account(s), ${vendors.count} test vendor record(s) (${TEST_DOMAIN}) and ${rfqs.count} test RFQ(s).`,
  );
  console.log("Seeded demo users and vendors were not modified.");
} catch (error) {
  const code = error?.code ? ` (${error.code})` : "";
  console.error(`Test-data cleanup failed${code}.`);
  console.error("Check DATABASE_URL and apply migrations with npm run db:deploy.");
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect().catch(() => {});
}
