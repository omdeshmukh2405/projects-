# Beverage Co.

Premium beverage & café e-commerce.

```
beverage-co/
├── frontend/   Static storefront (index.html + assets/ + config.js) — no build step
└── backend/    Next.js + Prisma + PostgreSQL API with the security architecture
```

These are **two separate Vercel projects**. That's the cleanest setup for a
static site + a separate Next.js/Prisma API, and it's what's documented below.

---

## Frontend deployment (Vercel)

1. **Import this repository** into Vercel.
2. **Root Directory:** `frontend`
3. **Framework Preset:** Other
4. **Build Command:** leave empty (there is no build step)
5. **Output Directory:** `.`
6. Deploy.

`frontend/vercel.json` sets long-lived cache headers for `/assets/*` and
clean URLs; nothing else is required. All asset references in `index.html`
are relative (`assets/coldCoffee.jpg`, `assets/coffee-loading.gif`, etc.) and
every one of them resolves to a real file in `frontend/assets/` — verified
before this was handed to you.

**Loading screen:** the "Brewing something good…" screen is hidden by a
fixed 1.9s timer that is scheduled *before* anything else runs, so it cannot
get stuck even if a later script error occurs or the GIF fails to load — the
homepage always appears.

**Connecting it to the backend (optional):** open `frontend/config.js` and
set `window.BEVERAGE_API_BASE_URL` to your deployed backend's URL, e.g.
`https://beverage-co-backend.vercel.app`. Leave it empty to run the
storefront fully standalone (its own in-browser cart math, as it does by
default) — nothing breaks either way. See **"What 'wired' means here"** below
for exactly what this does and doesn't turn on.

---

## Backend deployment (Vercel)

1. **Create a second Vercel project** from the same repository.
2. **Root Directory:** `backend`
3. **Framework Preset:** Next.js (auto-detected)
4. Add a **PostgreSQL database** (Vercel Postgres, Neon, Supabase, etc.) and
   set `DATABASE_URL`.
5. Set the environment variables below.
6. Deploy.

`package.json` has a `postinstall: prisma generate` script and a
`vercel-build: prisma generate && next build` script, so Vercel's build
always generates the Prisma client first — this is the #1 cause of
"works locally, breaks on Vercel" for Prisma projects, and it's handled.

### Environment variables (backend project → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string, least-privilege app role |
| `NEXTAUTH_URL` | yes | `https://<your-backend>.vercel.app` |
| `NEXTAUTH_SECRET` | yes | `openssl rand -base64 32` |
| `APP_ORIGIN` | yes | Comma-separated list of allowed frontend origins, e.g. `https://beverage-co.vercel.app`. Used for **both** CSRF same-origin checks (`lib/csrf.ts`) and CORS (`middleware.ts`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | only if Google sign-in is enabled |
| `PAYMENT_WEBHOOK_SECRET` | optional | only once a real payment provider is wired in |
| `EMAIL_PROVIDER_API_KEY` / `EMAIL_FROM` | optional | only once transactional email is wired in |

Full list with descriptions: `backend/.env.example`.

### Database migrations

```bash
# one-time / after schema changes, from your machine or CI — NOT on every deploy:
npx prisma migrate deploy
```

`migrate deploy` applies committed migrations without prompting and never
resets data — safe for production. Don't run `migrate dev` against
production.

### Seed data (matches the frontend exactly)

```bash
npx prisma db seed
```

`backend/prisma/seed.ts` inserts the same 7 categories and 15 products the
frontend ships with, **using the same ids** (`p1`…`p15`, `coffee`, `tea`,
…) — so if you point `frontend/config.js` at this backend, the products line
up with no translation layer. It also seeds the product-relationship graph
behind "Complete your sip" / `/api/v1/recommendations`, copied from the
frontend's own `RECOMMEND_MAP`. Safe to re-run (every write is an upsert).

### CORS

`backend/middleware.ts` reflects `Access-Control-Allow-Origin` **only** for
an origin present in `APP_ORIGIN` — never `*` — and handles the `OPTIONS`
preflight for every `/api/*` route before it reaches a handler. Update
`APP_ORIGIN` if your frontend's Vercel URL changes (e.g. after attaching a
custom domain).

---

## What "wired" means here

The frontend now, when `BEVERAGE_API_BASE_URL` is set, calls
`GET /api/v1/products` on load and refreshes each product's displayed name,
description and price from the backend — proving the two deployments can
actually talk to each other, with real CORS, over the network.

**What is not wired, and why:** cart totals, the ₹200 free-delivery
calculation and checkout are still computed in the browser by
`frontend/index.html`'s own JS. The backend's authoritative versions of all
three (`backend/lib/pricing.ts`, `backend/lib/money.ts`,
`backend/app/api/v1/checkout/route.ts`) require an authenticated session —
and this static page has no login/signup screen. Wiring those up for real
means building that login UI first and switching the cart drawer to call
`/api/v1/cart` and `/api/v1/checkout` instead of its local `state.cart`
object. That's a genuine feature, not a config change — happy to build it
next if you want the full end-to-end flow rather than the current
"storefront + separately-deployable, tested-independently API" split.

---

## Local development

### Frontend
```bash
cd frontend
npx serve .            # or: python3 -m http.server 8080
```

### Backend
```bash
cd backend
npm install
cp .env.example .env.local
npx prisma migrate dev --name init
npx prisma db seed
npm run dev
npm test
```

## Status / honesty notes

- The backend tests are written but have **not been run** in the sandbox
  this was authored in (no network access for `npm install`). Run `npm test`
  yourself before relying on them.
- `npm run build` / `npm run typecheck` have likewise not been run here —
  same reason. Run both before your first real deploy.
- Integration tests that need a live database (BOLA/IDOR across two real
  users, concurrent-checkout races, webhook replay, rate-limit behaviour)
  are not written yet — see `backend/SECURITY_AUDIT.md` for the full list of
  what's implemented, partial, or outstanding.
- Nothing here is claimed to be "100% secure."
