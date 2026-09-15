"""Export the selected, unmodified artwork into web and desktop icon formats.

Run: python3 scripts/build-brand-icons.py (requires Pillow).
Generated files are checked in; normal builds do not require Python.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'build/brand-source.png'
WEB = ROOT / 'public/brand'
DESKTOP = ROOT / 'build/icons'
WEB.mkdir(parents=True, exist_ok=True)
DESKTOP.mkdir(parents=True, exist_ok=True)

with Image.open(SOURCE) as source:
    # Format/size conversion only: keep the approved composition and colors.
    master = source.convert('RGBA')
    alpha = master.getchannel('A')
    w, h = master.size
    corners = ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))
    if alpha.getextrema() != (0, 255) or any(alpha.getpixel(p) for p in corners):
        raise ValueError('The production icon must have transparent corners; do not export an opaque preview.')
    # The approved artwork already includes its rounded tile and transparent margin.
    # Do not add a second safe area: that made the packaged Dock icon too small.
    for size in (16, 32, 48, 64, 128, 180, 192, 256, 512, 1024):
        master.resize((size, size), Image.Resampling.LANCZOS).save(WEB / f'icon-{size}.png')
    master.save(WEB / 'favicon.ico', sizes=[(n, n) for n in (16, 32, 48, 64, 128, 256)])
    master.resize((1024, 1024), Image.Resampling.LANCZOS).save(DESKTOP / 'icon.icns')
    (DESKTOP / 'icon.ico').write_bytes((WEB / 'favicon.ico').read_bytes())
    (DESKTOP / 'icon.png').write_bytes((WEB / 'icon-512.png').read_bytes())
    # Check the actual encoded deliverables, not just the source image mode.
    for path in (*WEB.glob('icon-*.png'), WEB / 'favicon.ico', *DESKTOP.glob('icon.*')):
        with Image.open(path) as exported:
            rgba = exported.convert('RGBA')
            ew, eh = rgba.size
            if any(rgba.getpixel(p)[3] for p in ((0, 0), (ew - 1, 0), (0, eh - 1), (ew - 1, eh - 1))):
                raise ValueError(f'Transparency lost during icon export: {path}')
print('Exported approved colorful icon to public/brand and build/icons.')
