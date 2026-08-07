// Pure-logic tests for split-tax pricing. Run: node --test backend/functions/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndPrice, DEPOSIT, TAX_RATE, MAX_KIDS } from '../shared/pricing.mjs';

const round2 = n => Math.round(n * 100) / 100;

// Minimal valid booking; override the priced fields per case.
const book = over => validateAndPrice({
  pkgId: 1, kids: 10,
  name: 'Test User', phone: '5551234567', email: 'a@b.com',
  dateISO: '2026-09-01', time: '10:00 AM – 12:00 PM',
  agreedToPolicies: true,
  ...over,
});

const CASES = [
  { label: 'Pkg1 / 10 kids',            over: { pkgId: 1, kids: 10 } },
  { label: 'Pkg1 / 10 kids / WEEKDAY1', over: { pkgId: 1, kids: 10, discountCode: 'WEEKDAY1' } },
  { label: 'Pkg2 / 20 kids',            over: { pkgId: 2, kids: 20 } },
  { label: 'Pkg4 / 15 kids + cake',     over: { pkgId: 4, kids: 15, options: { themed_cake: 1 } } },
];

test('deposit charged now is a fixed $500 + tax = $543.13 for every booking', () => {
  const expectTax = round2(DEPOSIT * TAX_RATE); // 43.13
  for (const c of CASES) {
    const b = book(c.over);
    assert.equal(b.depositTax, expectTax, `${c.label}: depositTax`);
    assert.equal(b.depositTax, 43.13, `${c.label}: depositTax literal`);
    assert.equal(b.depositDue, 543.13, `${c.label}: depositDue`);
  }
});

test('Stripe charges depositDue in whole cents (54313¢)', () => {
  for (const c of CASES) {
    assert.equal(Math.round(book(c.over).depositDue * 100), 54313, c.label);
  }
});

test('paid now + remaining at venue reconciles to the sale total (no penny drift)', () => {
  for (const c of CASES) {
    const b = book(c.over);
    assert.equal(round2(b.depositDue + b.balance), b.saleTotal, `${c.label}: depositDue + balance === saleTotal`);
    assert.equal(round2(b.depositTax + b.remainingTax), b.tax, `${c.label}: depositTax + remainingTax === tax`);
    assert.ok(b.balance > 0, `${c.label}: balance stays positive`);
  }
});

test('total tax is unchanged from the pre-split behavior (tax on full subtotal)', () => {
  for (const c of CASES) {
    const b = book(c.over);
    assert.equal(b.tax, round2(b.subtotal * TAX_RATE), c.label);
    assert.equal(b.saleTotal, round2(b.subtotal + b.tax), c.label);
  }
});

test('included kids per package: P1/P2 cover 10, P3/P4 cover 12 (base, 0 extra)', () => {
  assert.equal(book({ pkgId: 1, kids: 10 }).extra, 0);
  assert.equal(book({ pkgId: 1, kids: 10 }).subtotal, 599);
  assert.equal(book({ pkgId: 3, kids: 12 }).extra, 0);          // P3 base now includes 12
  assert.equal(book({ pkgId: 3, kids: 12 }).subtotal, 1399);
  assert.equal(book({ pkgId: 4, kids: 12 }).subtotal, 1799);
});

test('extra kids charge above the included count, and each adds an adult', () => {
  const p1 = book({ pkgId: 1, kids: 12 });   // 2 over P1's 10
  assert.equal(p1.extra, 2);
  assert.equal(p1.subtotal, 599 + 2 * 35);
  assert.equal(p1.adults, 12);               // 10 included + 2 extra
  const p3 = book({ pkgId: 3, kids: 14 });   // 2 over P3's 12
  assert.equal(p3.extra, 2);
  assert.equal(p3.subtotal, 1399 + 2 * 35);
  assert.equal(p3.adults, 14);               // 12 included + 2 extra
});

test('max party size is 25 kids; 26 is rejected', () => {
  assert.equal(MAX_KIDS, 25);
  assert.equal(book({ pkgId: 4, kids: 25 }).kids, 25);          // boundary ok
  assert.throws(() => book({ pkgId: 4, kids: 26 }), /Invalid kids count/);
});

test('Pkg1 worked example matches the agreed numbers', () => {
  const b = book({ pkgId: 1, kids: 10 });
  assert.equal(b.subtotal, 599);
  assert.equal(b.tax, 51.66);
  assert.equal(b.saleTotal, 650.66);
  assert.equal(b.depositDue, 543.13);
  assert.equal(b.balance, 107.53);
});

test('Package 1 accepts up to 15 kids and prices correctly (maxKids field exists on the catalog but is not enforced yet — Phase 1)', () => {
  const b = book({ pkgId: 1, kids: 15 });
  assert.equal(b.extra, 5);              // 15 - includedKids(10)
  assert.equal(b.adults, 15);            // 10 included + 5 extra
  assert.equal(b.subtotal, 599 + 5 * 35);
});

// This phase deliberately does not enforce the per-package maxKids cap yet (Package 1's
// live cached frontend can still send up to 25 kids). Once Phase 3 enforcement lands,
// this should become: assert.throws(() => book({ pkgId: 1, kids: 16 }), /.../).
test('Package 1 still allows 16 kids in this phase — maxKids is not enforced yet', () => {
  assert.doesNotThrow(() => book({ pkgId: 1, kids: 16 }));
});

test('three hero sandwich add-ons price at $15 each', () => {
  const b = book({ pkgId: 1, kids: 10, options: { chicken_parm_hero: 2, eggplant_parm_hero: 1, ham_provolone_hero: 1 } });
  assert.equal(b.optionsSum, 2 * 15 + 1 * 15 + 1 * 15);
  const byId = Object.fromEntries(b.options.map(o => [o.id, o]));
  assert.deepEqual(byId.chicken_parm_hero, { id: 'chicken_parm_hero', name: '🥪 Chicken Cutlet Parmigiana Hero (1 foot)', price: 15, qty: 2, total: 30 });
  assert.deepEqual(byId.eggplant_parm_hero, { id: 'eggplant_parm_hero', name: '🥪 Eggplant Parmigiana Hero (1 foot)', price: 15, qty: 1, total: 15 });
  assert.deepEqual(byId.ham_provolone_hero, { id: 'ham_provolone_hero', name: '🥪 Ham & Provolone Hero (1 foot)', price: 15, qty: 1, total: 15 });
});

test('professional photography assistance add-on prices at $300', () => {
  const b = book({ pkgId: 1, kids: 10, options: { photography: 1 } });
  assert.equal(b.optionsSum, 300);
  const byId = Object.fromEntries(b.options.map(o => [o.id, o]));
  assert.deepEqual(byId.photography, { id: 'photography', name: '📸 Professional Photography Assistance', price: 300, qty: 1, total: 300 });
});

test('agreedToPolicies/agreedAt are accepted and passed through (not required yet — Phase 1)', () => {
  const withAgreement = book({ agreedToPolicies: true, agreedAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(withAgreement.agreedToPolicies, true);
  assert.equal(withAgreement.agreedAt, '2026-01-01T00:00:00.000Z');

  // Bypass the book() helper's default so agreedToPolicies is genuinely omitted.
  const withoutAgreement = validateAndPrice({
    pkgId: 1, kids: 10,
    name: 'Test User', phone: '5551234567', email: 'a@b.com',
    dateISO: '2026-09-01', time: '10:00 AM – 12:00 PM',
  });
  assert.equal(withoutAgreement.agreedToPolicies, false);
  assert.ok(typeof withoutAgreement.agreedAt === 'string' && withoutAgreement.agreedAt.length > 0);
});
