// POST /stripe-webhook  (called by Stripe, not the browser)
// The authoritative payment callback: verifies the signature, marks the booking
// paid exactly once, and emails the customer + venue.
import Stripe from 'stripe';
import { getBooking, markPaid, queryByDate } from '../shared/dynamo.mjs';
import { sendBookingEmails } from '../shared/email.mjs';
import { CAPACITY, bookedCounts } from '../shared/capacity.mjs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

export async function handler(event) {
  const sig = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripeWebhook] signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return { statusCode: 200, body: 'no bookingId' };

  try {
    const booking = await getBooking(bookingId);
    if (!booking) {
      console.error('[stripeWebhook] booking not found:', bookingId);
      return { statusCode: 200, body: 'not found' }; // 200 so Stripe stops retrying
    }
    if (booking.status === 'paid') {
      return { statusCode: 200, body: 'already paid' }; // idempotent
    }

    // Conditional update guards against concurrent webhook retries.
    try {
      await markPaid(bookingId, session.payment_intent);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return { statusCode: 200, body: 'already paid' };
      }
      throw err;
    }

    // The hold count tolerates an oversell race at checkout time; flag it so the
    // owner can resolve manually. We never refuse a completed payment.
    const nowSec = Math.floor(Date.now() / 1000);
    const paid = (bookedCounts(await queryByDate(booking.dateISO), nowSec)[booking.time] || 0);
    if (paid > CAPACITY) {
      console.warn(`[stripeWebhook] OVERSOLD slot ${booking.dateISO} ${booking.time}: ${paid} active holds (cap ${CAPACITY})`);
    }

    await sendBookingEmails({ ...booking, status: 'paid', paymentIntentId: session.payment_intent });
    console.log('[stripeWebhook] confirmed + emailed', bookingId);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[stripeWebhook]', err);
    // 500 => Stripe retries; safe because the work above is idempotent.
    return { statusCode: 500, body: 'error' };
  }
}
