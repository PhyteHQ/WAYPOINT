"""Package the buildless app for GitHub Pages, using only the standard library."""
from pathlib import Path
import gzip
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]
packed = ROOT / 'data/navigation.json.gz'
navigation_file = ROOT / 'data/navigation.json'
if packed.exists():
    navigation_file.write_bytes(gzip.decompress(packed.read_bytes()))
nav = json.loads(navigation_file.read_text())
assert nav['schema'] == 1 and len(nav['nodes']) > 2000
assert not nav['coverage']['missingSystems']
assert nav['coverage']['lockedGateData']

destination = ROOT / 'dist'
if destination.exists():
    shutil.rmtree(destination)
destination.mkdir(exist_ok=True)
for name in ['index.html', 'styles.css', 'mark.svg', 'manifest.webmanifest']:
    shutil.copy2(ROOT / name, destination / name)
for folder in ['src', 'data', 'assets']:
    (destination / folder).mkdir(exist_ok=True)
    if folder in ['src', 'assets']:
        shutil.copytree(ROOT / folder, destination / folder, dirs_exist_ok=True)
    else:
        shutil.copy2(navigation_file, destination / 'data/navigation.json')
(destination / '.nojekyll').touch()
# Pin the complete shell to one release, including worker imports and navigation.
shell = sorted(p for p in destination.rglob('*') if p.is_file() and p.name != '.nojekyll')
revision = hashlib.sha256()
for file in shell:
    revision.update(file.relative_to(destination).as_posix().encode())
    revision.update(b'\0')
    revision.update(file.read_bytes())
worker = (ROOT / 'sw.js').read_text()
worker = worker.replace('__WAYPOINT_REVISION__', revision.hexdigest()[:20])
worker = worker.replace('/* __WAYPOINT_SHELL__ */ []', json.dumps(['./' + p.relative_to(destination).as_posix() for p in shell]))
(destination / 'sw.js').write_text(worker)
print(f'WAYPOINT packaged: {len(nav["nodes"])} navigation points, {nav["coverage"]["systems"]} systems')
