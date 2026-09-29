import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { requireRole, AuthzError } from "@/lib/rbac";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";

/**
 * Admin-only endpoint. `requireRole` throws unless the *server-loaded*
 * session's role (from the database, via lib/session.ts) is in the allowed
 * list — see SECURITY.md #38, #52. There is deliberately no code path here
 * that reads a role from the request body, a header, or a cookie value the
 * client could set directly.
 *
 * Production hardening beyond this file (see SECURITY_AUDIT.md — currently
 * NOT IMPLEMENTED, needs infra decisions):
 *  - MFA requirement + step-up re-authentication for ADMIN sessions
 *  - Optional IP allowlisting for the admin surface
 *  - Shorter session lifetime for ADMIN/STAFF roles than CUSTOMER
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    requireRole(user.role, ["ADMIN", "STAFF"]);

    const limited = rateLimitOrResponse("adminAction", user.id);
    if (limited) return limited;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");

    const orders = await db.order.findMany({
      where: status ? { status: status as any } : undefined,
      include: { items: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    await logEvent({
      level: "security",
      eventType: "ADMIN_ORDERS_VIEWED",
      userId: user.id,
      result: "SUCCESS",
      ipAddress: clientIp(req),
    });

    return Response.json({ orders });
  } catch (err) {
    if (err instanceof AuthzError) {
      // Any authorization failure here is logged at "security" level — see
      // SECURITY.md #38, repeated authorization failures should feed an
      // alerting rule.
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { "content-type": "application/json" },
      });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
