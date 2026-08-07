// Canonical slot lists (must match WEEKEND_SLOTS/WEEKDAY_SLOTS in the booking
// page). Served by GET /admin/blocks so admin.html never hardcodes the exact
// en-dash slot strings.
export const WEEKEND_SLOTS = ['10:00 AM – 12:00 PM', '12:30 – 2:30 PM', '3:00 – 5:00 PM', '5:30 – 7:30 PM'];
export const WEEKDAY_SLOTS = ['5:30 – 7:30 PM'];

export function slotsFor(dateISO) {
  const day = new Date(dateISO + 'T12:00:00Z').getUTCDay();
  return day === 0 || day === 6 ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
}
