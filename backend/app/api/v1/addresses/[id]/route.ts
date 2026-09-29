import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { addressUpdateSchema, ADDRESS_ALLOWED_FIELDS } from "@/lib/validation/address";
import { assertFound, AuthzError, pickAllowed } from "@/lib/rbac";
import { logEvent, clientIp } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/csrf";

interface Params {
  params: { id: string };
}

// Every handler below folds `userId: user.id` into the WHERE clause. This is
// the load-bearing line for BOLA/IDOR protection (SECURITY.md #8): even if
// an attacker changes the :id in the URL to another customer's address, the
// query simply returns no row, and assertFound turns that into a 404 rather
// than ever touching or revealing someone else's data.

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const address = await db.address.findFirst({ where: { id: params.id, userId: user.id } });
    assertFound(address, "Address not found.");
    return Response.json({ address });
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: Params) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  try {
    const user = await requireUser();
    const existing = await db.address.findFirst({ where: { id: params.id, userId: user.id } });
    assertFound(existing, "Address not found.");

    const body = await req.json().catch(() => null);
    const parsed = addressUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(400, "Please check the address details.");

    // Defense in depth even though the schema already only exposes safe
    // fields — see lib/rbac.ts pickAllowed / mass-assignment protection.
    const safeData = pickAllowed(parsed.data, ADDRESS_ALLOWED_FIELDS as unknown as (keyof typeof parsed.data)[]);

    const address = await db.address.update({
      where: { id: params.id }, // safe: existence+ownership already verified above
      data: safeData,
    });

    await logEvent({
      level: "info",
      eventType: "ADDRESS_UPDATED",
      userId: user.id,
      resource: `address:${address.id}`,
      result: "SUCCESS",
      ipAddress: clientIp(req),
    });

    return Response.json({ address });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const originError = assertSameOrigin(req);
  if (originError) return originError;

  try {
    const user = await requireUser();
    const existing = await db.address.findFirst({ where: { id: params.id, userId: user.id } });
    assertFound(existing, "Address not found.");

    await db.address.delete({ where: { id: params.id } });

    await logEvent({
      level: "info",
      eventType: "ADDRESS_DELETED",
      userId: user.id,
      resource: `address:${params.id}`,
      result: "SUCCESS",
      ipAddress: clientIp(req),
    });

    return new Response(null, { status: 204 });
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
