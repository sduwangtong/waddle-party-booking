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

// Slot labels read "H:MM[ AM|PM] – H:MM AM|PM" (en-dash; the start's meridiem is
// implied by the end's when it's left off, as in "1:30 – 3:30 PM"). Parsed to
// [start, end) minutes-from-midnight → null if the label doesn't fit that shape.
const SLOT_LABEL = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\s*–\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

export function slotRange(label) {
  const m = SLOT_LABEL.exec(String(label ?? '').trim());
  if (!m) return null;
  const mins = (h, min, mer) => ((Number(h) % 12) + (/pm/i.test(mer) ? 12 : 0)) * 60 + Number(min);
  const start = mins(m[1], m[2], m[3] || m[6]);
  const end = mins(m[4], m[5], m[6]);
  return end > start ? [start, end] : null;
}

// Rooms clash only on a genuine overlap — back-to-back slots that merely share an
// edge (10:30–12:30 then 12:30–2:30) don't.
const overlaps = (a, b) => !!a && !!b && a[0] < b[1] && b[0] < a[1];

// Which of `slots` a booking holds: its own label, plus any slot its clock window
// runs into. The overlap arm is what keeps parties booked under a retired grid
// (the weekend grid went 4 slots → 3 in Sep 2026) occupying their rooms — without
// it those bookings match no current label and their date reads as wide open.
function slotsHeldBy(item, grid) {
  const range = slotRange(item?.time);
  const held = grid.filter(([, slotAt]) => overlaps(range, slotAt)).map(([slot]) => slot);
  // A booking also always counts against its own label, even one the grid no
  // longer lists — so the cap stays enforced for a label this date doesn't offer
  // (e.g. mid-deploy, while the browser is still handing out the previous grid).
  if (item?.time && !held.includes(item.time)) held.push(item.time);
  return held;
}

// Count active holds against each of the date's slots → { [slot]: count }.
// A blocked slot reports CAPACITY (full) even with zero real bookings.
export function bookedCounts(items, nowSec, slots = []) {
  const grid = slots.map(slot => [slot, slotRange(slot)]);
  const counts = {};
  for (const item of items || []) {
    if (!isActiveHold(item, nowSec)) continue;
    for (const slot of slotsHeldBy(item, grid)) counts[slot] = (counts[slot] || 0) + 1;
  }
  for (const item of items || []) {
    if (item?.status !== 'blocked') continue;
    for (const slot of slotsHeldBy(item, grid)) counts[slot] = CAPACITY;
  }
  return counts;
}
