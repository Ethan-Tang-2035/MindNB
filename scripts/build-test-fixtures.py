"""Generate deterministic synthetic regression documents; Python standard library only.

All raster samples are procedural test patterns with transparent edges, not edited
photographs. Templates preserve structural cases (IDs, collapse, image dimensions,
layout and styles); text and artwork are synthetic. License: AGPL-3.0-only.
"""
from pathlib import Path
import hashlib
import json
import struct
import zipfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / 'tests/fixtures'

def png(width, height, seed):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            # A deterministic multicolor grid exercises raster embedding and alpha.
            inside = width // 12 < x < width * 11 // 12 and height // 12 < y < height * 11 // 12
            v = ((x // 19) * 23 + (y // 17) * 31 + seed * 47) % 160
            rows.extend((48 + v, 64 + (v * 3) % 160, 80 + (v * 7) % 160, 220 if inside else 0))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')

def build(stem):
    template = json.loads((FIXTURES / f'{stem}.template.json').read_text())
    replacements = {}; assets = {}
    for key, spec in template['images'].items():
        data = png(**spec)
        name = hashlib.sha256(data).hexdigest() + '.png'
        replacements['fixture:' + key] = 'asset:' + name
        assets['assets/' + name] = data
    def replace(v):
        if isinstance(v, dict): return {k: replace(x) for k, x in v.items()}
        if isinstance(v, list): return [replace(x) for x in v]
        return replacements.get(v, v) if isinstance(v, str) else v
    document = json.dumps(replace(template['document']), ensure_ascii=False, separators=(',', ':')).encode()
    with zipfile.ZipFile(FIXTURES / f'{stem}.mindnb', 'w') as archive:
        for name, data in sorted({**assets, 'document.json': document}.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    print('Generated', stem)

if __name__ == '__main__':
    for stem in ['meal-plan', 'meal-journal']: build(stem)
    for name, seed in [('monday.png', 1), ('friday.png', 5)]:
        (FIXTURES / name).write_bytes(png(1254, 1254, seed))
