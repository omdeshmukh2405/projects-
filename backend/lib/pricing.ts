import { db } from "./db";
import {
  FREE_DELIVERY_THRESHOLD_PAISE, STANDARD_DELIVERY_FEE_PAISE, MAX_QUANTITY_PER_ITEM,
  MAX_DISTINCT_ITEMS_PER_ORDER, calculateTotals, PricingError,
} from "./money";
export { FREE_DELIVERY_THRESHOLD_PAISE, STANDARD_DELIVERY_FEE_PAISE, MAX_QUANTITY_PER_ITEM, MAX_DISTINCT_ITEMS_PER_ORDER, calculateTotals, PricingError };

/**
 * SERVER-AUTHORITATIVE PRICING (see SECURITY.md #10, #12, #14).
 *
 * This is the single place in the codebase allowed to decide what an order
 * costs. Every amount here is an integer number of paise (1 rupee = 100
 * paise) to avoid floating-point rounding bugs — never switch these back to
 * JS `number` rupees with decimals.
 *
 * Callers (checkout route, cart summary route) pass only:
 *   - productId + quantity pairs
 *   - an optional coupon code
 *   - the selected addressId (for future delivery-zone pricing)
 *
 * They must NEVER pass price, subtotal, discount or deliveryFee — if a
 * request body contains any of those keys, the validation schema in
 * lib/validation/cart.ts rejects the request before it reaches here.
 */

export interface PricedLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceInPaise: number;
  lineTotalInPaise: number;
}

export interface PricedCart {
  lines: PricedLine[];
  subtotalInPaise: number;
  discountInPaise: number;
  deliveryFeeInPaise: number;
  totalInPaise: number;
  freeDeliveryUnlocked: boolean;
  remainingForFreeDeliveryInPaise: number;
  couponApplied: string | null;
}

interface RequestedLine {
  productId: string;
  quantity: number;
}

/**
 * Re-derives the full price of a cart from the database. This is called by
 * both the "view cart summary" endpoint (read-only) and the checkout
 * endpoint (which then persists the result) so the number the customer sees
 * before paying is guaranteed to be the number they're charged.
 */
export async function priceCart(requestedLines: RequestedLine[], couponCode?: string | null): Promise<PricedCart> {
  if (requestedLines.length === 0) {
    throw new PricingError("Cart is empty.");
  }
  if (requestedLines.length > MAX_DISTINCT_ITEMS_PER_ORDER) {
    throw new PricingError("Too many distinct items in one order.");
  }

  const dedup = new Map<string, number>();
  for (const line of requestedLines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new PricingError(`Invalid quantity for product ${line.productId}.`);
    }
    if (line.quantity > MAX_QUANTITY_PER_ITEM) {
      throw new PricingError(`Quantity too high for product ${line.productId}.`);
    }
    dedup.set(line.productId, (dedup.get(line.productId) ?? 0) + line.quantity);
  }

  const productIds = [...dedup.keys()];
  const products = await db.product.findMany({ where: { id: { in: productIds } } });

  if (products.length !== productIds.length) {
    throw new PricingError("One or more products no longer exist.");
  }
  const unavailable = products.filter((p) => !p.isAvailable);
  if (unavailable.length > 0) {
    throw new PricingError(`Currently unavailable: ${unavailable.map((p) => p.name).join(", ")}`);
  }

  const lines: PricedLine[] = products.map((p) => {
    const quantity = dedup.get(p.id)!;
    return {
      productId: p.id,
      name: p.name,
      quantity,
      unitPriceInPaise: p.priceInPaise, // ALWAYS from the DB row, never from the request
      lineTotalInPaise: p.priceInPaise * quantity,
    };
  });

  const subtotalInPaise = lines.reduce((sum, l) => sum + l.lineTotalInPaise, 0);

  const { discountInPaise, couponApplied } = await applyCoupon(couponCode ?? null, subtotalInPaise);

  const totals = calculateTotals(subtotalInPaise, discountInPaise);

  return {
    lines,
    subtotalInPaise,
    ...totals,
    couponApplied,
  };
}

/**
 * Coupon validation lives here (not in the client) — see SECURITY.md #55.
 * Every rule (expiry, min subtotal, per-user redemption cap) is re-checked
 * server-side at checkout time, not just when the coupon was first "applied"
 * in the UI, to close the race-condition window described in SECURITY.md #32.
 */
async function applyCoupon(
  code: string | null,
  subtotalInPaise: number,
): Promise<{ discountInPaise: number; couponApplied: string | null }> {
  if (!code) return { discountInPaise: 0, couponApplied: null };

  const coupon = await db.coupon.findUnique({ where: { code: code.toUpperCase() } });
  if (!coupon || !coupon.isActive) throw new PricingError("Invalid coupon code.");
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new PricingError("This coupon has expired.");
  if (subtotalInPaise < coupon.minSubtotalInPaise) {
    throw new PricingError(`This coupon needs a minimum order of ₹${coupon.minSubtotalInPaise / 100}.`);
  }

  let discount = 0;
  if (coupon.percentOff) discount = Math.floor((subtotalInPaise * coupon.percentOff) / 100);
  if (coupon.flatOffInPaise) discount = Math.max(discount, coupon.flatOffInPaise);

  // Never allow a discount to exceed the subtotal (negative-total protection,
  // SECURITY.md #11 / #55).
  discount = Math.min(discount, subtotalInPaise);

  return { discountInPaise: discount, couponApplied: coupon.code };
}

/**
 * Per-user + global redemption caps, enforced inside the same DB transaction
 * as order creation in app/api/v1/checkout/route.ts so two concurrent
 * checkouts can't both redeem the last use of a limited coupon
 * (see SECURITY.md #31, Transactional Integrity).
 */
export async function assertCouponRedeemable(couponCode: string, userId: string) {
  const coupon = await db.coupon.findUnique({
    where: { code: couponCode.toUpperCase() },
    include: { redemptions: { where: { userId } } },
  });
  if (!coupon) throw new PricingError("Invalid coupon code.");

  if (coupon.redemptions.length >= coupon.maxRedemptionsPerUser) {
    throw new PricingError("You've already used this coupon.");
  }
  if (coupon.maxRedemptions != null) {
    const totalRedemptions = await db.couponRedemption.count({ where: { couponId: coupon.id } });
    if (totalRedemptions >= coupon.maxRedemptions) {
      throw new PricingError("This coupon has reached its redemption limit.");
    }
  }
}
