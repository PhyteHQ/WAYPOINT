import test from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../src/search.mjs';
import { example } from '../src/example.mjs';
import { PROFILES } from '../src/trade.mjs';
const options = { cargo: 4300, capital: 5000000, mode: 'auto', maxMinutes: 60, start: '', sort: 'hourly', breadth: 45, searchMs: 15000, timeModel: { dock: 30 } };

test('all profile and route mode combinations yield finite and internally consistent example quotes', async () => {
  const { dataset, navigation } = example();
  for (const profile of PROFILES) for (const mode of ['one', 'two', 'three', 'auto']) {
    const result = await search(dataset, navigation, profile, { ...options, cargo: profile.cargo, mode });
    assert(result.results.length, `${profile.id}/${mode}`);
    for (const route of result.results) {
      assert(route.profit > 0 && route.seconds > 0 && route.hourly > 0);
      assert(route.peakCargo <= profile.cargo + 1e-6);
      assert(route.quantities.every(Number.isInteger));
      if (mode !== 'one') assert.equal(route.legs[0].source, route.legs.at(-1).target);
    }
  }
});

test('the specified starting base is the anchor even when the first flight carries no cargo', async () => {
  const { dataset, navigation } = example();
  const result = await search(dataset, navigation, PROFILES[1], { ...options, mode: 'two', start: 'demo-a' });
  assert(result.results.length);
  assert(result.results.every(r => r.legs[0].source === 'demo-a' && r.legs.at(-1).target === 'demo-a'));
});

test('without navigation, hourly rankings are unavailable unless explicitly requested', async () => {
  const { dataset } = example();
  const strict = await search(dataset, null, PROFILES[1], { ...options, mode: 'one' });
  assert.equal(strict.results.length, 0);
  const unknown = await search(dataset, null, PROFILES[1], { ...options, mode: 'one', allowUnknownTime: true });
  assert(unknown.results.length);
  assert(unknown.results.every(r => r.hourly === null && r.seconds === null));
});

test('POB exclusion and a duration ceiling remove ineligible results', async () => {
  const { dataset, navigation } = example();
  const result = await search(dataset, navigation, PROFILES[1], { ...options, excludePobs: true });
  assert.equal(result.results.length, 0);
  const short = await search(dataset, navigation, PROFILES[1], { ...options, maxMinutes: 0.01 });
  assert.equal(short.results.length, 0);
});
