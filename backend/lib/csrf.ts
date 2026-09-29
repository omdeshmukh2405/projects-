/**
 * CSRF protection for cookie-authenticated, state-changing requests
 * (see SECURITY.md #24 / ASVS 4.x session-cookie CSRF requirements).
 *
 * We use two independent layers, either of which stops the standard CSRF
 * attack (a third-party page silently submitting to our API using the
 * victim's cookies):
 *
 *  1. SameSite=Lax session cookies (configured in lib/auth.ts) — modern
 *     browsers will not attach the cookie to a cross-site POST/PUT/PATCH/
 *     DELETE at all.
 *  2. A same-origin check on every mutating request, as defense in depth for
 *     older browsers / edge cases SameSite doesn't cover.
 *
 * Call `assertSameOrigin(req)` at the top of every mutating route handler.
 */
export function assertSameOrigin(req: Request): Response | null {
  const method = req.method?.toUpperCase();
  if (!method || ["GET", "HEAD", "OPTIONS"].includes(method)) return null;

  const origin = req.headers.get("origin");
  const allowed = (process.env.APP_ORIGIN ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!origin || !allowed.includes(origin)) {
    return new Response(JSON.stringify({ error: "Cross-origin request rejected." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
