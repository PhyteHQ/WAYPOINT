/** Optional integration check: use the same public API client as the app. */
import { liveData } from '../src/data.mjs';
import { baseProblems, makeLeg, optimizeTour, simulate, PROFILES } from '../src/trade.mjs';
import { search } from '../src/search.mjs';
import { groupRoutes } from '../src/variants.mjs';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const origin = process.env.WAYPOINT_ORIGIN || 'https://phytehq.github.io';
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Origin', origin);
  const response = await originalFetch(url, { ...init, headers });
  const request = { path: new URL(url).pathname, method: init.method || 'GET', status: response.status,
    contentType: response.headers.get('content-type'), allowOrigin: response.headers.get('access-control-allow-origin') };
  requests.push(request);
  console.log(JSON.stringify(request));
  return response;
};

try {
  const data = await liveData(AbortSignal.timeout(25000));
  const successful = requests.filter(r => r.status >= 200 && r.status < 300);
  if (successful.some(r => r.allowOrigin !== '*' && r.allowOrigin !== origin)) {
    throw new Error('The public API does not permit the GitHub Pages origin through CORS.');
  }
  const pobs = data.bases.filter(b => b.kind === 'pob');
  const usablePobs = pobs.filter(b => !baseProblems(b).length && b.offers.some(o =>
    ['stock', 'min', 'max', 'volume', 'originalVolume'].every(f => Number.isFinite(o[f])) && o.volume > 0 && o.originalVolume > 0));
  if (pobs.length && !usablePobs.length) throw new Error('POB records contain no complete money, storage and commodity limits.');
  const sources = new Map();
  for (const base of data.bases) for (const offer of base.offers) if (offer.buy > 0) {
    const list = sources.get(offer.id) || [];
    list.push({ base, price: offer.buy }); sources.set(offer.id, list);
  }
  for (const list of sources.values()) list.sort((a, b) => a.price - b.price);
  let delivery = null;
  outer: for (const target of usablePobs) for (const offer of target.offers) {
    for (const { base: source } of (sources.get(offer.id) || []).slice(0, 5)) {
      if (source.id === target.id) continue;
      const leg = makeLeg(source, target, offer.id, PROFILES[0]);
      if (!leg || leg.margin <= 0) continue;
      const quote = optimizeTour([leg], [source, target], { cargo: 5000, capital: 10000000 });
      if (quote?.profit > 0) {
        delivery = { quantity: quote.quantities[0], profit: quote.profit, peakCargo: quote.peakCargo };
        break outer;
      }
    }
  }
  console.log(JSON.stringify({ check: 'public-market-api', receivedAt: data.asOf,
    bases: data.bases.length, pobs: data.bases.filter(b => b.kind === 'pob').length,
    offers: data.bases.reduce((n, b) => n + b.offers.length, 0), cors: 'allowed',
    pobsWithCompleteTradingData: usablePobs.length, feasiblePobDeliveryQuote: delivery }));
  const start = data.bases.find(b => b.name === 'Resolution Heavy Works');
  if (start) {
    const navigation = JSON.parse(gunzipSync(readFileSync(new URL('../data/navigation.json.gz', import.meta.url))));
    const options = { cargo: 3600, capital: 1000000, mode: 'auto', start: start.id,
      returnScope: 'system', allowEmptyReturn: false, maxMinutes: 60, sort: 'hourly', breadth: 18, searchMs: 18000,
      maxChecks: 10000, mixedCargo: true, timeModel: { dock: 30, jump: 15, charge: 5, lane: 10 } };
    const result = await search(data, navigation, PROFILES[2], options);
    for (const route of result.results) {
      const last = route.legs.at(-1), destination = data.bases.find(b => b.id === last.target);
      if (!route.loads.at(-1).length || destination?.system !== start.system) throw new Error('The system return violates its destination or cargo requirement.');
      const replay = simulate(route.legs, route.itemQuantities, data.bases, options, route.orderMask);
      if (!replay || Math.abs(replay.profit - route.profit) > 1e-6) throw new Error('A selected mixed manifest fails exact financial replay.');
    }
    const best = result.results[0];
    const groups = groupRoutes(result.results, new Map(data.bases.map(b => [b.id, b])), options.sort);
    console.log(JSON.stringify({ check: 'live-system-return-search', start: start.name, targetSystem: start.systemName,
      found: result.results.length, mixed: result.results.filter(r => r.mixed).length, considered: result.stats.considered,
      routeGroups: groups.length, variantsPerGroup: groups.map(group => group.entries.length),
      checked: result.stats.checked, ranked: result.stats.ranked, elapsedMs: Math.round(result.stats.elapsed),
      baselineBestHourly: result.stats.baselineBestHourly, mixedRefinements: result.stats.mixedRefinements,
      best: best ? { profit: best.profit, seconds: best.seconds, trades: best.tradeCount,
        legs: best.legs.map((l, i) => ({ from: data.bases.find(b => b.id === l.source)?.name,
          to: data.bases.find(b => b.id === l.target)?.name, cargo: best.loads[i].map(item => ({ good: item.good, quantity: item.quantity })) })) } : null }));
    const single = await search(data, navigation, PROFILES[2], { ...options, mixedCargo: false });
    console.log(JSON.stringify({ check: 'live-cargo-comparison', snapshot: data.asOf,
      mixed: { found: result.results.length, bestProfit: best?.profit, bestHourly: best?.hourly, elapsedMs: Math.round(result.stats.elapsed) },
      single: { found: single.results.length, bestProfit: single.results[0]?.profit, bestHourly: single.results[0]?.hourly, elapsedMs: Math.round(single.stats.elapsed),
        legs: single.results[0]?.legs.map((l,i)=>({from: data.bases.find(b=>b.id===l.source)?.name,to:data.bases.find(b=>b.id===l.target)?.name,cargo:single.results[0].loads[i].map(item=>({good:item.good,quantity:item.quantity}))})) } }));
    if (best && best.hourly + 1e-6 < result.stats.baselineBestHourly) throw new Error('Mixed refinement discarded a better baseline tour.');
  }
} catch (error) {
  console.error(`Public market integration check failed: ${error.message}`);
  process.exitCode = 1;
}
