import { z } from "zod";
import { MAX_QUANTITY_PER_ITEM } from "../money";

// Deliberately absent from every schema below: price, unitPrice, subtotal,
// discount, deliveryFee, total, freeDelivery, paymentStatus. If a client
// includes any of these keys, Zod's default behaviour (stripping unknown
// keys) silently drops them — they can never reach lib/pricing.ts.

// .strict(): a body containing price / total / deliveryFee / freeDelivery /
// paymentSuccess fails validation outright (400) instead of being silently dropped.
export const cartMutationSchema = z
  .object({
    productId: z.string().cuid(),
    quantity: z.number().int().min(0).max(MAX_QUANTITY_PER_ITEM), // 0 = remove
  })
  .strict();

export const checkoutSchema = z
  .object({
  addressId: z.string().cuid(),
  couponCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,24}$/)
    .optional()
    .nullable(),
  // Idempotency key generated client-side (e.g. crypto.randomUUID()) once per
  // checkout attempt and resent unchanged on retry — see SECURITY.md #18.
  idempotencyKey: z.string().uuid(),
  })
  .strict();

export const searchSchema = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.number().int().min(1).max(24).default(12),
});
