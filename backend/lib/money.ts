/**
 * Money primitives. INTEGER PAISE ONLY (₹1 = 100 paise) — never floats.
 * No imports on purpose: this file must stay pure so it is unit-testable
 * without a database and cannot be influenced by request data.
 */
export const FREE_DELIVERY_THRESHOLD_PAISE = 20_000; // ₹200
export const STANDARD_DELIVERY_FEE_PAISE = 3_000; // ₹30
export const MAX_QUANTITY_PER_ITEM = 20;
export const MAX_DISTINCT_ITEMS_PER_ORDER = 40;

/**
 * Pure money math (integer paise only) — no I/O, so it can be unit-tested and
 * cannot be influenced by anything the client sends.
 */
export function calculateTotals(subtotalInPaise: number, discountInPaise = 0) {
  if (![subtotalInPaise, discountInPaise].every(Number.isInteger) || subtotalInPaise < 0 || discountInPaise < 0) {
    throw new PricingError("Invalid amount.");
  }
  const discount = Math.min(discountInPaise, subtotalInPaise);
  const eligibleSubtotal = subtotalInPaise - discount;
  const freeDeliveryUnlocked = eligibleSubtotal >= FREE_DELIVERY_THRESHOLD_PAISE;
  const deliveryFeeInPaise = freeDeliveryUnlocked ? 0 : STANDARD_DELIVERY_FEE_PAISE;
  return {
    discountInPaise: discount,
    deliveryFeeInPaise,
    freeDeliveryUnlocked,
    remainingForFreeDeliveryInPaise: Math.max(0, FREE_DELIVERY_THRESHOLD_PAISE - eligibleSubtotal),
    totalInPaise: eligibleSubtotal + deliveryFeeInPaise,
  };
}

export class PricingError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
