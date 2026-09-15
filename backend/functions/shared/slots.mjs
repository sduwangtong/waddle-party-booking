// Canonical slot lists (must match WEEKEND_SLOTS/WEEKDAY_SLOTS in the booking
// page). Served by GET /admin/blocks so admin.html never hardcodes the exact
// en-dash slot strings.
//
// The weekend grid drops from 4 party slots to 3 on GRID_SWITCH. Sep/Oct 2026
// were already densely booked under the 4-slot grid, so those dates keep it and
// the new grid starts once the calendar is nearly empty — one existing party on
// 11/07. Once GRID_SWITCH is in the past, delete WEEKEND_SLOTS_PRE_SWITCH and
// the branch in slotsFor.
export const GRID_SWITCH = '2026-11-01';
export const WEEKEND_SLOTS = ['10:30 AM – 12:30 PM', '1:30 – 3:30 PM', '4:30 – 6:30 PM'];
export const WEEKEND_SLOTS_PRE_SWITCH = ['10:00 AM – 12:00 PM', '12:30 – 2:30 PM', '3:00 – 5:00 PM', '5:30 – 7:30 PM'];
export const WEEKDAY_SLOTS = ['5:30 – 7:30 PM'];

export function slotsFor(dateISO) {
  const day = new Date(dateISO + 'T12:00:00Z').getUTCDay();
  if (day !== 0 && day !== 6) return WEEKDAY_SLOTS;
  return dateISO < GRID_SWITCH ? WEEKEND_SLOTS_PRE_SWITCH : WEEKEND_SLOTS;
}
