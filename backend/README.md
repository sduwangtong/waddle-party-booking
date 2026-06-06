# Waddle Waddle NY — booking-request backend

Sends confirmation emails when a customer submits the booking form. **No online
payment** — the owner replies to the venue alert with a Zelle QR code to collect
the $500 deposit.

```
Browser (index.html)
  │ POST /booking-request ──▶ SubmitBooking Lambda
  │     {date,slot,kids,pkg,       • validateAndPrice() (server owns the math)
  │      theme,name,phone,email}   • SES → venue alert  (To info@, Reply-To = customer)
  │                                • SES → customer confirmation (From info@)
  │ ◀── { ok: true } ──── step-5 "request received"
  │
  └─ owner hits Reply on the venue alert → sends Zelle QR → customer pays $500
```

## Stack
- **One Lambda** `SubmitBooking` → `POST /booking-request`
- **SES** sends both emails from `info@waddlewaddleny.com` (domain-verified)
- No DynamoDB, no Stripe. The venue inbox is the booking record.

## One-time setup

### 1. Verify the domain in SES (region us-east-1)
The identity is **already created** (account 642662060437, us-east-1). Add these
**3 DKIM CNAME records** at the DNS host for waddlewaddleny.com:
```
pwcccozcf6syklr7m4mtssgg56czrar4._domainkey.waddlewaddleny.com  CNAME  pwcccozcf6syklr7m4mtssgg56czrar4.dkim.amazonses.com
wt2k2a5wdcwm73rrleiwkewvaoikpcrm._domainkey.waddlewaddleny.com  CNAME  wt2k2a5wdcwm73rrleiwkewvaoikpcrm.dkim.amazonses.com
wkrabau7ytyllmfxncqqu7zhtlq3jf5l._domainkey.waddlewaddleny.com  CNAME  wkrabau7ytyllmfxncqqu7zhtlq3jf5l.dkim.amazonses.com
```
Check status until it flips to verified:
```bash
aws sesv2 get-email-identity --email-identity waddlewaddleny.com --region us-east-1 \
  --query '{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}'
```
Recommended for deliverability:
```
waddlewaddleny.com         TXT  "v=spf1 include:amazonses.com ~all"
_dmarc.waddlewaddleny.com  TXT  "v=DMARC1; p=none; rua=mailto:info@waddlewaddleny.com"
```
Wait until the identity shows **Verified** (minutes to a few hours after DNS propagates).
`info@waddlewaddleny.com` must be a real mailbox you read and reply from.

### 2. Confirm SES is out of sandbox (us-east-1)
```bash
aws sesv2 get-account --region us-east-1 --query 'ProductionAccessEnabled'
```
Should be `true` (shared with Boba Tea). If `false`, request production access in the SES console.

### 3. Deploy
```bash
cd backend
sam build
sam deploy --guided --stack-name waddle-booking
# Region: us-east-1 — accept the parameter defaults.
```
Copy the **`ApiBaseUrl`** output.

### 4. Point the frontend at the API
In `../index.html`, set `const API_BASE = "<ApiBaseUrl>"`, then commit + push
(GitHub Pages redeploys automatically).

## Test
1. Complete a booking on the page and submit.
2. Confirm the **venue alert** lands in the `info@` inbox (not Sent) with **Reply-To = the customer**, and the **customer confirmation** arrives (check spam the first time).
3. Hit **Reply** on the venue alert — it should compose to the customer. Attach your Zelle QR and send.

Logs: `sam logs --stack-name waddle-booking --name SubmitBookingFunction --tail`

## Re-enabling online payment later
The full Stripe deposit flow is preserved on the **`stripe-deposit-deferred`** branch
(`createCheckout` + `stripeWebhook` Lambdas; `pricing.mjs` is shared). Merge/port it
back when you're ready to take cards.

## Not built (by design)
Durable booking log (DynamoDB), server-side dedup / slot-locking, SES bounce/complaint
alerts. Each is a small add if volume grows.
