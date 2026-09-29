/**
 * Seeds the SAME 15 products, 7 categories and recommendation graph the
 * static frontend ships with — using the *same ids* ('coffee', 'p1', ...)
 * so the frontend and backend refer to identical products with zero mapping
 * layer. Run with: npx prisma db seed  (wired via package.json "prisma.seed").
 *
 * Safe to re-run: every write is an upsert.
 */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const CATEGORIES = [
  { id: "coffee", name: "Coffee" },
  { id: "tea", name: "Tea" },
  { id: "coolers", name: "Coolers" },
  { id: "refreshers", name: "Refreshers" },
  { id: "juices", name: "Juices" },
  { id: "smoothies", name: "Smoothies" },
  { id: "snacks", name: "Snacks" },
];

// price is rupees here for readability; converted to paise below (see lib/money.ts)
const PRODUCTS = [
  { id: "p1", slug: "classic-cold-coffee", name: "Classic Cold Coffee", cat: "coffee", price: 160, desc: "Smooth cold coffee with a creamy finish.", ingredients: ["Espresso", "Whole milk", "Ice", "Cane sugar"] },
  { id: "p2", slug: "cappuccino", name: "Cappuccino", cat: "coffee", price: 140, desc: "Rich espresso topped with velvety foam.", ingredients: ["Espresso", "Steamed milk", "Milk foam"] },
  { id: "p3", slug: "iced-latte", name: "Iced Latte", cat: "coffee", price: 150, desc: "Espresso over ice with cold milk.", ingredients: ["Espresso", "Cold milk", "Ice"] },
  { id: "p4", slug: "masala-chai", name: "Masala Chai", cat: "tea", price: 80, desc: "Spiced tea brewed the traditional way.", ingredients: ["Assam tea", "Milk", "Cardamom", "Ginger", "Cinnamon"] },
  { id: "p5", slug: "green-tea", name: "Green Tea", cat: "tea", price: 90, desc: "Light, grassy and calming.", ingredients: ["Green tea leaves", "Hot water"] },
  { id: "p6", slug: "peach-iced-tea", name: "Peach Iced Tea", cat: "tea", price: 130, desc: "Black tea with real peach notes.", ingredients: ["Black tea", "Peach syrup", "Ice", "Lemon"] },
  { id: "p7", slug: "mango-cooler", name: "Mango Cooler", cat: "coolers", price: 150, desc: "Ripe mango blended till silky smooth.", ingredients: ["Mango pulp", "Milk", "Ice", "Sugar"] },
  { id: "p8", slug: "orange-refresher", name: "Orange Refresher", cat: "refreshers", price: 120, desc: "Zesty orange with a fizzy lift.", ingredients: ["Orange juice", "Soda", "Mint", "Ice"] },
  { id: "p9", slug: "berry-smoothie", name: "Berry Smoothie", cat: "smoothies", price: 180, desc: "Mixed berries blended thick and cold.", ingredients: ["Mixed berries", "Yoghurt", "Honey", "Ice"] },
  { id: "p10", slug: "chocolate-croissant", name: "Chocolate Croissant", cat: "snacks", price: 70, desc: "Buttery, flaky, filled with chocolate.", ingredients: ["Butter", "Flour", "Dark chocolate"] },
  { id: "p11", slug: "butter-croissant", name: "Butter Croissant", cat: "snacks", price: 60, desc: "Classic, flaky and golden.", ingredients: ["Butter", "Flour", "Yeast"] },
  { id: "p12", slug: "chocolate-cookie", name: "Chocolate Cookie", cat: "snacks", price: 60, desc: "Chunky, chewy, chocolate-loaded.", ingredients: ["Dark chocolate", "Butter", "Brown sugar"] },
  { id: "p13", slug: "brownie", name: "Brownie", cat: "snacks", price: 90, desc: "Dense, fudgy chocolate brownie.", ingredients: ["Cocoa", "Butter", "Dark chocolate", "Walnuts"] },
  { id: "p14", slug: "veg-sandwich", name: "Veg Sandwich", cat: "snacks", price: 120, desc: "Grilled sandwich, fresh veggies.", ingredients: ["Sourdough", "Cucumber", "Tomato", "Mint chutney"] },
  { id: "p15", slug: "cookie-granola-mix", name: "Cookie & Granola Mix", cat: "snacks", price: 80, desc: "Crunchy granola with cookie bits.", ingredients: ["Oats", "Honey", "Almonds", "Cookie crumble"] },
];

// Same graph as frontend's RECOMMEND_MAP (script1 in index.html) — priority order preserved via `weight`.
const RECOMMEND_MAP: Record<string, string[]> = {
  p1: ["p10", "p12", "p13"], p2: ["p11", "p10", "p12"], p3: ["p10", "p13", "p12"],
  p4: ["p14", "p15", "p11"], p5: ["p14", "p12"], p6: ["p14", "p10"],
  p7: ["p13", "p10"], p8: ["p12", "p10"], p9: ["p15", "p11"],
  p10: ["p1", "p2"], p11: ["p2", "p4"], p12: ["p1", "p4"],
  p13: ["p1", "p7"], p14: ["p1", "p6", "p4"], p15: ["p9", "p4"],
};

async function main() {
  for (const c of CATEGORIES) {
    await db.category.upsert({ where: { id: c.id }, update: { name: c.name, slug: c.id }, create: { id: c.id, slug: c.id, name: c.name } });
  }
  for (const p of PRODUCTS) {
    await db.product.upsert({
      where: { id: p.id },
      update: { name: p.name, slug: p.slug, description: p.desc, categoryId: p.cat, priceInPaise: p.price * 100, ingredients: p.ingredients, isAvailable: true },
      create: { id: p.id, slug: p.slug, name: p.name, description: p.desc, categoryId: p.cat, priceInPaise: p.price * 100, ingredients: p.ingredients, isAvailable: true },
    });
  }
  for (const [fromId, toIds] of Object.entries(RECOMMEND_MAP)) {
    for (let i = 0; i < toIds.length; i++) {
      await db.productRelation.upsert({
        where: { fromId_toId: { fromId, toId: toIds[i] } },
        update: { weight: toIds.length - i },
        create: { fromId, toId: toIds[i], weight: toIds.length - i },
      });
    }
  }
  console.log(`Seeded ${CATEGORIES.length} categories, ${PRODUCTS.length} products, ${Object.values(RECOMMEND_MAP).flat().length} recommendation edges.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
