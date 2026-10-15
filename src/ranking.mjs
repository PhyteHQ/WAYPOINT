import { cargoItems } from './cargo.mjs';

const indices = new WeakMap(), orderings = new WeakMap();
function offersFor(base) {
  if (indices.get(base)?.offers !== base.offers) indices.set(base, { offers: base.offers, map: new Map(base.offers.map(o => [o.id, o])) });
  return indices.get(base).map;
}

// Ranking is an estimate only. The joint integer optimizer and replay decide
// feasibility, including purchases that fund a POB before an incoming sale.
export function estimateShipment(leg, byId, cargo, capital = Infinity, { targetLimits = true, sourceLimits = true } = {}) {
  const source = byId.get(leg.source), target = byId.get(leg.target), items = cargoItems(leg);
  if (!source || !target || !items.length) return { profit: 0, volume: 0, cost: 0 };
  const offersFrom = offersFor(source), offersTo = offersFor(target);
  if (!orderings.has(leg)) orderings.set(leg, items.length === 1 ? [items] :
    [line => line.margin / line.volume, line => line.margin / line.buy, line => line.margin / line.targetVolume]
      .map(metric => [...items].sort((a, b) => metric(b) - metric(a))));
  let best = { profit: 0, volume: 0, cost: 0 };
  for (const order of orderings.get(leg)) {
    let free = cargo, budget = capital, money = targetLimits && target.kind === 'pob' ? Number(target.cash) : Infinity;
    let space = targetLimits && target.kind === 'pob' ? Number(target.space) : Infinity, profit = 0, cost = 0;
    for (const line of order) {
      const from = offersFrom.get(line.good), to = offersTo.get(line.good);
      const reserve = sourceLimits && source.kind === 'pob' ? Math.max(0, Number(from.stock) - Number(from.min)) : Infinity;
      const demand = targetLimits && target.kind === 'pob' ? Math.max(0, Number(to.max) - Number(to.stock)) : Infinity;
      const q = Math.max(0, Math.floor(Math.min(free / line.volume, budget / line.buy, reserve, demand,
        money / line.sell, space / line.targetVolume) + 1e-7));
      if (!q) continue;
      free -= q * line.volume; budget -= q * line.buy; money -= q * line.sell; space -= q * line.targetVolume;
      profit += q * line.margin; cost += q * line.buy;
    }
    if (profit > best.profit) best = { profit, volume: cargo - free, cost };
  }
  return best;
}

export function selectCandidates(candidates, limit, primary = 'rate') {
  const metrics = ['rate', 'profit', 'potentialRate', 'potentialProfit', 'lookahead'];
  const lists = new Map(metrics.map(metric => [metric, [...candidates].sort((a, b) => b[metric] - a[metric] || b.profit - a.profit)]));
  const positions = new Map(metrics.map(metric => [metric, 0])), seen = new Set(), chosen = [];
  const schedule = primary === 'profit' ? ['profit', 'profit', 'rate', 'profit', 'potentialProfit', 'lookahead', 'potentialRate'] :
    ['rate', 'rate', 'profit', 'rate', 'potentialRate', 'lookahead', 'potentialProfit'];
  while (chosen.length < Math.min(limit, candidates.length)) {
    let added = false;
    for (const metric of schedule) {
      const list = lists.get(metric); let at = positions.get(metric);
      while (at < list.length && seen.has(list[at].trade)) at++;
      positions.set(metric, at + 1);
      if (at >= list.length) continue;
      const next = list[at]; seen.add(next.trade); chosen.push(next); added = true;
      if (chosen.length >= limit) break;
    }
    if (!added) break;
  }
  return chosen;
}

export function roughTravelTime(navigation, bases, profile, settings = {}) {
  const byId = bases, nodes = new Map((navigation?.nodes || []).map(n => [n.id, n])), exits = new Map(), lanes = new Map(), systems = new Map(), hops = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const edge of navigation?.links || []) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to); if (!from || !to) continue;
    if (edge.kind === 'jump') { add(systems, from.system, to.system); add(exits, from.system, from.pos); add(exits, to.system, to.pos); }
    if (edge.kind === 'lane') lanes.set(from.system, Math.max(lanes.get(from.system) || 0, edge.speed));
  }
  const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  const speed = system => Math.max(profile.cruise, lanes.get(system) || 0);
  function hopCount(from, to) {
    if (!hops.has(from)) {
      const costs = new Map([[from, 0]]), queue = [from];
      for (let at = 0; at < queue.length; at++) for (const next of systems.get(queue[at]) || []) if (!costs.has(next)) {
        costs.set(next, costs.get(queue[at]) + 1); queue.push(next);
      }
      hops.set(from, costs);
    }
    return hops.get(from).get(to);
  }
  return (fromId, toId) => {
    if (fromId === toId) return 0;
    const from = byId.get(fromId), to = byId.get(toId);
    if (!from?.pos || !to?.pos || !from.system || !to.system) return null;
    if (from.system === to.system) return distance(from.pos, to.pos) / speed(from.system) + (settings.charge ?? 5);
    const count = hopCount(from.system, to.system);
    if (count == null) return null;
    const approach = base => {
      const points = exits.get(base.system) || []; return points.length ? Math.min(...points.map(pos => distance(base.pos, pos))) / speed(base.system) : 0;
    };
    return count * (settings.jump ?? 15) + approach(from) + approach(to) + 2 * (settings.charge ?? 5);
  };
}
