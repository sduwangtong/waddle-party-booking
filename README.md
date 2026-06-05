# Waddle Waddle NY — Party Room Booking

A single-page birthday party-room booking flow for **Waddle Waddle NY** (120 Voice Rd. Carle Place, NY 11514).

One self-contained `index.html` — no build step, no dependencies. Works on GitHub Pages or embedded in a Square page.

## Flow
1. **Date · Time · Kids** — pick a date (weekend vs. weekday time slots) and number of kids (10–25).
2. **Package** — Classic / Premium / Luxury / VIP, priced live (+$40 or +$50 per extra kid over 10).
3. **Theme** — choose a party theme.
4. **Review & Deposit** — enter name / phone / email, see the price breakdown (tax 8.625%, $500 deposit), pay.
5. **Confirmation** — reservation summary + the email sent to info@waddlewaddleny.com.

## Status (mock)
- Deposit payment is simulated — a real **Square payment link** drops into step 4 later.
- The confirmation email is *previewed* on screen; real delivery needs a small service (Square notifications / Formspree / serverless).
- Theme list shown is placeholder samples.
