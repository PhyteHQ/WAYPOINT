import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLeg, optimizeTour, simulate, repeatTour, PROFILES } from '../src/trade.mjs';

const offer = (id, buy, sell, extra = {}) => ({ id, name: id, buy, sell, volume: 1, originalVolume: 1, stock: 0, min: 0, max: 100, ...extra });
const npc = (id, offers) => ({ id, name: id, kind: 'npc', offers });
const pob = (id, offers, cash = 10000, space = 10000) => ({ id, name: id, kind: 'pob', offers, cash, space });
function shipment(source, target, ids) {
  const items = ids.map(id => makeLeg(source, target, id, PROFILES[0]));
  return { ...items[0], items };
}

test('a limited best good is complemented by another good on the same physical flight', () => {
  const source = pob('s', [offer('a', 10, null, { stock: 5, min: 3 }), offer('b', 10, null, { stock: 10 })]);
  const target = npc('t', [offer('a', null, 30), offer('b', null, 20)]);
  const leg = shipment(source, target, ['a', 'b']);
  const quote = optimizeTour([leg], [source, target], { cargo: 10, capital: 1000 });
  assert.deepEqual(quote.itemQuantities, [[2, 8]]); assert.equal(quote.profit, 120); assert.equal(quote.peakCargo, 10);
  assert.equal(quote.loads[0].length, 2); assert.equal(quote.bases[0].offers[0].stock, 3);
  assert.deepEqual(source.offers.map(o => o.stock), [5, 10], 'quoting does not mutate the market snapshot');
});

test('mixed goods share target money, original storage volume and per-good demand', () => {
  const source = npc('s', [offer('a', 10, null, { volume: 2 }), offer('b', 10, null)]);
  const target = pob('t', [offer('a', null, 30, { volume: 2, originalVolume: 3, max: 2 }),
    offer('b', null, 20, { originalVolume: 2 })], 100, 10);
  const leg = shipment(source, target, ['a', 'b']);
  const quote = optimizeTour([leg], [source, target], { cargo: 10, capital: 100 });
  assert.deepEqual(quote.itemQuantities, [[2, 2]]); assert.equal(quote.profit, 60); assert.equal(quote.peakCargo, 6);
  const after = quote.bases.find(b => b.id === 't'); assert.equal(after.cash, 0); assert.equal(after.space, 0);
  assert.equal(simulate([leg], [[2, 3]], [source, target], { cargo: 10, capital: 100 }), null);
});

test('the player has one shared purchase budget for the whole manifest', () => {
  const source = pob('s', [offer('a', 10, null, { stock: 1 }), offer('b', 10, null, { stock: 10 })], 0, 0);
  const target = npc('t', [offer('a', null, 30), offer('b', null, 20)]);
  const quote = optimizeTour([shipment(source, target, ['a', 'b'])], [source, target], { cargo: 10, capital: 25 });
  assert.deepEqual(quote.itemQuantities, [[1, 1]]); assert.equal(quote.capitalNeeded, 20); assert.equal(quote.profit, 30);
});

test('optional goods with impossible reserve/demand may have zero quantity without blocking the shipment', () => {
  for (const policy of ['reserve', 'demand']) {
    const source = pob('s', [offer('a', 10, null, { stock: policy === 'reserve' ? 0 : 10, min: policy === 'reserve' ? 5 : 0 }),
      offer('b', 10, null, { stock: 10 })]);
    const target = pob('t', [offer('a', null, 100, { stock: policy === 'demand' ? 5 : 0, max: 3 }), offer('b', null, 20)]);
    const quote = optimizeTour([shipment(source, target, ['a', 'b'])], [source, target], { cargo: 10, capital: 1000 });
    assert.deepEqual(quote.itemQuantities, [[0, 10]], policy); assert.equal(quote.profit, 100);
  }
});

