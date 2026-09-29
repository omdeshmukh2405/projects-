# SECURITY.md — Beverage Co.

This document describes the security architecture actually implemented in
this codebase, and what is intentionally left as an infrastructure decision
for whoever deploys it. It is not a claim that the application is "100%
secure" — see `SECURITY_AUDIT.md` for a control-by-control status table.

## 1. Architecture

```
Browser
  ↓ HTTPS (enforced by platform/HSTS in production)
  ↓ Security headers (middleware.ts)
Next.js Route Handlers (app/api/v1/**)
  ↓ Same-origin / CSRF check (lib/csrf.ts)
  ↓ Rate limiting (lib/rateLimit.ts)
  ↓ Authentication — database session (lib/session.ts, lib/auth.ts)
  ↓ Authorization — ownership + RBAC (lib/rbac.ts)
  ↓ Input validation — Zod schemas (lib/validation/**)
  ↓ Business logic — server-authoritative pricing (lib/pricing.ts)
  ↓ Prisma (parameterized queries only)
PostgreSQL
```

There is no code path from the browser directly to the database. Every
mutation goes through a route handler that authenticates, authorizes,
validates, then recalculates money server-side.

## 2. Authentication model

- Email/password via `next-auth` `CredentialsProvider`, plus optional Google
  OAuth (`lib/auth.ts`).
- Passwords hashed with **bcrypt, cost factor 12** — never stored in plain
  text, never compared with `===`.
- Password policy: 12+ characters, mixed case, number, symbol
  (`lib/validation/auth.ts`), aligned with ASVS 5.0's move away from
  short-minimum/forced-rotation policies.
- **Account lockout**: 5 failed attempts locks the account for 15 minutes
  (`User.failedLoginCount` / `lockedUntil`).
- **Enumeration resistance**: signup, login, and password-reset-request all
  return the same generic message regardless of whether the email exists,
  and login runs a bcrypt compare against a dummy hash even when the user
  doesn't exist, so response timing doesn't leak existence either.
- **Password reset**: cryptographically random 32-byte token; only its
  SHA-256 hash is stored; 15-minute expiry; single-use (`usedAt`); resetting
  a password deletes every existing session for that user.

## 3. Session model

- **Database sessions**, not JWTs (`session: { strategy: "database" }`) —
  chosen specifically so logout and password-reset can immediately revoke a
  session server-side, which a stateless JWT can't do before its own
  expiry without a separate denylist.
- Cookie: `HttpOnly`, `Secure` (production), `SameSite=Lax`, and uses the
  `__Host-` prefix in production for additional cookie-injection resistance.
- 12-hour absolute session lifetime, sliding refresh at most once per hour.
- Session tokens are never written to `localStorage`/`sessionStorage`, never
  put in a URL, and never logged (`lib/logger.ts` only logs user id + event
  type, not tokens).

## 4. Authorization model

- Roles: `CUSTOMER`, `STAFF`, `ADMIN` (`prisma/schema.prisma`).
- Deny-by-default: `requireRole()` throws unless the caller's role is
  explicitly allow-listed (`lib/rbac.ts`).
- **BOLA/IDOR protection**: every per-resource route (`addresses/[id]`,
  `orders/[id]`) folds `userId: session.user.id` directly into the Prisma
  `WHERE` clause, rather than loading by id alone and checking ownership in
  application code afterward. A missing/mismatched row returns 404, not 403,
  so existence isn't leaked.
- **Mass-assignment protection**: `pickAllowed()` strips any field not on an
  explicit allowlist before a Prisma `update()` — a client can't sneak `role`,
  `priceInPaise`, `paymentStatus`, etc. into a PATCH body.

## 5. Money & pricing (`lib/pricing.ts`)

- All amounts are integer **paise**, never floating-point rupees.
- The client may only ever send `productId` + `quantity` (+ optional
  `couponCode`). The Zod schemas in `lib/validation/cart.ts` don't declare
  `price`, `subtotal`, `discount`, `deliveryFee`, or `total` fields at all —
  Zod strips unknown keys by default, so those values can never reach
  `priceCart()` even if a client sends them.
- `priceCart()` re-reads product price from the database on every call — cart
  view, checkout, and recommendation pricing all call the same function, so
  the number shown pre-checkout is guaranteed to equal the number charged.
- Free-delivery threshold (₹200 / 20,000 paise) is a server-side constant,
  evaluated inside `priceCart()`. There is no `freeDelivery` boolean anywhere
  in a client request schema.
- Coupons are re-validated at checkout time (expiry, minimum subtotal,
  per-user and global redemption caps) inside the same DB transaction that
  creates the order, closing the double-redemption race window.

## 6. Orders

- Explicit state machine (`OrderStatus` enum). Customers may only trigger
  `CREATED/PAYMENT_PENDING → CANCELLED`; every other transition
  (`PAID`, `CONFIRMED`, …, `DELIVERED`) is set by trusted server code only
  (checkout route, payment webhook, or a STAFF/ADMIN route) — never by a
  customer-supplied `status` field.
