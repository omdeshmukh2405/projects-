import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { addressSchema } from "@/lib/validation/address";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";
import { AuthzError } from "@/lib/rbac";

// GET /api/v1/addresses — always scoped to the authenticated user; there is
// no way to pass a different userId in the query and get someone else's
// addresses (see SECURITY.md #8, BOLA/IDOR protection).
export async function GET() {
  try {
    const user = await requireUser();
    const addresses = await db.address.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ addresses });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  try {
    const user = await requireUser();
    const limited = rateLimitOrResponse("cartMutation", user.id);
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const parsed = addressSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "Please check the address details.");
    }

    const address = await db.address.create({
      data: { ...parsed.data, userId: user.id },
    });

    await logEvent({
      level: "info",
      eventType: "ADDRESS_CREATED",
      userId: user.id,
      resource: `address:${address.id}`,
      result: "SUCCESS",
      ipAddress: clientIp(req),
    });

    return Response.json({ address }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function handleError(err: unknown) {
  if (err instanceof AuthzError) return jsonError(err.status, err.message);
  // eslint-disable-next-line no-console
  console.error(err);
  return jsonError(500, "Something went wrong. Please try again.");
}
