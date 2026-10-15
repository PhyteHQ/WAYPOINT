"""Build a compact navigation graph from Discovery INI configuration files."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import struct


def ini(path):
    data = Path(path).read_bytes()
    if data[:4] == b'BINI':
        _, version, strings = struct.unpack_from('<4sII', data)
        if version != 1:
            raise ValueError('Unsupported BINI version')
        def string(offset):
            start = strings + offset
            return data[start:data.index(b'\0', start)].decode('cp1252')
        at, sections = 12, []
        while at < strings:
            name, count = struct.unpack_from('<HH', data, at); at += 4
            entries = {}
            for _ in range(count):
                field, size = struct.unpack_from('<HB', data, at); at += 3
                values = []
                for _ in range(size):
                    kind = data[at]; at += 1
                    if kind == 1: value = struct.unpack_from('<i', data, at)[0]
                    elif kind == 2: value = struct.unpack_from('<f', data, at)[0]
                    elif kind == 3: value = string(struct.unpack_from('<I', data, at)[0])
                    else: raise ValueError('Unsupported BINI value type')
                    at += 4; values.append(str(value))
                entries.setdefault(string(field).lower(), []).append(values)
            sections.append((string(name).lower(), entries))
        return sections
    text = data.decode('utf-8-sig', errors='replace') if data.startswith(b'\xef\xbb\xbf') else data.decode('cp1252')
    sections, entries = [], None
    for raw in text.splitlines():
        line = raw.split(';', 1)[0].strip()
        match = re.fullmatch(r'\[([^]]+)\]', line)
        if match:
            entries = {}; sections.append((match.group(1).lower(), entries))
        elif entries is not None and '=' in line:
            field, value = line.split('=', 1)
            entries.setdefault(field.strip().lower(), []).append([v.strip().strip('"') for v in value.split(',')])
    return sections


def first(section, field, default=''):
    values = section.get(field)
    return values[0][0] if values and values[0] else default


def name_hash(name):
    polynomial = 0xA001 << 14
    table = []
    for value in range(256):
        for _ in range(8):
            value = value >> 1 ^ polynomial if value & 1 else value >> 1
        table.append(value)
    value = 0
    for byte in name.lower().encode('ascii'):
        value = value >> 8 ^ table[(value ^ byte) & 255]
    swapped = int.from_bytes(value.to_bytes(4, 'little'), 'big')
    return swapped >> 2 | 0x80000000


def system_files(root):
    result = []
    for name in ['universe.ini', 'multiuniverse.ini']:
        path = root / 'data/universe' / name
        if not path.exists():
            if name == 'universe.ini': raise ValueError('universe.ini fehlt')
            continue
        for kind, section in ini(path):
            if kind == 'system' and first(section, 'file'):
                result.append((first(section, 'nickname').lower(), 'data/universe/' + first(section, 'file').replace('\\', '/').lower()))
    return list(dict.fromkeys(result))


def build(root, patch_label='Lokale Spielkonfiguration'):
    solars = {}
    for kind, section in ini(root / 'data/solar/solararch.ini'):
        nickname = first(section, 'nickname').lower()
        if nickname: solars[nickname] = section
    locked = set()
    initial = root / 'data/initialworld.ini'
    if initial.exists():
        for kind, section in ini(initial):
            if kind == 'lockedgates':
                for value in section.get('locked_gate', []):
                    try: locked.add(int(value[0]) & 0xFFFFFFFF)
                    except ValueError: pass
    nodes, links, aliases, objects, missing, systems = [], [], {}, {}, [], []
    for system, path in system_files(root):
        file = root / path
        if not file.exists(): missing.append(path); continue
        systems.append(system)
        for kind, entry in ini(file):
            if kind != 'object' or 'pos' not in entry: continue
            nickname = first(entry, 'nickname').lower()
            archetype = first(entry, 'archetype').lower()
            solar = solars.get(archetype, {})
            spheres = [values[0].lower() for values in solar.get('docking_sphere', []) if values]
            dock = first(entry, 'dock_with').lower()
            goto = entry.get('goto', [])
            next_ring = first(entry, 'next_ring').lower()
            previous_ring = first(entry, 'prev_ring').lower()
            if goto:
                if name_hash(nickname) in locked or 'invisible' in archetype or not spheres: continue
                node_kind = 'jump'
            elif next_ring or previous_ring: node_kind = 'lane'
            elif dock: node_kind = 'base'
            else: continue
            try: position = [round(float(x), 3) for x in entry['pos'][0][:3]]
            except ValueError: continue
            if len(position) != 3: continue
            allows = []
            if any(s in spheres for s in ['jump', 'airlock']): allows = ['medium', 'berth', 'large']
            else:
                if 'moor_medium' in spheres: allows.append('medium')
                if 'moor_large' in spheres: allows.append('large')
                if 'berth' in spheres or 'ring' in spheres: allows.append('berth')
            if node_kind == 'lane': allows = ['medium', 'berth', 'large']
            identifier = f'{system}:{nickname}'
            node = {'id': identifier, 'system': system, 'pos': position, 'kind': node_kind, 'allows': allows}
            if 'cargo_limit' in solar:
                node['cargoLimit'] = float(first(solar, 'cargo_limit'))
            nodes.append(node); objects[identifier] = (node, entry)
            if dock: aliases[dock] = identifier
    for identifier, (node, entry) in objects.items():
        if node['kind'] == 'jump':
            target = entry['goto'][0]
            if len(target) >= 2:
                destination = f'{target[0].lower()}:{target[1].lower()}'
                if destination in objects:
                    edge = {'from': identifier, 'to': destination, 'kind': 'jump', 'allows': node['allows']}
                    if 'cargoLimit' in node: edge['cargoLimit'] = node['cargoLimit']
                    links.append(edge)
        elif node['kind'] == 'lane':
            for field in ['next_ring', 'prev_ring']:
                target = first(entry, field).lower()
                destination = f'{node["system"]}:{target}'
                if destination in objects:
                    links.append({'from': identifier, 'to': destination, 'kind': 'lane', 'speed': 2250})
    return {'schema': 1, 'builtAt': datetime.now(timezone.utc).isoformat(), 'source': 'https://patch.discoverygc.com/',
            'patch': patch_label, 'nodes': nodes, 'links': links, 'baseNodes': aliases, 'systemMultipliers': {},
            'coverage': {'systems': len(systems), 'missingSystems': missing, 'lockedGateData': initial.exists()},
            'assumptions': ['Tradelanes: 2250 m/s (Modellwert wie in Darkstat)', 'Keine Hindernis-, Gefechts- oder Warteschlangen-Simulation', 'Keine serverseitigen System-Geschwindigkeitsmultiplikatoren']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--game-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('data/navigation.json'))
    parser.add_argument('--patch', default='Lokale Spielkonfiguration')
    parser.add_argument('--download-catalog', type=Path)
    args = parser.parse_args()
    if args.download_catalog:
        from patch_catalog import read_files
        index = json.loads(args.download_catalog.read_text())
        roots = ['data/universe/universe.ini', 'data/universe/multiuniverse.ini', 'data/solar/solararch.ini']
        read_files(index, roots, args.game_root)
        missing = read_files(index, [path for _, path in system_files(args.game_root)], args.game_root)
        if missing: print('System files absent from public patch history:', missing, flush=True)
        args.patch = index['latest']['label']
    result = build(args.game_root, args.patch)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(json.dumps({'nodes': len(result['nodes']), 'links': len(result['links']), 'bases': len(result['baseNodes']), 'coverage': result['coverage']}))
