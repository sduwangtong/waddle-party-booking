// Authoritative pricing — MUST mirror the constants in ../../../index.html.
// The browser sends only selections (package id, kids, option quantities…); the
// server recomputes every dollar here so the client can never dictate the numbers.

export const DEPOSIT = 500;            // deposit, untaxed, collected via Zelle
export const TAX_RATE = 0.08625;       // 8.625% sales tax on the party total
export const MIN_KIDS = 10;
export const MAX_KIDS = 25;

export const PACKAGES = [
  { id: 1, name: 'PACKAGE 1', title: 'Classic', base: 599,  perKid: 35 },
  { id: 2, name: 'PACKAGE 2', title: 'Premium', base: 899,  perKid: 35 },
  { id: 3, name: 'PACKAGE 3', title: 'Luxury',  base: 1399, perKid: 35 },
  { id: 4, name: 'PACKAGE 4', title: 'VIP',     base: 1799, perKid: 35 },
];

// Add-on extras — MUST mirror OPTIONS in index.html.
export const OPTIONS = [
  { id: 'balloon_dog', n: 'Balloon Dog', p: 3 },
  { id: 'goodie_bags', n: 'Goodie Bags', p: 8 },
  { id: 'special_gift', n: 'Special Gift for Birthday Kid', p: 100 },
  { id: 'juice_box', n: 'Juice Box', p: 3 },
  { id: 'milk_box', n: 'Milk Box', p: 3 },
  { id: 'fruit_pouch', n: 'Fruit Pouch', p: 3 },
  { id: 'yogurt_pouch', n: 'Yogurt Pouch', p: 3 },
  { id: 'pizza_cheese', n: 'Pizza (Cheese 18")', p: 30 },
  { id: 'veg_salad', n: 'Vegetable Salad', p: 30 },
  { id: 'fruit_salad', n: 'Fruit Salad', p: 30 },
  { id: 'coke_2l', n: '2L Coke', p: 10 },
  { id: 'lemonade_2l', n: '2L Lemonade', p: 10 },
  { id: 'themed_cake', n: 'Themed Birthday Cake', p: 200 },
  { id: 'sparkling_water', n: 'Sparkling Water', p: 3 },
  { id: 'bottled_water', n: 'Bottled Water', p: 3 },
  { id: 'extra_adult', n: 'One Additional Adult', p: 10 },
  { id: 'grip_sock', n: 'Waddle Grip Sock', p: 3 },
  { id: 'outside_food_fee', n: 'Outside Food Cleaning Fee', p: 100 },
];
const OPTION_BY_ID = Object.fromEntries(OPTIONS.map(o => [o.id, o]));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const round2 = n => Math.round(n * 100) / 100;

// Validates the raw booking payload and returns a normalized, priced booking.
// Throws Error(message) on any invalid input — the caller maps that to a 400.
export function validateAndPrice(input) {
  const kids = Number(input?.kids);
  const pkg = PACKAGES.find(p => p.id === Number(input?.pkgId));
  const name = String(input?.name ?? '').trim();
  const phone = String(input?.phone ?? '').trim();
  const email = String(input?.email ?? '').trim().toLowerCase();
  const dateISO = String(input?.dateISO ?? '').trim();
  const time = String(input?.time ?? '').trim();
  const theme = input?.theme ? String(input.theme).trim().slice(0, 60) : null;

  if (!pkg) throw new Error('Invalid package');
  if (!Number.isInteger(kids) || kids < MIN_KIDS || kids > MAX_KIDS) throw new Error('Invalid kids count');
  if (!ISO_DATE.test(dateISO)) throw new Error('Invalid date');
  if (!time || time.length > 40) throw new Error('Invalid time slot');
  if (name.length < 2 || name.length > 80) throw new Error('Invalid name');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Invalid phone');
  if (!EMAIL.test(email) || email.length > 120) throw new Error('Invalid email');

  // Add-on extras — server owns the catalog + prices; ignore unknown ids.
  const rawOptions = (input?.options && typeof input.options === 'object') ? input.options : {};
  const selected = [];
  let optionsSum = 0;
  for (const [id, qtyRaw] of Object.entries(rawOptions)) {
    const item = OPTION_BY_ID[id];
    if (!item) continue;
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty < 0 || qty > 99) throw new Error('Invalid option quantity');
    if (qty > 0) {
      selected.push({ id, name: item.n, price: item.p, qty, total: item.p * qty });
      optionsSum += item.p * qty;
    }
  }

  const extra = Math.max(0, kids - MIN_KIDS);
  const adults = 10 + extra;                  // each extra kid includes 1 accompanying adult
  const kidsExtra = extra * pkg.perKid;
  const subtotal = round2(pkg.base + kidsExtra + optionsSum);
  const tax = round2(subtotal * TAX_RATE);
  const saleTotal = round2(subtotal + tax);
  const balance = round2(saleTotal - DEPOSIT);

  return {
    pkgId: pkg.id, pkgName: pkg.name, pkgTitle: pkg.title,
    kids, extra, adults, dateISO, time, theme,
    name, phone, email,
    options: selected, optionsSum,
    subtotal, tax, saleTotal,
    deposit: DEPOSIT, balance,
  };
}
