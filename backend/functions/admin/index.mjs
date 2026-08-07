// Admin slot blocking — used by admin.html to close a date+time slot to new
// bookings (e.g. a whole-playground private party) without fake paid records.
//   GET  /admin/blocks?date=YYYY-MM-DD   → { date, capacity, booked, blocks }
//   POST /admin/block    { date, time, reason? } → put one status:'blocked' item
//   POST /admin/unblock  { date, time }          → delete that item
// Auth: x-admin-token header must equal the ADMIN_TOKEN env var (stack parameter).
import { timingSafeEqual } from 'node:crypto';
import { putBooking, deleteBooking, queryByDate } from '../shared/dynamo.mjs';
import { CAPACITY, bookedCounts } from '../shared/capacity.mjs';
import { slotsFor } from '../shared/slots.mjs';
import { json, ok, badRequest, serverError } from '../shared/response.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Deterministic id per date+slot ("5:30 – 7:30 PM" → block-2026-08-02-530730PM),
// so block is idempotent and unblock needs no lookup.
const blockId = (date, time) => `block-${date}-${time.replace(/[^0-9APMapm]+/g, '')}`;

function authorized(event) {
  const expect = process.env.ADMIN_TOKEN || '';
  const got = event.headers?.['x-admin-token'] || '';
  if (!expect || got.length !== expect.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}

// Both POST bodies carry {date, time}. The time must be one of the date's
// canonical slot strings (e.g. "5:30 – 7:30 PM") — no typo'd en-dashes.
function parseSlot(body) {
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  const time = typeof body.time === 'string' ? body.time.trim() : '';
  if (!ISO_DATE.test(date)) throw new Error('Invalid date');
  if (!slotsFor(date).includes(time)) throw new Error('Invalid time slot');
  return { date, time };
}

export async function handler(event) {
  if (!authorized(event)) return json(401, { error: 'unauthorized' });

  try {
    switch (event.routeKey) {
      case 'GET /admin/blocks': {
        const date = event.queryStringParameters?.date?.trim();
        if (!date || !ISO_DATE.test(date)) return badRequest('Invalid date');
        const items = await queryByDate(date);
        const nowSec = Math.floor(Date.now() / 1000);
        return ok({
          date,
          capacity: CAPACITY,
          slots: slotsFor(date),
          booked: bookedCounts(items, nowSec),
          blocks: items
            .filter(i => i.status === 'blocked')
            .map(({ time, reason, createdAt }) => ({ time, reason, createdAt })),
        });
      }

      case 'POST /admin/block': {
        const body = JSON.parse(event.body || '{}');
        const { date, time } = parseSlot(body);
        await putBooking({
          bookingId: blockId(date, time),
          dateISO: date,
          time,
          status: 'blocked',
          reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : '',
          createdAt: new Date().toISOString(),
        });
        return ok({ blocked: true, date, time });
      }

      case 'POST /admin/unblock': {
        const { date, time } = parseSlot(JSON.parse(event.body || '{}'));
        await deleteBooking(blockId(date, time));
        return ok({ blocked: false, date, time });
      }

      default:
        return badRequest('Unknown route');
    }
  } catch (err) {
    if (err instanceof SyntaxError || /^Invalid /.test(err.message)) return badRequest(err.message);
    console.error('[admin]', err);
    return serverError('Admin operation failed');
  }
}
