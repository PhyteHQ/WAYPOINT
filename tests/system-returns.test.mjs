import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.mjs';
import { PROFILES } from '../src/trade.mjs';

function fixture() {
  const offer = (id, buy, sell, values = {}) => ({ id, name: id, buy, sell, volume: 1, originalVolume: 1, stock: null, min: null, max: null, ...values });
  const bases = [
    { id: 'home', name: 'Start dock', system: 'home-system', systemName: 'Home', pos: [0, 0, 0], kind: 'npc', offers: [offer('out', 10, null)] },
    { id: 'drop', name: 'Delivery dock', system: 'away-system', systemName: 'Away', pos: [0, 0, 0], kind: 'npc', offers: [offer('out', null, 30)] },
    { id: 'pickup', name: 'Different pickup dock', system: 'away-system', systemName: 'Away', pos: [1000, 0, 0], kind: 'pob', cash: 0, space: 0,
      offers: [offer('back', 50, null, { volume: 4, originalVolume: 7, stock: 20, min: 2, max: 100 })] },
    { id: 'buyer', name: 'Different home buyer', system: 'home-system', systemName: 'Home', pos: [2000, 0, 0], kind: 'pob', cash: 180, space: 14,
      offers: [offer('back', null, 90, { volume: 4, originalVolume: 7, stock: 2, min: 0, max: 5 })] },
  ];
  const nodes = bases.map(b => ({ id: b.id, system: b.system, pos: b.pos, kind: 'base' }));
  const navigation = { schema: 1, nodes, baseNodes: Object.fromEntries(nodes.map(n => [n.id, n.id])), links: [
    { from: 'home', to: 'drop', kind: 'jump' }, { from: 'drop', to: 'home', kind: 'jump' },
  ] };
  return { dataset: { schema: 1, asOf: new Date().toISOString(), bases }, navigation };
}
const settings = { cargo: 100, capital: 1000, mode: 'two', start: 'home', returnScope: 'system',
  allowEmptyReturn: false, maxMinutes: 60, sort: 'hourly', breadth: 45, searchMs: 5000, timeModel: { dock: 30, jump: 15, charge: 5 } };
const run = ({ dataset, navigation }, extra = {}) => search(dataset, navigation, PROFILES[0], { ...settings, ...extra });

test('return cargo can come from another dock in the arrival system and sell to another home buyer', async () => {
  const result = await run(fixture());
  assert.equal(result.results.length, 1);
  const route = result.results[0];
  assert.deepEqual(route.legs.map(l => [l.source, l.target]), [['home', 'drop'], ['drop', 'pickup'], ['pickup', 'buyer']]);
  assert.deepEqual(route.quantities, [100, 0, 2]);
  assert.equal(route.profit, 2080);
  assert.equal(route.tradeCount, 2);
  assert.equal(route.closed, false);
  assert.equal(route.systemClosed, true);
  assert.equal(route.emptyReturn, false);
  const expected = 15 + (1000 / 350 + 5) + (1000 / 350 + 5 + 15 + 2000 / 350 + 5) + 4 * 30;
  assert(Math.abs(route.seconds - expected) < 1e-6, 'pickup travel and its extra station stop cost real time');
  assert.equal(route.hourly, route.profit / route.seconds * 3600);
});

test('the return-system filter is applied before the candidate limit', async () => {
  const f = fixture();
  f.dataset.bases.push({ id: 'rich', name: 'Unrelated lucrative destination', system: 'other', kind: 'npc', offers: [{ ...f.dataset.bases[3].offers[0], sell: 50000 }] });
  const result = await run(f, { breadth: 1 });
  assert.equal(result.results[0].legs.at(-1).target, 'buyer');
});

test('a pickup in a different system is never treated as a local transfer', async () => {
  const f = fixture();
  f.dataset.bases[2].system = 'third-system'; f.navigation.nodes[2].system = 'third-system';
  f.navigation.links.push({ from: 'drop', to: 'pickup', kind: 'jump' }, { from: 'pickup', to: 'drop', kind: 'jump' });
  assert.equal((await run(f)).results.length, 0);
});

test('empty return is opt-in; zero money, full storage and reached demand reject a loaded return', async () => {
  for (const change of [b => { b.cash = 0; }, b => { b.space = 0; }, b => { b.offers[0].max = 2; }]) {
    const f = fixture(); change(f.dataset.bases[3]);
    assert.equal((await run(f)).results.length, 0);
    const permitted = await run(f, { allowEmptyReturn: true });
    assert(permitted.results.length);
    assert(permitted.results.every(r => r.emptyReturn && !r.legs.at(-1).good));
  }
});

test('three trading legs can include a local pickup before returning to the home system', async () => {
  const f = fixture();
  const incoming = { ...f.dataset.bases[1].offers[0] };
  f.dataset.bases[1].offers[0].id = 'middle-good';
  f.dataset.bases.push({ id: 'middle', name: 'Intermediate dock', system: 'middle-system', pos: [0, 0, 0], kind: 'npc',
    offers: [incoming, { ...incoming, id: 'middle-good', buy: 10, sell: null }] });
  f.navigation.nodes.push({ id: 'middle', system: 'middle-system', pos: [0, 0, 0], kind: 'base' });
  f.navigation.baseNodes.middle = 'middle';
  f.navigation.links = [['home', 'middle'], ['middle', 'home'], ['middle', 'drop'], ['drop', 'middle']].map(([from, to]) => ({ from, to, kind: 'jump' }));
  const result = await run(f, { mode: 'three' });
  assert(result.results.length);
  const route = result.results[0];
  assert.equal(route.tradeCount, 3);
  assert.equal(route.legs.length, 4);
  assert.equal(route.legs.at(-1).source, 'pickup');
  assert.equal(route.legs.at(-1).target, 'buyer');
  assert.equal(route.profit, 4080);
});

test('the initial local pickup is flown and an exact-base destination remains available', async () => {
  const f = fixture();
  const start = f.dataset.bases[0];
  f.dataset.bases.push({ ...start, id: 'home-pickup', pos: [500, 0, 0] });
  f.navigation.nodes.push({ id: 'home-pickup', system: start.system, pos: [500, 0, 0], kind: 'base' });
  f.navigation.baseNodes['home-pickup'] = 'home-pickup';
  start.offers = [{ ...f.dataset.bases[3].offers[0], sell: 80 }];
  const result = await run(f, { returnScope: 'base', flexiblePickups: true });
  assert(result.results.length);
  assert(result.results.every(r => r.closed && r.legs.at(-1).target === 'home'));
  assert.equal(result.results[0].legs[0].purpose, 'approach');
  assert.equal(result.results[0].legs[0].target, 'home-pickup');
});

test('excluded pickup bases cannot reappear through the system-wide index', async () => {
  assert.equal((await run(fixture(), { blocked: ['pickup'] })).results.length, 0);
  assert.equal((await run(fixture(), { excludePobs: true })).results.length, 0);
});

test('an explicit target system overrides the start system', async () => {
  const f = fixture();
  f.dataset.bases[3].system = 'chosen-system'; f.dataset.bases[3].systemName = 'Chosen';
  f.navigation.nodes[3].system = 'chosen-system';
  f.navigation.links.push({ from: 'drop', to: 'buyer', kind: 'jump' });
  const result = await run(f, { returnSystem: 'chosen-system' });
  assert(result.results.length);
  assert(result.results.every(r => r.returnSystem === 'chosen-system' && r.legs.at(-1).target === 'buyer'));
  assert.equal(result.results[0].systemClosed, false);
});
