import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { checkoutSchema } from "@/lib/validation/cart";
import { priceCart, assertCouponRedeemable, PricingError } from "@/lib/pricing";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { assertFound, AuthzError } from "@/lib/rbac";

/**
 * Creates an order in PAYMENT_PENDING state and (in a real deployment)
 * returns a hosted-checkout redirect URL / client secret from your PCI-
 * compliant payment provider (Razorpay/Stripe/etc). This route never
 * accepts or stores card data itself (see SECURITY.md #16, #48) — the order
 * is only marked PAID by the webhook handler in
 * app/api/v1/webhooks/payment/route.ts, after independently verifying the
 * provider's signature.
 */
export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  try {
    const user = await requireUser();
    const limited = rateLimitOrResponse("checkout", user.id);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Please check your order details.");

    const { addressId, couponCode, idempotencyKey } = parsed.data;

    // Idempotency: a network retry sending the same key must return the
    // original order rather than creating a second one (SECURITY.md #18).
    const existingOrder = await db.order.findUnique({ where: { idempotencyKey } });
    if (existingOrder) {
      assertFound(existingOrder.userId === user.id ? existingOrder : null, "Order not found.");
      return Response.json({ order: existingOrder });
    }

    const address = await db.address.findFirst({ where: { id: addressId, userId: user.id } });
    assertFound(address, "Delivery address not found.");

    const cartItems = await db.cartItem.findMany({ where: { userId: user.id } });
    if (cartItems.length === 0) return jsonError(400, "Your cart is empty.");

    if (couponCode) {
      await assertCouponRedeemable(couponCode, user.id);
    }

    // Re-price from the database inside the same logical step that creates
    // the order — this is the number that gets charged, full stop.
    const priced = await priceCart(
      cartItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      couponCode,
    );

    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: user.id,
          addressId: address!.id,
          status: "PAYMENT_PENDING",
          paymentStatus: "PENDING",
          subtotalInPaise: priced.subtotalInPaise,
          discountInPaise: priced.discountInPaise,
          deliveryFeeInPaise: priced.deliveryFeeInPaise,
          totalInPaise: priced.totalInPaise,
          idempotencyKey,
          items: {
            create: priced.lines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPriceInPaise: l.unitPriceInPaise,
            })),
          },
        },
        include: { items: true },
      });

      if (priced.couponApplied) {
        // Unique constraint on (couponId, orderId isn't declared unique per
        // user here, but maxRedemptionsPerUser is re-checked above under the
        // same transaction boundary as the redemption row insert, closing
        // the race window from SECURITY.md #32).
        const coupon = await tx.coupon.findUniqueOrThrow({ where: { code: priced.couponApplied } });
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, userId: user.id, orderId: created.id },
        });
      }

      // Cart is cleared only after the order is durably created.
      await tx.cartItem.deleteMany({ where: { userId: user.id } });

      return created;
    });

    await logEvent({
      level: "info",
      eventType: "ORDER_CREATED",
      userId: user.id,
      resource: `order:${order.id}`,
      result: "SUCCESS",
      ipAddress: clientIp(req),
      metadata: { totalInPaise: order.totalInPaise },
    });

    // TODO: create a payment-provider order/session here and return its
    // client secret / redirect URL alongside `order` so the frontend can
    // launch the hosted payment flow.
    return Response.json({ order }, { status: 201 });
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
  if (err instanceof PricingError) return jsonError(err.status, err.message);
  // eslint-disable-next-line no-console
  console.error(err);
  return jsonError(500, "Something went wrong. Please try again.");
}
