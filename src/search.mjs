import { baseProblems, makeLeg, optimizeTour } from './trade.mjs';
import { Navigator } from './navigation.mjs';

const empty = (from, to) => ({ source: from, target: to, good: null, name: 'Leerflug', margin: 0, volume: 0 });
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

export async function search(dataset, navigation, profile, options, report = () => {}, canceled = () => false) {
  const started = performance.now(), bases = dataset.bases.filter(b => !options.excludePobs || b.kind !== 'pob');
  const usable = bases.filter(b => !baseProblems(b).length && !options.blocked?.includes(b.id));
  const byId = new Map(usable.map(b => [b.id, b]));
  const navigator = new Navigator(navigation, usable, profile, options.timeModel);
  const outgoing = new Map(), edges = [], baseGoods = new Map();
  for (const b of usable) for (const item of b.offers) {
    if (!baseGoods.has(item.id)) baseGoods.set(item.id, []);
    baseGoods.get(item.id).push(b);
  }
  for (const source of usable) for (const item of source.offers) {
    if (!(item.buy > 0)) continue;
    for (const target of baseGoods.get(item.id) || []) {
      if (source.id === target.id) continue;
      const leg = makeLeg(source, target, item.id, profile);
      if (!leg || !(leg.margin > 0)) continue;
      leg.ceiling = Math.floor(options.cargo / leg.volume) * leg.margin;
      if (!outgoing.has(source.id)) outgoing.set(source.id, []);
      outgoing.get(source.id).push(leg); edges.push(leg);
    }
  }
  edges.sort((a, b) => b.ceiling - a.ceiling);
  let pruned = false;
  const breadth = options.breadth ?? 18;
  for (const [id, list] of outgoing) {
    list.sort((a, b) => b.ceiling - a.ceiling);
    if (list.length > breadth) pruned = true;
    outgoing.set(id, list.slice(0, breadth));
  }
  const starts = options.start ? [options.start] : [...outgoing.keys()];
  const results = [], signatures = new Set();
  let considered = 0, checked = 0, rejectedTime = 0, noNavigation = 0, expired = false;
  const maxMilliseconds = options.searchMs ?? 18000, maxChecks = options.maxChecks ?? 10000;
  const withinBudget = () => !canceled() && considered < maxChecks && performance.now() - started < maxMilliseconds;

  async function consider(legs) {
    if (options.mode !== 'one' && options.start) {
      const index = legs.findIndex(l => l.source === options.start);
      if (index < 0) return;
      legs = [...legs.slice(index), ...legs.slice(0, index)];
    } else if (options.mode === 'one' && options.start && legs[0].source !== options.start) {
      legs = [empty(options.start, legs[0].source), ...legs];
    }
    considered++;
    if (considered % 80 === 0) {
      report({ considered, checked, found: results.length, elapsed: performance.now() - started });
      await pause();
    }
    const signature = legs.map(l => `${l.source}|${l.target}|${l.good || ''}`).join('>');
    if (signatures.has(signature)) return;
    signatures.add(signature);
    const routes = legs.map(l => navigator.route(l.source, l.target));
    const known = routes.every(Boolean);
    if (!known && !options.allowUnknownTime) { noNavigation++; return; }
    const stops = legs.length + 1;
    const seconds = known ? routes.reduce((s, r) => s + r.seconds, 0) + stops * (options.timeModel?.dock ?? 30) : null;
    if (seconds != null && seconds > options.maxMinutes * 60) { rejectedTime++; return; }
    checked++;
    const quote = optimizeTour(legs, usable, options);
    if (!quote) return;
    const profit = quote.profit, hourly = seconds > 0 ? profit / seconds * 3600 : null;
    results.push({ id: signature, legs, quantities: quote.quantities, orderMask: quote.orderMask, profit,
      capitalNeeded: quote.capitalNeeded, peakCargo: quote.peakCargo, seconds, hourly,
      jumps: known ? routes.reduce((s, r) => s + r.jumps, 0) : null,
      closed: legs.at(-1).target === legs[0].source });
    if (results.length > 300) {
      results.sort(compare); results.length = 150;
    }
  }
  function compare(a, b) {
    if (options.sort === 'profit') return b.profit - a.profit;
    if (a.hourly == null && b.hourly != null) return 1;
    if (b.hourly == null && a.hourly != null) return -1;
    return (b.hourly ?? b.profit) - (a.hourly ?? a.profit);
  }
  // A high-profit edge frontier is an explicit bounded candidate search.
  // Quantities and operation order are optimized exactly for each checked tour.
  const seedEdges = edges;
  const modes = options.mode === 'auto' ? ['two', 'three'] : [options.mode];
  for (const first of seedEdges) {
    if (!withinBudget()) { expired = true; break; }
    if (modes.includes('one')) await consider([first]);
    if (modes.includes('two')) {
      // A short empty return is valid, even if the destination sells nothing.
      await consider([first, empty(first.target, first.source)]);
      for (const second of outgoing.get(first.target) || []) if (second.target === first.source) {
        if (!withinBudget()) { expired = true; break; }
        await consider([first, second]);
      }
    }
    if (modes.includes('three')) {
      for (const second of outgoing.get(first.target) || []) {
        if (second.target === first.source) continue;
        if (!withinBudget()) { expired = true; break; }
        await consider([first, second, empty(second.target, first.source)]);
        for (const third of outgoing.get(second.target) || []) if (third.target === first.source) {
          if (!withinBudget()) { expired = true; break; }
          await consider([first, second, third]);
        }
      }
    }
  }
  results.sort(compare);
  return { results: results.slice(0, 60), stats: { considered, checked, rejectedTime, noNavigation, excludedBases: bases.length - usable.length,
    candidateEdges: edges.length, partial: pruned || expired || canceled(), canceled: canceled(), elapsed: performance.now() - started },
    assumptions: ['Eine Ware je Flugabschnitt', 'Positive Handelsmargen; Leer-Rückflug möglich', 'Bestände und Preise bleiben während der Simulation konstant', 'Charakterabhängiger Dockzugang separat prüfen'],
    scope: 'Beste gefundene Touren; begrenzte Kandidatensuche, kein Nachweis des globalen Optimums.' };
}
