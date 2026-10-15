// Deliberately fictitious, opt-in functional example. Never used as live fallback.
export function example() {
  const stock = (id, buy, sell, quantity, min, max, volume = 1) => ({ id, name: id === 'alloy' ? 'Beispiel-Alloy' : id === 'food' ? 'Beispiel-Food' : 'Beispiel-Komponenten', buy, sell, stock: quantity, min, max, volume, originalVolume: volume, volumes: {} });
  const bases = [
    { id: 'demo-a', name: 'Beispiel · Nordhafen', system: 'demo-system', systemName: 'Beispielsystem', pos: [0, 0, 0], kind: 'npc', cash: null, space: null, offers: [stock('alloy', 140, 120, null, null, null), stock('food', 90, 85, null, null, null), stock('parts', 940, 880, null, null, null, 3)] },
    { id: 'demo-b', name: 'Beispiel · Meridian Works', system: 'demo-system', systemName: 'Beispielsystem', pos: [60000, 0, 0], kind: 'pob', cash: 650000, space: 3400, offers: [stock('alloy', 190, 210, 2000, 1500, 6000), stock('food', 70, 65, 8000, 1800, 10000), stock('parts', 1350, 1300, 100, 60, 800, 3)] },
    { id: 'demo-c', name: 'Beispiel · Süddepot', system: 'demo-system', systemName: 'Beispielsystem', pos: [20000, 0, 45000], kind: 'pob', cash: 1400000, space: 6000, offers: [stock('alloy', 175, 165, 5000, 200, 7000), stock('food', 160, 150, 1000, 500, 8000), stock('parts', 740, 700, 1800, 400, 2500, 3)] },
  ];
  const nodes = bases.map(b => ({ id: b.id, system: b.system, pos: b.pos, kind: 'base', allows: ['medium'] }));
  nodes.push({ id: 'lane-a', system: 'demo-system', pos: [6000, 0, 0], kind: 'lane' }, { id: 'lane-b', system: 'demo-system', pos: [54000, 0, 0], kind: 'lane' });
  return { dataset: { schema: 1, asOf: new Date().toISOString(), source: 'demo', timestampKind: 'example', bases }, navigation: {
    schema: 1, source: 'Fiktives Funktionsbeispiel', patch: 'Beispieldaten', nodes, baseNodes: Object.fromEntries(bases.map(b => [b.id, b.id])),
    links: [{ from: 'lane-a', to: 'lane-b', kind: 'lane', speed: 2250 }, { from: 'lane-b', to: 'lane-a', kind: 'lane', speed: 2250 }],
    coverage: { systems: 1, missingSystems: [], lockedGateData: true }, assumptions: [] } };
}
