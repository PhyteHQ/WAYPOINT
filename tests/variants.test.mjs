import test from 'node:test';
import assert from 'node:assert/strict';
import { routeFamily, groupRoutes, selectDiverseRoutes } from '../src/variants.mjs';
import { search } from '../src/search.mjs';
import { PROFILES } from '../src/trade.mjs';

const byId = new Map([
  ['home', { system: 'home', systemName: 'Home' }], ['buyer', { system: 'home' }],
  ['drop', { system: 'away', systemName: 'Away' }], ['pickup', { system: 'away' }],
  ['other', { system: 'other', systemName: 'Other' }],
]);
const leg = (source, target, good = 'goods', extra = {}) => ({ source, target, good, ...extra });
const route = (id, legs, values = {}) => ({ id, legs, profit: 100, hourly: 1000, seconds: 360, capitalNeeded: 50, roundTrip: true, ...values });

test('cargo, same-system pickup docks and final buyers are variants of the same system itinerary', () => {
  const a = route('a', [leg('home', 'drop'), leg('drop', 'home')]);
  const b = route('b', [leg('home', 'pickup', 'other-cargo'), leg('pickup', 'drop', null, { purpose: 'pickup' }), leg('drop', 'buyer', 'back')]);
  assert.equal(routeFamily(a, byId).key, routeFamily(b, byId).key);
  assert.deepEqual(routeFamily(a, byId).names, ['Home', 'Away', 'Home']);
});

test('different directions, intermediate systems, trade counts and empty returns remain distinct', () => {
  const variants = [
    route('out-and-back', [leg('home', 'drop'), leg('drop', 'home')]),
    route('reverse', [leg('drop', 'home'), leg('home', 'drop')]),
    route('other-system', [leg('home', 'other'), leg('other', 'home')]),
    route('three', [leg('home', 'drop'), leg('drop', 'pickup'), leg('pickup', 'home')]),
    route('empty', [leg('home', 'drop'), leg('drop', 'home', null, { purpose: 'return' })], { emptyReturn: true }),
  ];
  assert.equal(groupRoutes(variants, byId).length, variants.length);
});

test('local tours keep distinct outbound dock pairs, and unknown systems never collapse unrelated bases', () => {
  const local = new Map([...byId].map(([id]) => [id, { system: 'local', systemName: 'Local' }]));
  const a = route('a', [leg('home', 'drop'), leg('drop', 'home')]);
  const b = route('b', [leg('home', 'drop'), leg('drop', 'pickup', null), leg('pickup', 'buyer')]);
  const c = route('c', [leg('home', 'pickup'), leg('pickup', 'home')]);
  assert.equal(routeFamily(a, local).key, routeFamily(b, local).key);
  assert.notEqual(routeFamily(a, local).key, routeFamily(c, local).key);
  assert.equal(routeFamily(a, local).local, true);
  assert.notEqual(routeFamily(a, new Map()).key, routeFamily(c, new Map()).key);
});

test('group representatives follow the selected objective and retain their original detail indices', () => {
  const legs = [leg('home', 'drop'), leg('drop', 'home')];
  const routes = [route('profit', legs, { profit: 200, hourly: 500 }), route('rate', legs),
    route('other', [leg('home', 'other'), leg('other', 'home')], { hourly: 600 })];
  const hourly = groupRoutes(routes, byId);
  assert.equal(hourly[0].entries[0].route.id, 'rate');
  assert.equal(hourly[0].entries[0].index, 1);
  assert.equal(hourly[0].entries[1].index, 0);
  assert.equal(groupRoutes(routes, byId, 'profit')[0].entries[0].route.id, 'profit');
});

test('bounded retention reserves different families before dozens of higher-ranking variants', () => {
  const crowded = Array.from({ length: 350 }, (_, i) => route(`crowded-${i}`, [leg('home', 'drop'), leg('drop', 'home')], { hourly: 10000 - i }));
  const other = route('other', [leg('home', 'other'), leg('other', 'home')], { hourly: 100 });
  const shortlist = selectDiverseRoutes([...crowded, other], byId, { limit: 150 });
  const final = selectDiverseRoutes(shortlist, byId);
  assert.equal(final.length, 60);
  assert.equal(final[0].id, 'crowded-0');
  assert(final.includes(other), 'a lower-scoring distinct itinerary survives both pruning stages');
  const equalFamilies = ['drop', 'other'].flatMap(target => Array.from({ length: 40 }, (_, i) =>
    route(`${target}-${i}`, [leg('home', target), leg(target, 'home')], { hourly: 1000 - i + (target === 'drop' ? 1000 : 0) })));
  const balanced = groupRoutes(selectDiverseRoutes(equalFamilies, byId, { limit: 10 }), byId);
  assert.deepEqual(balanced.map(g => g.entries.length), [5, 5]);
});

test('retention keeps the overall best objective, handles missing times and very short lists', () => {
  const legs = [leg('home', 'drop')];
  const known = route('known', legs, { profit: 100, hourly: 50 });
  const unknown = route('unknown', legs, { profit: 1000, hourly: null });
  assert.equal(selectDiverseRoutes([unknown, known], byId, { limit: 1 })[0], known);
  assert.equal(selectDiverseRoutes([unknown, known], byId, { limit: 1, sort: 'profit' })[0], unknown);
  assert.deepEqual(selectDiverseRoutes([], byId), []);
  assert.deepEqual(selectDiverseRoutes([known], byId, { limit: 100 }), [known]);
});

test('real single and mixed searches retain another destination behind more than 300 commodity variants', async () => {
  const offer = (id, buy, sell) => ({ id, name: id, buy, sell, volume: 1, originalVolume: 1 });
  const goods = Array.from({ length: 310 }, (_, i) => `g-${i}`);
  const bases = [
    { id: 'home', name: 'Home', system: 'home', kind: 'npc', pos: [0, 0, 0], offers: goods.map(id => offer(id, 1, null)) },
    { id: 'drop', name: 'Away', system: 'away', kind: 'npc', pos: [0, 0, 0], offers: goods.map((id, i) => offer(id, null, 500 - i)) },
    { id: 'other', name: 'Other', system: 'other', kind: 'npc', pos: [0, 0, 0], offers: [offer(goods[0], null, 2)] },
  ];
  const dataset = { schema: 1, bases }, navigation = { schema: 1,
    nodes: bases.map(b => ({ id: b.id, system: b.system, pos: b.pos, kind: 'base' })),
    baseNodes: Object.fromEntries(bases.map(b => [b.id, b.id])),
    links: ['drop', 'other'].map(to => ({ from: 'home', to, kind: 'jump' })) };
  const options = { cargo: 10, capital: 100, mode: 'one', sort: 'hourly', maxMinutes: 60, searchMs: 5000, mixedMs: 0, timeModel: { dock: 30, jump: 15 } };
  for (const mixedCargo of [false, true]) {
    const result = await search(dataset, navigation, PROFILES[0], { ...options, mixedCargo });
    assert(result.stats.checked > 300);
    assert.equal(result.results[0].profit, 4990);
    assert(result.results.some(r => r.legs.at(-1).target === 'other'), `other family survives with mixedCargo=${mixedCargo}`);
    assert.equal(groupRoutes(result.results, new Map(bases.map(b => [b.id, b]))).length, 2);
  }
});
