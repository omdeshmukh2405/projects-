// Beverage Co. — deployment config.
//
// Leave BEVERAGE_API_BASE_URL empty to run the storefront fully standalone
// (its own in-browser cart/pricing math, as it does today — nothing breaks).
//
// Point it at a deployed backend (see /backend, a separate Vercel project)
// to switch on real server calls for the endpoints that don't require login:
// GET /api/v1/products and POST /api/v1/recommendations. Product ids in the
// backend's seed data (prisma/seed.ts) intentionally match this frontend's
// ids ('p1'..'p15'), so no id-mapping layer is needed.
//
// Cart totals and checkout still use the frontend's own math even with this
// set, because that requires the customer to be logged in and this static
// page has no login screen yet — see README "What 'wired' means here".
window.BEVERAGE_API_BASE_URL = ""; // e.g. "https://beverage-co-backend.vercel.app"
