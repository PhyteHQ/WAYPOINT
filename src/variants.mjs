// A family describes the trading itinerary, independent of cargo and local docks.
export function routeFamily(route, byId) {
  const trades = route.legs.filter(leg => leg.good);
  const system = id => byId.get(id)?.system ? ['system', byId.get(id).system] : ['base', id];
  const visits = [route.legs[0].source, ...trades.flatMap(leg => [leg.source, leg.target]), route.legs.at(-1).target];
  const systems = [];
  for (const id of visits) {
    const token = system(id);
    if (JSON.stringify(systems.at(-1)?.token) !== JSON.stringify(token))
      systems.push({ token, name: byId.get(id)?.systemName || byId.get(id)?.system || byId.get(id)?.name || id });
  }
  const local = systems.length === 1;
  // Local tours need an outbound dock pair to remain useful, distinct choices.
  const outbound = local && trades.length ? [trades[0].source, trades[0].target] : null;
  const key = JSON.stringify([Boolean(route.roundTrip), Boolean(route.emptyReturn),
    system(route.legs[0].source), trades.map(leg => [system(leg.source), system(leg.target)]),
    system(route.legs.at(-1).target), outbound]);
  return { key, local, names: systems.map(s => s.name) };
}

export function compareRoutes(a, b, sort = 'hourly') {
  if (sort === 'profit') return b.profit - a.profit || (b.hourly ?? -Infinity) - (a.hourly ?? -Infinity) || a.capitalNeeded - b.capitalNeeded;
  if (a.hourly == null && b.hourly != null) return 1;
  if (b.hourly == null && a.hourly != null) return -1;
  return (b.hourly ?? b.profit) - (a.hourly ?? a.profit) || b.profit - a.profit || a.capitalNeeded - b.capitalNeeded;
}

export function groupRoutes(routes, byId, sort = 'hourly') {
  const families = new Map();
  routes.forEach((route, index) => {
    const family = routeFamily(route, byId);
    if (!families.has(family.key)) families.set(family.key, { ...family, entries: [] });
    families.get(family.key).entries.push({ route, index });
  });
  const compare = (a, b) => compareRoutes(a.route, b.route, sort);
  const groups = [...families.values()];
  for (const group of groups) group.entries.sort(compare);
  return groups.sort((a, b) => compare(a.entries[0], b.entries[0]));
}

// Reserve a place for each family's best result before filling in alternatives.
// Apply this before bounded retention, so folding the UI does not hide lost routes.
export function selectDiverseRoutes(routes, byId, { limit = 60, sort = 'hourly' } = {}) {
  const groups = groupRoutes(routes, byId, sort), selected = [];
  for (let variant = 0; selected.length < limit; variant++) {
    let added = false;
    for (const group of groups) {
      const entry = group.entries[variant];
      if (entry) { selected.push(entry.route); added = true; }
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected.sort((a, b) => compareRoutes(a, b, sort));
}
