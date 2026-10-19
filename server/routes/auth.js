import { Router } from "express";
import { z } from "zod";
import {
  ApiError,
  COOKIE_MAX_AGE,
  clearSessionCookie,
  currentVendorFor,
  emailSchema,
  hashPassword,
  newResetToken,
  parse,
  passwordSchema,
  requireAuth,
  setSessionCookie,
  signToken,
  verifyPassword,
} from "../auth.js";
import { displayName, nextSequence, now, prisma, publicUser } from "../db.js";
import { sendPasswordResetEmail } from "../email.js";
import { createAuthLimiter } from "../rateLimit.js";
import { PERMISSIONS, roleLabel, vendorOut } from "../serializers.js";

const router = Router();

function resetAppOrigin(req) {
  const configuredOrigins = (process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const candidate =
    process.env.NODE_ENV === "production"
      ? configuredOrigins[0]
      : req.get("origin") || configuredOrigins[0] || "http://localhost:5173";

  if (!candidate) {
    throw new Error("CLIENT_ORIGIN must be configured in production to create password reset links.");
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("CLIENT_ORIGIN must be a valid absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("CLIENT_ORIGIN must use HTTP or HTTPS.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (parsed.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  ) {
    throw new Error("CLIENT_ORIGIN must be a public HTTPS app URL in production.");
  }
  return parsed.origin;
}

// Persistent rate limiting (Redis when REDIS_URL is set, otherwise the
// database) instead of an in-memory Map — counters survive restarts and are
// shared across Node.js instances.
const loginLimiter = await createAuthLimiter({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  prefix: "vb:rl:login:",
});

const forgotPasswordLimiter = await createAuthLimiter({
  // Allow 50 attempts in development so testing never hits the ceiling.
  // In production a real environment variable will override NODE_ENV.
  limit: process.env.NODE_ENV === "production" ? 5 : 50,
  windowMs: 15 * 60 * 1000,
  prefix: "vb:rl:forgot:",
  skipSuccessfulRequests: false,
  message: {
    error: {
      message: "Too many password reset requests. Please wait a few minutes and try again.",
      code: "rate_limited",
    },
  },
});

const registerSchema = z.object({
  firstName: z.string().trim().min(2, "Enter your first name."),
  lastName: z.string().trim().min(2, "Enter your last name."),
  email: emailSchema,
  phone: z.string().trim().min(7, "Enter a valid phone number.").max(24, "Phone number is too long."),
  // Role is intentionally omitted from the public schema; extra client-supplied
  // role fields are stripped and every public registration becomes a vendor.
  country: z.string().trim().min(2, "Enter your country."),
  additionalInfo: z.string().trim().max(500).optional().default(""),
  password: passwordSchema,
  companyName: z.string().trim().max(120).optional().default(""),
  category: z.string().trim().max(80).optional().default(""),
});

router.post("/register", async (req, res) => {
  const data = parse(registerSchema, req.body);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new ApiError(409, "An account with that email already exists.", {
      code: "email_taken",
      fields: { email: "This email is already registered." },
    });
  }
  if (!data.companyName) {
    throw new ApiError(422, "Please add your company name.", {
      code: "validation_failed",
      fields: { companyName: "Company name is required for vendor accounts." },
    });
  }

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        country: data.country,
        role: "vendor",
        additionalInfo: data.additionalInfo || null,
        passwordHash: hashPassword(data.password),
        createdAt: now(),
      },
    });

    const seq = await nextSequence("VND", tx);
    await tx.vendor.create({
      data: {
        code: `VND-${String(seq).padStart(3, "0")}`,
        name: data.companyName,
        category: data.category || "General",
        email: data.email,
        phone: data.phone,
        country: data.country,
        contactName: displayName(user),
        status: "Pending",
        rating: 0,
        notes: "Self-registered vendor account — awaiting verification.",
        userId: user.id,
        createdAt: now(),
        updatedAt: now(),
      },
    });

    return user;
  });

  const token = signToken(created);
  setSessionCookie(res, token);
  res.status(201).json({ expiresIn: COOKIE_MAX_AGE, ...(await sessionPayload(created)) });
});

