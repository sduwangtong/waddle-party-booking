// Pure-logic tests for slot-capacity counting. Run: node --test backend/functions/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY, isActiveHold, bookedCounts, slotRange } from '../shared/capacity.mjs';
import { slotsFor } from '../shared/slots.mjs';

// The weekend grid before Sep 2026 — bookings taken under these labels are still
// on the books and must keep holding rooms in the 3-slot grid that replaced them.
const RETIRED_WEEKEND = ['10:00 AM – 12:00 PM', '12:30 – 2:30 PM', '3:00 – 5:00 PM', '5:30 – 7:30 PM'];

const NOW = 1_700_000_000; // fixed "now" in epoch seconds
const future = NOW + 600;  // 10 min ahead — still within a 30-min hold
const past = NOW - 600;    // 10 min ago — expired hold

test('CAPACITY is 3', () => {
  assert.equal(CAPACITY, 3);
});

test('isActiveHold: paid always counts', () => {
  assert.equal(isActiveHold({ status: 'paid' }, NOW), true);
  // paid ignores expiresAt entirely
  assert.equal(isActiveHold({ status: 'paid', expiresAt: past }, NOW), true);
});

test('isActiveHold: pending counts only while not expired', () => {
  assert.equal(isActiveHold({ status: 'pending', expiresAt: future }, NOW), true);
  assert.equal(isActiveHold({ status: 'pending', expiresAt: past }, NOW), false);
});

test('isActiveHold: other statuses never count', () => {
  assert.equal(isActiveHold({ status: 'refunded' }, NOW), false);
  assert.equal(isActiveHold({ status: 'cancelled' }, NOW), false);
  assert.equal(isActiveHold(null, NOW), false);
  assert.equal(isActiveHold(undefined, NOW), false);
});

test('bookedCounts: groups active holds by time, ignores expired/refunded', () => {
  const items = [
    { time: '10:00 AM – 12:00 PM', status: 'paid' },
    { time: '10:00 AM – 12:00 PM', status: 'pending', expiresAt: future },
    { time: '10:00 AM – 12:00 PM', status: 'pending', expiresAt: past },     // expired — excluded
    { time: '10:00 AM – 12:00 PM', status: 'refunded' },                     // excluded
    { time: '3:00 – 5:00 PM', status: 'paid' },
  ];
  const counts = bookedCounts(items, NOW, RETIRED_WEEKEND);
  assert.equal(counts['10:00 AM – 12:00 PM'], 2);
  assert.equal(counts['3:00 – 5:00 PM'], 1);
});

test('bookedCounts: empty / nullish input → empty map', () => {
  assert.deepEqual(bookedCounts([], NOW, RETIRED_WEEKEND), {});
  assert.deepEqual(bookedCounts(null, NOW, RETIRED_WEEKEND), {});
  assert.deepEqual(bookedCounts(undefined, NOW, RETIRED_WEEKEND), {});
});

test('cap boundary: a 3rd active hold reaches CAPACITY, a 4th would exceed it', () => {
  const three = [
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'pending', expiresAt: future },
  ];
  assert.equal(bookedCounts(three, NOW, ['T']).T, CAPACITY);          // slot now full
  assert.equal(bookedCounts(three, NOW, ['T']).T >= CAPACITY, true);  // createCheckout would 409

  const expiredFreesSlot = [
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'pending', expiresAt: past }, // abandoned checkout frees a seat
  ];
  assert.equal(bookedCounts(expiredFreesSlot, NOW, ['T']).T, 2);
});

test('isActiveHold: blocked is not an active hold (it fills the slot in bookedCounts instead)', () => {
  assert.equal(isActiveHold({ status: 'blocked' }, NOW), false);
});

test('bookedCounts: a blocked item fills its slot to CAPACITY with zero bookings', () => {
  const items = [{ time: 'T', status: 'blocked' }];
  assert.equal(bookedCounts(items, NOW, ['T']).T, CAPACITY);
});

test('bookedCounts: blocked overrides partial bookings, leaves other slots alone', () => {
  const items = [
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'blocked' },
    { time: 'U', status: 'paid' },
  ];
  const counts = bookedCounts(items, NOW, ['T', 'U']);
  assert.equal(counts.T, CAPACITY); // blocked wins over 1 paid
  assert.equal(counts.U, 1);        // other slot unaffected
});

// ---- Weekend grid: 4 slots → 3 from GRID_SWITCH (2026-11-01) ----------------
// Counting by label alone left every already-booked date reading as wide open,
// because a booking taken under the retired grid carries no current label.

test('slotRange: parses labels, inferring the start meridiem from the end', () => {
  assert.deepEqual(slotRange('10:30 AM – 12:30 PM'), [630, 750]);
  assert.deepEqual(slotRange('1:30 – 3:30 PM'), [810, 930]);   // start PM implied
  assert.deepEqual(slotRange('4:30 – 6:30 PM'), [990, 1110]);
  assert.deepEqual(slotRange('12:30 – 2:30 PM'), [750, 870]);  // noon hour, not midnight
  assert.deepEqual(slotRange('10:00 AM – 12:00 PM'), [600, 720]);
});

