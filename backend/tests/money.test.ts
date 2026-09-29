import { describe, it, expect } from "vitest";
import { calculateTotals, FREE_DELIVERY_THRESHOLD_PAISE, STANDARD_DELIVERY_FEE_PAISE } from "@/lib/money";

describe("server-side free delivery (₹200 = 20000 paise)", () => {
  it("charges delivery just below the threshold", () => {
    const t = calculateTotals(19_999);
    expect(t.freeDeliveryUnlocked).toBe(false);
    expect(t.deliveryFeeInPaise).toBe(STANDARD_DELIVERY_FEE_PAISE);
    expect(t.remainingForFreeDeliveryInPaise).toBe(1);
  });
  it("is free at exactly the threshold and above", () => {
    expect(calculateTotals(FREE_DELIVERY_THRESHOLD_PAISE).deliveryFeeInPaise).toBe(0);
    expect(calculateTotals(25_000).freeDeliveryUnlocked).toBe(true);
  });
  it("Cold Coffee ₹160 leaves ₹40 to go", () => {
    const t = calculateTotals(16_000);
    expect(t.remainingForFreeDeliveryInPaise).toBe(4_000);
    expect(t.totalInPaise).toBe(16_000 + STANDARD_DELIVERY_FEE_PAISE);
  });
  it("uses the discounted subtotal for eligibility", () => {
    expect(calculateTotals(21_000, 2_000).freeDeliveryUnlocked).toBe(false);
  });
  it("never lets a discount exceed the subtotal (no negative totals)", () => {
    expect(calculateTotals(5_000, 999_999).totalInPaise).toBe(STANDARD_DELIVERY_FEE_PAISE);
  });
  it("rejects floats and negatives (no floating-point currency)", () => {
    expect(() => calculateTotals(160.5)).toThrow();
    expect(() => calculateTotals(-1)).toThrow();
    expect(() => calculateTotals(100, -5)).toThrow();
  });
});
