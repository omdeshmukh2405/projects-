import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { logEvent } from "./logger";
import { loginSchema } from "./validation/auth";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * NextAuth handles the cryptography (password hashing is still our own via
 * bcrypt, but session token generation/rotation/cookie handling is the
 * library's, per SECURITY.md #4 — "never implement cryptography manually").
 *
 * Sessions use the **database** strategy, not JSON Web Tokens, so that:
 *  - logout / password change can immediately revoke a session server-side
 *    (a JWT strategy can't be revoked before it expires without a denylist)
 *  - session inspection/administration is possible from the Session table
 */
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: {
    strategy: "database",
    maxAge: 12 * 60 * 60, // 12h absolute session lifetime
    updateAge: 60 * 60, // rotate/touch at most once an hour
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-beverageco.session-token"
          : "beverageco.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, req) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const ip = (req?.headers?.["x-forwarded-for"] as string | undefined)?.split(",")[0] ?? null;
        const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });

        // Constant-shape response whether or not the account exists, to avoid
        // user enumeration (SECURITY.md #4). We still run a bcrypt compare
        // against a dummy hash so response timing doesn't leak existence.
        const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeOO/1fh5b2QT2AWQxwUDsN1XdlS0.pWzO";
        const hashToCheck = user?.passwordHash ?? DUMMY_HASH;

        if (user?.lockedUntil && user.lockedUntil > new Date()) {
          await logEvent({
            level: "security",
            eventType: "LOGIN_BLOCKED_LOCKED",
            userId: user.id,
            result: "DENIED",
            ipAddress: ip,
          });
          return null;
        }

        const passwordOk = await bcrypt.compare(password, hashToCheck);

        if (!user || !passwordOk) {
          if (user) {
            const failedCount = user.failedLoginCount + 1;
            await db.user.update({
              where: { id: user.id },
              data: {
                failedLoginCount: failedCount,
                lockedUntil:
                  failedCount >= MAX_FAILED_LOGINS
                    ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
                    : undefined,
              },
            });
          }
          await logEvent({
            level: "security",
            eventType: "LOGIN_FAILED",
            userId: user?.id ?? null,
            result: "DENIED",
            ipAddress: ip,
          });
          return null;
        }

        if (user.failedLoginCount > 0) {
          await db.user.update({
            where: { id: user.id },
            data: { failedLoginCount: 0, lockedUntil: null },
          });
        }

        await logEvent({
          level: "info",
          eventType: "LOGIN_SUCCEEDED",
          userId: user.id,
          result: "SUCCESS",
          ipAddress: ip,
        });

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // `user` here is the DB row (adapter + database strategy), never a
      // client-controlled JWT payload — safe to trust role from it.
      if (session.user) {
        (session.user as any).id = user.id;
        (session.user as any).role = (user as any).role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  events: {
    async signOut({ session }) {
      await logEvent({
        level: "info",
        eventType: "LOGOUT",
        userId: (session as any)?.userId ?? null,
        result: "SUCCESS",
      });
    },
  },
};
