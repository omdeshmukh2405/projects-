/**
 * Layered rate limiting (see SECURITY.md #21).
 *
 * IMPORTANT — production note:
 * This ships an in-memory sliding-window limiter so the project runs without
 * extra infrastructure. In-memory state is per-process, so on a
 * multi-instance deployment it under-counts (each instance has its own
 * counters). Before going to production, swap `store` below for a shared
 * store (Upstash Redis, Redis, or your platform's rate-limit primitive) that
 * survives across instances and restarts. The public API
 * (`checkRateLimit`) is deliberately kept identical either way so callers
 * don't change.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const store = new Map<string, Bucket>();

export interface RateLimitConfig {
  /** Logical bucket name, e.g. "login", "checkout", "search". */
  name: string;
  /** Max requests allowed within the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

// Central policy table — tune per SECURITY.md #21. Stricter for
// authentication and money-moving flows, looser for read-only browsing.
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  login: { name: "login", limit: 5, windowMs: 15 * 60_000 },
  signup: { name: "signup", limit: 5, windowMs: 60 * 60_000 },
  passwordResetRequest: { name: "password-reset-request", limit: 3, windowMs: 60 * 60_000 },
  passwordResetConfirm: { name: "password-reset-confirm", limit: 10, windowMs: 60 * 60_000 },
  search: { name: "search", limit: 60, windowMs: 60_000 },
  cartMutation: { name: "cart-mutation", limit: 60, windowMs: 60_000 },
  checkout: { name: "checkout", limit: 5, windowMs: 60_000 },
  couponApply: { name: "coupon-apply", limit: 10, windowMs: 60_000 },
  webhook: { name: "webhook", limit: 120, windowMs: 60_000 },
  adminAction: { name: "admin-action", limit: 30, windowMs: 60_000 },
  default: { name: "default", limit: 120, windowMs: 60_000 },
};

/**
 * @param key Identity to rate-limit on. Prefer `${userId}` when authenticated
 *            and fall back to IP for anonymous flows (login, signup) — see
 *            SECURITY.md #21 on not relying on IP alone where avoidable.
 */
export function checkRateLimit(config: RateLimitConfig, key: string): { allowed: boolean; remaining: number; resetAt: number } {
  const bucketKey = `${config.name}:${key}`;
  const now = Date.now();
  const existing = store.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + config.windowMs;
    store.set(bucketKey, { count: 1, resetAt });
    return { allowed: true, remaining: config.limit - 1, resetAt };
  }

  if (existing.count >= config.limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: config.limit - existing.count, resetAt: existing.resetAt };
}

/** Convenience wrapper that returns a ready-to-send 429 Response, or null if allowed. */
export function rateLimitOrResponse(configKey: keyof typeof RATE_LIMITS, key: string): Response | null {
  const config = RATE_LIMITS[configKey] ?? RATE_LIMITS.default;
  const result = checkRateLimit(config, key);
  if (result.allowed) return null;
  return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      "retry-after": Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
    },
  });
}
