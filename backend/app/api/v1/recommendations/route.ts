import { z } from "zod";
import { db } from "@/lib/db";
import { getOptionalUser } from "@/lib/session";
import { priceCart } from "@/lib/pricing";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { clientIp } from "@/lib/logger";
import { toPublicProductDTO } from "../products/route";

/**
 * Implements the "Complete your sip" logic server-side: product-to-product
 * relationships (ProductRelation table) re-sorted by closeness to the
 * remaining amount needed for free delivery.
 *
 * SECURITY.md #13/#47: this endpoint is READ-ONLY and purely informational.
 * It returns product ids/names/prices for display — it never writes to the
 * cart, never returns a discount, and the checkout route independently
 * re-derives pricing regardless of what this endpoint suggested. An
 * attacker who feeds it a manipulated cart snapshot can at worst get a
 * silly recommendation, never a cheaper order.
 */
const bodySchema = z.object({
  cartProductIds: z.array(z.string().cuid()).max(40).default([]),
  limit: z.number().int().min(1).max(6).default(3),
});

export async function POST(req: Request) {
  const ip = clientIp(req);
  const user = await getOptionalUser();
  const limited = rateLimitOrResponse("search", user?.id ?? ip ?? "unknown");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ recommendations: [] });

  const { cartProductIds, limit } = parsed.data;

  if (cartProductIds.length === 0) {
    const starters = await db.product.findMany({
      where: { isAvailable: true },
      include: { category: true },
      take: limit,
    });
    return Response.json({ recommendations: starters.map(toPublicProductDTO) });
  }

  const relations = await db.productRelation.findMany({
    where: { fromId: { in: cartProductIds }, toId: { notIn: cartProductIds } },
    include: { to: { include: { category: true } } },
    orderBy: { weight: "desc" },
  });

  // De-dupe while preserving relationship-weight order
  const seen = new Set<string>();
  const candidates = relations
    .filter((r) => r.to.isAvailable && !seen.has(r.toId) && seen.add(r.toId))
    .map((r) => r.to);

  let ordered = candidates;
  if (cartProductIds.length > 0) {
    const priced = await priceCart(cartProductIds.map((id) => ({ productId: id, quantity: 1 })));
    if (priced.remainingForFreeDeliveryInPaise > 0) {
      const remaining = priced.remainingForFreeDeliveryInPaise;
      ordered = [...candidates].sort(
        (a, b) => Math.abs(a.priceInPaise - remaining) - Math.abs(b.priceInPaise - remaining),
      );
    }
  }

  return Response.json({ recommendations: ordered.slice(0, limit).map(toPublicProductDTO) });
}
