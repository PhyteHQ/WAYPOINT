import test from 'node:test';
import assert from 'node:assert/strict';
import { example } from '../src/example.mjs';
import { PROFILES } from '../src/trade.mjs';

test('worker details replay the selected mixed manifest and preserve displayed quantities and profit', async () => {
  const messages = [];
  globalThis.self = { postMessage: data => messages.push(data) };
  await import('../src/worker.mjs');
  const data = example(), options = { mode: 'auto', returnScope: 'system', allowEmptyReturn: false, mixedCargo: true,
    cargo: 4300, capital: 5000000, breadth: 18, searchMs: 5000, maxMinutes: 60, sort: 'hourly', timeModel: { dock: 30 } };
  await self.onmessage({ data: { type: 'search', id: 1, ...data, profile: PROFILES[1], options } });
  const results = messages.find(m => m.type === 'result')?.result.results;
  assert(results?.length); const route = results.find(r => r.mixed); assert(route, 'the example includes an actual mixed manifest');
  await self.onmessage({ data: { type: 'detail', id: 2, dataset: data.dataset, route, options } });
  const detail = messages.find(m => m.type === 'detail'); assert(detail?.quote);
  assert.equal(detail.quote.profit, route.profit); assert.deepEqual(detail.quote.itemQuantities, route.itemQuantities);
  assert.deepEqual(detail.quote.loads.map(load => load.map(l => [l.good, l.quantity])), route.loads.map(load => load.map(l => [l.good, l.quantity])));
  assert.equal(detail.quote.orderMask, route.orderMask);
});