- Checkout is transactional (`db.$transaction`) and idempotent: a client
  generates a UUID `idempotencyKey` once per checkout attempt; retrying with
  the same key returns the original order instead of creating a duplicate.

## 7. Payments

- No card data, CVV, UPI PIN, or bank credentials ever touch this codebase —
  integrate a PCI-compliant, tokenized/hosted payment flow (Razorpay/Stripe/
  etc.) and only store the provider's opaque reference.
- `paymentSuccess: true` sent from a browser is never trusted anywhere in
  this codebase. Only `app/api/v1/webhooks/payment/route.ts` can move an
  order to `PAID`, and only after verifying an HMAC signature with
  `crypto.timingSafeEqual` (constant-time comparison).
- Webhook processing is idempotent via a `WebhookEvent` table keyed by the
  provider's event id — a duplicate delivery is detected via a unique-
  constraint violation and treated as a no-op success, never reprocessed.
- The webhook also re-validates the claimed payment amount against the
  order's own stored total before marking it paid.

## 8. Input validation

- Every mutating route validates its body with a Zod schema
  (`lib/validation/*.ts`) before touching the database. Unknown/unexpected
  fields are dropped by default rather than passed through.
- Search queries are length-bounded (max 80 chars) and passed to Prisma's
  parameterized `contains` filter — no raw SQL string concatenation exists
  anywhere in this codebase.

## 9. Rate limiting (`lib/rateLimit.ts`)

Layered limits per SECURITY.md's source brief — strict on
login/signup/password-reset/checkout, looser on browsing/search. **Ships as
an in-memory limiter** so the project runs without extra infrastructure; the
file has an explicit `IMPORTANT` comment that this under-counts across
multiple server instances and must be swapped for a shared store (Redis /
Upstash) before a multi-instance production deployment. See
`SECURITY_AUDIT.md`.

## 10. CSRF

- `SameSite=Lax` session cookie as the primary defense.
- `assertSameOrigin()` (`lib/csrf.ts`) as defense-in-depth on every mutating
  route: rejects any POST/PUT/PATCH/DELETE whose `Origin` header isn't in
  the `APP_ORIGIN` allowlist.

## 11. XSS

- No component in this backend renders unsanitized HTML from user input;
  there is no `dangerouslySetInnerHTML` usage in this codebase. If a rich-
  text field (e.g. product descriptions from an admin CMS) is added later,
  sanitize with a maintained library (e.g. `sanitize-html`) before render.

## 12. Security headers & CSP

Set globally in `middleware.ts`: a restrictive `Content-Security-Policy`
(no `unsafe-inline`/`unsafe-eval` for scripts, `frame-ancestors 'none'`),
`Strict-Transport-Security` (production only), `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`.

## 13. Logging & audit trail

- `lib/logger.ts` writes a structured JSON line to stdout **and** an
  `AuditLog` database row for every security-relevant event (login success/
  failure, signup, password reset, address changes, order creation/
  cancellation, admin actions, webhook failures).
- Never logs passwords, tokens, session ids, or payment credentials —
  callers pass only `userId`, `eventType`, `resource`, `result`, and
  non-sensitive `metadata`.

## 14. What is explicitly NOT implemented here (infrastructure decisions)

These require deployment-specific choices this codebase can't make for you —
tracked honestly in `SECURITY_AUDIT.md` rather than glossed over:

- Shared/distributed rate-limit store for multi-instance deployments.
- Actual payment-provider SDK integration (webhook handler is written
  against a generic HMAC-signed payload shape; swap in your provider's
  official verifier).
- Transactional email sending for verification/reset links (the token
  generation and validation logic is complete; wiring an email provider is
  left to you, alongside `EMAIL_PROVIDER_API_KEY` in `.env.example`).
- MFA / step-up re-authentication for ADMIN sessions.
- WAF / DDoS-layer protection (belongs at your CDN/platform, not app code).
- Automated dependency/secret scanning in CI (see `SECURITY_AUDIT.md` #56
  for the recommended pipeline; no CI config is included here since none was
  requested).
- Encrypted-at-rest configuration for the database (a platform/managed-DB
  setting, not application code).

## 15. Incident response (starting point)

If credentials, the webhook secret, or the database are suspected
compromised:

1. **Contain**: rotate the affected secret immediately (`NEXTAUTH_SECRET`,
   `PAYMENT_WEBHOOK_SECRET`, or DB credentials) — rotating `NEXTAUTH_SECRET`
   invalidates all existing sessions.
2. **Revoke**: for a suspected account compromise, `db.session.deleteMany`
   for that user and force a password reset.
3. **Investigate**: query `AuditLog` for the affected user/resource/time
   window.
4. **Recover**: restore from the most recent verified-good backup if data
   integrity is in question.
5. **Review**: document root cause and add a regression test under
   `lib/validation` or the relevant route before closing the incident.
