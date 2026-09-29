import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AuthzError } from "@/lib/rbac";

export async function GET() {
  try {
    const user = await requireUser();
    const orders = await db.order.findMany({
      where: { userId: user.id }, // never accept a userId from the query string here
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return Response.json({ orders });
  } catch (err) {
    if (err instanceof AuthzError) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: err.status,
        headers: { "content-type": "application/json" },
      });
    }
    // eslint-disable-next-line no-console
    console.error(err);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
