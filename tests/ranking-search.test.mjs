import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.mjs';
import { PROFILES, optimizeTour } from '../src/trade.mjs';
import { selectCandidates } from '../src/ranking.mjs';

const offer = (id, buy, sell, extra = {}) => ({ id, name: id, buy, sell, volume: 1, originalVolume: 1, stock: null, min: null, max: null, ...extra });
const settings = { cargo: 100, capital: 1000, mode: 'two', start: 'home', returnScope: 'system', allowEmptyReturn: false,
  maxMinutes: 100000, sort: 'hourly', breadth: 18, searchMs: 5000, timeModel: { dock: 30, jump: 15, charge: 5 } };
function fixture({ far = false } = {}) {
  const home = { id: 'home', name: 'home', kind: 'npc', system: 'home', pos: [0, 0, 0], offers: [offer('out', 10, null), offer('back', null, 20)] };
  const away = { id: 'away', name: 'away', kind: 'npc', system: 'away', pos: [0, 0, 0], offers: [offer('out', null, 20), offer('premium', 10, null), offer('back', 10, null)] };
  const buyers = Array.from({ length: 18 }, (_, i) => ({ id: `buyer-${i}`, name: `buyer ${i}`, kind: 'pob', system: 'home',
    pos: [far ? 20000000 + i * 1000 : 1000 + i * 100, 0, 0], cash: far ? 100000 : 110, space: far ? 1000 : 1,
    offers: [offer('premium', null, 110, { stock: 0, min: 0, max: far ? 1000 : 1 })] }));
  const bases = [home, away, ...buyers];
  const navigation = { schema: 1, nodes: bases.map(b => ({ id: b.id, system: b.system, pos: b.pos, kind: 'base' })),
    baseNodes: Object.fromEntries(bases.map(b => [b.id, b.id])), links: [{ from: 'home', to: 'away', kind: 'jump' }, { from: 'away', to: 'home', kind: 'jump' }] };
  return { dataset: { schema: 1, asOf: new Date().toISOString(), bases }, navigation };
}
test('standard search finds the full return cargo behind eighteen tiny high-margin POB offers', async () => {
  const { dataset, navigation } = fixture();
  for (const mixedCargo of [false, true]) {
    const result = await search(dataset, navigation, PROFILES[0], { ...settings, mixedCargo });
    assert.equal(result.results[0].profit, 2000); assert.equal(result.results[0].legs.at(-1).target, 'home');
    assert.equal(result.results[0].quantities.at(-1), 100);
  }
});
test('actual flight duration participates before pruning, with distinct hourly and total-profit objectives', async () => {
  const { dataset, navigation } = fixture({ far: true });
  const hourly = await search(dataset, navigation, PROFILES[0], settings);
  assert.equal(hourly.results[0].legs.at(-1).target, 'home'); assert(Math.abs(hourly.results[0].hourly - 60000) < 1e-6);
  const total = await search(dataset, navigation, PROFILES[0], { ...settings, sort: 'profit' });
  assert.equal(total.results[0].profit, 11000); assert(total.results[0].seconds > hourly.results[0].seconds);
});
test('zero snapshot cash/space does not prune a POB funded by buying its return goods first', async () => {
  const f = fixture(); f.dataset.bases.length = 2;
  const [home, away] = f.dataset.bases;
  home.offers = [offer('out', 1, null), offer('back', null, 110)];
  away.kind = 'pob'; away.cash = 0; away.space = 0;
  away.offers = [offer('out', null, 100, { stock: 0, min: 0, max: 10 }), offer('back', 100, null, { stock: 2, min: 0, max: 10 })];
  const result = await search(f.dataset, f.navigation, PROFILES[0], { ...settings, cargo: 2, capital: 101, breadth: 1 });
  const route = result.results[0]; assert(route); assert.equal(route.profit, 109); assert.equal(route.orderMask, 1);
  assert(optimizeTour(route.legs, f.dataset.bases, { cargo: 2, capital: 101 }));
});
test('mixed same-pair cargo improves profit without adding flights, docks or travel time', async () => {
  const f = fixture(); f.dataset.bases.length = 2;
  const [home, away] = f.dataset.bases; home.kind = 'pob'; home.cash = 1000; home.space = 1000;
  home.offers = [offer('a', 10, null, { stock: 5, min: 3, max: 100 }), offer('b', 10, null, { stock: 10, min: 0, max: 100 })];
  away.offers = [offer('a', null, 30), offer('b', null, 20)];
  const opts = { ...settings, mode: 'one', cargo: 10 };
  const single = await search(f.dataset, f.navigation, PROFILES[0], { ...opts, mixedCargo: false });
  const mixed = await search(f.dataset, f.navigation, PROFILES[0], opts);
  assert.equal(single.results[0].profit, 100); assert.equal(mixed.results[0].profit, 120);
  assert.equal(mixed.results[0].seconds, single.results[0].seconds); assert.equal(mixed.results[0].legs.length, 1);
  assert.equal(mixed.results[0].tradeCount, 1); assert.equal(mixed.results[0].mixed, true);
  assert.deepEqual(mixed.results[0].loads[0].map(l => [l.good, l.quantity]), [['a', 2], ['b', 8]]);
});
test('candidate diversity retains funded potential and selection terminates for very short lists', () => {
  const scored = Array.from({ length: 20 }, (_, i) => ({ trade: { id: i }, rate: 100 - i, profit: 100 - i,
    potentialRate: i === 19 ? 10000 : 100, potentialProfit: i === 19 ? 10000 : 100, lookahead: i === 19 ? 10000 : 100 }));
  assert(selectCandidates(scored, 7).some(c => c.trade.id === 19));
  assert.equal(selectCandidates(scored.slice(0, 1), 100).length, 1);
  assert.equal(selectCandidates([], 18).length, 0);
});
