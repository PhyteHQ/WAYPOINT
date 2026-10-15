import { PROFILES, optimizeTour } from './trade.mjs';
import { cacheRead, cacheWrite, liveData, loadNavigation, parseImport } from './data.mjs';
import { example } from './example.mjs';
import { setupMarketPicker } from './picker.mjs';
import { setupPwa } from './pwa.mjs';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const integer = value => Number.isFinite(value) ? Math.round(value).toLocaleString('de-DE') : '—';
const money = value => Number.isFinite(value) ? value >= 1e6 ? `${(value / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 })} M` : integer(value) : '—';
const duration = seconds => seconds == null ? 'Unbekannt' : `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')} min`;
const clock = value => new Date(value).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
let dataset = null, navigation = null, realNavigation = null, dataMode = 'connecting', profile = PROFILES[0];
let mode = 'auto', results = [], stats = null, busy = false, requestId = 0, activeOptions = null, debounce;
let worker = null, liveController = null, lastError = '', detailId = 0;
let blocked = [];
try {
  const settings = JSON.parse(localStorage.getItem('waypoint-settings-v1') || '{}');
  profile = PROFILES.find(p => p.id === settings.profile) || profile;
  mode = ['one', 'auto', 'two', 'three'].includes(settings.mode) ? settings.mode : mode;
  if (['system', 'base'].includes(settings.returnScope)) $('returnScope').value = settings.returnScope;
  if (typeof settings.returnSystem === 'string' && settings.returnSystem.length < 200) $('returnSystem').value = settings.returnSystem;
  if (typeof settings.allowEmptyReturn === 'boolean') $('allowEmptyReturn').checked = settings.allowEmptyReturn;
  for (const id of ['capital', 'maxMinutes', 'dockTime', 'jumpTime', 'chargeTime', 'breadth']) if (settings[id] != null && /^\d+$/.test(String(settings[id]))) $(id).value = settings[id];
  blocked = Array.isArray(settings.blocked) ? settings.blocked.filter(x => typeof x === 'string').slice(0, 1000) : [];
} catch { /* Corrupt or unavailable preferences do not prevent startup. */ }
const marketPicker = setupMarketPicker();
setupPwa();

