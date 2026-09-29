# Beverage Co. — Backend

A Next.js + Prisma + PostgreSQL backend implementing the security
architecture requested for Beverage Co.: authenticated accounts, addresses,
cart, checkout, orders, coupons, and a payment webhook — all with
server-authoritative pricing and the ₹200 free-delivery rule enforced only
server-side.

This is a **backend/API codebase**, not the visual site. The visual
storefront (Beverage Co.'s HTML/CSS/JS frontend prototype) is a separate
artifact; wire it up to these endpoints by replacing its client-side cart
math with calls to `/api/v1/cart`, `/api/v1/checkout`, etc.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL, NEXTAUTH_SECRET, etc.
npx prisma migrate dev       # creates tables from prisma/schema.prisma
npm run dev
```

Generate a `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

## Project layout

```
prisma/schema.prisma          Data model (users, sessions, products, orders, ...)
lib/
  db.ts                       Prisma client singleton
  auth.ts                     NextAuth config (credentials + Google OAuth)
  session.ts                  requireUser() / getOptionalUser() helpers
  rbac.ts                     Role checks, ownership assertions, mass-assignment guard
  pricing.ts                  Server-authoritative cart/order pricing — read this first
  rateLimit.ts                Layered rate limiting policy table
  csrf.ts                     Same-origin check for mutating routes
  logger.ts                   Structured + audit-trail logging
  validation/                 Zod schemas — the only shape of data routes accept
app/api/v1/
  auth/                       signup, login (NextAuth), logout, password reset
  addresses/                  CRUD, ownership-scoped
  cart/                       server-priced cart view + mutation
  checkout/                   transactional, idempotent order creation
  orders/                     list, detail, customer cancellation
  products/, search/          public read endpoints
  recommendations/            "Complete your sip" — informational only, never touches price
  webhooks/payment/           signature-verified, idempotent payment confirmation
  admin/orders/               STAFF/ADMIN-only
middleware.ts                 Security headers + CSP for every response
SECURITY.md                   What's implemented and why, in plain language
SECURITY_AUDIT.md             Control-by-control PASS/PARTIAL/NOT IMPLEMENTED table
```

## Before you deploy

Read `SECURITY_AUDIT.md`'s PARTIAL and NOT IMPLEMENTED rows first — each has
a specific next step (shared rate-limit store, a real payment provider SDK,
a least-privilege DB role, CI security scanning). None of them are silently
skipped; they're infrastructure decisions this codebase can't make for you.

## Connecting a real payment provider

`app/api/v1/checkout/route.ts` and `app/api/v1/webhooks/payment/route.ts`
are written against a generic signed-webhook shape. Before going live:

1. Pick a PCI-compliant provider (Razorpay, Stripe, etc.) and use its hosted
   checkout / tokenized payment flow — never collect card data in this app.
2. In `checkout/route.ts`, create the provider's payment session/order after
   this codebase's own `Order` row is created, and return its redirect URL
   or client secret to the frontend.
3. In `webhooks/payment/route.ts`, swap `verifySignature()` for the
   provider's official SDK verifier (e.g. `stripe.webhooks.constructEvent`)
   rather than trusting the generic HMAC check as final.

## Running the tests

```bash
npm install
npm test          # vitest: pricing, free-delivery, tampering, address/auth validation
```

`tests/money.test.ts` covers the ₹200 boundary (19999 vs 20000 paise), the
"Cold Coffee ₹160 → ₹40 to go" case, discount clamping and rejection of
floats/negatives. `tests/validation.test.ts` proves that `price`, `total`,
`deliveryFee`, `freeDelivery`, `paymentSuccess`, `discount`, negative or huge
quantities, and injected `userId`/`role` fields are all rejected by the schemas
before they can reach pricing or the database.

**Not yet written** (need a running Postgres and are listed as gaps in
`SECURITY_AUDIT.md`): integration tests for BOLA/IDOR across two real users,
concurrent-checkout races, webhook replay, and rate-limit behaviour.

## Database & migrations

```bash
cp .env.example .env.local      # set DATABASE_URL
npx prisma migrate dev --name init   # generates + applies SQL migrations from schema.prisma
```

No migration SQL is committed: generate it with the command above against your
own database so it matches your Prisma version. The `Address` model now holds
name, phone, house/flat (`line1`), street (`line2`), area, city, state, PIN and
an optional landmark.

## How ₹200 free delivery works

`lib/money.ts` holds `FREE_DELIVERY_THRESHOLD_PAISE = 20000` and the pure
`calculateTotals()` function. `lib/pricing.ts` loads real prices from the
database, sums them, applies any validated coupon, then calls `calculateTotals()`.
The browser only ever sends `productId` + `quantity`; any extra field (price,
total, freeDelivery…) makes the request fail validation.

## How Complete Your Sip works

The storefront ranks suggestions by (1) explicit product relationships, then
(2) closeness of price to the amount still needed for free delivery, and once
₹200 is reached it keeps the related-products order and stops price-chasing.
`POST /api/v1/recommendations` mirrors this server-side. It is informational
only: it never changes a price, discount or delivery fee, and checkout
recalculates everything independently.
