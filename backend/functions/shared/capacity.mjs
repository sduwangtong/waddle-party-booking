// Slot-capacity rules. A date+time slot holds at most CAPACITY active bookings.
// A booking is "active" (counts toward the cap) if it's paid, or pending with a
// checkout that hasn't expired yet — abandoned checkouts free the slot when their
// 30-minute hold lapses, with no cleanup job (expired pendings are just ignored).
// An admin block (status 'blocked', one item per slot, written via /admin/block)
// fills its slot entirely regardless of how many real bookings it holds.
export const CAPACITY = 3;

export function isActiveHold(item, nowSec) {
  if (!item) return false;
  if (item.status === 'paid') return true;
  return item.status === 'pending' && Number(item.expiresAt) > nowSec;
}

// Count active holds per time slot for one date's bookings → { [time]: count }.
// A blocked slot reports CAPACITY (full) even with zero real bookings.
export function bookedCounts(items, nowSec) {
  const counts = {};
  for (const item of items || []) {
    if (isActiveHold(item, nowSec)) {
      counts[item.time] = (counts[item.time] || 0) + 1;
    }
  }
  for (const item of items || []) {
    if (item?.status === 'blocked') counts[item.time] = CAPACITY;
  }
  return counts;
}