function saveSettings() {
  const settings = { profile: profile.id, mode, blocked, returnScope: $('returnScope').value,
    returnSystem: $('returnSystem').value, allowEmptyReturn: $('allowEmptyReturn').checked };
  for (const id of ['capital', 'maxMinutes', 'dockTime', 'jumpTime', 'chargeTime', 'breadth']) settings[id] = $(id).value;
  try { localStorage.setItem('waypoint-settings-v1', JSON.stringify(settings)); } catch { /* Storage can be disabled. */ }
}
function setProfile(next) {
  profile = next; $('cargo').value = next.cargo; $('cargo').max = next.cargo;
  for (const button of document.querySelectorAll('[data-ship]')) {
    const active = button.dataset.ship === next.id; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
  saveSettings(); queueSearch();
}
function setMode(next) {
  mode = next;
  const closed = next !== 'one'; $('stopsField').hidden = !closed;
  if (closed) $('stops').value = next;
  for (const button of document.querySelectorAll('[data-mode]')) {
    const active = button.dataset.mode === (closed ? 'auto' : 'one'); button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
  updateReturnControls();
  saveSettings(); queueSearch();
}
function updateReturnControls() {
  const roundTrip = mode !== 'one', system = $('returnScope').value === 'system';
  $('returnControls').hidden = !roundTrip;
  $('returnSystemField').hidden = !system;
  $('startHint').textContent = !roundTrip ? 'Die Anreise von dieser Basis zum Einkaufsort wird mitgerechnet.' : system ?
    'Lokale Abholbasen dürfen wechseln. Die Tour endet bei einem passenden Abnehmer im Zielsystem.' :
    'Die Tour kehrt genau zu dieser Basis zurück. Leer lassen für freie Startwahl.';
}
function notice(text, severity = 'warn') {
  $('notice').textContent = text; $('notice').hidden = !text;
  $('notice').dataset.severity = severity;
}
function updateSource() {
  const demo = dataMode === 'demo', stale = dataset && Date.now() - Date.parse(dataset.asOf) > 10 * 60 * 1000;
  $('connection').className = `data-state ${dataMode === 'live' && !stale ? 'ok' : 'warn'}`;
  const label = { connecting: 'VERBINDE', live: 'MARKTDATEN', cached: 'GESPEICHERT', demo: 'BEISPIEL', imported: 'IMPORT', offline: 'OFFLINE' }[dataMode] || 'OFFLINE';
  $('connection').innerHTML = `<i></i>${label}`;
  $('sourceStrip').classList.toggle('example', demo);
  if (dataset) {
    const prefix = demo ? 'FIKTIVE BEISPIELDATEN · kein echter Markt' : dataMode === 'cached' ? `GESPEICHERTER ABRUF ${clock(dataset.asOf)}` : dataMode === 'imported' ? `IMPORT · ${clock(dataset.asOf)}` : `DARKSTAT · ABRUF ${clock(dataset.asOf)}`;
    $('sourceLabel').textContent = prefix + (stale && !demo ? ' · veraltet' : '');
    $('marketCount').textContent = `${integer(dataset.bases.length)} Basen · ${integer(dataset.bases.filter(b => b.kind === 'pob').length)} POBs`;
  } else {
    $('sourceLabel').textContent = dataMode === 'connecting' ? 'Marktdaten werden angefragt' : 'Keine gültigen Marktdaten verfügbar';
    $('marketCount').textContent = navigation ? `${integer(navigation.coverage?.systems || 0)} Systeme im Navigationsmodell` : 'Navigationsmodell wird geladen';
  }
  $('searchButton').disabled = !dataset || busy;
  $('exportButton').disabled = !dataset;
}
function setDataset(data, source) {
  dataset = data; dataMode = source; results = []; stats = null;
  marketPicker.setData(data);
  updateSource();
}
function options() {
  const startText = $('start').value.trim();
  const matches = dataset.bases.filter(b => b.name === startText || b.id === startText);
  const selectedStart = matches.find(b => b.id === $('start').dataset.marketId) || (matches.length === 1 ? matches[0] : null);
  if (startText && !selectedStart) throw new Error('Bitte eine Startbasis über die Basisauswahl wählen.');
  const returnScope = $('returnScope').value, returnText = $('returnSystem').value.trim().toLowerCase();
  const systems = [...new Map(dataset.bases.filter(b => b.system).map(b => [b.system, { id: b.system, name: b.systemName || b.system }])).values()];
  const targets = systems.filter(s => s.id.toLowerCase() === returnText || s.name.toLowerCase() === returnText);
  const selectedTarget = targets.find(s => s.id === $('returnSystem').dataset.marketId) || (targets.length === 1 ? targets[0] : null);
  if (mode !== 'one' && returnScope === 'system' && returnText && !selectedTarget) throw new Error('Bitte ein Zielsystem über die Systemauswahl wählen.');
  if (!$('plannerForm').reportValidity()) return null;
  const cargo = Number($('cargo').value), capital = Number($('capital').value);
  if (!(cargo > 0 && cargo <= profile.cargo) || !(capital >= 0)) throw new Error('Freies Volumen oder Kapital ist ungültig.');
  return { mode, start: selectedStart?.id || '', cargo, capital, excludePobs: !$('pobs').checked, allowUnknownTime: $('unknownTime').checked,
    returnScope, returnSystem: returnText ? selectedTarget?.id || '' : '', flexiblePickups: true, allowEmptyReturn: $('allowEmptyReturn').checked,
    maxMinutes: Number($('maxMinutes').value), sort: $('sort').value, blocked,
    breadth: Number($('breadth').value), searchMs: 18000,
    timeModel: { dock: Number($('dockTime').value), jump: Number($('jumpTime').value), charge: Number($('chargeTime').value), lane: 10 } };
}
function getWorker() {
  if (worker) return worker;
  worker = new Worker('./src/worker.mjs', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'detail') {
      if (data.id === detailId && $('detailDialog').open) renderDetail(data.quote, data.repeats);
      return;
    }
    if (data.id !== requestId) return;
    if (data.type === 'progress') $('progressText').textContent = data.phase === 'offers' ? `Angebote vergleichen · ${integer(data.candidates)} mögliche Handelsverbindungen` : `${integer(data.considered)} Touren gesichtet · ${integer(data.checked)} Mengenprüfungen · ${integer(data.found)} Treffer`;
    else if (data.type === 'result') {
      busy = false; results = data.result.results; stats = data.result.stats;
      $('searchProgress').hidden = true; $('cancelButton').hidden = true; updateSource(); renderResults();
    } else if (data.type === 'error') {
      busy = false; $('searchProgress').hidden = true; $('cancelButton').hidden = true; notice(data.message); updateSource();
    }
  };
  worker.onerror = event => { busy = false; updateSource(); $('searchProgress').hidden = true; notice(`Die Berechnung konnte nicht gestartet werden: ${event.message || 'Modul konnte nicht geladen werden.'}`); };
  return worker;
}
function queueSearch() {
  clearTimeout(debounce);
  if (dataset) debounce = setTimeout(runSearch, 250);
}
function runSearch() {
  clearTimeout(debounce);
  if (!dataset) return;
  try {
    const nextOptions = options(); if (!nextOptions) return;
    activeOptions = nextOptions; saveSettings(); busy = true; results = []; stats = null;
    $('resultsBody').innerHTML = ''; $('searchProgress').hidden = false; $('cancelButton').hidden = false;
    $('progressText').textContent = `${profile.name}: mögliche Lieferungen und Rundtouren prüfen …`;
    if (dataset.source === 'demo') notice('Fiktives Funktionsbeispiel. Diese Angebote und Stationen existieren nicht im Spiel.');
    else if (dataMode === 'cached') notice('Berechnung mit einem gespeicherten Abruf. Geld, Lagerplatz und Angebote können sich inzwischen geändert haben.');
    else if (dataMode === 'imported') notice('Berechnung mit importierten Daten. Den Zeitpunkt und die Herkunft vor dem Abflug prüfen.');
    else if (!navigation) notice('Navigationsdaten fehlen. Ohne Flugzeit werden nur ausdrücklich zugelassene Angebote angezeigt.');
    else notice('');
    updateSource();
    getWorker().postMessage({ type: 'search', id: ++requestId, dataset, navigation, profile, options: activeOptions });
  } catch (error) { notice(error.message); }
}
function routeNames(route) {
  const ids = [route.legs[0].source, ...route.legs.map(l => l.target)];
  return ids.map(id => dataset.bases.find(b => b.id === id)?.name || id);
}
function renderResults() {
  const available = results.length;
  if (!available) {
    $('resultsBody').innerHTML = `<div class="empty-state"><div class="route-symbol" aria-hidden="true"><span></span><i></i><span></span></div><h3>Für dieses Profil kein Treffer.</h3><p>${stats?.noNavigation ? 'Für mögliche Angebote fehlen nutzbare Flugwege oder vollständige Navigationsdaten. Du kannst Angebote ohne Flugzeit in den Einstellungen ausdrücklich zulassen.' : 'Prüfe Zielsystem, Rückladung, Kapital, Tourdauer oder Routenmodus. Ein leerer Rückweg wird nur bei ausdrücklicher Freigabe eingeplant. POBs mit fehlenden Pflichtangaben bleiben ausgeschlossen.'}</p></div>`;
  } else {
    $('resultsBody').innerHTML = `<table class="result-table"><thead><tr><th scope="col">ROUTE / STATIONEN</th><th scope="col">LADUNG</th><th scope="col">GEWINN · $</th><th scope="col">$ / STUNDE</th><th scope="col"><span class="sr-only">Details</span></th></tr></thead><tbody>${results.map((route, index) => {
      const names = routeNames(route);
      const tradeCount = route.tradeCount || route.legs.filter(l => l.good).length;
      const tourLabel = !route.roundTrip ? 'ONE WAY' : route.returnScope === 'system' ? 'SYSTEMTOUR' : 'RUNDTOUR';
      const hasPob = route.legs.some(l => dataset.bases.find(b => b.id === l.source)?.kind === 'pob' || dataset.bases.find(b => b.id === l.target)?.kind === 'pob');
      return `<tr><td><div class="route-head"><span class="rank">${String(index + 1).padStart(2, '0')}</span><span class="tag ${route.roundTrip ? 'green' : ''}">${tourLabel}</span>${hasPob ? '<span class="tag">POB</span>' : ''}</div><div class="route-name">${names.map(escape).join('<span class="route-arrow">→</span>')}</div><div class="route-system">${escape(profile.name)} · ${integer(tradeCount)} ${tradeCount === 1 ? 'Handelsflug' : 'Handelsflüge'}${route.localTransfers ? ` · ${integer(route.localTransfers)} Anflüge` : ''}${route.returnSystemName ? ` · Ziel: ${escape(route.returnSystemName)}` : ''} · ${route.jumps == null ? 'Sprünge unbekannt' : `${integer(route.jumps)} Sprünge`} · ${duration(route.seconds)}</div><div class="mobile-profit">${route.hourly != null ? `${money(route.hourly)} $ / h` : '$ / h unbekannt'}</div></td><td class="goods">${route.legs.map((leg, n) => leg.good ? `${escape(leg.name)}<br><b>${integer(route.quantities[n])} Stk. · ${integer(route.quantities[n] * leg.volume)} Vol.</b>` : `<span>${leg.purpose === 'return' ? 'Leerer Rückweg' : 'Anflug zur Abholung'}</span>`).join('<br>')}</td><td class="numeric"><strong title="${integer(route.profit)} $">${money(route.profit)}</strong><div class="subvalue">${integer(route.peakCargo)} / ${integer(activeOptions.cargo)} Vol.</div></td><td class="numeric hourly"><strong>${money(route.hourly)}</strong><div class="subvalue">${duration(route.seconds)}</div></td><td><button class="detail-button" data-route="${index}" aria-label="Handelsplan für Tour ${index + 1} öffnen">↗</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }
  $('resultsFoot').textContent = `${integer(stats?.checked || 0)} Touren mit Mengenprüfung · ${integer(stats?.excludedBases || 0)} Basen ausgeschlossen · ${stats?.partial ? 'Begrenzte Suche; weitere Möglichkeiten können existieren' : 'Kandidatensuche abgeschlossen'} · ${dataMode === 'demo' ? 'Fiktives Beispiel' : 'Persönlichen Dockzugang prüfen'}`;
}

let selectedRoute = null;
function openDetail(index) {
  selectedRoute = results[index]; if (!selectedRoute) return;
  $('detailContent').innerHTML = '<h2 id="detailTitle">Handelsplan wird geprüft …</h2>';
  $('detailDialog').showModal();
  getWorker().postMessage({ type: 'detail', id: ++detailId, dataset, route: selectedRoute, options: activeOptions });
}
function renderDetail(quote, repeats) {
  if (!quote) { $('detailContent').innerHTML = '<h2 id="detailTitle">Tour nicht mehr berechenbar</h2><p class="detail-note">Bitte die Suche erneut starten.</p>'; return; }
  const route = selectedRoute, names = routeNames(route), byId = new Map(dataset.bases.map(b => [b.id, b]));
  const knownTime = route.seconds != null;
  let content = `<h2 id="detailTitle">${names.map(escape).join(' → ')}</h2><div class="detail-status">${dataMode === 'demo' ? 'Fiktive Beispielroute · kein echter Handelsvorschlag' : `Mengen geprüft anhand des Abrufs ${clock(dataset.asOf)}. Persönlicher Dockzugang bleibt unbestätigt.`}</div><div class="detail-stats"><div class="detail-stat"><span>Gewinn dieser Tour</span><strong>${money(quote.profit)} <small>$</small></strong></div><div class="detail-stat"><span>Geschätzte Dauer</span><strong>${duration(route.seconds)}</strong></div><div class="detail-stat"><span>Kapitalbindung, maximal</span><strong>${money(quote.capitalNeeded)} <small>$</small></strong></div></div>`;
  const eventsByStop = Array.from({ length: route.legs.length + 1 }, () => []);
  for (const event of quote.events) eventsByStop[event.kind === 'buy' ? event.leg : event.leg + 1].push(event);
  for (let stop = 0; stop < eventsByStop.length; stop++) {
    const baseId = stop === 0 ? route.legs[0].source : route.legs[stop - 1].target;
    content += `<div class="halt"><h3>${escape(byId.get(baseId)?.name || baseId)}</h3>`;
    for (const event of eventsByStop[stop]) {
      const leg = route.legs[event.leg], base = byId.get(event.base), item = base.offers.find(i => i.id === leg.good);
      const q = event.quantity;
      const limits = [];
      if (event.kind === 'buy') {
        if (Math.floor((activeOptions.cargo - event.before.cargo + 1e-6) / leg.volume) === q) limits.push('freier Frachtraum');
        if (Math.floor((event.before.player + 1e-6) / leg.buy) === q) limits.push('dein Kapital');
        if (base.kind === 'pob' && Math.floor(event.before.stock - item.min) === q) limits.push('Verkaufsreserve');
      } else if (base.kind === 'pob') {
        if (Math.floor((event.before.cash + 1e-6) / leg.sell) === q) limits.push('POB-Geld');
        if (Math.floor((event.before.space + 1e-6) / leg.targetVolume) === q) limits.push('POB-Lagerplatz');
        if (Math.floor(item.max - event.before.stock) === q) limits.push('Ankaufslimit');
      }
      content += `<div class="event"><span class="event-label">${event.kind === 'buy' ? 'KAUF' : 'VERKAUF'}</span><div class="event-text">${integer(q)} × ${escape(leg.name)} zu ${integer(event.price)} $<small>${integer(q * leg.volume)} Volumen · ${integer(q * event.price)} $ gesamt${limits.length ? ` · Grenze: ${limits.map(escape).join(', ')}` : ''}</small>${base.kind === 'pob' ? `<small class="event-meta">POB danach: ${integer(event.after.cash)} $ · ${integer(event.after.space)} Vol. frei · ${integer(event.after.stock)} Stk. Bestand</small>` : ''}</div></div>`;
    }
    if (stop < route.legs.length) {
      const leg = route.legs[stop], q = quote.quantities[stop];
      const returning = route.roundTrip && stop === route.legs.length - 1;
      const load = leg.good ? `${integer(q)} × ${escape(leg.name)} · ${integer(q * leg.volume)} Volumen` : 'Leerflug · 0 Volumen';
      content += `<div class="event flight"><span class="event-label">${returning ? 'RÜCKFLUG' : 'FLUG'}</span><div class="event-text">Nach ${escape(byId.get(leg.target)?.name || leg.target)}<small>${load}${knownTime ? ' · Flugzeit in der Gesamtdauer enthalten' : ''}</small></div></div>`;
    } else if (route.closed) {
      content += '<p class="detail-note route-arrival">Startbasis wieder erreicht · Rundtour abgeschlossen.</p>';
    } else if (route.roundTrip) {
      content += `<p class="detail-note route-arrival">Zielsystem ${escape(route.returnSystemName)} erreicht · Tour abgeschlossen. Die nächste Tour beginnt an dieser Ankunftsbasis.</p>`;
    }
    content += '</div>';
  }
  if (repeats) content += `<p class="detail-note">Mit fortgeschriebenen Beständen: <strong>${integer(repeats.count)}${repeats.capped ? '+' : ''} berechenbare Umläufe</strong>, zusammen ${integer(repeats.profit)} $ für die ersten ${integer(repeats.count)} Umläufe. Die Ladungsmengen können sich pro Umlauf ändern. Fremde Händler und laufende Produktion sind nicht vorausgesagt.</p>`;
  content += `<p class="detail-note">Die Handelsreihenfolge oben gehört zur Mengenprüfung. Eine andere Reihenfolge kann an Geld oder Lagerplatz scheitern. ${knownTime ? 'Die Flugzeit berücksichtigt das gewählte Zeitmodell; Gefechte, Warteschlangen und Umwege sind nicht eingerechnet.' : 'Für diese Tour fehlt eine belastbare Flugzeit. Ein Stundenverdienst wird deshalb nicht ausgewiesen.'}</p>`;
  content += `<div class="halt"><h3>Basis ausschließen</h3><p class="detail-note">Wenn du dort nicht andocken kannst, kannst du die Basis für zukünftige Suchen ausblenden.</p><div class="blocked-list">${[...new Set(route.legs.flatMap(l => [l.source, l.target]))].map(id => `<button class="button subtle" data-block="${escape(id)}">${escape(byId.get(id)?.name || id)}</button>`).join(' ')}</div></div>`;
  $('detailContent').innerHTML = content;
}

function showModel() {
  const coverage = navigation?.coverage;
  $('modelContent').innerHTML = `<h3>Marktdaten</h3><p>${dataset ? `${dataMode === 'demo' ? 'Fiktives Beispiel' : 'Letzter Abruf / Import'}: ${clock(dataset.asOf)}. ${integer(dataset.bases.length)} Basen geladen.` : 'Noch kein gültiger Markt-Abruf vorhanden.'} ${lastError ? escape(lastError) : ''}</p><p>Der Abrufzeitpunkt ist kein Beleg für das Alter der vorgelagerten Serverdaten. Zwischen Abfrage und Ankunft können andere Spieler handeln. Fehlendes POB-Geld, fehlender Lagerplatz und unvollständige Warenwerte werden nicht als unbegrenzte Kapazität behandelt.</p><h3>Flugzeit</h3><p>${navigation ? `${integer(coverage?.systems || 0)} Systeme · ${integer(navigation.nodes.length)} Navigationspunkte · ${escape(navigation.patch || '')}.` : 'Kein Navigationskatalog geladen.'} ${coverage?.missingSystems?.length ? `${integer(coverage.missingSystems.length)} Systeme fehlen im Katalog.` : ''} ${coverage?.lockedGateData === false ? 'Daten zu gesperrten Gates fehlen; die Navigation ist unvollständig.' : ''}</p><p>Die drei Profile rechnen Cruise-Strecken mit 350, 410 oder 500 m/s. Tradelanes verwenden einen separaten Modellwert. Start-/Stoppzeit, Cruise-Ladezeit und Sprungzeit kannst du im Auftrag ändern. ${navigation?.assumptions?.map(escape).join(' · ') || ''}</p><h3>Rundtouren und Suchumfang</h3><p>Für jede geprüfte Tour werden ganzzahlige Ladungsmengen und Handelsreihenfolgen gemeinsam optimiert. Geld, Warenbestand und Lagerplatz werden bei jedem Geschäft fortgeschrieben. Eine Ware pro Handelsabschnitt; positive Handelsmargen. Rückladungen können an anderen Basen im selben Abflugsystem gekauft und an beliebigen passenden Basen im Zielsystem verkauft werden. Lokale Abholflüge zählen vollständig zu Dauer und Stundenverdienst. Ein leerer Rückweg muss ausdrücklich zugelassen werden. Mischladungen und verlustbringende Teilgeschäfte sind nicht Teil dieser Version.</p><p>Die Suche bewertet eine begrenzte Auswahl von Anschlussangeboten. „Beste gefundene Touren“ ist kein Nachweis des weltweiten Optimums. Für tiefere Suchen kannst du die Suchtiefe erhöhen. Persönliche Reputation, Whitelists und Handelsverbote sind nicht automatisch bestätigt.</p><h3>Ausgeblendete Basen</h3><p>${blocked.length ? `${integer(blocked.length)} Basen sind ausgeblendet.` : 'Keine Basen ausgeblendet.'}</p>${blocked.length ? '<button class="button" id="clearBlocked">Alle wieder einbeziehen</button>' : ''}<h3>Quellen</h3><p><a href="https://darkstat.dd84ai.com/" target="_blank" rel="noopener">Darkstat</a> · <a href="https://patch.discoverygc.com/patchlist.xml" target="_blank" rel="noopener">Öffentliche Discovery-Patchdaten</a></p>`;
  $('modelDialog').showModal();
}

async function refresh() {
  liveController?.abort(); liveController = new AbortController();
  const controller = liveController, timer = setTimeout(() => controller.abort(), 22000);
  $('refreshButton').disabled = true;
  if (!dataset) { dataMode = 'connecting'; updateSource(); }
  try {
    const data = await liveData(controller.signal);
    if (controller !== liveController) return;
    navigation = realNavigation; setDataset(data, 'live'); lastError = '';
    cacheWrite(data).catch(() => {}); notice(''); runSearch();
  } catch (error) {
    if (controller !== liveController) return;
    lastError = error.name === 'AbortError' ? 'Darkstat hat innerhalb von 22 Sekunden nicht geantwortet.' : error.message;
    if (dataset && dataMode !== 'demo') dataMode = 'cached'; else if (!dataset) dataMode = 'offline';
    notice(`${lastError} ${dataset ? 'Der vorhandene Datenstand bleibt erhalten.' : 'Du kannst erneut verbinden, einen Snapshot importieren oder das ausdrücklich fiktive Funktionsbeispiel öffnen.'}`);
    if (!dataset) $('resultsBody').innerHTML = '<div class="empty-state"><div class="route-symbol" aria-hidden="true"><span></span><i></i><span></span></div><h3>Der Markt ist gerade nicht erreichbar.</h3><p>Es werden keine erfundenen Angebote als aktuelle Handelsmöglichkeiten eingesetzt. Die Oberfläche und Berechnung kannst du mit einem fiktiven Beispiel ausprobieren.</p><button class="button" id="exampleButton" type="button">Fiktives Funktionsbeispiel öffnen</button></div>';
    updateSource();
  } finally { clearTimeout(timer); $('refreshButton').disabled = false; }
}

document.addEventListener('click', event => {
  const ship = event.target.closest('[data-ship]'); if (ship) setProfile(PROFILES.find(p => p.id === ship.dataset.ship));
  const modeButton = event.target.closest('[data-mode]'); if (modeButton) setMode(modeButton.dataset.mode === 'one' ? 'one' : $('stops').value);
  const detail = event.target.closest('[data-route]'); if (detail) openDetail(Number(detail.dataset.route));
  const close = event.target.closest('[data-close]'); if (close) $(close.dataset.close).close();
  if (event.target.closest('#exampleButton')) { liveController?.abort(); liveController = null; const data = example(); navigation = data.navigation; setDataset(data.dataset, 'demo'); $('start').value = ''; runSearch(); }
  const block = event.target.closest('[data-block]');
  if (block) { blocked = [...new Set([...blocked, block.dataset.block])]; saveSettings(); $('detailDialog').close(); runSearch(); }
  if (event.target.closest('#clearBlocked')) { blocked = []; saveSettings(); $('modelDialog').close(); runSearch(); }
});
$('plannerForm').addEventListener('submit', event => { event.preventDefault(); runSearch(); });
$('plannerForm').addEventListener('change', event => { if (event.target.id === 'stops') setMode(event.target.value); else { updateReturnControls(); queueSearch(); } });
$('sort').addEventListener('change', queueSearch);
$('refreshButton').addEventListener('click', refresh);
$('modelButton').addEventListener('click', showModel);
$('cancelButton').addEventListener('click', () => { worker?.postMessage({ type: 'cancel' }); requestId++; busy = false; $('searchProgress').hidden = true; $('cancelButton').hidden = true; updateSource(); notice('Suche beendet. Starte eine neue Berechnung, um weitere Touren zu prüfen.'); });
$('importButton').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 70 * 1024 * 1024) throw new Error('Die Datei überschreitet 70 MiB.');
    const parsed = parseImport(JSON.parse(await file.text()));
    liveController?.abort(); liveController = null;
    if (parsed.navigation) { navigation = realNavigation = parsed.navigation; }
    if (parsed.dataset) setDataset(parsed.dataset, parsed.dataset.source === 'demo' ? 'demo' : 'imported');
    notice('Datei eingelesen.'); updateSource(); queueSearch();
  } catch (error) { notice(error.message); }
  finally { event.target.value = ''; }
});
$('exportButton').addEventListener('click', () => {
  if (!dataset) return;
  const blob = new Blob([JSON.stringify({ market: dataset, navigation })], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `waypoint-${dataset.source === 'demo' ? 'example' : 'snapshot'}-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setProfile(profile); setMode(mode);
loadNavigation().then(nav => { realNavigation = nav; if (dataMode !== 'demo') navigation = nav; updateSource(); if (dataset) queueSearch(); }).catch(error => { lastError = error.message; updateSource(); });
cacheRead().then(data => { if (data && !dataset) { setDataset(data, 'cached'); notice('Gespeicherter Abruf geladen. Die Verbindung zu Darkstat wird geprüft.'); queueSearch(); } }).catch(() => {});
refresh();
setInterval(() => { updateSource(); if (!document.hidden && navigator.onLine && dataMode !== 'demo' && !busy) refresh(); }, 300000);
