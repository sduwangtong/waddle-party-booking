// Authoritative pricing — MUST mirror the constants in ../../../index.html.
// The browser sends only selections (package id, kids, option quantities…); the
// server recomputes every dollar here so the client can never dictate the numbers.

export const DEPOSIT = 500;            // deposit base; charged now WITH its tax (see DEPOSIT_DUE)
export const TAX_RATE = 0.08625;       // 8.625% sales tax on the party total
export const MIN_KIDS = 10;
export const MAX_KIDS = 25;

// includedKids = guests covered by the base price (P1/P2: 10, P3/P4: 12).
// Extra kids beyond that are perKid each (and each adds 1 accompanying adult).
export const PACKAGES = [
  { id: 1, name: 'PACKAGE 1', title: 'Classic', base: 599,  perKid: 35, includedKids: 10, maxKids: 15 },
  { id: 2, name: 'PACKAGE 2', title: 'Premium', base: 899,  perKid: 35, includedKids: 10, maxKids: 25 },
  { id: 3, name: 'PACKAGE 3', title: 'Luxury',  base: 1399, perKid: 35, includedKids: 12, maxKids: 25 },
  { id: 4, name: 'PACKAGE 4', title: 'VIP',     base: 1799, perKid: 35, includedKids: 12, maxKids: 25 },
];

// Discount codes — server-owned so the client can never invent a discount.
// 10% off the pre-tax subtotal. MUST mirror DISCOUNT_CODES in index.html.
export const DISCOUNT_CODES = { DAYCARE122: 0.10, IMMEMBER: 0.10, WEEKDAY1: 0.10 };

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
  { id: 'veg_salad', n: 'Vegetable Salad', p: 50 },
  { id: 'fruit_salad', n: 'Fruit Salad', p: 50 },
  { id: 'coke_2l', n: '2L Coke', p: 10 },
  { id: 'lemonade_2l', n: '2L Lemonade', p: 10 },
  { id: 'themed_cake', n: 'Themed Birthday Cake', p: 200 },
  { id: 'sparkling_water', n: 'Sparkling Water', p: 3 },
  { id: 'bottled_water', n: 'Bottled Water', p: 3 },
  { id: 'chicken_parm_hero', n: '🥪 Chicken Cutlet Parmigiana Hero (1 foot)', p: 15 },
  { id: 'eggplant_parm_hero', n: '🥪 Eggplant Parmigiana Hero (1 foot)', p: 15 },
  { id: 'ham_provolone_hero', n: '🥪 Ham & Provolone Hero (1 foot)', p: 15 },
  { id: 'extra_adult', n: 'One Additional Adult', p: 10 },
  { id: 'grip_sock', n: 'Waddle Grip Sock', p: 3 },
  { id: 'photography', n: '📸 Professional Photography Assistance', p: 300 },
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
  // Themes come with Package 3 & 4 only — drop any theme sent for Package 1/2.
  const theme = pkg && pkg.id >= 3 && input?.theme ? String(input.theme).trim().slice(0, 60) : null;

  // Birthday-child details (collected at checkout).
  const childName = String(input?.childName ?? '').trim().slice(0, 80);
  const childAgeNum = Number(input?.childAge);
  const childAge = Number.isInteger(childAgeNum) && childAgeNum >= 1 && childAgeNum <= 17 ? childAgeNum : null;
  const childGender = String(input?.childGender ?? '').trim().slice(0, 30);
  const allergies = String(input?.allergies ?? '').trim().slice(0, 300);
  const notes = String(input?.notes ?? '').trim().slice(0, 800);
  const discCode = String(input?.discountCode ?? '').trim().toUpperCase();
  const agreedToPolicies = input?.agreedToPolicies === true;
  const agreedAt = String(input?.agreedAt ?? '').trim().slice(0, 40) || new Date().toISOString();

  if (!pkg) throw new Error('Invalid package');
  if (!Number.isInteger(kids) || kids < MIN_KIDS || kids > MAX_KIDS) throw new Error('Invalid kids count');
  if (!ISO_DATE.test(dateISO)) throw new Error('Invalid date');
  if (!time || time.length > 40) throw new Error('Invalid time slot');
  if (name.length < 2 || name.length > 80) throw new Error('Invalid name');
  if (phone.replace(/\D/g, '').length < 7) throw new Error('Invalid phone');
  if (!EMAIL.test(email) || email.length > 120) throw new Error('Invalid email');
  // Birthday-child fields are best-effort here — the booking form already requires them,
  // and keeping the API lenient lets it accept older clients during a deploy (childAge is
  // normalized to null when missing/out of range; the number balloon is then just unset).

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

  const extra = Math.max(0, kids - pkg.includedKids);
  const adults = pkg.includedKids + extra;    // each extra kid includes 1 accompanying adult
  const kidsExtra = extra * pkg.perKid;
  const gross = round2(pkg.base + kidsExtra + optionsSum);   // pre-discount, pre-tax
  const discountRate = DISCOUNT_CODES[discCode] || 0;        // unknown codes silently apply 0%
  const discountCode = discountRate > 0 ? discCode : null;
  const discount = round2(gross * discountRate);
  const subtotal = round2(gross - discount);                 // 10% off applies before tax
  const tax = round2(subtotal * TAX_RATE);
  const saleTotal = round2(subtotal + tax);
  // Split tax: the deposit charged now includes tax on its $500 base; the
  // remainder (subtotal − 500) carries the rest of the tax, due at the venue.
  // depositTax/depositDue are fixed ($43.13 / $543.13) since the base is always $500.
  const depositTax = round2(DEPOSIT * TAX_RATE);     // 43.13
  const depositDue = round2(DEPOSIT + depositTax);   // 543.13 — what Stripe charges now
  const remainingTax = round2(tax - depositTax);     // remainder absorbs the rounding cent
  const balance = round2(saleTotal - depositDue);    // due at venue (= remaining base + remainingTax)

  return {
    pkgId: pkg.id, pkgName: pkg.name, pkgTitle: pkg.title,
    kids, extra, adults, dateISO, time, theme,
    childName, childAge, childGender, allergies, notes,
    name, phone, email,
    options: selected, optionsSum,
    gross, discountCode, discountRate, discount,
    subtotal, tax, saleTotal,
    deposit: DEPOSIT, depositTax, depositDue, remainingTax, balance,
    agreedToPolicies, agreedAt,
  };
}
