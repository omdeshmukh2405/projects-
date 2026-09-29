import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton so hot-reload doesn't exhaust DB connections.
// The connection string in DATABASE_URL should use a least-privilege application
// role — see SECURITY.md #61 (Database Access). Never point this at an
// admin/superuser database credential.

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const db =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") global.__prisma = db;
