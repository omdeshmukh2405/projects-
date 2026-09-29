import crypto from "node:crypto";
import { db } from "@/lib/db";
import { passwordResetRequestSchema } from "@/lib/validation/auth";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

const TOKEN_TTL_MINUTES = 15;

// Generic message returned regardless of whether the email exists, per
// SECURITY.md #4 ("never expose whether an email exists").
const GENERIC_MESSAGE = "If an account exists for that email, we've sent password reset instructions.";

export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const ip = clientIp(req);
  const limited = rateLimitOrResponse("passwordResetRequest", ip ?? "unknown");
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    // Still return the generic message — don't leak validation details for
    // an unauthenticated, potentially-enumerating endpoint.
    return Response.json({ message: GENERIC_MESSAGE });
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    // Raw token goes to the user's email; only its hash is persisted, so a
    // database leak alone can't be used to reset passwords
    // (see SECURITY.md #4, #40).
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
      },
    });

    // TODO: send `rawToken` via your transactional email provider as a link
    // to /reset-password/confirm?token=... — never log or return it here.

    await logEvent({
      level: "info",
      eventType: "PASSWORD_RESET_REQUESTED",
      userId: user.id,
      result: "SUCCESS",
      ipAddress: ip,
    });
  } else {
    await logEvent({
      level: "security",
      eventType: "PASSWORD_RESET_REQUESTED_UNKNOWN_EMAIL",
      result: "DENIED",
      ipAddress: ip,
    });
  }

  return Response.json({ message: GENERIC_MESSAGE });
}
