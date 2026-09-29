import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { AuthzError } from "./rbac";

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
}

/**
 * The ONLY way route handlers should learn who is calling them. This reads
 * the session token from the httpOnly cookie and re-validates it against the
 * database-backed Session table on every call — there is no client-supplied
 * user id or role anywhere in this path (see SECURITY.md #2, Zero Trust).
 */
export async function requireUser(): Promise<AuthedUser> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new AuthzError("Authentication required.", 401);
  }
  return session.user as unknown as AuthedUser;
}

export async function getOptionalUser(): Promise<AuthedUser | null> {
  const session = await getServerSession(authOptions);
  return (session?.user as unknown as AuthedUser) ?? null;
}
