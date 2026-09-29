import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { passwordResetConfirmSchema } from "@/lib/validation/auth";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const ip = clientIp(req);
  const limited = rateLimitOrResponse("passwordResetConfirm", ip ?? "unknown");
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = passwordResetConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "This reset link is invalid or has expired.");
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });

  // Same error for "doesn't exist", "expired" and "already used" — no signal
  // about which case it is (SECURITY.md #4).
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    await logEvent({ level: "security", eventType: "PASSWORD_RESET_TOKEN_INVALID", result: "DENIED", ipAddress: ip });
    return jsonError(400, "This reset link is invalid or has expired.");
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);

  await db.$transaction([
    db.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    }),
    db.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Password change invalidates every existing session — SECURITY.md #6 /
    // #53. A stolen session cookie stops working the moment the real owner
    // resets their password.
    db.session.deleteMany({ where: { userId: record.userId } }),
  ]);

  await logEvent({
    level: "security",
    eventType: "PASSWORD_RESET_COMPLETED",
    userId: record.userId,
    result: "SUCCESS",
    ipAddress: ip,
  });

  return Response.json({ message: "Your password has been reset. Please log in again." });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