test('slotRange: unparseable labels are null, not a bogus window', () => {
  assert.equal(slotRange('T'), null);
  assert.equal(slotRange(''), null);
  assert.equal(slotRange(null), null);
  assert.equal(slotRange('5:30 - 7:30 PM'), null); // hyphen, not the canonical en-dash
});

test('GRID_SWITCH: weekends keep 4 slots before it and show 3 from it on', () => {
  assert.deepEqual(slotsFor('2026-10-31'), RETIRED_WEEKEND);      // Sat, day before
  assert.equal(slotsFor('2026-11-01').length, 3);                 // Sun, switch day
  assert.deepEqual(slotsFor('2026-11-01'), ['10:30 AM – 12:30 PM', '1:30 – 3:30 PM', '4:30 – 6:30 PM']);
  assert.deepEqual(slotsFor('2026-09-26'), RETIRED_WEEKEND);      // busy Sep Sat, unchanged
});

test('GRID_SWITCH does not touch weekdays on either side', () => {
  assert.deepEqual(slotsFor('2026-10-12'), ['5:30 – 7:30 PM']); // Mon before
  assert.deepEqual(slotsFor('2026-11-09'), ['5:30 – 7:30 PM']); // Mon after
});

test('pre-switch dates count by label, exactly as before', () => {
  const items = [
    { time: '12:30 – 2:30 PM', status: 'paid' },
    { time: '12:30 – 2:30 PM', status: 'paid' },
    { time: '3:00 – 5:00 PM', status: 'paid' },
  ];
  const counts = bookedCounts(items, NOW, slotsFor('2026-09-26'));
  assert.equal(counts['12:30 – 2:30 PM'], 2);
  assert.equal(counts['3:00 – 5:00 PM'], 1);
  assert.equal(counts['10:00 AM – 12:00 PM'] ?? 0, 0); // no bleed between old slots
});

test('Sat 2026-11-07 as actually booked: the 10:00 party holds the new morning slot', () => {
  const items = [{ time: '10:00 AM – 12:00 PM', status: 'paid' }]; // the one real post-switch booking
  const counts = bookedCounts(items, NOW, slotsFor('2026-11-07'));
  assert.equal(counts['10:30 AM – 12:30 PM'], 1);        // overlaps 10:30–12:00
  assert.equal(counts['1:30 – 3:30 PM'] ?? 0, 0);        // afternoon genuinely free
  assert.equal(counts['4:30 – 6:30 PM'] ?? 0, 0);
});

test('Sat 2027-03-20 as actually booked: same carry-over holds a year out', () => {
  const items = [{ time: '10:00 AM – 12:00 PM', status: 'paid' }];
  const counts = bookedCounts(items, NOW, slotsFor('2027-03-20'));
  assert.equal(counts['10:30 AM – 12:30 PM'], 1);
});

test('a retired-label booking fills a post-switch slot it runs into', () => {
  const items = [
    { time: '12:30 – 2:30 PM', status: 'paid' },
    { time: '12:30 – 2:30 PM', status: 'paid' },
    { time: '12:30 – 2:30 PM', status: 'paid' },
  ];
  const counts = bookedCounts(items, NOW, slotsFor('2026-11-07'));
  assert.ok(counts['1:30 – 3:30 PM'] >= CAPACITY);       // would have read 0 → oversold
  assert.equal(counts['10:30 AM – 12:30 PM'] ?? 0, 0);   // ends exactly as that slot starts
});

test('back-to-back slots do not count against each other', () => {
  const items = [{ time: '10:30 AM – 12:30 PM', status: 'paid' }];
  const counts = bookedCounts(items, NOW, slotsFor('2026-11-07'));
  assert.equal(counts['10:30 AM – 12:30 PM'], 1);
  assert.equal(counts['1:30 – 3:30 PM'] ?? 0, 0);
});

test('a blocked retired slot closes every post-switch slot it runs into', () => {
  const items = [{ time: '3:00 – 5:00 PM', status: 'blocked' }];
  const counts = bookedCounts(items, NOW, slotsFor('2026-11-07'));
  assert.equal(counts['1:30 – 3:30 PM'], CAPACITY);  // overlaps 3:00–3:30
  assert.equal(counts['4:30 – 6:30 PM'], CAPACITY);  // and 4:30–5:00
});

test('a booking still caps its own label even when the grid no longer lists it', () => {
  // Mid-deploy: browser hands out the retired grid while the server is on the new
  // one. The old label must still fill up rather than accept bookings forever.
  const three = [
    { time: '12:30 – 2:30 PM', status: 'paid' },
    { time: '12:30 – 2:30 PM', status: 'paid' },
    { time: '12:30 – 2:30 PM', status: 'paid' },
  ];
  const counts = bookedCounts(three, NOW, slotsFor('2026-11-07'));
  assert.equal(counts['12:30 – 2:30 PM'], CAPACITY); // createCheckout would 409
});
