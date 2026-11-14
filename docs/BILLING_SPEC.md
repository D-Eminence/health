# Facility billing: trials, subscriptions and payment

Status: **proposed**. The portal is built against the routes below, but hid-system
does not serve them yet (hand-off F3, gap map "Facility trial, subscriptions and
reminders"). Until it does, the portal says billing is not available and lets the
facility in; it never shows a trial, a balance or a payment it cannot read from
the server.

Patients are never billed. Nothing here applies to patient accounts.

## Product decisions (defaults, change here first)

| Decision | Default |
| --- | --- |
| Trial length | 14 days, the same for every product |
| Payment details to start a trial | Not required |
| When the trial starts | When the facility administrator chooses "Start free trial" on Plan & billing, which the workspace invites them to do as soon as they arrive after sign-up |
| Payment provider | Paystack (NGN), hosted checkout |
| Billing period | From the product's price row (`billing_period`, usually `month`) |
| Trial ended, not paid | Read-only: staff can sign in and read, every write is refused until payment |
| Payment due on a paid plan | 7-day grace, then read-only as above |
| Reminders | Email to the administrator 7, 3 and 1 day before the trial ends, and when it ends |
| Price | The product's row in the existing price catalogue (`commercial.pricing`). A `contact_sales` or `custom_quote` row has no self-serve payment: "Pay now" becomes "Talk to sales" |

## Routes

All are authenticated staff routes on the gateway, scoped to the organization of
the active facility (send `X-Facility-ID` as other facility routes do). CSRF and
`Idempotency-Key` apply to the POSTs as they do elsewhere. Errors use the existing
problem+json shape.

New permissions, granted to `org_admin`:

- `billing.subscription.read`: read the subscription and invoices
- `billing.subscription.manage`: start the trial and start a payment

### `GET /api/v1/commercial/subscription`

Permission `billing.subscription.read`. Answers the organization's subscription
for the product it enrolled with.

```json
{
  "organizationId": "uuid",
  "productCode": "ehr | migrate | laboratory | pharmacy",
  "status": "none | trialing | active | past_due | read_only | cancelled",
  "trialEndsAt": "2026-10-30T00:00:00Z | null",
  "currentPeriodEndsAt": "2026-11-30T00:00:00Z | null",
  "graceEndsAt": "2026-12-07T00:00:00Z | null",
  "price": { "visibility": "fixed", "amount_minor": 2500000, "currency": "NGN", "billing_period": "month", "unit": null } ,
  "selfServePayment": true,
  "version": "opaque"
}
```

- `none`: enrolled, no trial started.
- `trialing`: inside the trial; `trialEndsAt` is set.
- `active`: paid; `currentPeriodEndsAt` is set.
- `past_due`: a renewal failed; `graceEndsAt` is set.
- `read_only`: the trial or grace ended unpaid.
- `price` is the catalogue row the subscription is billed at, or `null`.
- `selfServePayment` is `false` for `contact_sales` and `custom_quote` prices.

### `POST /api/v1/commercial/subscription/trial`

Permission `billing.subscription.manage`. Body `{}`. Starts the 14-day trial and
answers the subscription as above. Idempotent: a second call while `trialing`
answers the same trial. `409 TRIAL_ALREADY_USED` once a trial has ended.

### `POST /api/v1/commercial/subscription/checkout`

Permission `billing.subscription.manage`. Body `{}`. The server initializes a
Paystack transaction for the subscription's price and answers:

```json
{ "authorizationUrl": "https://checkout.paystack.com/…", "reference": "string" }
```

- The callback URL is fixed server-side to `<portal origin>/provider/billing`
  (Paystack appends `?reference=` and `?trxref=`). It is never taken from the
  request.
- The portal only navigates to an `https://checkout.paystack.com/` address.
- Payment is confirmed only by Paystack's signed webhook (`charge.success`,
  verified with the secret key's HMAC) or by the server calling Paystack's
  verify endpoint. The return to the portal changes nothing by itself: the
  portal just reads the subscription again.
- `409 SELF_SERVE_PAYMENT_UNAVAILABLE` for a sales-only price.

### `GET /api/v1/commercial/invoices`

Permission `billing.subscription.read`. Newest first, at most 50.

```json
{ "items": [ { "id": "uuid", "number": "HID-2026-000123", "issuedAt": "…", "amount_minor": 2500000, "currency": "NGN", "status": "paid | open | void" } ] }
```

## Enforcement (server)

- Writes by any staff member of a `read_only` organization are refused with
  `402 SUBSCRIPTION_READ_ONLY`; reads continue. Patient access to their own
  records is never affected.
- The gateway, not the portal, enforces this. The portal only explains it.

## What the portal does (already built)

| Place | Behaviour |
| --- | --- |
| Facility sign-up | Unchanged: it ends in the workspace. (The workspace holds signed-in requests until its session is loaded, so the plan is not asked for on the sign-up page.) |
| Workspace banner, no plan yet | To holders of `billing.subscription.manage` whose subscription is `none`: "Start your 14-day free trial. No card is needed." linking to Plan & billing. |
| Workspace banner, later | To holders of `billing.subscription.read` when the trial has 7 days or fewer left, payment is due, or the facility is read-only. |
| `/provider/billing` ("Plan & billing", needs `billing.subscription.read`) | Status, trial days left, price, invoices. With `billing.subscription.manage`: "Start 14-day free trial" (main action when there is no plan) and "Pay now". Reads the subscription again after the return from Paystack. |
| Billing not served (404 or 501) | No banner; Plan & billing says billing is not available yet. Nothing else changes. |

The routes are registered in `packages/contracts/src/registry.ts` with status
`proposed`, and granted to the provider portal (`staff-web`) in
`packages/contracts/src/boundaries.ts`. Change them to `surface-verified` once
hid-system serves them.
