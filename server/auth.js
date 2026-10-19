import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma, publicUser } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";
export const COOKIE_NAME = "vb_token";
export const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET is not set. Refusing to use the development fallback in production.");
  process.exit(1);
}

export class ApiError extends Error {
  constructor(status, message, { code = "request_failed", fields = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

export function readToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.[COOKIE_NAME] || null;
}

export async function authenticateOptional(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    // A missing, expired or malformed token is anonymous; database failures
    // below are different and must reach the API error handler.
    return next();
  }

  try {
    req.authPayload = payload;
    const user = await prisma.user.findUnique({ where: { id: Number(payload.sub) } });
    if (user) {
      req.user = publicUser(user);
      req.userRow = user;
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(new ApiError(401, "You need to sign in to continue.", { code: "unauthenticated" }));
  }
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "You need to sign in to continue.", { code: "unauthenticated" }));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new ApiError(403, "Your role does not have permission to perform this action.", {
          code: "forbidden",
        }),
      );
    }
    next();
  };
}

export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    if (!fields[key]) fields[key] = issue.message;
  }
  throw new ApiError(422, "Please check the highlighted fields and try again.", {
    code: "validation_failed",
    fields,
  });
}

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Za-z]/, "Password must include a letter.")
  .regex(/[0-9]/, "Password must include a number.");

export const ROLE_LABELS = {
  admin: "Admin",
  procurement: "Procurement Officer",
  manager: "Manager/Approver",
  vendor: "Vendor",
};

export async function currentVendorFor(user) {
  if (!user) return null;
  return prisma.vendor.findFirst({ where: { userId: user.id } });
}

export function newResetToken() {
  return crypto.randomBytes(32).toString("hex");
}
