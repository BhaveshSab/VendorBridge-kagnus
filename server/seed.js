import { hashPassword } from "./auth.js";
import { now, prisma } from "./db.js";

export async function isDatabaseEmpty() {
  return (await prisma.user.count()) === 0;
}

async function resetTables() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "password_resets", "vendors", "counters", "users" RESTART IDENTITY CASCADE',
  );
}

export async function seed({ force = false } = {}) {
  if (force) await resetTables();
  if (!(await isDatabaseEmpty())) return false;

  await prisma.$transaction(
    async (tx) => {
      const createdAt = now();

      const insertUser = (firstName, lastName, email, password, role, extra = {}) =>
        tx.user.create({
          data: {
            firstName,
            lastName,
            email,
            phone: extra.phone || null,
            country: extra.country || "India",
            role,
            additionalInfo: extra.additionalInfo || null,
            passwordHash: hashPassword(password),
            createdAt,
          },
        });

      await insertUser("Aisha", "Kapoor", "admin@vendorbridge.dev", "Admin@123", "admin", {
        phone: "+91 98200 11223",
      });
      const procurement = await insertUser(
        "Rohan",
        "Mehta",
        "procurement@vendorbridge.dev",
        "Procure@123",
        "procurement",
        { phone: "+91 98330 44556" },
      );
      await insertUser("Priya", "Nair", "manager@vendorbridge.dev", "Manager@123", "manager", {
        phone: "+91 90040 77889",
      });
      const vendorUser = await insertUser(
        "Neha",
        "Sharma",
        "vendor@vendorbridge.dev",
        "Vendor@123",
        "vendor",
        {
          phone: "+91 98110 66778",
          additionalInfo: "Nova Office Supplies — account manager",
        },
      );

      const insertVendor = (vendor, code) =>
        tx.vendor.create({
          data: {
            code,
            name: vendor.name,
            category: vendor.category,
            gstin: vendor.gstin || null,
            email: vendor.email,
            phone: vendor.phone || null,
            address: vendor.address || null,
            city: vendor.city || null,
            country: vendor.country || "India",
            contactName: vendor.contactName || null,
            status: vendor.status,
            rating: vendor.rating,
            notes: vendor.notes || null,
            userId: vendor.userId || null,
            createdBy: procurement.id,
            createdAt,
            updatedAt: createdAt,
          },
        });

      await insertVendor(
        {
          name: "Nova Office Supplies",
          category: "Office Supplies",
          gstin: "29AABCN1234F1Z5",
          email: "sales@novaoffice.in",
          phone: "+91 80 4123 8890",
          address: "42, Indiranagar 100ft Road",
          city: "Bengaluru",
          contactName: "Neha Sharma",
          status: "Active",
          rating: 4.6,
          notes: "Preferred supplier for stationery and pantry consumables.",
          userId: vendorUser.id,
        },
        "VND-001",
      );

      const vendors = [
        ["Zenith IT Solutions", "IT Equipment", "27AAACZ5678K1Z2", "orders@zenithit.in", "Pune", "Active", 4.8, "Arjun Desai", "Bulk hardware partner with 5-day dispatch SLA."],
        ["BluePeak Logistics", "Logistics", "07AABCB9012M1Z8", "contracts@bluepeak.in", "New Delhi", "Active", 4.3, "Karan Bhatia", "Nationwide courier and warehousing partner."],
        ["Meridian Furniture", "Furniture", "29AACCM3456P1Z1", "hello@meridianfurniture.in", "Bengaluru", "Pending", 4.1, "Sana Iyer", "Awaiting compliance documents for onboarding."],
        ["GreenLeaf Facilities", "Facilities", "29AADCG7788Q1Z4", "ops@greenleaf.in", "Hyderabad", "Active", 4.4, "Vikram Rao", "Annual facility maintenance contract."],
        ["Orbit Software Labs", "Software", "06AAECO2211R1Z9", "accounts@orbitlabs.in", "Gurugram", "Active", 4.7, "Meera Joshi", "Cloud hosting and managed support."],
        ["PaperTrail Stationery", "Stationery", "19AAFCP5544S1Z6", "sales@papertrail.in", "Kolkata", "Inactive", 3.8, "Ritu Sen", "Contract paused after pricing review."],
        ["CanteenCraft Catering", "Catering", "29AAGCC8899T1Z3", "events@canteencraft.in", "Bengaluru", "Active", 4.2, "Anil Kumar", "Office catering and event meals."],
        ["Apex Hardware", "IT Equipment", "24AAHCA1122U1Z7", "b2b@apexhardware.in", "Ahmedabad", "Active", 4.0, "Jignesh Patel", "Peripherals and networking hardware."],
        ["Sunrise Printworks", "Stationery", "33AAJCS3344V1Z5", "orders@sunriseprint.in", "Chennai", "Pending", 3.9, "Deepa Menon", "New vendor, documents under verification."],
        ["Vector Movers", "Logistics", "27AAKCV6677W1Z1", "dispatch@vectormovers.in", "Mumbai", "Active", 4.5, "Sameer Khan", "Regional express logistics."],
        ["UrbanNest Interiors", "Furniture", "29AALCU9900X1Z8", "projects@urbannest.in", "Bengaluru", "Active", 4.6, "Tara Reddy", "Ergonomic workspace fit-outs."],
        ["ClearWorks Hygiene", "Facilities", "29AAMCC2233Y1Z2", "care@clearworks.in", "Bengaluru", "Active", 4.2, "Sunil George", "Hygiene and sanitation services."],
        ["Nexa Cloud Services", "Software", "29AANCN5566Z1Z6", "billing@nexacloud.in", "Bengaluru", "Active", 4.5, "Fatima Sheikh", "Backup and observability tooling."],
        ["Ironclad Security", "Facilities", "29AAOCI7788A1Z4", "info@ironclad.in", "Bengaluru", "Blocked", 2.9, "Nikhil Jain", "Blocked pending insurance renewal."],
        ["Quantum Peripherals", "IT Equipment", "29AAPCQ1234B1Z3", "sales@quantumperipherals.in", "Bengaluru", "Active", 4.1, "Ananya Bose", "Monitors, docks and accessories."],
      ];

      for (const [index, row] of vendors.entries()) {
        const [name, category, gstin, email, city, status, rating, contactName, notes] = row;
        await insertVendor(
          {
            name,
            category,
            gstin,
            email,
            phone: "+91 80 4000 1200",
            address: "Procurement Park, Phase 2",
            city,
            contactName,
            status,
            rating,
            notes,
          },
          `VND-${String(index + 2).padStart(3, "0")}`,
        );
      }

      await tx.counter.upsert({
        where: { name: "VND" },
        create: { name: "VND", value: vendors.length + 1 },
        update: { value: vendors.length + 1 },
      });
    },
    { timeout: 30000 },
  );

  return true;
}

if (process.argv[1] && process.argv[1].endsWith("seed.js")) {
  try {
    const { ensureDatabase } = await import("./ensureDb.js");
    await ensureDatabase();
    const force = process.argv.includes("--force");
    const seeded = await seed({ force });
    console.log(
      seeded ? "Seeded VendorBridge demo data into PostgreSQL." : "Database already contains data. Use --force to reseed.",
    );
    await prisma.$disconnect();
  } catch (error) {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  }
}
