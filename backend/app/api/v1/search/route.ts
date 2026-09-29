import { db } from "@/lib/db";
import { searchSchema } from "@/lib/validation/cart";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { clientIp } from "@/lib/logger";
import { toPublicProductDTO } from "../products/route";

/**
 * Search input is bounded (max 80 chars, see lib/validation/cart.ts) before
 * it ever reaches the database, and the query below uses Prisma's
 * parameterized `contains` filter — never raw string concatenation into SQL
 * (see SECURITY.md #40, #59).
 */
export async function GET(req: Request) {
  const ip = clientIp(req);
  const limited = rateLimitOrResponse("search", ip ?? "unknown");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = searchSchema.safeParse({
    q: searchParams.get("q") ?? "",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  if (!parsed.success) {
    return Response.json({ results: [] });
  }

  const { q, limit } = parsed.data;

  const results = await db.product.findMany({
    where: {
      isAvailable: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { ingredients: { has: q.toLowerCase() } },
        { category: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    include: { category: true },
    take: limit,
  });

  return Response.json({ results: results.map(toPublicProductDTO) });
}
