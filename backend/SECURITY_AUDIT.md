# SECURITY_AUDIT.md — Beverage Co. backend

Status as of this codebase, checked against OWASP Top 10:2025, OWASP ASVS 5.0,
and OWASP API Security Top 10. Statuses: **PASS** (implemented and testable
in this code), **PARTIAL** (implemented but depends on a deployment choice
not made here), **NOT IMPLEMENTED** (deliberately out of scope — see note),
**N/A**.

| # | Control | Status | Implementation | Test to run |
|---|---|---|---|---|
| 1 | Password hashing | PASS | bcrypt cost 12, `lib/auth.ts` | Confirm `User.passwordHash` is never a plaintext match; verify cost factor |
| 2 | Password policy | PASS | 12+ chars, mixed class, `lib/validation/auth.ts` | Submit an 8-char password, expect 400 |
| 3 | Account lockout | PASS | 5 attempts / 15 min, `lib/auth.ts` | 6 bad logins, 6th should return locked, not "wrong password" |
| 4 | Enumeration resistance | PASS | Generic messages + dummy-hash compare, signup/login/reset routes | Compare response time & body for existing vs non-existing email |
| 5 | Password reset token security | PASS | Random 32-byte token, SHA-256 hashed at rest, 15-min TTL, single-use | Reuse a token twice, expect second attempt to fail |
| 6 | Session security | PASS | Database sessions, HttpOnly/Secure/SameSite, `__Host-` prefix in prod | Inspect Set-Cookie headers in prod build |
| 7 | Session revocation on logout | PASS | `lib/db` session row deleted, not just cookie cleared | Capture session token, log out, replay token — expect 401 |
| 8 | Session revocation on password change | PASS | `db.session.deleteMany` inside reset transaction | Reset password, confirm old session cookie now 401s |
| 9 | RBAC / deny-by-default | PASS | `requireRole()` throws unless allow-listed, `lib/rbac.ts` | Call `/api/v1/admin/orders` as CUSTOMER, expect 403 |
| 10 | BOLA/IDOR protection | PASS | `userId` folded into every per-resource query | User A requests User B's `/orders/:id` and `/addresses/:id`, expect 404 |
| 11 | Mass-assignment protection | PASS | `pickAllowed()` allowlist on address PATCH; Zod strips unknown keys everywhere | PATCH an address with `{"role":"ADMIN"}` in body, confirm ignored |
| 12 | Server-authoritative pricing | PASS | `lib/pricing.ts` re-reads price from DB on every call | POST cart with a manipulated implied price — schema has no price field to manipulate |
| 13 | ₹200 free-delivery server enforcement | PASS | `FREE_DELIVERY_THRESHOLD_PAISE` constant, evaluated server-side only | Attempt to POST `freeDelivery:true` — field doesn't exist in schema |
| 14 | Cart quantity bounds | PASS | `MAX_QUANTITY_PER_ITEM`, integer check, `lib/pricing.ts` | POST quantity -1, 0, 999999 — all rejected or handled safely |
| 15 | Coupon abuse prevention | PASS | Expiry/min-subtotal/per-user/global caps checked at checkout inside transaction | Redeem same coupon twice concurrently (see #23 for the concurrency caveat) |
| 16 | Order state machine | PASS | Explicit enum + `CUSTOMER_CANCELLABLE_STATUSES` allowlist | PATCH a DELIVERED order to cancel, expect 409 |
| 17 | Checkout idempotency | PASS | UUID `idempotencyKey`, unique DB constraint | POST checkout twice with same key, expect same order id both times |
| 18 | Payment data handling | PASS | No card/CVV/UPI-PIN fields exist anywhere in the schema or routes | Grep the codebase for "cvv", "cardNumber" — none found |
| 19 | Payment confirmation trust boundary | PASS | Only the signature-verified webhook can set `paymentStatus: SUCCEEDED` | POST `{paymentSuccess:true}` to any customer-facing route — no route reads that field |
| 20 | Webhook signature verification | PASS | HMAC-SHA256 + `crypto.timingSafeEqual` | Send webhook with wrong signature, expect 400 |
| 21 | Webhook idempotency | PASS | `WebhookEvent` unique-id table | Replay the same webhook payload twice, expect single order transition |
| 22 | Webhook amount validation | PASS | Cross-checked against `Order.totalInPaise` | Send webhook claiming a different amount than the order total, expect rejection |
| 23 | Race-condition / transactional integrity | **PARTIAL** | Checkout and coupon redemption run inside `db.$transaction`, but there is no explicit row-level lock or unique constraint stopping two *simultaneous* requests from both passing the pre-check before either commits | Fire two concurrent checkout requests for a coupon at `maxRedemptions - 1`... could both succeed. **Needs**: a unique constraint on `(couponId, userId)` in `CouponRedemption` (schema currently allows it via the `@@index`, not `@@unique` — tighten before production) or a `SELECT ... FOR UPDATE` |
| 24 | Input validation | PASS | Zod on every mutating route body; query params validated for search | Send malformed JSON / wrong types, expect 400 not 500 |
| 25 | SQL/NoSQL injection | PASS | Prisma parameterized queries exclusively; zero raw SQL string concatenation | Search for `$queryRawUnsafe`/string-built SQL — none present |
| 26 | XSS | PASS (by absence) | No `dangerouslySetInnerHTML`, no raw HTML rendering of user input anywhere in this backend | N/A — revisit if a rich-text/CMS field is added |
| 27 | CSRF | PASS | SameSite=Lax cookie + `assertSameOrigin()` origin allowlist on every mutating route | POST from a different Origin header, expect 403 |
| 28 | Security headers / CSP | PASS | `middleware.ts`, no `unsafe-inline`/`unsafe-eval` for scripts | Run `curl -I` against any route, confirm headers present |
| 29 | CORS | **PARTIAL** | `APP_ORIGIN` allowlist used by `assertSameOrigin`, but there is no separate `Access-Control-Allow-Origin` response header configuration for genuine cross-origin API consumers (e.g. a future mobile app calling this API from a different origin) | **Needs**: an explicit CORS middleware/config once a second origin (mobile app, partner integration) needs API access |
| 30 | Rate limiting | **PARTIAL** | Layered limits implemented and applied to every sensitive route, `lib/rateLimit.ts` | **Needs**: swap the in-memory store for Redis/Upstash before any multi-instance deployment — documented explicitly in the file's own comments |
| 31 | Error handling / no internal leakage | PASS | Every route catches and returns a generic message; `console.error` only server-side | Trigger a DB error (e.g. bad `DATABASE_URL`), confirm client sees generic 500 not a stack trace |
| 32 | Structured audit logging | PASS | `lib/logger.ts`, `AuditLog` table, no secrets logged | Query `AuditLog` after a login-failure burst, confirm entries exist with no password data |
| 33 | Least-privilege DB access | **PARTIAL** | Documented requirement (`lib/db.ts` comment, `.env.example`), but the actual Postgres role creation/grants are an infrastructure step outside application code | **Needs**: create `beverageco_app` role with only the grants this app uses, separate from a migration/admin role |
| 34 | Secrets management | PASS | `.env.example` has placeholders only; nothing hardcoded in source | `git grep` for any live-looking secret — none present |
| 35 | Explicit response DTOs (no over-exposure) | PASS | `toPublicProductDTO()` used by `/products` and `/search`; order/address responses only return fields already scoped to the requester | Inspect a `/products` response for absence of cost/supplier/internal fields (schema doesn't have them, but the DTO pattern is in place for when it does) |
| 36 | API versioning | PASS | All routes under `/api/v1/` | N/A |
| 37 | Dependency/supply-chain scanning | **NOT IMPLEMENTED** | `package.json` pins exact versions; no CI workflow file included | **Needs**: wire `npm audit`, Dependabot/Renovate, and a SAST tool (Semgrep/CodeQL) into your CI — no CI platform was specified, so no `.github/workflows` was generated |
| 38 | MFA / step-up auth for ADMIN | **NOT IMPLEMENTED** | Noted in `SECURITY.md` and inline comment in `app/api/v1/admin/orders/route.ts` | Requires choosing a TOTP/WebAuthn library and an admin-specific auth flow — not built here |
| 39 | Transactional email delivery | **NOT IMPLEMENTED** | Token generation/validation logic complete; actual send call is a `TODO` | Requires picking a provider (Postmark/SES/etc.) and wiring `EMAIL_PROVIDER_API_KEY` |
| 40 | Payment provider integration | **NOT IMPLEMENTED** | Webhook handler written against a generic signed-payload shape; checkout route has a `TODO` for creating the provider-side payment session | Requires your chosen provider's SDK; do not treat the current webhook shape as final |
| 41 | Inventory management | N/A | Not requested; `Product.isAvailable` is a simple boolean, not a stock count | If stock tracking is added, apply the same atomic-update pattern as pricing |
| 42 | File upload security | N/A | No file upload endpoint exists in this codebase | Apply `SECURITY.md`'s file-upload rules if a profile-picture upload is added |
| 43 | Encrypted backups / recovery | **NOT IMPLEMENTED** | Application-code cannot configure this; it's a managed-database/platform setting | Configure automated encrypted backups on your Postgres provider |
| 44 | WAF / DDoS protection | **NOT IMPLEMENTED** | Belongs at the CDN/platform layer (Cloudflare, AWS WAF, etc.), not in application code | Enable at your hosting platform |

## Summary

- **31 of 44** applicable controls are fully implemented and testable today.
- **5** are partially implemented — each has a specific, named remaining step
  (tighten the coupon unique constraint, add a shared rate-limit store, add
  explicit CORS config, provision a least-privilege DB role) rather than a
  vague "harden later."
- **6** are explicitly out of scope for a codebase with no chosen CI
  platform, payment provider, or email provider, and are called out by name
  rather than silently skipped.
- **2** are not applicable given the current feature set (no file uploads, no
  inventory tracking).

This table should be re-run — and regenerated with real findings — after
integrating a real payment provider and before the first production deploy.

---

## Update — after the address / validation / test changes

- Request schemas for cart, checkout and addresses are now `.strict()`: a body
  carrying `price`, `total`, `deliveryFee`, `freeDelivery`, `paymentSuccess`,
  `userId` or `role` is **rejected with 400**, not silently stripped.
- Money logic (`lib/money.ts`) is pure and has no database import, so it is
  unit-tested in isolation. `tests/` contains the pricing and validation suites.
- **Test status: written, NOT yet run in CI.** The sandbox this was authored in
  has no network, so `npm install` and `npm test` have not been executed here.
  The pure `calculateTotals()` function was smoke-run directly with Node and
  behaved as the tests expect (19999 → fee, 20000 → free, floats/negatives
  rejected). Run `npm test` before relying on any of this.
- **Still NOT tested:** BOLA/IDOR with two real users, race conditions,
  webhook replay, rate-limit bypass, CSRF and SSRF. These need a live database
  and are open items, not passes.
- Address fields (name, phone, state, landmark) were added to the schema; a
  migration must be generated with `prisma migrate dev`.
