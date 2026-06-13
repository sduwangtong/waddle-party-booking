// GET /availability?date=YYYY-MM-DD
// Returns how many active holds each time slot has for the date, so the browser
// can disable full slots. The cap itself lives in capacity.mjs (CAPACITY).
import { queryByDate } from '../shared/dynamo.mjs';
import { CAPACITY, bookedCounts } from '../shared/capacity.mjs';
import { ok, badRequest, serverError } from '../shared/response.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function handler(event) {
  const date = event.queryStringParameters?.date?.trim();
  if (!date || !ISO_DATE.test(date)) return badRequest('Invalid date');

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const booked = bookedCounts(await queryByDate(date), nowSec);
    return ok({ date, capacity: CAPACITY, booked });
  } catch (err) {
    console.error('[availability]', err);
    return serverError('Could not load availability');
  }
}
