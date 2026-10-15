import { normalizeDarkstat, validateDataset } from './trade.mjs';
import { validateNavigation } from './navigation.mjs';

const API = 'https://darkstat.dd84ai.com/api';
export async function request(path, body, signal) {
  const init = { method: 'POST', headers: { Accept: 'application/json' }, signal };
  if (body !== undefined) init.body = JSON.stringify(body);
  let response = await fetch(`${API}/${path}`, init);
  if (response.status === 405) {
    const query = body ? `?${new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]))}` : '';
    response = await fetch(`${API}/${path}${query}`, { headers: { Accept: 'application/json' }, signal });
  }
  if (!response.ok) throw new Error(`Darkstat antwortet mit HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 70 * 1024 * 1024) throw new Error('Marktantwort ist zu groß.');
  try { return JSON.parse(text); } catch { throw new Error('Darkstat liefert zurzeit keine lesbaren Marktdaten.'); }
}

export async function liveData(signal) {
  const [pobs, commodities] = await Promise.all([
    request('pobs', undefined, signal),
    request('commodities', { include_market_goods: true, filter_to_useful: true }, signal),
  ]);
  const result = normalizeDarkstat(pobs, commodities);
  if (!result.bases.some(b => b.offers.length)) throw new Error('Die Marktantwort enthält keine handelbaren Waren.');
  return result;
}

function database() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('waypoint-data-v1', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
export async function cacheRead() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots'), read = tx.objectStore('snapshots').get('market');
    read.onsuccess = () => { db.close(); resolve(read.result ? validateDataset(read.result) : null); };
    read.onerror = () => { db.close(); reject(read.error); };
  });
}
export async function cacheWrite(data) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').put(data, 'market');
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function loadNavigation() {
  const response = await fetch('./data/navigation.json');
  if (!response.ok) throw new Error('Navigationskatalog fehlt.');
  return validateNavigation(await response.json());
}
export function parseImport(value) {
  if (value?.schema === 1 && Array.isArray(value.bases)) return { dataset: validateDataset(value) };
  if (value?.schema === 1 && Array.isArray(value.nodes)) return { navigation: validateNavigation(value) };
  if (Array.isArray(value?.pobs) && Array.isArray(value?.commodities)) return { dataset: normalizeDarkstat(value.pobs, value.commodities, value.asOf) };
  if (value?.market && value?.navigation) return { dataset: validateDataset(value.market), navigation: validateNavigation(value.navigation) };
  throw new Error('Die Datei enthält keinen unterstützten Markt- oder Navigationskatalog.');
}
