import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { cartMutationSchema } from "@/lib/validation/cart";
import { priceCart, PricingError } from "@/lib/pricing";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { AuthzError } from "@/lib/rbac";

/**
 * GET returns the server-computed cart summary — subtotal, delivery fee,
 * free-delivery progress, total — entirely derived from `lib/pricing.ts`.
 * The frontend renders this response directly rather than doing its own
 * arithmetic, so what the customer sees always matches what checkout will
 * charge (see SECURITY.md #10, #46).
 */
export async function GET() {
  try {
    const user = await requireUser();
    const items = await db.cartItem.findMany({ where: { userId: user.id } });
    if (items.length === 0) {
      return Response.json({
        lines: [],
        subtotalInPaise: 0,
        discountInPaise: 0,
        deliveryFeeInPaise: 0,
        totalInPaise: 0,
        freeDeliveryUnlocked: false,
        remainingForFreeDeliveryInPaise: 20_000,
      });
    }
    const priced = await priceCart(items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
    return Response.json(priced);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST sets the quantity of a single product in the caller's cart.
 * Body: { productId, quantity } — quantity 0 removes the line.
 * There is no `price` field in the accepted schema; see
 * lib/validation/cart.ts for why that's a security property, not an oversight.
 */
export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  try {
    const user = await requireUser();
    const limited = rateLimitOrResponse("cartMutation", user.id);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const parsed = cartMutationSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Invalid cart update.");

    const product = await db.product.findUnique({ where: { id: parsed.data.productId } });
    if (!product || !product.isAvailable) return jsonError(404, "Product not found.");

    if (parsed.data.quantity === 0) {
      await db.cartItem.deleteMany({ where: { userId: user.id, productId: parsed.data.productId } });
    } else {
      await db.cartItem.upsert({
        where: { userId_productId: { userId: user.id, productId: parsed.data.productId } },
        update: { quantity: parsed.data.quantity },
        create: { userId: user.id, productId: parsed.data.productId, quantity: parsed.data.quantity },
      });
    }

    const items = await db.cartItem.findMany({ where: { userId: user.id } });
    const priced = items.length
      ? await priceCart(items.map((i) => ({ productId: i.productId, quantity: i.quantity })))
      : null;

    return Response.json({ cart: priced });
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
