# Waddle Waddle NY — booking backend

Takes a $500 deposit via **Stripe Checkout** and emails the venue + customer once
the payment succeeds. Each date+time slot holds at most **3 active bookings**;
the 4th is blocked in the UI and at checkout.

```
Browser (index.html)
  │ GET  /availability?date=… ─▶ Availability Lambda
  │   ◀── {booked:{slot:count}} ── full slots shown "Fully booked"
  │
  │ POST /create-checkout ──────▶ CreateCheckout Lambda
  │   {date,slot,kids,pkg,…}        • validateAndPrice() (server owns the math)
  │                                 • capacity check (byDate GSI) → 409 if slot full
  │                                 • Stripe Checkout session ($500, expires 30 min)
  │                                 • putBooking(status:'pending', expiresAt)
  │   ◀── {url, bookingId} ──── browser redirects to Stripe
  │
  ▼ Stripe Checkout (card)
  │   success → ?status=success&booking=ID   cancel → ?status=cancel
  │
  └─ Stripe ──POST /stripe-webhook──▶ StripeWebhook Lambda
       checkout.session.completed       • verify signature
                                         • markPaid() (idempotent conditional update)
                                         • SES → venue alert + customer confirmation
```

## Stack
- **3 Lambdas**: `CreateCheckout` (`POST /create-checkout`), `StripeWebhook` (`POST /stripe-webhook`), `Availability` (`GET /availability`).
- **DynamoDB** `WaddleBookings` — PK `bookingId`, GSI `byDate` (PK `dateISO`). One query per date counts active holds (`shared/capacity.mjs`).
- **SES** sends both emails from `info@waddlewaddleny.com` (domain-verified).
- **Hold semantics**: a booking counts toward the cap of 3 if `status==='paid'`, or `status==='pending'` with `expiresAt` (epoch sec) in the future. Checkout sessions expire after 30 min, so abandoned checkouts free the slot automatically — no cleanup job.
- `status` grows later: `pending`/`paid` → `refunded`/`cancelled`. `paymentIntentId` is stored for future refunds.

> The legacy unpaid Zelle path (`SubmitBooking` → `/booking-request`) is removed. The
> old `stripe-deposit-deferred` branch is now absorbed into this template.

## One-time setup

### 1. SES domain `waddlewaddleny.com` (region us-east-1)
Identity already created (account 642662060437). DKIM/SPF/DMARC as before — see git
history if the records need re-adding. Confirm verified + out of sandbox:
```bash
aws sesv2 get-email-identity --email-identity waddlewaddleny.com --region us-east-1 \
  --query '{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}'
aws sesv2 get-account --region us-east-1 --query 'ProductionAccessEnabled'   # → true
```

### 2. Install deps + build
```bash
cd backend
npm install --prefix functions     # pulls the stripe SDK
sam build
```

### 3. Deploy in **test mode** first
```bash
sam deploy --stack-name waddle-booking \
  --parameter-overrides StripeSecretKey=sk_test_xxx StripeWebhookSecret=placeholder \
  --capabilities CAPABILITY_IAM
```
Note the **`WebhookUrl`** output. (Same stack name keeps the API id, so `index.html`'s
`API_BASE` is unchanged.)

### 4. Register the Stripe webhook → redeploy with the real secret
Stripe Dashboard (test mode) → Developers → Webhooks → **Add endpoint**:
- URL = the `WebhookUrl` output
- Event = `checkout.session.completed`

Copy the signing secret (`whsec_…`) and redeploy:
```bash
sam deploy --stack-name waddle-booking \
  --parameter-overrides StripeSecretKey=sk_test_xxx StripeWebhookSecret=whsec_realvalue \
  --capabilities CAPABILITY_IAM
```

### 5. Go live
Switch the Dashboard to **live mode**, add a live webhook endpoint (same URL), then
redeploy with the live `sk_live_…` key and that endpoint's live `whsec_…`.

## Test (test mode, card `4242 4242 4242 4242`, any future expiry/CVC)
1. Run unit tests: `node --test functions/test/`.
2. Book a slot → you're redirected to Stripe → pay with the test card.
3. You land back on the site at `?status=success` showing the confirmation; both emails arrive (no Zelle/QR) with the **Booking ID**.
4. Check DynamoDB: the item flipped `pending` → `paid` with a `paymentIntentId`.
   ```bash
   aws dynamodb scan --table-name WaddleBookings --region us-east-1 \
     --query 'Items[].{id:bookingId.S,status:status.S,date:dateISO.S,time:time.S}'
   ```
5. Book the same slot 3× (paid) → the 4th attempt shows "Fully booked" in the UI and `/create-checkout` returns **409 slot_full**.
6. Start a checkout and abandon it → after 30 min the slot is open again.
7. Cancel on the Stripe page → you return at `?status=cancel` (selections preserved).

Logs:
```bash
sam logs --stack-name waddle-booking --name WaddleBooking-StripeWebhook --tail
sam logs --stack-name waddle-booking --name WaddleBooking-CreateCheckout --tail
```

## Known / accepted limits
- **Oversell race**: two checkouts started at the same instant can both pass the count (max +1–2 over). The webhook never refuses a paid booking; it logs `OVERSOLD slot …` for the owner to resolve. No locks, no auto-refund.
- **Cross-origin / new-tab Stripe return** loses the `sessionStorage` snapshot → a generic "deposit received, check your email" confirmation is shown (payment still recorded).
- Refunds & booking modification are **not built** yet (the data model is ready for them).
