"""Package the buildless app for GitHub Pages, using only the standard library."""
from pathlib import Path
import gzip
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
destination.mkdir(exist_ok=True)
for name in ['index.html', 'styles.css', 'mark.svg']:
    shutil.copy2(ROOT / name, destination / name)
for folder in ['src', 'data']:
    (destination / folder).mkdir(exist_ok=True)
    if folder == 'src':
        shutil.copytree(ROOT / folder, destination / folder, dirs_exist_ok=True)
    else:
        shutil.copy2(navigation_file, destination / 'data/navigation.json')
(destination / '.nojekyll').touch()
print(f'WAYPOINT packaged: {len(nav["nodes"])} navigation points, {nav["coverage"]["systems"]} systems')
