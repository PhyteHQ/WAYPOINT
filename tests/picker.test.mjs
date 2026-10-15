import test from 'node:test';
import assert from 'node:assert/strict';
import { marketChoices, filterChoices, pickerViewport } from '../src/picker.mjs';

const bases = [
  { id: 'rhw', name: 'Resolution Heavy Works', system: 'br01', systemName: 'New London', kind: 'pob' },
  { id: 'trafalgar', name: 'Trafalgar Base', system: 'br01', systemName: 'New London', kind: 'npc' },
  { id: 'ore', name: 'Köln Refinery', system: 'rh02', systemName: 'Hamburg', kind: 'npc' },
];
test('market search finds partial names, systems, IDs and combined terms without accents', () => {
  const choices = marketChoices(bases, 'base');
  for (const query of ['resolution', 'NEW LONDON works', 'rhw', 'london pob'])
    assert.deepEqual(filterChoices(choices, query).items.map(x => x.id), ['rhw']);
  assert.equal(filterChoices(choices, 'koln').items[0].id, 'ore');
  assert.equal(filterChoices(choices, 'london hamburg').total, 0);
});
test('systems are unique while identically named bases retain their own IDs', () => {
  assert.deepEqual(marketChoices(bases, 'system').map(x => x.id).sort(), ['br01', 'rh02']);
  const sameNames = marketChoices([...bases, { ...bases[0], id: 'different-rhw' }], 'base');
  assert.deepEqual(filterChoices(sameNames, 'resolution').items.map(x => x.id).sort(), ['different-rhw', 'rhw']);
});
test('large markets show a bounded list and report every matching result', () => {
  const choices = marketChoices(Array.from({ length: 781 }, (_, i) => ({ ...bases[0], id: String(i), name: `Dock ${i}` })), 'base');
  const result = filterChoices(choices, 'dock');
  assert.equal(result.items.length, 80); assert.equal(result.total, 781);
});
test('picker height follows the visible viewport when the keyboard opens or pans it', () => {
  assert.deepEqual(pickerViewport({ height: 344, offsetTop: 71 }, 820), { height: 344, top: 71 });
  assert.deepEqual(pickerViewport(null, 820), { height: 820, top: 0 });
});
