import { baseProblems, makeLeg, optimizeTour } from './trade.mjs';
import { Navigator } from './navigation.mjs';
import { cargoItems } from './cargo.mjs';
import { estimateShipment, selectCandidates, roughTravelTime } from './ranking.mjs';

const empty = (from, to, purpose) => ({ source: from, target: to, good: null, name: 'Leerflug', margin: 0, volume: 0, purpose });
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const pair = (from, to) => JSON.stringify([from, to]);

export async function search(dataset, navigation, profile, options, report = () => {}, canceled = () => false) {
  const started = performance.now(), bases = dataset.bases.filter(b => !options.excludePobs || b.kind !== 'pob');
  const usable = bases.filter(b => !baseProblems(b).length && !options.blocked?.includes(b.id));
  const byId = new Map(usable.map(b => [b.id, b]));
  const navigator = new Navigator(navigation, usable, profile, options.timeModel);
  const approximateTime = roughTravelTime(navigation, byId, profile, options.timeModel);
  const returnScope = options.returnScope === 'system' ? 'system' : 'base';
  const flexible = options.flexiblePickups === true || returnScope === 'system';
  const allowEmptyReturn = options.allowEmptyReturn ?? true;
  const breadth = options.breadth ?? 18;
  const outgoing = new Map(), systemOutgoing = new Map(), returns = new Map(), edges = [], goods = new Map(), shipments = new Map();
  const results = [], signatures = new Set();
  let pruned = false, considered = 0, checked = 0, ranked = 0, rejectedTime = 0, noNavigation = 0, expired = false, candidateEdges = 0;
  const maxMilliseconds = options.searchMs ?? 18000, maxChecks = options.maxChecks ?? 10000;
  const withinBudget = () => !canceled() && considered < maxChecks && performance.now() - started < maxMilliseconds;
  const sameSystem = (a, b) => Boolean(byId.get(a)?.system) && byId.get(a).system === byId.get(b)?.system;
  const push = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

  for (const base of usable) for (const offer of base.offers) push(goods, offer.id, { base, offer });
  for (let b = 0; b < usable.length; b++) {
    const source = usable[b];
    for (const item of source.offers) {
      if (!(item.buy > 0)) continue;
      for (const { base: target, offer } of goods.get(item.id) || []) {
        if (source.id === target.id || !(offer.sell > item.buy)) continue;
        const leg = makeLeg(source, target, item.id, profile, item, offer);
        if (!leg) continue;
        candidateEdges++;
        if (options.mixedCargo === false) edges.push(leg);
        else push(shipments, pair(source.id, target.id), leg);
      }
    }
    if (b % 40 === 39) {
      report({ phase: 'offers', candidates: candidateEdges, considered, checked, found: 0 });
      await pause();
      if (canceled()) break;
    }
  }
  for (const items of shipments.values()) edges.push(items.length === 1 ? items[0] : { ...items[0], items });
  for (const leg of edges) {
    const source = byId.get(leg.source), target = byId.get(leg.target);
    push(outgoing, source.id, leg);
    if (source.system) push(systemOutgoing, source.system, leg);
    if (source.system && target.system) push(returns, pair(source.system, target.system), leg);
  }
  const returnPotential = new Map();
  const availableProfit = leg => leg.availableProfit ??= estimateShipment(leg, byId, options.cargo).profit;
  function backhaul(fromSystem, goal) {
    const key = pair(fromSystem, goal.base || goal.system);
    if (!returnPotential.has(key)) {
      const list = (returns.get(pair(fromSystem, goal.system)) || []).filter(l => !goal.base || l.target === goal.base);
      returnPotential.set(key, list.reduce((best, l) => Math.max(best, availableProfit(l)), 0));
    }
    return returnPotential.get(key);
  }
  function metrics(trade, profit, potentialProfit, seconds, lookahead = 0) {
    const divisor = seconds > 0 ? seconds : 3600;
    return { trade, profit, potentialProfit, seconds, rate: profit / divisor, potentialRate: potentialProfit / divisor,
      lookahead: (profit + lookahead) / divisor };
  }
  function pathTime(legs, exact = false) {
    let seconds = (legs.length + 1) * (options.timeModel?.dock ?? 30);
    for (const leg of legs) {
      const travel = exact ? navigator.route(leg.source, leg.target)?.seconds : approximateTime(leg.source, leg.target);
      if (travel == null) return null;
      seconds += travel;
    }
    return seconds;
  }
  async function nextTrades(prefix, goal) {
    const current = prefix.at(-1).target;
    const system = byId.get(current)?.system;
    let list = flexible && system ? (goal?.system ? returns.get(pair(system, goal.system)) : systemOutgoing.get(system)) : outgoing.get(current);
    list ||= [];
    // Match the destination before pruning; unrelated exports must not hide returns.
    if (goal) list = list.filter(l => goal.base ? l.target === goal.base : byId.get(l.target)?.system === goal.system);
    if (!list.length) return [];
    if (list.length > breadth) pruned = true;
    let prefixProfit = 0, prefixPotential = 0;
    for (const leg of prefix) if (leg.good) {
      prefixProfit += estimateShipment(leg, byId, options.cargo, options.capital + prefixProfit).profit;
      prefixPotential += estimateShipment(leg, byId, options.cargo, options.capital + prefixPotential,
        { targetLimits: false, sourceLimits: false }).profit;
    }
    const budget = options.capital + prefixPotential;
    const preliminary = list.map(trade => {
      const legs = appendTrade(prefix, trade);
      const profit = estimateShipment(trade, byId, options.cargo, budget).profit;
      const potential = estimateShipment(trade, byId, options.cargo, budget, { targetLimits: false, sourceLimits: false }).profit;
      return metrics(trade, prefixProfit + profit, prefixPotential + potential, pathTime(legs));
    });
    const shortlist = selectCandidates(preliminary, Math.max(breadth * 6, 48), options.sort === 'profit' ? 'profit' : 'rate'), refined = [];
    for (const candidate of shortlist) {
      if (!withinBudget()) { expired = true; break; }
      const legs = appendTrade(prefix, candidate.trade), seconds = pathTime(legs, true);
      ranked++;
      if (seconds == null && !options.allowUnknownTime) { noNavigation++; continue; }
      if (seconds != null && seconds > options.maxMinutes * 60) { rejectedTime++; continue; }
      refined.push(metrics(candidate.trade, candidate.profit, candidate.potentialProfit, seconds));
      if (ranked % 24 === 0) { report({ phase: 'ranking', ranked, considered, checked, found: results.length }); await pause(); }
    }
    return selectCandidates(refined, breadth, options.sort === 'profit' ? 'profit' : 'rate').map(c => c.trade);
  }
  function appendTrade(legs, trade) {
    const current = legs.at(-1).target;
    if (current === trade.source) return [...legs, trade];
    if (!flexible || !sameSystem(current, trade.source)) return null;
    return [...legs, empty(current, trade.source, 'pickup'), trade];
  }
  function compare(a, b) {
    if (options.sort === 'profit') return b.profit - a.profit;
    if (a.hourly == null && b.hourly != null) return 1;
    if (b.hourly == null && a.hourly != null) return -1;
    return (b.hourly ?? b.profit) - (a.hourly ?? a.profit);
  }
  async function consider(legs, goal = null) {
    considered++;
    if (considered % 40 === 0) {
      report({ considered, checked, found: results.length, elapsed: performance.now() - started });
      await pause();
    }
    if (legs.some((l, i) => i > 0 && legs[i - 1].target !== l.source)) return;
    const signature = legs.map(l => `${l.source}|${l.target}|${cargoItems(l).map(item => item.good).sort().join(',')}`).join('>');
    if (signatures.has(signature)) return;
    signatures.add(signature);
    const routes = legs.map(l => navigator.route(l.source, l.target));
    const known = routes.every(Boolean);
    if (!known && !options.allowUnknownTime) { noNavigation++; return; }
    const seconds = known ? routes.reduce((s, r) => s + r.seconds, 0) + (legs.length + 1) * (options.timeModel?.dock ?? 30) : null;
    if (seconds != null && seconds > options.maxMinutes * 60) { rejectedTime++; return; }
    checked++;
    const routeBases = [...new Set(legs.flatMap(l => [l.source, l.target]))].map(id => byId.get(id));
    const quote = optimizeTour(legs, routeBases, options);
    if (!quote) return;
    const profit = quote.profit, hourly = seconds > 0 ? profit / seconds * 3600 : null;
    const last = legs.at(-1), destination = byId.get(last.target);
    results.push({ id: signature, legs, quantities: quote.quantities, itemQuantities: quote.itemQuantities, loads: quote.loads,
      mixed: quote.loads.some(load => load.length > 1), orderMask: quote.orderMask, profit,
      capitalNeeded: quote.capitalNeeded, peakCargo: quote.peakCargo, seconds, hourly,
      jumps: known ? routes.reduce((s, r) => s + r.jumps, 0) : null,
      closed: last.target === legs[0].source, systemClosed: sameSystem(legs[0].source, last.target),
      roundTrip: options.mode !== 'one', returnScope: goal ? returnScope : null,
      returnSystem: goal?.system || null, returnSystemName: goal ? destination.systemName || destination.system : null,
      tradeCount: legs.filter(l => l.good).length, localTransfers: legs.filter(l => !l.good && l.purpose !== 'return').length,
      emptyReturn: last.purpose === 'return' });
    if (results.length > 300) { results.sort(compare); results.length = 150; }
  }
  async function finish(prefix, goal) {
    for (const trade of await nextTrades(prefix, goal)) {
      if (!withinBudget()) { expired = true; return; }
      const legs = appendTrade(prefix, trade);
      if (legs) await consider(legs, goal);
    }
    if (!allowEmptyReturn || !withinBudget()) return;
    const current = prefix.at(-1).target;
    let targets = goal.base ? [byId.get(goal.base)] : usable.filter(b => b.system && b.system === goal.system);
    if (targets.some(b => b?.id === current)) { await consider(prefix, goal); return; }
    targets = targets.filter(Boolean).map(b => ({ id: b.id, seconds: navigator.route(current, b.id)?.seconds ?? Infinity }));
    targets.sort((a, b) => a.seconds - b.seconds);
    if (targets.length) await consider([...prefix, empty(current, targets[0].id, 'return')], goal);
  }

  const start = options.start ? byId.get(options.start) : null;
  if (options.start && !start) return { results: [], stats: { considered, checked, excludedBases: bases.length - usable.length } };
  const seeds = [];
  for (const leg of edges) {
    if (start && options.mode !== 'one' && leg.source !== start.id && !sameSystem(start.id, leg.source)) continue;
    const source = byId.get(leg.source), anchor = start || source;
    const potential = estimateShipment(leg, byId, options.cargo, options.capital, { targetLimits: false }).profit;
    if (!(potential > 0)) continue;
    const profit = estimateShipment(leg, byId, options.cargo, options.capital).profit;
    const prefix = anchor.id === leg.source ? [leg] : [empty(anchor.id, leg.source, 'approach'), leg];
    const goal = { system: returnScope === 'system' ? options.returnSystem || anchor.system : anchor.system,
      base: returnScope === 'base' ? anchor.id : null };
    seeds.push(metrics(leg, profit, potential, pathTime(prefix), options.mode === 'one' ? 0 : backhaul(byId.get(leg.target)?.system, goal)));
  }
  const modes = options.mode === 'auto' ? ['two', 'three'] : [options.mode];
  for (const { trade: first } of selectCandidates(seeds, seeds.length, options.sort === 'profit' ? 'profit' : 'rate')) {
    if (!withinBudget()) { expired = true; break; }
    const anchor = start || byId.get(first.source);
    const prefix = anchor.id === first.source ? [first] : [empty(anchor.id, first.source, 'approach'), first];
    if (modes.includes('one')) { await consider(prefix); continue; }
    const system = returnScope === 'system' ? options.returnSystem || anchor.system : anchor.system;
    const goal = { system, base: returnScope === 'base' ? anchor.id : null };
    if (!goal.base && !goal.system) continue;
    if (modes.includes('two')) await finish(prefix, goal);
    if (modes.includes('three')) for (const second of await nextTrades(prefix)) {
      if (!withinBudget()) { expired = true; break; }
      const extended = appendTrade(prefix, second);
      if (extended) await finish(extended, goal);
    }
  }
  results.sort(compare);
  return { results: results.slice(0, 60), stats: { considered, checked, ranked, rejectedTime, noNavigation, excludedBases: bases.length - usable.length,
    candidateEdges, shipmentCandidates: edges.length, partial: pruned || expired || canceled(), canceled: canceled(), elapsed: performance.now() - started },
    assumptions: [options.mixedCargo === false ? 'Eine Ware je Handelsabschnitt' : 'Mischladungen zwischen denselben Basen', 'Lokale Anflüge mit vollständiger Flugzeit',
      allowEmptyReturn ? 'Leerer Rückweg zugelassen' : 'Rückhandel mit Ladung erforderlich',
      'Bestände werden pro Geschäft fortgeschrieben; Preise bleiben im Modell konstant', 'Charakterabhängiger Dockzugang separat prüfen'],
    scope: 'Beste gefundene Touren; begrenzte Kandidatensuche, kein Nachweis des globalen Optimums.' };
}
