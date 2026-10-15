/** Optional integration check: use the same public API client as the app. */
import { liveData } from '../src/data.mjs';

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
  console.log(JSON.stringify({ check: 'public-market-api', receivedAt: data.asOf,
    bases: data.bases.length, pobs: data.bases.filter(b => b.kind === 'pob').length,
    offers: data.bases.reduce((n, b) => n + b.offers.length, 0), cors: 'allowed' }));
} catch (error) {
  console.error(`Public market integration check failed: ${error.message}`);
  process.exitCode = 1;
}
