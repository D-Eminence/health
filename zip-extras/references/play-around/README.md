# KORO

Functional e-commerce application prototype — a modern Nigerian online store.

## Purpose

A technical demonstration of a complete commerce workflow:

- Product catalogue (categories, listing, search, sorting, product detail)
- Persistent cart with dynamic subtotal / delivery / express / total
- Checkout (contact → recipient → delivery address → order review)
- Order creation with **authoritative server-side** validation and pricing
- Payment initialization through **two gateways** (Bachs.io, Flutterwave) plus a clearly-labelled demo mode
- Payment verification, signed webhook handling, and idempotency
- Order history, order details, and a development admin view
- Responsive UX built on the existing Waya design system

## Stack

- **React 19** + **TypeScript** (Vite)
- **react-router-dom** — clean URL routing
- **zod** — schema validation (server-authoritative)
- **Waya product design system** — CSS custom-property tokens (`src/styles/product-tokens.css`) and reusable UI primitives (`src/components/ui`)
- **Vercel serverless functions** (`api/`) — order creation, payment init, payment verification, gateway webhooks
- React Context for the cart; a localStorage-backed data layer for the SPA fallback

## Architecture

```
Customer
  ↓
Cart (localStorage, persistent)
  ↓
Checkout (Contact → Recipient → Delivery → Review)
  ↓
POST /api/orders          — validates input, re-prices from the catalog,
  |                         checks stock, calculates delivery + express,
  |                         snapshots items, creates pending payment + reference
  ↓
POST /api/payments/init   — Bachs: server creates the hosted checkout session
  |                         Flutterwave: client opens the inline checkout
  ↓
Gateway (hosted redirect or inline popup)
  ↓
Callback → server-side verification (transaction status / reference / amount / currency)
  ↓
Webhook (signed, idempotent) → payment marked successful → order marked paid → fulfilment
  ↓
Order confirmation
```

Key separation:

- `api/` — Vercel serverless routes (`orders`, `payments/init`, `payments/verify`, `webhooks/*`)
- `server/lib.js` — order store, catalog prices, order numbering, reference generation
- `server/gateways.js` — Bachs + Flutterwave API calls and webhook signature checks
- `src/koro/lib/api.ts` — client for those routes; probes `/api/health` before use
- `src/koro/lib/orders.ts` — order creation business logic (never trusts the client total)
- `src/koro/lib/payments.ts` — payment orchestration, webhook handler, idempotency
- `src/koro/lib/bachs.ts` — Bachs contract (checkout endpoint, reference, HMAC signing)
- `src/koro/lib/flutterwave.ts` — Flutterwave contract (inline checkout, public key)
- `src/koro/lib/validation.ts` — zod schemas shared by UI and "server"
- `src/koro/store/CartContext.tsx` — cart state + persistence

## Running with the API

The SPA works on its own, but the server-verified payment path needs the
functions, so run both together:

```sh
npx vercel dev        # SPA + /api/* on http://localhost:3000
```

With plain `npm run dev` (Vite only) there is no `/api`, so the client detects
that `/api/health` is not a real JSON API and falls back to the clearly-labelled
local simulation. Nothing fabricates a real charge: the demo path is marked as a
simulation everywhere it appears, and the real path only ever reports what the
gateway told the server.

## Setup

```sh
npm install
cp .env.example .env   # then fill in the gateway keys you have
npm run dev            # http://localhost:5173 (SPA only, simulated payments)
npx vercel dev         # http://localhost:3000 (SPA + /api, real test payments)
npm run build          # production build
npm test               # vitest
```

### Environment variables

Anything prefixed `VITE_` is **inlined into the JS bundle at build time** and is
therefore public. Secret keys must never carry that prefix — the serverless
functions read them from `process.env` at request time.

