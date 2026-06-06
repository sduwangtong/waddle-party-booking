// POST /booking-request
// Validates + recomputes the booking, emails the venue (authoritative) then the
// customer. No payment, no database — the venue inbox is the record. The owner
// replies to the venue alert with a Zelle QR to collect the $500 deposit.
import { validateAndPrice } from '../shared/pricing.mjs';
import { sendVenueAlert, sendCustomerConfirmation } from '../shared/email.mjs';
import { ok, badRequest, serverError } from '../shared/response.mjs';

export async function handler(event) {
  let booking;
  try {
    booking = validateAndPrice(JSON.parse(event.body || '{}'));
  } catch (err) {
    return badRequest(err.message);
  }

  // The venue alert is the booking record — it must succeed.
  try {
    await sendVenueAlert(booking);
  } catch (err) {
    console.error('[submitBooking] venue alert failed:', err);
    return serverError('Could not submit your request');
  }

  // Customer confirmation is best-effort; the owner already has the lead.
  let emailedCustomer = true;
  try {
    await sendCustomerConfirmation(booking);
  } catch (err) {
    emailedCustomer = false;
    console.error('[submitBooking] customer confirmation failed:', err);
  }

  return ok({ ok: true, emailedCustomer });
}
