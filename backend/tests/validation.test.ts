import { describe, it, expect } from "vitest";
import { cartMutationSchema, checkoutSchema } from "@/lib/validation/cart";
import { addressSchema } from "@/lib/validation/address";
import { signupSchema } from "@/lib/validation/auth";

const cuid = "ckabcdefghijklmnopqrstuvw";
const uuid = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("cart tampering is rejected before it reaches pricing", () => {
  it("accepts a normal update", () => {
    expect(cartMutationSchema.safeParse({ productId: cuid, quantity: 2 }).success).toBe(true);
  });
  it.each([
    ["price = 1", { price: 1 }],
    ["priceInPaise", { priceInPaise: 1 }],
    ["total", { total: 1 }],
    ["deliveryFee = 0", { deliveryFee: 0 }],
    ["freeDelivery = true", { freeDelivery: true }],
    ["paymentSuccess = true", { paymentSuccess: true }],
    ["discount", { discount: 100000 }],
  ])("rejects %s", (_n, extra) => {
    expect(cartMutationSchema.safeParse({ productId: cuid, quantity: 1, ...extra }).success).toBe(false);
  });
  it.each([-1, 999_999_999, 1.5, "2", null])("rejects quantity %s", (q) => {
    expect(cartMutationSchema.safeParse({ productId: cuid, quantity: q }).success).toBe(false);
  });
  it("checkout rejects client-supplied money fields", () => {
    const base = { addressId: cuid, idempotencyKey: uuid };
    expect(checkoutSchema.safeParse(base).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, total: 1 }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, freeDelivery: true }).success).toBe(false);
  });
});

describe("address validation / mass assignment", () => {
  const ok = {
    label: "Home", name: "Aarav Mehta", phone: "9876543210", line1: "B-402", line2: "Near Wakad Bridge",
    area: "Punawale", city: "Pune", state: "Maharashtra", pincode: "411033",
  };
  it("accepts a valid address", () => expect(addressSchema.safeParse(ok).success).toBe(true));
  it("rejects userId / role / id injection", () => {
    expect(addressSchema.safeParse({ ...ok, userId: "someone-else" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, role: "ADMIN" }).success).toBe(false);
  });
  it("rejects bad phone and PIN", () => {
    expect(addressSchema.safeParse({ ...ok, phone: "12345" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...ok, pincode: "0123" }).success).toBe(false);
  });
});

describe("signup", () => {
  it("enforces the password policy", () => {
    const base = { name: "A", email: "a@b.co" };
    expect(signupSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, password: "Str0ng!Passw0rd" }).success).toBe(true);
  });
});
