export function setupPwa(doc = document, win = window, nav = navigator) {
  const $ = id => doc.getElementById(id), install = $('installButton');
  const display = win.matchMedia?.('(display-mode: standalone)');
  let prompt = null, registration = null, restarting = false;
  const installed = () => Boolean(nav.standalone || display?.matches);
  const updateInstall = () => { install.hidden = installed(); };
  updateInstall(); display?.addEventListener?.('change', updateInstall);
  win.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; updateInstall(); });
  win.addEventListener('appinstalled', () => { prompt = null; install.hidden = true; if ($('installDialog').open) $('installDialog').close(); });
  install.addEventListener('click', async () => {
    if (prompt) {
      const current = prompt; prompt = null;
      try { await current.prompt(); await current.userChoice; return; } catch { /* Browser instructions remain available. */ }
    }
    const ios = /iPad|iPhone|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
    const mobile = /Android/.test(nav.userAgent);
    $('installInstructions').innerHTML = ios ? '<h3>Auf iPhone oder iPad</h3><ol><li>WAYPOINT in Safari öffnen.</li><li>Auf <strong>Teilen</strong> tippen und <strong>Zum Home-Bildschirm</strong> wählen.</li><li>Falls angeboten, <strong>Als Web-App öffnen</strong> aktivieren und mit <strong>Hinzufügen</strong> bestätigen.</li></ol>' :
      mobile ? '<h3>Auf Android</h3><ol><li>WAYPOINT in Chrome öffnen.</li><li>Im Browsermenü <strong>App installieren</strong> oder <strong>Zum Startbildschirm hinzufügen</strong> wählen.</li><li>Die Installation bestätigen.</li></ol>' :
      '<h3>Auf deinem Computer</h3><ol><li>WAYPOINT in Chrome oder Edge öffnen.</li><li>Das Installieren-Symbol in der Adressleiste oder <strong>App installieren</strong> im Browsermenü wählen.</li><li>Die Installation bestätigen.</li></ol><p class="detail-note">Auf dem iPhone: Safari → Teilen → Zum Home-Bildschirm. Auf Android: Browsermenü → App installieren.</p>';
    $('installDialog').showModal();
  });
  if (!nav.serviceWorker) return;
  const showUpdate = () => { if (registration?.waiting && nav.serviceWorker.controller) $('appUpdate').hidden = false; };
  $('updateAppButton').addEventListener('click', () => {
    if (!registration?.waiting) return;
    restarting = true; $('updateAppButton').disabled = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  nav.serviceWorker.addEventListener('controllerchange', () => { if (restarting) win.location.reload(); });
  nav.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }).then(reg => {
    registration = reg; showUpdate();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') showUpdate(); });
    });
  }).catch(() => { /* An unavailable offline cache never blocks the online planner. */ });
}
