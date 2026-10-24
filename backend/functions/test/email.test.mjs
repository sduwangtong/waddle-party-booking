// Customer confirmation email content. SES is mocked so nothing is sent.
// Run: node --test --experimental-test-module-mocks backend/functions/test/
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const sent = [];
mock.module('@aws-sdk/client-ses', {
  namedExports: {
    SESClient: class { async send(cmd) { sent.push(cmd.input); } },
    SendEmailCommand: class { constructor(input) { this.input = input; } },
  },
});

const { sendBookingEmails, PARTY_NOTES } = await import('../shared/email.mjs');
const { validateAndPrice } = await import('../shared/pricing.mjs');

const booking = {
  ...validateAndPrice({
    pkgId: 3, kids: 12,
    name: 'Test User', phone: '5551234567', email: 'cust@example.com',
    dateISO: '2026-12-05', time: '10:00 AM – 12:00 PM', theme: 'Bluey',
    agreedToPolicies: true,
  }),
  bookingId: 'test-123',
};

test('customer email (html + text) carries the helper, service-fee and gratuity notes', async () => {
  sent.length = 0;
  await sendBookingEmails(booking);
  const customer = sent.find(m => m.Destination.ToAddresses[0] === 'cust@example.com');
  assert.ok(customer, 'customer email was sent');
  const html = customer.Message.Body.Html.Data;
  const text = customer.Message.Body.Text.Data;
  assert.equal(PARTY_NOTES.length, 3);
  for (const [heading, body] of PARTY_NOTES) {
    assert.ok(html.includes(heading) && html.includes(body), `html has "${heading}"`);
    assert.ok(text.includes(heading) && text.includes(body), `text has "${heading}"`);
  }
  assert.ok(html.includes('Service fee (10% of base)') && html.includes('$139.90'), 'fee row in summary');
});
