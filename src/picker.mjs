const fold = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de-DE');

export function marketChoices(bases, kind) {
  const entries = kind === 'system' ? [...new Map(bases.filter(b => b.system).map(b => [b.system,
    { id: b.system, name: b.systemName || b.system, detail: '', kind: 'system' }])).values()] :
    bases.map(b => ({ id: b.id, name: b.name, detail: b.systemName || b.system || 'System unbekannt', kind: b.kind }));
  return entries.sort((a, b) => a.name.localeCompare(b.name, 'de')).map(item => ({ ...item,
    search: fold(`${item.name} ${item.detail} ${item.id} ${item.kind === 'pob' ? 'pob' : ''}`) }));
}

export function filterChoices(items, query, limit = 80) {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  const matches = items.filter(item => words.every(word => item.search.includes(word)));
  return { items: matches.slice(0, limit), total: matches.length };
}

export function pickerViewport(viewport, fallbackHeight = 800) {
  return { height: Math.max(1, viewport?.height || fallbackHeight), top: Math.max(0, viewport?.offsetTop || 0) };
}

export function setupMarketPicker(doc = document, win = window) {
  const $ = id => doc.getElementById(id), dialog = $('marketPickerDialog'), input = $('marketPickerSearch');
  let active = null, bases = [], items = [], visible = [];
  const setViewport = () => {
    if (!dialog.open) return;
    const viewport = pickerViewport(win.visualViewport, win.innerHeight);
    dialog.style.setProperty('--picker-height', `${viewport.height}px`);
    dialog.style.setProperty('--picker-top', `${viewport.top}px`);
  };
  function render() {
    const matches = filterChoices(items, input.value);
    visible = matches.items;
    const count = $('marketPickerCount');
    count.textContent = !bases.length ? 'Marktdaten werden noch benötigt.' : matches.total > visible.length ?
      `${visible.length} von ${matches.total} Treffern · Mit einem Suchwort eingrenzen` : `${matches.total} Treffer`;
    const list = $('marketPickerResults');
    list.replaceChildren(...visible.map(item => {
      const row = doc.createElement('li'), button = doc.createElement('button');
      button.type = 'button'; button.className = 'picker-option'; button.dataset.marketChoice = item.id;
      const name = doc.createElement('span'); name.textContent = item.name; button.append(name);
      const detail = doc.createElement('small'); detail.textContent = `${item.detail}${item.kind === 'pob' ? ' · POB' : ''}`;
      if (detail.textContent) button.append(detail);
      const current = $(active).dataset.marketId || $(active).value;
      button.setAttribute('aria-pressed', String(current === item.id || current === item.name));
      row.append(button); return row;
    }));
    if (!visible.length) {
      const empty = doc.createElement('li'); empty.className = 'picker-empty';
      empty.textContent = bases.length ? 'Kein Treffer. Probiere einen Teil des Namens oder das System.' : 'Verbinde Darkstat, importiere einen Snapshot oder öffne das Funktionsbeispiel.';
      list.append(empty);
    }
    list.scrollTop = 0;
  }
  function open(id, query = '') {
    active = id; const system = id === 'returnSystem';
    items = marketChoices(bases, system ? 'system' : 'base');
    $('marketPickerTitle').textContent = system ? 'Zielsystem auswählen' : 'Startbasis auswählen';
    $('marketPickerSearchLabel').textContent = system ? 'Systeme suchen' : 'Basen suchen';
    input.placeholder = system ? 'System suchen …' : 'Basis oder System suchen …'; input.value = query;
    $('marketPickerClear').replaceChildren();
    const label = doc.createTextNode(system ? 'Startsystem · automatisch' : 'Beliebiger Start');
    const detail = doc.createElement('span'); detail.textContent = system ? 'In das System deiner Startbasis zurückkehren' : 'Keine Startbasis festlegen';
    $('marketPickerClear').append(label, detail);
    render(); dialog.showModal(); doc.body.classList.add('picker-open'); setViewport();
    input.focus({ preventScroll: true });
  }
  function choose(item) {
    const field = $(active); field.value = item?.name || '';
    if (item) field.dataset.marketId = item.id; else delete field.dataset.marketId;
    dialog.close(); field.dispatchEvent(new win.Event('change', { bubbles: true }));
  }
  for (const id of ['start', 'returnSystem']) {
    $(id).addEventListener('click', () => open(id));
    $(id).addEventListener('keydown', event => {
      if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); open(id); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); open(id, event.key); }
    });
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); $('marketPickerResults').querySelector('button')?.focus(); }
    if (event.key === 'Enter') { event.preventDefault(); if (visible.length === 1) choose(visible[0]); }
  });
  $('marketPickerResults').addEventListener('click', event => {
    const button = event.target.closest('[data-market-choice]');
    if (button) choose(visible.find(item => item.id === button.dataset.marketChoice));
  });
  $('marketPickerClear').addEventListener('click', () => choose(null));
  dialog.addEventListener('close', () => { doc.body.classList.remove('picker-open'); active = null; });
  win.addEventListener('resize', setViewport);
  win.visualViewport?.addEventListener('resize', setViewport);
  win.visualViewport?.addEventListener('scroll', setViewport);
  return { setData(data) {
    bases = data.bases;
    // Resolve restored system names/IDs without changing their saved meaning.
    const system = marketChoices(bases, 'system').find(s => s.name === $('returnSystem').value || s.id === $('returnSystem').value);
    if (system) { $('returnSystem').value = system.name; $('returnSystem').dataset.marketId = system.id; }
    if (dialog.open && active) { items = marketChoices(bases, active === 'returnSystem' ? 'system' : 'base'); render(); }
  } };
}
