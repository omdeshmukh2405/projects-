import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signupSchema } from "@/lib/validation/auth";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

const BCRYPT_COST = 12; // ASVS-aligned work factor; re-benchmark on target hardware

export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const ip = clientIp(req);
  const limited = rateLimitOrResponse("signup", ip ?? "unknown");
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "Please check your details and try again.");
  }
  const { name, email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    // Generic response — do not reveal that this email is already registered
    // (SECURITY.md #4, enumeration prevention).
    await logEvent({ level: "security", eventType: "SIGNUP_DUPLICATE_ATTEMPT", result: "DENIED", ipAddress: ip });
    return Response.json({
      message: "If this email isn't already registered, check your inbox to verify your account.",
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await db.user.create({
    data: { name, email, passwordHash, role: "CUSTOMER" },
  });

  // Email verification token generation / sending is intentionally out of
  // scope here — wire up your transactional email provider and reuse the
  // same single-use, short-lived, hashed-token pattern as
  // app/api/v1/auth/reset-password/route.ts.

  await logEvent({ level: "info", eventType: "SIGNUP_SUCCEEDED", userId: user.id, result: "SUCCESS", ipAddress: ip });

  return Response.json({
    message: "If this email isn't already registered, check your inbox to verify your account.",
  });
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
