"""Read configuration data from Discovery's public patch ZIPs using HTTP ranges.

Only text configuration entries are read. No game executables, assets, credentials,
or third-party source code are installed or executed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

PATCH_SERVER = 'https://patch.discoverygc.com/'


def fetch(url, start=None, end=None):
    headers = {'User-Agent': 'Waypoint-Config-Reader/0.1'}
    if start is not None:
        headers['Range'] = f'bytes={start}' if isinstance(start, str) and start.startswith('-') else f'bytes={start}-{end if end is not None else ""}'
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=35) as response:
        data = response.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024:
            raise ValueError('Range request exceeded the 16 MiB limit')
        return data, dict(response.headers), response.status


class RemoteZip(io.RawIOBase):
    def __init__(self, url):
        self.url, self.offset = url, 0
        self.buffer, headers, status = fetch(url, '-65536')
        content_range = next((v for k, v in headers.items() if k.lower() == 'content-range'), '')
        if status == 206 and content_range:
            self.size = int(content_range.split('/')[-1])
            self.buffer_start = self.size - len(self.buffer)
        elif status == 200:
            self.size, self.buffer_start = len(self.buffer), 0
        else:
            raise ValueError(f'No usable ZIP range response: {status}')

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.offset

    def seek(self, offset, whence=0):
        self.offset = offset if whence == 0 else self.offset + offset if whence == 1 else self.size + offset
        if self.offset < 0:
            raise ValueError('Negative ZIP offset')
        return self.offset

    def read(self, size=-1):
        length = self.size - self.offset if size < 0 else min(size, self.size - self.offset)
        if length <= 0:
            return b''
        if not (self.buffer_start <= self.offset and self.offset + length <= self.buffer_start + len(self.buffer)):
            stop = min(self.size - 1, self.offset + max(length, 65536) - 1)
            self.buffer, _, status = fetch(self.url, self.offset, stop)
            if status != 206:
                raise ValueError('Server did not honor a ZIP range request')
            self.buffer_start = self.offset
        start = self.offset - self.buffer_start
        result = self.buffer[start:start + length]
        self.offset += len(result)
        return result


def canonical(name):
    name = name.replace('\\', '/').lower().lstrip('/')
    match = re.search(r'(?:^|/)(data/.*)', name)
    return match.group(1) if match else name


def configuration(name):
    name = canonical(name)
    return name.endswith(('.ini', '.cfg')) and name.startswith(('data/universe/', 'data/solar/', 'data/ships/', 'data/equipment/'))


def manifest():
    data, _, _ = fetch(PATCH_SERVER + 'patchlist.xml')
    return [{'url': p.attrib['url'], 'hash': p.attrib.get('md5hash', ''), 'label': (p.text or '').strip()}
            for p in ET.fromstring(data).findall('./PatchList/patch')]


def scan_patch(patch, cache):
    cache_file = cache / (patch['hash'] + '.json')
    if cache_file.exists():
        return json.loads(cache_file.read_text())
    with zipfile.ZipFile(RemoteZip(PATCH_SERVER + patch['url'])) as archive:
        entries = {canonical(info.filename): info.filename for info in archive.infolist()
                   if configuration(info.filename) and info.file_size < 8 * 1024 * 1024}
    result = {**patch, 'entries': entries}
    cache_file.write_text(json.dumps(result))
    return result


def catalog(cache, limit=None):
    cache.mkdir(parents=True, exist_ok=True)
    patches = manifest()
    selected = patches[-limit:] if limit else patches
    results, errors = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(scan_patch, p, cache): p for p in selected}
        for count, future in enumerate(concurrent.futures.as_completed(futures), 1):
            patch = futures[future]
            try:
                results[patch['url']] = future.result()
            except Exception as error:
                errors.append({'patch': patch['url'], 'error': str(error)})
            if count % 20 == 0:
                print(f'Indexed {count}/{len(selected)} patch archives', flush=True)
    ordered = [results[p['url']] for p in selected if p['url'] in results]
    files = {}
    for patch in ordered:
        for path, archived_name in patch['entries'].items():
            files[path] = {'archive': patch['url'], 'name': archived_name}
    result = {'source': PATCH_SERVER, 'latest': patches[-1], 'patches': ordered, 'files': files, 'errors': errors}
    (cache / 'catalog.json').write_text(json.dumps(result))
    return result


def read_files(index, paths, destination):
    by_archive = {}
    missing = []
    for path in paths:
        path = canonical(path)
        entry = index['files'].get(path)
        if entry is None:
            missing.append(path)
        else:
            by_archive.setdefault(entry['archive'], []).append((path, entry['name']))

    def read_group(pair):
        archive_name, entries = pair
        with zipfile.ZipFile(RemoteZip(PATCH_SERVER + archive_name)) as archive:
            for path, member in entries:
                target = destination / path
                if '..' in Path(path).parts:
                    raise ValueError('Invalid configuration path')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(member))
        return len(entries)

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for count in pool.map(read_group, by_archive.items()):
            print(f'Read {count} configuration files', flush=True)
    return missing


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--download', type=Path)
    args = parser.parse_args()
    result = catalog(args.cache, args.limit)
    print(json.dumps({'files': len(result['files']), 'errors': result['errors'], 'latest': result['latest']}), flush=True)
    if args.download:
        missing = read_files(result, ['data/universe/universe.ini', 'data/solar/solararch.ini'], args.download)
        print('Missing requested files:', missing)
