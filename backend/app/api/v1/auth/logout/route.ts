import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * NextAuth's built-in /api/v1/auth/signout already clears the cookie; this
 * route additionally guarantees the server-side Session row is deleted
 * (not just expired-out) so a captured cookie value is immediately useless
 * (see SECURITY.md #6).
 */
export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  const session = await getServerSession(authOptions);
  if (session?.user) {
    await db.session.deleteMany({ where: { userId: (session.user as any).id } });
    await logEvent({
      level: "info",
      eventType: "LOGOUT",
      userId: (session.user as any).id,
      result: "SUCCESS",
      ipAddress: clientIp(req),
    });
  }
  return Response.json({ message: "Logged out." });
}
