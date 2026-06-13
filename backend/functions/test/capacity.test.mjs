// Pure-logic tests for slot-capacity counting. Run: node --test backend/functions/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPACITY, isActiveHold, bookedCounts } from '../shared/capacity.mjs';

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
  const counts = bookedCounts(items, NOW);
  assert.deepEqual(counts, { '10:00 AM – 12:00 PM': 2, '3:00 – 5:00 PM': 1 });
});

test('bookedCounts: empty / nullish input → empty map', () => {
  assert.deepEqual(bookedCounts([], NOW), {});
  assert.deepEqual(bookedCounts(null, NOW), {});
  assert.deepEqual(bookedCounts(undefined, NOW), {});
});

test('cap boundary: a 3rd active hold reaches CAPACITY, a 4th would exceed it', () => {
  const three = [
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'pending', expiresAt: future },
  ];
  assert.equal(bookedCounts(three, NOW).T, CAPACITY);            // slot now full
  assert.equal(bookedCounts(three, NOW).T >= CAPACITY, true);    // createCheckout would 409

  const expiredFreesSlot = [
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'paid' },
    { time: 'T', status: 'pending', expiresAt: past }, // abandoned checkout frees a seat
  ];
  assert.equal(bookedCounts(expiredFreesSlot, NOW).T, 2);
});