| Variable | Where | Required | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE` | client | no | Base URL for `/api/*`. Leave empty to use the same origin. |
| `VITE_BACHS_CHECKOUT_ENDPOINT` | client | for Bachs | Endpoint that creates the checkout session (`/api/payments/init`). |
| `VITE_FLUTTERWAVE_PUBLIC_KEY` | client | for Flutterwave | Opens the inline checkout. Public key — safe to expose. |
| `BACHS_SECRET_KEY` | server | for Bachs | Creates checkout sessions. Never expose. |
| `BACHS_WEBHOOK_SECRET` | server | for Bachs | HMAC-SHA256 of `{timestamp}.{raw_body}`. Never expose. |
| `BACHS_PRODUCT_ID` | server | no | Skips product auto-creation when set. |
| `BACHS_API_BASE` | server | no | Defaults to `https://sandbox-api.bachs.io`. |
| `BACHS_CHECKOUT_PATH` | server | no | Defaults to `/v1/checkout-sessions`. |
| `FLUTTERWAVE_SECRET_KEY` | server | for Flutterwave | `GET /v3/transactions/{id}/verify`. Never expose. |
| `FLUTTERWAVE_ENCRYPTION_KEY` | server | for Flutterwave | Compared against the `verif-hash` header. Never expose. |
| `FLUTTERWAVE_API_BASE` | server | no | Defaults to `https://api.flutterwave.com/v3`. |
| `KORO_STORE_PATH` | server | no | JSON store location. Defaults to the OS temp dir. |

Without the gateway keys the checkout runs a clearly-labelled **sandbox simulation**.

### Payment gateways (sandbox/test)

Two gateways are integrated behind a single checkout UI:

1. **Bachs.io** — the backend creates a checkout session with `BACHS_SECRET_KEY`
   and returns a `checkoutUrl`; the SPA calls `VITE_BACHS_CHECKOUT_ENDPOINT` to
   obtain that URL. Fulfilment is confirmed by the `collection.succeeded` webhook,
   validated with `BACHS_WEBHOOK_SECRET` (HMAC-SHA256 of `{timestamp}.{body}`).
   See docs.bachs.io.
2. **Flutterwave** — `VITE_FLUTTERWAVE_PUBLIC_KEY` opens the real Flutterwave
   inline test checkout. The backend verifies
   `GET /v3/transactions/{id}/verify` with `FLUTTERWAVE_SECRET_KEY` and validates
   webhooks by comparing the `verif-hash` header to `FLUTTERWAVE_ENCRYPTION_KEY`.

> **Honest boundary:** gateway *initiation* and server-side *verification* are
> both real when the keys above are set — the client never sees a secret and only
> receives a verdict. Unset keys fall back to a labelled simulation.

## Deploy to Vercel

1. Import the repository. Vercel auto-detects Vite; `vercel.json` pins
   `buildCommand: npm run build` and `outputDirectory: dist`.
2. Add the environment variables from the table above under
   **Settings → Environment Variables**. Server-only keys must be added for the
   environment you are deploying (Production/Preview) — they are read by the
   `/api` functions, not inlined into the bundle.
3. `api/*.js` are ESM functions and work because `package.json` sets
   `"type": "module"`.
4. Point the gateway webhooks at your deployment:
   - Bachs → `https://<your-domain>/api/webhooks/bachs`
   - Flutterwave → `https://<your-domain>/api/webhooks/flutterwave`
5. Checkout return URLs need no configuration — they are derived per request
   from the browser origin, with `req.headers.host` as the server-side fallback,
   so preview deployments and custom domains both work.

> **Storage caveat:** `server/lib.js` is a JSON file store in the OS temp dir. On
> deployed Vercel the filesystem is ephemeral and per-instance, so orders do not
> survive between invocations. Swap that module for Vercel KV / Postgres /
> Supabase before treating orders as durable — the call sites do not change.

## Demo

| Path | What it demonstrates |
| --- | --- |
| Payment step → **Simulate successful payment** | order created → signed webhook → payment `successful` → order `paid` |
| Payment step → **Simulate failed payment** | payment `failed`, order stays `pending_payment`, retry reuses the order |
| Payment step → **Simulate processing payment** | payment `processing`, order stays `pending_payment` |
| `/payment/callback?reference=…` | server-side verification before any redirect |
| Duplicate webhook | idempotency guard — already-successful payments are not processed twice and inventory is not deducted twice |

The full journey: **Product → Add to Cart → Cart → Checkout → Select gateway → Gateway checkout → Verify → Confirmation**.

## Structure

```
api/                    Vercel serverless routes (orders, payments, webhooks)
server/                 gateway clients + JSON order store
src/
  components/ui/        Waya design-system primitives (reused, extended icons)
  styles/               Waya tokens + component styles
  koro/
    components/         Header, footer, product card, order summary, checkout steps
    routes/             catalog, product, cart, checkout, payment, order, admin
    lib/                types, money, products, validation, db, orders, api,
                        bachs, flutterwave, payments
    store/              CartContext, ToastContext
    styles/             storefront, checkout and toast styles on the Waya tokens
    KoroApp.tsx         router + providers
```

## Design system

KORO reuses the existing [Waya product design system](docs/DESIGN_SYSTEM.md):
the semantic color/typography/spacing/radius tokens and the Button, InputField,
SelectField, Badge, Alert, and StatePanel primitives. The storefront adds
commerce-specific styles in `src/koro/styles/` that only consume those tokens —
including one charcoal accent and one capsule search-field anatomy shared by the
hero and the top bar. The original design-system catalogue remains available at
`/design-system` and keeps documenting the untouched Waya palette.
