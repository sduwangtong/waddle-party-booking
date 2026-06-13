// POST /create-checkout
// Validates the booking, recomputes the deposit server-side, enforces the slot
// cap, stores a pending booking, and returns a Stripe Checkout URL for the
// browser to redirect to. Confirmation emails are sent later by the webhook.
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { validateAndPrice } from '../shared/pricing.mjs';
import { putBooking, queryByDate } from '../shared/dynamo.mjs';
import { CAPACITY, bookedCounts } from '../shared/capacity.mjs';
import { ok, badRequest, conflict, serverError } from '../shared/response.mjs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const HOLD_SECONDS = 30 * 60; // Stripe Checkout minimum session lifetime

// Where Stripe redirects back to. The site lives at two origins; pick the one the
// request came from (so sessionStorage on that origin survives), else github.io.
const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://sduwangtong.github.io';
const SUCCESS_PATH = process.env.SUCCESS_PATH || '/waddle-party-booking/';
const RETURN_BASES = {
  [ORIGIN]: ORIGIN.replace(/\/$/, '') + SUCCESS_PATH,
  'https://book.waddlewaddleny.com': 'https://book.waddlewaddleny.com/',
};
const returnBase = event => {
  const origin = event.headers?.origin || event.headers?.Origin;
  return RETURN_BASES[origin] || RETURN_BASES[ORIGIN];
};

export async function handler(event) {
  let booking;
  try {
    booking = validateAndPrice(JSON.parse(event.body || '{}'));
  } catch (err) {
    return badRequest(err.message);
  }

  try {
    // Capacity check: count active holds for this date+time. Accepts a small
    // oversell race under concurrent checkouts (the webhook logs it; owner resolves).
    const nowSec = Math.floor(Date.now() / 1000);
    const counts = bookedCounts(await queryByDate(booking.dateISO), nowSec);
    if ((counts[booking.time] || 0) >= CAPACITY) {
      return conflict({ error: 'slot_full' });
    }

    const bookingId = randomUUID();
    const base = returnBase(event);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: booking.email,
      expires_at: nowSec + HOLD_SECONDS,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: booking.deposit * 100, // server-owned, always $500
          product_data: {
            name: `Party deposit — ${booking.pkgTitle}`,
            description: `${booking.dateISO} · ${booking.time} · ${booking.kids} kids${booking.theme ? ' · ' + booking.theme : ''}`,
          },
        },
      }],
      metadata: { bookingId },
      success_url: `${base}?status=success&booking=${bookingId}`,
      cancel_url: `${base}?status=cancel`,
    });

    await putBooking({
      bookingId,
      status: 'pending',
      stripeSessionId: session.id,
      expiresAt: nowSec + HOLD_SECONDS,
      createdAt: new Date().toISOString(),
      ...booking,
    });

    return ok({ url: session.url, bookingId });
  } catch (err) {
    console.error('[createCheckout]', err);
    return serverError('Could not start checkout');
  }
}
