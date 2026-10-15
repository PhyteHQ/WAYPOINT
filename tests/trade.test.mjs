import test from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, makeLeg, normalizeDarkstat, optimizeTour, repeatTour, validateDataset, volumeFor } from '../src/trade.mjs';

const item = (id, values = {}) => ({ id, name: id, buy: 10, sell: 20, volume: 1, originalVolume: 1, stock: 10000, min: 0, max: 20000, ...values });
const base = (id, offers, values = {}) => ({ id, name: id, kind: 'npc', offers, cash: null, space: null, ...values });
const options = { cargo: 5000, capital: 1000000 };
const leg = (a, b, good, profile = PROFILES[0]) => makeLeg(a, b, good, profile);

test('each actual cargo capacity is divided by unit volume and rounded down', () => {
  for (const profile of PROFILES) {
    const a = base('A', [item('x', { volume: 3 })]), b = base('B', [item('x', { volume: 3 })]);
    const result = optimizeTour([leg(a, b, 'x', profile)], [a, b], { ...options, cargo: profile.cargo });
    assert.equal(result.quantities[0], Math.floor(profile.cargo / 3));
  }
});

test('the delivery respects cash, demand and original POB volume simultaneously', () => {
  const a = base('A', [item('x', { volume: 2 })]);
  const b = base('B', [item('x', { volume: 2, originalVolume: 5, stock: 10, max: 500 })], { kind: 'pob', cash: 3000, space: 240 });
  const result = optimizeTour([leg(a, b, 'x')], [a, b], options);
  assert.equal(result.quantities[0], 48);
  assert.equal(result.profit, 480);
  assert.equal(result.bases[1].space, 0);
  assert.equal(result.bases[1].cash, 2040);
});

test('a zero cash balance, a full warehouse and a reached max each prevent delivery', () => {
  const a = base('A', [item('x')]);
  for (const change of [{ cash: 0, space: 1000 }, { cash: 10000, space: 0 }, { cash: 10000, space: 1000, full: true }]) {
    const b = base('B', [item('x', change.full ? { stock: 100, max: 100 } : {})], { kind: 'pob', ...change });
    assert.equal(optimizeTour([leg(a, b, 'x')], [a, b], options), null);
  }
});

test('a source reserve is never sold', () => {
  const a = base('A', [item('x', { stock: 150, min: 100 })], { kind: 'pob', cash: 100, space: 0 });
  const b = base('B', [item('x')]);
  assert.equal(optimizeTour([leg(a, b, 'x')], [a, b], options).quantities[0], 50);
  assert.equal(a.offers[0].stock, 150, 'input snapshots remain unchanged');
});

test('capital limits the source purchase and is reused after delivery', () => {
  const a = base('A', [item('ore'), item('food', { sell: 30 })]);
  const b = base('B', [item('ore'), item('food', { buy: 10 })]);
  const legs = [leg(a, b, 'ore'), leg(b, a, 'food')];
  const result = optimizeTour(legs, [a, b], { cargo: 100, capital: 500 });
  assert.deepEqual(result.quantities, [50, 100]);
  assert.equal(result.profit, 2500);
});

test('buying return cargo first can fund and make space for an incoming delivery', () => {
  const a = base('A', [item('ore'), item('food', { sell: 11 })]);
  const b = base('B', [item('ore', { stock: 0, max: 100 }), item('food', { buy: 10, stock: 100, max: 100 })], { kind: 'pob', cash: 0, space: 0 });
  const result = optimizeTour([leg(a, b, 'ore'), leg(b, a, 'food')], [a, b], { cargo: 100, capital: 1000 });
  assert.deepEqual(result.quantities, [33, 67]);
  assert.equal(result.profit, 397);
  assert.equal(result.orderMask, 1);
  assert.equal(result.events[1].kind, 'buy');
  assert(result.events.every(e => e.after.cargo <= 100));
});

test('a tour closes with updated source POB cash and storage', () => {
  const a = base('A', [item('ore', { stock: 100, max: 100 }), item('food', { stock: 0, max: 100, sell: 15 })], { kind: 'pob', cash: 0, space: 0 });
  const b = base('B', [item('ore'), item('food', { buy: 10 })]);
  const result = optimizeTour([leg(a, b, 'ore'), leg(b, a, 'food')], [a, b], { cargo: 100, capital: 1000 });
  assert(result);
  assert.equal(result.quantities[0], 100);
  assert.equal(result.quantities[1], 66);
  assert.equal(result.bases[0].cash, 10);
});

