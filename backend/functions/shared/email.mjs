// Booking-confirmation emails via SES. Both sent FROM info@waddlewaddleny.com
// (domain-verified). These go out AFTER the $500 deposit is paid via Stripe
// (the webhook calls sendBookingEmails): the customer gets a paid receipt + the
// balance due at the venue; the venue gets the confirmed booking with its IDs.
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});
const SENDER = process.env.SES_SENDER_EMAIL || 'info@waddlewaddleny.com';
const VENUE = process.env.VENUE_EMAIL || 'info@waddlewaddleny.com';
const FROM = `Waddle Waddle NY <${SENDER}>`;
const VENUE_ADDR = '120 Voice Rd, Carle Place, NY 11514 · (516) 243-9397';

const money = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const prettyDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const firstName = full => full.split(' ')[0];
const refundLine = b => `Your ${money(b.deposit)} deposit is refundable only if you cancel at least 14 days before the party date.`;

function summaryRows(b) {
  const rows = [
    ['Date', prettyDate(b.dateISO)],
    ['Time', b.time],
    ['Guests', `${b.kids} kids + ${b.adults} adults`],
    ['Birthday child', `${b.childName || '—'}${b.childAge ? ` (turning ${b.childAge})` : ''}`],
    ['Gender', b.childGender || '—'],
    ['Package', `${b.pkgName} — ${b.pkgTitle}`],
    ['Theme', b.theme || '—'],
  ];
  if (b.allergies) rows.push(['Allergies / dietary', b.allergies]);
  if (b.notes) rows.push(['Notes', b.notes]);
  for (const o of (b.options || [])) rows.push([`${o.qty} × ${o.name}`, money(o.total)]);
  if (b.discount > 0) {
    rows.push(['Items total', money(b.gross)]);
    rows.push([`Discount (${b.discountCode}, 10%)`, `−${money(b.discount)}`]);
  }
  rows.push(
    ['Subtotal', money(b.subtotal)],
    ['Tax (8.625%)', money(b.tax)],
    ['Sale total', money(b.saleTotal)],
    ['Deposit paid (Stripe)', money(b.deposit)],
    ['Remaining balance (at venue)', money(b.balance)],
  );
  return rows;
}

function htmlTable(b) {
  const rows = summaryRows(b)
    .map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#6b6b7b;">${k}</td><td style="padding:6px 0;font-weight:600;color:#2c2c3a;text-align:right;">${v}</td></tr>`)
    .join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:15px;">${rows}</table>`;
}

const textSummary = b => summaryRows(b).map(([k, v]) => `  ${(k + ':').padEnd(30)}${v}`).join('\n');

async function send({ to, cc, subject, html, text, replyTo }) {
  await ses.send(new SendEmailCommand({
    Source: FROM,
    Destination: { ToAddresses: [to], CcAddresses: cc ? [cc] : undefined },
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: {
        Html: { Data: html, Charset: 'UTF-8' },
        Text: { Data: text, Charset: 'UTF-8' },
      },
    },
  }));
}

// Internal alert to the venue — the booking is confirmed and the deposit is paid.
// Reply-To = customer for easy follow-up.
export async function sendVenueAlert(b) {
  const ids = `Booking ID: ${b.bookingId || '—'}${b.paymentIntentId ? ` · Payment: ${b.paymentIntentId}` : ''}`;
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2c2c3a;">
      <h2 style="margin:0 0 4px;">🎉 New booking confirmed</h2>
      <p style="color:#6b6b7b;margin:0 0 16px;">${firstName(b.name)} paid the ${money(b.deposit)} deposit via Stripe — the date is locked in. Reply to this email to follow up.</p>
      <div style="background:#F4F1FB;border-radius:14px;padding:18px 20px;">${htmlTable(b)}</div>
      <p style="margin:16px 0 4px;font-weight:600;">Contact</p>
      <p style="margin:0;color:#2c2c3a;">${b.name}<br>${b.phone}<br>${b.email}</p>
      <p style="color:#9a9aa8;font-size:12px;margin:14px 0 0;">${ids}</p>
      <p style="color:#9a3b58;font-size:12px;margin:8px 0 0;">Cancellation policy shown to customer: ${refundLine(b)}</p>
    </div>`.trim();
  const text = `New booking confirmed\n\n${firstName(b.name)} paid the ${money(b.deposit)} deposit via Stripe — the date is locked in. Reply to follow up.\n\n${textSummary(b)}\n\nContact:\n  ${b.name}\n  ${b.phone}\n  ${b.email}\n\n${ids}\n\nCancellation policy shown to customer: ${refundLine(b)}`;
  await send({
    to: VENUE,
    replyTo: b.email,
    subject: `New booking CONFIRMED (deposit paid) — ${prettyDate(b.dateISO)} ${b.time} (${b.name})`,
    html, text,
  });
}

// Paid receipt + confirmation to the customer. No payment action needed — the
// deposit is already paid; only the balance remains, due at the venue.
export async function sendCustomerConfirmation(b) {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2c2c3a;">
      <h2 style="margin:0 0 4px;">🐤 Your party is booked, ${firstName(b.name)}!</h2>
      <p style="color:#6b6b7b;margin:0 0 20px;">We received your <b>${money(b.deposit)} deposit</b> and your date is <b>locked in</b>. We can't wait to celebrate with you!</p>
      <div style="background:#F4F1FB;border-radius:14px;padding:18px 20px;">
        <p style="margin:0 0 12px;font-weight:600;">Your booking</p>
        ${htmlTable(b)}
      </div>
      <p style="color:#6b6b7b;font-size:14px;margin:18px 0 4px;">The remaining balance of <b>${money(b.balance)}</b> is due at the venue. Questions? Just reply to this email.</p>
      <p style="color:#9a3b58;font-size:13px;margin:14px 0 0;background:#FDEEF2;border:1px solid #F4C4D2;border-radius:10px;padding:10px 14px;">⚠️ Cancellation policy: ${refundLine(b)}</p>
      <p style="color:#9a9aa8;font-size:13px;margin:16px 0 0;">${VENUE_ADDR}</p>
      <p style="color:#c4c4cf;font-size:12px;margin:10px 0 0;">Booking ID: ${b.bookingId || '—'}</p>
    </div>`.trim();
  const text = `Your party is booked, ${firstName(b.name)}!\n\nWe received your ${money(b.deposit)} deposit and your date is locked in.\n\n${textSummary(b)}\n\nThe remaining balance of ${money(b.balance)} is due at the venue. Questions? Just reply to this email.\n\nCancellation policy: ${refundLine(b)}\n\n${VENUE_ADDR}\n\nBooking ID: ${b.bookingId || '—'}`;
  await send({
    to: b.email,
    cc: VENUE, // copy the venue on the exact email the customer receives
    replyTo: SENDER,
    subject: 'Your Waddle Waddle NY party is confirmed 🐤',
    html, text,
  });
}

// Called by the Stripe webhook once the deposit is paid. The venue alert is the
// authoritative record and must succeed; the customer receipt is best-effort.
export async function sendBookingEmails(b) {
  await sendVenueAlert(b);
  try {
    await sendCustomerConfirmation(b);
  } catch (err) {
    console.error('[email] customer confirmation failed:', err);
  }
}