async function sessionPayload(userRow) {
  const vendorRow = await currentVendorFor({ id: userRow.id });
  return {
    user: publicUser(userRow),
    vendor: vendorOut(vendorRow, { includeInternalNotes: userRow.role !== "vendor" }),
    permissions: PERMISSIONS[userRow.role],
    roleLabel: roleLabel(userRow.role),
  };
}

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

router.post("/login", loginLimiter, async (req, res) => {
  const data = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user || !verifyPassword(data.password, user.passwordHash)) {
    throw new ApiError(401, "Incorrect email or password.", { code: "invalid_credentials" });
  }
  const token = signToken(user);
  setSessionCookie(res, token);
  res.json({ expiresIn: COOKIE_MAX_AGE, ...(await sessionPayload(user)) });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) {
    throw new ApiError(401, "Your session is no longer valid. Please sign in again.", {
      code: "unauthenticated",
    });
  }
  res.json(await sessionPayload(user));
});

const forgotSchema = z.object({ email: emailSchema });

router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
  const { email } = parse(forgotSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const generic = {
    message: "If that email is registered, a password reset link has been sent.",
  };
  if (!user) {
    res.json(generic);
    return;
  }
  const token = newResetToken();
  await prisma.$transaction([
    prisma.passwordReset.updateMany({ where: { userId: user.id, used: 0 }, data: { used: 1 } }),
    prisma.passwordReset.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        used: 0,
        createdAt: now(),
      },
    }),
  ]);

  // Deliver the reset link by email (Resend in production, local mail outbox
  // during development). The token is never returned in the response body.
  try {
    const appUrl = resetAppOrigin(req);
    const resetUrl = `${appUrl}/reset-password?token=${token}`;
    await sendPasswordResetEmail({ to: user.email, name: displayName(user), resetUrl });
  } catch (error) {
    // Never leak delivery state (or the token) through the API — log and keep
    // the response indistinguishable from the unknown-email case.
    console.error("[api] failed to dispatch password reset email", error);
  }
  res.json(generic);
});

// Development helper: enables browser users to receive/click the reset link
// without requiring an active third-party transactional email service.
//
// This endpoint hands out a live reset token to any caller who knows an email
// address, so it is opt-in: it stays not-found unless ALLOW_DEV_RESET_LINK is
// explicitly "true" *and* the process is not running in production.
const devResetLinkEnabled =
  process.env.NODE_ENV !== "production" && process.env.ALLOW_DEV_RESET_LINK === "true";

// Lets the sign-in UI decide whether to render its local-development helpers.
router.get("/capabilities", (_req, res) => {
  res.json({ devResetLink: devResetLinkEnabled });
});

router.get("/dev-reset-link", async (req, res) => {
  if (!devResetLinkEnabled) {
    throw new ApiError(404, "API route not found.", { code: "not_found" });
  }

  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Email query param is required." });
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }
  const record = await prisma.passwordReset.findFirst({
    where: {
      userId: user.id,
      used: 0,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!record) {
    return res.status(404).json({ error: "No active reset token for this user." });
  }

  const appUrl = resetAppOrigin(req);
  const resetUrl = `${appUrl}/reset-password?token=${record.token}`;
  res.json({ token: record.token, resetUrl, email: user.email });
});

const resetSchema = z.object({
  token: z.string().min(10, "Reset link is invalid."),
  password: passwordSchema,
});

router.post("/reset-password", async (req, res) => {
  const { token, password } = parse(resetSchema, req.body);
  const record = await prisma.passwordReset.findUnique({ where: { token } });
  if (!record || record.used || record.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.", {
      code: "invalid_reset_token",
    });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: hashPassword(password) } }),
    prisma.passwordReset.update({ where: { token }, data: { used: 1 } }),
  ]);
  res.json({ message: "Password updated. You can sign in with your new password." });
});

export default router;