test('three legs share one balance and never count stock twice', () => {
  const a = base('A', [item('a'), item('c')]);
  const b = base('B', [item('a'), item('b', { stock: 20, min: 10 })], { kind: 'pob', cash: 500, space: 100 });
  const c = base('C', [item('b'), item('c')]);
  const result = optimizeTour([leg(a, b, 'a'), leg(b, c, 'b'), leg(c, a, 'c')], [a, b, c], { cargo: 100, capital: 1000 });
  assert(result);
  assert(result.quantities[0] <= 30);
  assert.equal(result.quantities[1], 10);
  assert(result.events.every(e => e.after.player >= 0));
});

test('repeated runs consume the available stock instead of multiplying one quotation', () => {
  const a = base('A', [item('x', { stock: 150, min: 10 })], { kind: 'pob', cash: 0, space: 100 });
  const b = base('B', [item('x')]);
  const legs = [leg(a, b, 'x'), { source: 'B', target: 'A', good: null }];
  const first = optimizeTour(legs, [a, b], { cargo: 100, capital: 10000 });
  const repeats = repeatTour(legs, first, { cargo: 100, capital: 10000 });
  assert.deepEqual(repeats, { count: 2, capped: false, profit: 1400 });
});

test('unknown POB fields are excluded while real zeros are preserved', () => {
  const a = base('A', [item('x')]);
  const b = base('B', [item('x')], { kind: 'pob', cash: null, space: 100 });
  assert.equal(leg(a, b, 'x'), null);
  const normalized = normalizeDarkstat([{ nickname: 'B', name: 'B', money: 0, cargospace: 0, shop_items: [{ nickname: 'x', category: 'commodity', price: 10, sell_price: 20, quantity: 0, min_stock: 0, max_stock: 100, volume: 1, original_volume: 1 }] }], []);
  assert.equal(normalized.bases[0].cash, 0);
  assert.equal(normalized.bases[0].offers[0].stock, 0);
  assert.equal(normalized.bases[0].offers[0].min, 0);
});

test('NPC prices and stock use the correct buying and selling perspective', () => {
  const data = normalizeDarkstat([], [{ nickname: 'x', name: 'X', volume: 3, ship_class: null, market_goods: [
    { base_nickname: 'A', base_name: 'A', system_nick: 's', base_sells: true, price_base_sells_for: 7, price_base_buys_for: 5, volume: 3 },
    { base_nickname: 'B', base_name: 'B', system_nick: 's', base_sells: false, price_base_sells_for: 100, price_base_buys_for: 11, volume: 3 },
  ] }]);
  assert.equal(data.bases[0].offers[0].buy, 7);
  assert.equal(data.bases[1].offers[0].buy, null);
  assert.equal(data.bases[1].offers[0].sell, 11);
  assert.equal(volumeFor(data.bases[0].offers[0], PROFILES[0]), 3);
});

test('malformed snapshots cannot enter the calculation', () => {
  assert.throws(() => validateDataset({ schema: 1, bases: [base('A', []), base('A', [])] }));
  assert.throws(() => validateDataset({ schema: 1, bases: [base('A', [item('x', { volume: -1 })])] }));
});

test('a local pickup reuses delivery proceeds but cannot fund a different POB retroactively', () => {
  const a = base('A', [item('ore', { buy: 10 })]);
  const b = base('B', [item('ore', { sell: 30, stock: 0, max: 1 })], { kind: 'pob', cash: 30, space: 1 });
  const pickup = base('P', [item('food', { buy: 25, stock: 1, max: 1 })], { kind: 'pob', cash: 0, space: 0 });
  const target = base('T', [item('food', { sell: 50 })]);
  const legs = [leg(a, b, 'ore'), { source: 'B', target: 'P', good: null }, leg(pickup, target, 'food')];
  const result = optimizeTour(legs, [a, b, pickup, target], { cargo: 1, capital: 10 });
  assert.deepEqual(result.quantities, [1, 0, 1]);
  assert.equal(result.profit, 45);
  assert.equal(result.capitalNeeded, 10);
  b.cash = 0;
  assert.equal(optimizeTour(legs, [a, b, pickup, target], { cargo: 1, capital: 100 }), null,
    'money paid at pickup P cannot pay for delivery at B before that pickup');
});
