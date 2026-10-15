import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Navigator, validateNavigation } from '../src/navigation.mjs';
import { PROFILES } from '../src/trade.mjs';

test('a ship-specific shortest path can switch from lane to direct cruise', () => {
  const nodes = [
    { id: 'a', system: 's', pos: [0, 0, 0], kind: 'base' },
    { id: 'b', system: 's', pos: [60000, 0, 0], kind: 'base' },
    { id: 'l1', system: 's', pos: [10000, 0, 0], kind: 'lane' },
    { id: 'l2', system: 's', pos: [50000, 0, 0], kind: 'lane' },
  ];
  const nav = { schema: 1, nodes, links: [{ from: 'l1', to: 'l2', kind: 'lane', speed: 40000 / 85 }], baseNodes: { A: 'a', B: 'b' } };
  const slow = new Navigator(nav, [], PROFILES[0], { lane: 0, charge: 0 }).route('A', 'B', true);
  const fast = new Navigator(nav, [], PROFILES[2], { lane: 0, charge: 0 }).route('A', 'B', true);
  assert.equal(slow.path.some(e => e.kind === 'lane'), true);
  assert.equal(fast.path.some(e => e.kind === 'lane'), false);
  assert(Math.abs(fast.seconds - 120) < 1e-6);
});

test('travel uses 3D coordinates and actual profile speed', () => {
  const nav = { schema: 1, nodes: [{ id: 'a', system: 's', pos: [0, 0, 0] }, { id: 'b', system: 's', pos: [3000, 4000, 0] }], links: [], baseNodes: { A: 'a', B: 'b' } };
  const result = new Navigator(nav, [], PROFILES[1], { charge: 0 }).route('A', 'B');
  assert(Math.abs(result.seconds - 5000 / 410) < 1e-6);
});

test('jump links are directed and respect cargo and docking restrictions', () => {
  const nav = { schema: 1, nodes: [{ id: 'a', system: 's', pos: [0, 0, 0] }, { id: 'b', system: 't', pos: [0, 0, 0] }], links: [{ from: 'a', to: 'b', kind: 'jump', allows: ['medium'], cargoLimit: 4300 }], baseNodes: { A: 'a', B: 'b' } };
  assert.equal(new Navigator(nav, [], PROFILES[0]).route('A', 'B'), null);
  const pilgrim = new Navigator(nav, [], PROFILES[1]);
  assert.equal(pilgrim.route('A', 'B').jumps, 1);
  assert.equal(pilgrim.route('B', 'A'), null);
});

test('unknown positions do not receive invented travel times', () => {
  const nav = { schema: 1, nodes: [{ id: 'a', system: 's', pos: [0, 0, 0] }], links: [], baseNodes: { A: 'a' } };
  assert.equal(new Navigator(nav, [{ id: 'B', system: 's', pos: null }], PROFILES[0]).route('A', 'B'), null);
  assert.throws(() => validateNavigation({ schema: 1, nodes: [{ id: 'a', system: 's', pos: [0, 0] }], links: [] }));
});

test('the bundled public navigation has complete referenced systems and real Manhattan routing', () => {
  const nav = JSON.parse(readFileSync(new URL('../data/navigation.json', import.meta.url), 'utf8'));
  validateNavigation(nav);
  assert(nav.nodes.length > 2000);
  assert(nav.links.length > 2000);
  assert.deepEqual(nav.coverage.missingSystems, []);
  assert.equal(nav.coverage.lockedGateData, true);
  const navigator = new Navigator(nav, [], PROFILES[1]);
  const path = navigator.route('li01_01_base', 'br01_01_base', true);
  assert(path, 'Manhattan to New London must be represented in the current configuration');
  assert(path.seconds > 100 && path.jumps > 0);
});
