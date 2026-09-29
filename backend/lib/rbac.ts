import type { Role } from "@prisma/client";

/**
 * Deny-by-default authorization helpers (see SECURITY.md #7, #8, #9).
 *
 * Golden rule used throughout the API routes in app/api/**:
 *   1. Load the authenticated session server-side (never trust a client claim).
 *   2. Load the resource from the database using the authenticated user's id
 *      as part of the WHERE clause, not just the id from the URL.
 *   3. If the row comes back null, the correct response is 404 (not 403),
 *      so we don't confirm to an attacker that the resource exists.
 */

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

export function requireRole(userRole: Role, allowed: Role[]) {
  if (!allowed.includes(userRole)) {
    throw new AuthzError("You do not have permission to perform this action.", 403);
  }
}

/**
 * Ownership check pattern used by every /api/v1/{addresses,orders,cart,wishlist}
 * route. Example usage inside a route handler:
 *
 *   const address = await db.address.findFirst({
 *     where: { id: params.id, userId: session.user.id },
 *   });
 *   assertFound(address, "Address not found.");
 *
 * Never do `db.address.findUnique({ where: { id: params.id } })` and then
 * check `address.userId === session.user.id` in application code — a bug in
 * that check is a full IDOR, whereas folding userId into the query means the
 * database itself enforces the boundary.
 */
export function assertFound<T>(row: T | null | undefined, message = "Not found."): asserts row is T {
  if (!row) {
    throw new AuthzError(message, 404);
  }
}

/** Fields a customer is never allowed to set on themselves via a PATCH body. */
export const USER_MASS_ASSIGNMENT_BLOCKLIST = [
  "role",
  "isAdmin",
  "passwordHash",
  "failedLoginCount",
  "lockedUntil",
  "emailVerifiedAt",
] as const;

/**
 * Strips any key not in `allowlist` from `body`. Use this instead of ever
 * spreading `req.body` directly into a Prisma `update`/`create` call
 * (see SECURITY.md #9, Property-Level Authorization / mass assignment).
 */
export function pickAllowed<T extends Record<string, unknown>>(body: T, allowlist: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      out[key] = body[key];
    }
  }
  return out;
}
