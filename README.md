# WAYPOINT

Independent trading planner for **Freelancer Discovery**, maintained in
[`PhyteHQ/WAYPOINT`](https://github.com/PhyteHQ/WAYPOINT) with its own GitHub Pages site.

**Open the planner: [WAYPOINT](https://phytehq.github.io/WAYPOINT/).**

This project has no dependency on, and makes no changes to, RHW or DTR.

## Included

- Ship profiles: **5,000 volume / 350 m/s**, **Pilgrim 4,300 / 410**, and
  **Longhorn 3,600 / 500**. Available volume and working capital are adjustable.
- One-way deliveries and two- or three-trade itineraries with return cargo.
  By default, return cargo may be picked up at another base in the arrival
  system and sold to any eligible buyer in the target system. An exact return
  to the starting base remains selectable. Empty return is opt-in.
- Every local pickup flight and extra station stop is included in travel time.
  The target system defaults to the starting system and can be overridden.
- All displayed monetary amounts use **$**, with unchanged in-game values.
- Optional mixed manifests combine profitable goods on the same physical flight,
  without adding docks or pickup stops. Each selected good has an integer quantity;
  ship volume, player capital, POB cash and storage are shared by the whole load.
- Integer cargo quantities constrained by ship volume, purchase capital,
  source reserves, destination max stock, POB money, and POB storage.
- Separate ship cargo volume and original POB storage volume.
- Joint quantity optimization and trading-order evaluation at intermediate
  stops. Buying return cargo first can fund an incoming delivery and free
  storage, provided ship capacity and player funds permit it.
- Sequential state updates, detailed action plans, source/destination balances,
  exclusion of inaccessible bases, and up to twelve simulated repeat runs for
  itineraries that physically return to the same base. A system return to a
  different base is not presented as an immediately repeatable station loop.
- Per-ship shortest travel paths over the bundled public navigation graph.
  Travel times are model estimates, including separate cruise, lane and jump
  behavior; they are not obtained by scaling a generic 350 m/s route time.
- Direct Darkstat market requests, IndexedDB last-good cache, explicit JSON
  import/export, and a deliberately fictitious opt-in functional example.
- A German interface, responsive ship selection and route results, keyboard
  controls, native dialogs, reduced-motion support, and a Web Worker for search.
- Searchable base/system dialogs with large touch targets. The mobile picker
  follows the visual viewport so search and results fit above the keyboard.
- A compact quick search with start base and route mode. Cargo, capital, return
  settings, filters and time-model controls are under **Suche anpassen**.
  A visible summary keeps the active settings apparent while collapsed, and
  invalid inputs automatically reveal their containing options before focus.
- Installable **WAYPOINT** app with its own Android/desktop and Apple icons.
  The app shell and navigation are available offline after installation;
  market snapshots retain their original saved-data label and timestamp.
  Content-based releases update together after the user chooses to restart.

## Install as an app

Use the download icon / **App installieren** button at the top of the planner.
Supporting browsers open their installation prompt; otherwise the button shows
instructions. On Android use Chrome's **App installieren** menu. On iPhone
or iPad open the page in Safari, then **Teilen → Zum Home-Bildschirm**.
The installation and offline cache are scoped to this project; other Pages
apps on the same GitHub account keep their own service workers and caches.

## Local validation

Python 3.10+ and Node.js 22+ are sufficient. No package installation or build
framework is required; the browser-compatible integer solver is vendored.

```sh
python3 scripts/build.py
node --test tests/*.test.mjs
```

Serve `dist/` with a normal static HTTP server for local development. Opening
`index.html` as a `file:` URL does not support module workers or data requests.

## GitHub Pages

Create a **new** repository named `WAYPOINT`, using branch `main`. Put these
source files in it. Under **Settings → Pages → Build and deployment**, choose
**GitHub Actions**. The supplied workflow packages the app, runs its tests,
and publishes only `dist/`. It never deploys RHW or DTR.

Renaming the project later requires updating the repository/site name and
visible brand copy. Asset and worker URLs are relative and do not hardcode
the repository path.

## Data and limits

Darkstat endpoints are public, cross-origin requests. The client checks response
shape and never replaces failed live data with fictitious offers. A failed
request retains an explicitly labelled last-good snapshot if one exists.
The displayed timestamp records when data was received; it does **not** prove
the age of upstream Discovery data. The optional **Check public Darkstat data**
workflow job uses the same application client to check the live endpoints,
normalization, POB field completeness, and CORS permission for the Pages origin.
Both public POST endpoints returned HTTP 200 and allowed the origin during the
initial publication check on 15 October 2026. This non-blocking check keeps an
upstream outage from preventing deployment of the cache/import interface.
Visual and interactive checks in a real browser remain separate from this API check.

The navigation graph was derived from all 230 archives in the public
Discovery patch manifest, through **22/08/2026 — 5.3 patch 5 hotfix 5**:

- 133 referenced systems, no missing referenced system files.
- 2,526 navigation points, 2,800 directed jump/lane links.
- Locked-gate data from the latest public `initialworld.ini` found in the
  manifest (14/07/2026 patch).
- 617 NPC base aliases; live POB positions are attached when known.

All three initial profiles use the transport **medium-mooring** routing model
and default commodity volume. Custom liner/miner volume classes are supported
by the data model but are not assigned to these transports. Verify any
ship-specific docking exceptions before expanding the profiles.

The default lane model is 2,250 m/s, matching Darkstat's nominal model. Flight estimates exclude obstacles,
combat, queues, acceleration curves and server-specific system speed overrides.
The interface states these assumptions. Personal reputation and POB whitelists
cannot be confirmed from these public market records. The user can exclude
bases they cannot use.

Search is deliberately bounded: positive-margin trading legs, up to 18 or 45
matching continuation/return candidates, an 18-second single-good route-search
budget, and up to six additional seconds for mixed-cargo improvement.
The search first retains broad single-good route coverage. It then improves
the best paths with mixed manifests, always retaining any better baseline,
and uses remaining refinement time to explore grouped-cargo paths. Goods
sharing a source/destination pair are grouped into one manifest.
Preselection estimates affordable quantities, source reserves, destination
demand, shared cash/storage and flight time; several ranking criteria retain
high-potential alternatives and promising backhauls. A bounded shortlist gets
exact navigation times before the continuation limit is applied. Snapshot
limits used for ranking never replace the final joint feasibility check.
Destination matching precedes candidate pruning. Displayed quantities are
jointly optimized and replay-validated for each candidate tour. Detail plans
replay the exact selected quantities and order rather than silently requoting.
The trading-order search considers unloading incoming goods before or after
buying outgoing goods at an intermediate stop. Arbitrary interleaving of
individual items is not exhaustively searched; integer solving also has a
per-order time limit.
The list is labelled **best found**, not the mathematically proven global
optimum. Loss-making intermediate trades and itineraries with
four or more loaded trading legs are outside this version. Local transfers may
add extra bases to the itinerary. Empty return requires explicit permission;
empty local pickup flights remain possible and are fully timed.

## Refreshing navigation

`scripts/patch_catalog.py` reads ZIP central directories and selected INI entries
with HTTP range requests. It does not install a game, run patch executables,
use private repository credentials, or download texture/audio archives in full.
The local configuration folder and patch-index cache are intermediate data.

```sh
python3 scripts/patch_catalog.py --cache .cache/patches --download .cache/game
python3 scripts/build_navigation.py --game-root .cache/game \
  --download-catalog .cache/patches/catalog.json --output data/navigation.json
```

Before replacing the checked-in compressed navigation catalog, also update
`data/initialworld.ini` in the intermediate game folder from the latest patch
containing it; this is required for the locked-gate check. Inspect coverage,
pack `data/navigation.json` as `data/navigation.json.gz`, then run validation.
The ordinary deployment workflow does not download new patches automatically.

## Sources and third-party code

- Market data: [Darkstat](https://darkstat.dd84ai.com/).
- Navigation configuration: [Discovery public patch manifest](https://patch.discoverygc.com/patchlist.xml).
- Integer solver: `javascript-lp-solver` **1.0.3**, from npm. Its
  browser ESM build (without its optional source-map URL) and Unlicense text are in `src/vendor/`.
- Fonts: Google Fonts (Barlow, Barlow Condensed, IBM Plex Mono), with system
  fallbacks if unavailable.

WAYPOINT's application code is an independent implementation. It does not
embed or fork Darkstat's application code.
