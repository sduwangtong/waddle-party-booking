// Booking-request emails via SES. Both sent FROM info@waddlewaddleny.com
// (domain-verified). The customer email includes the full order summary plus the
// Zelle QR so they can pay the $500 deposit; the venue gets a copy to follow up.
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({});
const SENDER = process.env.SES_SENDER_EMAIL || 'info@waddlewaddleny.com';
const VENUE = process.env.VENUE_EMAIL || 'info@waddlewaddleny.com';
const QR_URL = process.env.ZELLE_QR_URL || 'https://sduwangtong.github.io/waddle-party-booking/assets/zelle-qr.png';
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
    ['Zelle deposit due', money(b.deposit)],
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

// Internal alert to the venue. Reply-To = customer for easy follow-up.
export async function sendVenueAlert(b) {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2c2c3a;">
      <h2 style="margin:0 0 4px;">🎉 New party request</h2>
      <p style="color:#6b6b7b;margin:0 0 16px;">${firstName(b.name)} was emailed the Zelle QR for the ${money(b.deposit)} deposit. Reply to this email to follow up.</p>
      <div style="background:#F4F1FB;border-radius:14px;padding:18px 20px;">${htmlTable(b)}</div>
      <p style="margin:16px 0 4px;font-weight:600;">Contact</p>
      <p style="margin:0;color:#2c2c3a;">${b.name}<br>${b.phone}<br>${b.email}</p>
      <p style="color:#9a3b58;font-size:12px;margin:14px 0 0;">Cancellation policy shown to customer: ${refundLine(b)}</p>
    </div>`.trim();
  const text = `New party request\n\n${firstName(b.name)} was emailed the Zelle QR for the ${money(b.deposit)} deposit. Reply to follow up.\n\n${textSummary(b)}\n\nContact:\n  ${b.name}\n  ${b.phone}\n  ${b.email}\n\nCancellation policy shown to customer: ${refundLine(b)}`;
  await send({
    to: VENUE,
    replyTo: b.email,
    subject: `New booking REQUEST — ${prettyDate(b.dateISO)} ${b.time} (${b.name})`,
    html, text,
  });
}

// Confirmation to the customer — includes the order summary + Zelle QR to pay.
export async function sendCustomerConfirmation(b) {
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#2c2c3a;">
      <h2 style="margin:0 0 4px;">🐤 We got your party request, ${firstName(b.name)}!</h2>
      <p style="color:#6b6b7b;margin:0 0 20px;">Pay the <b>${money(b.deposit)} deposit</b> below to lock in your date. Your time slot is <b>locked in only after the deposit is received</b> — until then it stays open to other bookings.</p>
      <div style="background:#F4F1FB;border-radius:14px;padding:18px 20px;">
        <p style="margin:0 0 12px;font-weight:600;">Your request</p>
        ${htmlTable(b)}
      </div>
      <div style="text-align:center;margin:24px 0 8px;">
        <p style="font-weight:600;margin:0 0 6px;">Pay your ${money(b.deposit)} deposit with Zelle</p>
        <p style="color:#6b6b7b;font-size:13px;margin:0 0 14px;">Open your bank app → Zelle → Scan QR (pays <b>Waddle Waddle Inc.</b>). Send <b>${money(b.deposit)}</b>, then reply to this email.</p>
        <img src="${QR_URL}" alt="Zelle QR code — pay Waddle Waddle Inc." width="240" style="width:240px;max-width:80%;border:1px solid #eee;border-radius:14px;" />
      </div>
      <p style="color:#6b6b7b;font-size:14px;margin:18px 0 4px;">The remaining balance of <b>${money(b.balance)}</b> is due at the venue. Questions? Just reply to this email.</p>
      <p style="color:#9a3b58;font-size:13px;margin:14px 0 0;background:#FDEEF2;border:1px solid #F4C4D2;border-radius:10px;padding:10px 14px;">⚠️ Cancellation policy: ${refundLine(b)}</p>
      <p style="color:#9a9aa8;font-size:13px;margin:16px 0 0;">${VENUE_ADDR}</p>
    </div>`.trim();
  const text = `We got your party request, ${firstName(b.name)}!\n\nPay the ${money(b.deposit)} deposit to lock in your date. Your time slot is locked in only after the deposit is received — until then it stays open to other bookings.\n\n${textSummary(b)}\n\nPay with Zelle: open your bank app, choose Zelle, and pay ${money(b.deposit)} to Waddle Waddle Inc.\nQR code: ${QR_URL}\nThen reply to this email.\n\nRemaining balance of ${money(b.balance)} is due at the venue.\n\nCancellation policy: ${refundLine(b)}\n\n${VENUE_ADDR}`;
  await send({
    to: b.email,
    cc: VENUE, // copy the venue on the exact email the customer receives
    replyTo: SENDER,
    subject: 'We got your Waddle Waddle NY party request 🐤',
    html, text,
  });
}
