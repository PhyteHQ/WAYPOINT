/** Optional integration check: use the same public API client as the app. */
import { liveData } from '../src/data.mjs';
import { baseProblems, makeLeg, optimizeTour, PROFILES } from '../src/trade.mjs';
import { search } from '../src/search.mjs';
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
    const result = await search(data, navigation, PROFILES[2], { cargo: 3600, capital: 1000000, mode: 'auto', start: start.id,
      returnScope: 'system', allowEmptyReturn: false, maxMinutes: 120, sort: 'hourly', breadth: 18, searchMs: 12000,
      maxChecks: 2000, timeModel: { dock: 30, jump: 15, charge: 5, lane: 10 } });
    for (const route of result.results) {
      if (!route.legs.at(-1).good || route.returnSystem !== start.system) throw new Error('The system return violates its destination or cargo requirement.');
    }
    const best = result.results[0];
    console.log(JSON.stringify({ check: 'live-system-return-search', start: start.name, targetSystem: start.systemName,
      found: result.results.length, considered: result.stats.considered, checked: result.stats.checked, elapsedMs: Math.round(result.stats.elapsed),
      best: best ? { profit: best.profit, seconds: best.seconds, trades: best.tradeCount,
        legs: best.legs.map((l, i) => ({ from: data.bases.find(b => b.id === l.source)?.name,
          to: data.bases.find(b => b.id === l.target)?.name, cargo: l.good || 'local pickup', quantity: best.quantities[i] })) } : null }));
  }
} catch (error) {
  console.error(`Public market integration check failed: ${error.message}`);
  process.exitCode = 1;
}