test('buying mixed return cargo first can finance incoming cargo but never overfill the ship', () => {
  const home = npc('home', [offer('in-a', 10, null), offer('in-b', 10, null), offer('back-a', null, 40), offer('back-b', null, 40)]);
  const stop = pob('stop', [offer('in-a', null, 20), offer('in-b', null, 20),
    offer('back-a', 15, null, { stock: 1 }), offer('back-b', 15, null, { stock: 1 })], 0, 0);
  const legs = [shipment(home, stop, ['in-a', 'in-b']), shipment(stop, home, ['back-a', 'back-b'])];
  const quote = optimizeTour(legs, [home, stop], { cargo: 4, capital: 40 });
  assert(quote); assert.equal(quote.orderMask, 1); assert.deepEqual(quote.quantities, [1, 2]);
  assert.equal(quote.loads[1].length, 2); assert.equal(quote.peakCargo, 3); assert.equal(quote.profit, 60);
  assert(quote.events.findIndex(e => e.leg === 1 && e.kind === 'buy') < quote.events.findIndex(e => e.leg === 0 && e.kind === 'sell'));
  assert.equal(simulate(legs, quote.itemQuantities, [home, stop], { cargo: 2, capital: 40 }, quote.orderMask), null);
});

test('each trading flight must carry something even when individual goods are optional', () => {
  const source = npc('s', [offer('a', 10, null), offer('b', 10, null)]);
  const target = pob('t', [offer('a', null, 20), offer('b', null, 20)], 0, 0);
  const leg = shipment(source, target, ['a', 'b']);
  assert.equal(optimizeTour([leg], [source, target], { cargo: 10, capital: 100 }), null);
  assert.equal(simulate([leg], [[0, 0]], [source, target], { cargo: 10, capital: 100 }), null);
});

test('mixed repeated runs consume all shared reserves and money instead of multiplying the first quote', () => {
  const a = pob('a', [offer('x', 10, 5, { stock: 3 }), offer('y', 10, 5, { stock: 3 }), offer('z', 30, 25)], 10000, 10000);
  const b = pob('b', [offer('x', 30, 20), offer('y', 30, 20), offer('z', 10, 5, { stock: 10 })], 10000, 10000);
  const legs = [shipment(a, b, ['x', 'y']), makeLeg(b, a, 'z', PROFILES[0])];
  const quote = optimizeTour(legs, [a, b], { cargo: 4, capital: 1000 });
  const repeat = repeatTour(legs, quote, { cargo: 4, capital: 1000 });
  assert.equal(repeat.count, 2); assert.equal(repeat.profit, 180); assert.equal(repeat.capped, false);
});

test('small mixed-load optimizations match exhaustive independent integer enumeration', () => {
  for (let seed = 0; seed < 24; seed++) {
    const volumes = [1 + seed % 3, 1 + (seed + 1) % 3], original = [2, 3];
    const source = pob('s', [offer('a', 3, null, { volume: volumes[0], stock: 5, min: seed % 2 }),
      offer('b', 2, null, { volume: volumes[1], stock: 6, min: 1 })]);
    const target = pob('t', [offer('a', null, 9, { volume: volumes[0], originalVolume: original[0], max: 4 }),
      offer('b', null, 5, { volume: volumes[1], originalVolume: original[1], max: 5 })], 10 + seed * 2, 4 + seed % 9);
    const options = { cargo: 3 + seed % 8, capital: 5 + seed % 11 };
    let best = 0;
    for (let a = 0; a <= 5 - seed % 2; a++) for (let b = 0; b <= 5; b++) {
      if (a > 4 || 3 * a + 2 * b > options.capital || 9 * a + 5 * b > target.cash ||
        volumes[0] * a + volumes[1] * b > options.cargo || original[0] * a + original[1] * b > target.space) continue;
      best = Math.max(best, a * 6 + b * 3);
    }
    const quote = optimizeTour([shipment(source, target, ['a', 'b'])], [source, target], options);
    assert.equal(quote?.profit || 0, best, `case ${seed}`);
  }
});
