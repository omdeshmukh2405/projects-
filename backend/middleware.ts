import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Global security headers (SECURITY.md #52/#55, ASVS 14.4) PLUS explicit CORS
 * for /api/**, since the frontend may be a separate Vercel project on a
 * different origin than this backend.
 *
 * CORS policy: reflect the request's Origin header ONLY if it is present in
 * the comma-separated APP_ORIGIN env var — never a wildcard, since these
 * APIs use credentialed (cookie) requests. No match => no CORS headers => the
 * browser blocks the cross-origin request itself.
 */
function allowedOrigins(): string[] {
  return (process.env.APP_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const origin = req.headers.get("origin");
  const allowed = isApi && origin && allowedOrigins().includes(origin);

  // Preflight: answer directly, before it ever reaches a route handler.
  if (isApi && req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: allowed ? 204 : 403 });
    if (allowed) applyCors(res, origin!);
    return res;
  }

  const res = NextResponse.next();

  if (isApi && allowed) applyCors(res, origin!);

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  res.headers.set("X-Frame-Options", "DENY");
  if (process.env.NODE_ENV === "production") {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  return res;
}

function applyCors(res: NextResponse | Response, origin: string) {
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.headers.set("Vary", "Origin");
}

export const config = {
  matcher: "/:path*",
};
