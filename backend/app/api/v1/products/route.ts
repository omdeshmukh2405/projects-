import { db } from "@/lib/db";
import { rateLimitOrResponse } from "@/lib/rateLimit";
import { clientIp } from "@/lib/logger";

/**
 * Public, unauthenticated, read-only. Still rate-limited (product scraping /
 * enumeration, SECURITY.md #57) and returns an explicit DTO rather than the
 * raw Prisma row, so a future internal-only column (cost price, supplier id,
 * margin notes) can never leak just by being added to the schema
 * (see SECURITY.md #58).
 */
export async function GET(req: Request) {
  const ip = clientIp(req);
  const limited = rateLimitOrResponse("search", ip ?? "unknown");
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const products = await db.product.findMany({
    where: { isAvailable: true, ...(category ? { category: { slug: category } } : {}) },
    include: { category: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  return Response.json({
    products: products.map(toPublicProductDTO),
  });
}

export function toPublicProductDTO(p: {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceInPaise: number;
  ingredients: string[];
  category: { slug: string; name: string };
}) {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceInPaise: p.priceInPaise,
    ingredients: p.ingredients,
    category: p.category.slug,
    categoryName: p.category.name,
  };
}
