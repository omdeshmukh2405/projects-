import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { assertFound, AuthzError } from "@/lib/rbac";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

interface Params {
  params: { id: string };
}

/**
 * Explicit order state machine (see SECURITY.md #15, #54).
 * A customer may only ever trigger the CREATED/PAYMENT_PENDING -> CANCELLED
 * transition, and only while the order hasn't started being prepared. Every
 * other transition (PAID, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED,
 * REFUNDED) is set exclusively by trusted server code — the checkout route,
 * the payment webhook handler, or a STAFF/ADMIN-only endpoint — never by a
 * customer-supplied `status` field.
 */
const CUSTOMER_CANCELLABLE_STATUSES = ["CREATED", "PAYMENT_PENDING"] as const;

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    // Folding userId into the query, not checking it after the fact — see
    // lib/rbac.ts for why this distinction matters (BOLA/IDOR).
    const order = await db.order.findFirst({
      where: { id: params.id, userId: user.id },
      include: { items: { include: { product: true } }, address: true },
    });
    assertFound(order, "Order not found.");
    return Response.json({ order });
  } catch (err) {
    return handleError(err);
  }
}

/** Body: { action: "cancel" } — the only customer-triggerable transition. */
export async function PATCH(req: Request, { params }: Params) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  try {
    const user = await requireUser();
    const body = await req.json().catch(() => null);
    if (body?.action !== "cancel") {
      return jsonError(400, "Unsupported action.");
    }

    const order = await db.order.findFirst({ where: { id: params.id, userId: user.id } });
    assertFound(order, "Order not found.");

    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status as any)) {
      await logEvent({
        level: "security",
        eventType: "ORDER_CANCEL_INVALID_TRANSITION",
        userId: user.id,
        resource: `order:${order.id}`,
        result: "DENIED",
        ipAddress: clientIp(req),
        metadata: { fromStatus: order.status },
      });
      return jsonError(409, "This order can no longer be cancelled.");
    }

    const updated = await db.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });

    // TODO: if paymentStatus was already SUCCEEDED, kick off a refund via the
    // payment provider here rather than ever setting paymentStatus:REFUNDED
    // directly — refunds must be confirmed by the provider, same as payments.

    await logEvent({
      level: "info",
      eventType: "ORDER_CANCELLED",
      userId: user.id,
      resource: `order:${order.id}`,
      result: "SUCCESS",
      ipAddress: clientIp(req),
    });

    return Response.json({ order: updated });
  } catch (err) {
    return handleError(err);
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function handleError(err: unknown) {
  if (err instanceof AuthzError) return jsonError(err.status, err.message);
  // eslint-disable-next-line no-console
  console.error(err);
  return jsonError(500, "Something went wrong. Please try again.");
}
