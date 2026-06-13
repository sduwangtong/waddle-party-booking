// Slot-capacity rules. A date+time slot holds at most CAPACITY active bookings.
// A booking is "active" (counts toward the cap) if it's paid, or pending with a
// checkout that hasn't expired yet — abandoned checkouts free the slot when their
// 30-minute hold lapses, with no cleanup job (expired pendings are just ignored).
export const CAPACITY = 3;

export function isActiveHold(item, nowSec) {
  if (!item) return false;
  if (item.status === 'paid') return true;
  return item.status === 'pending' && Number(item.expiresAt) > nowSec;
}

// Count active holds per time slot for one date's bookings → { [time]: count }.
export function bookedCounts(items, nowSec) {
  const counts = {};
  for (const item of items || []) {
    if (isActiveHold(item, nowSec)) {
      counts[item.time] = (counts[item.time] || 0) + 1;
    }
  }
  return counts;
}
