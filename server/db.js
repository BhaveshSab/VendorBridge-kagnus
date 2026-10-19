import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..");

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export function now() {
  return new Date();
}

export async function nextSequence(name, client = prisma) {
  const counter = await client.counter.upsert({
    where: { name },
    create: { name, value: 1 },
    update: { value: { increment: 1 } },
  });
  return counter.value;
}

export function displayName(user) {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    name: displayName(user),
    email: user.email,
    phone: user.phone,
    country: user.country,
    role: user.role,
    additionalInfo: user.additionalInfo,
    createdAt: user.createdAt.toISOString(),
  };
}
