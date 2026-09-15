"""Create renamed, lossless WOFF2 web subsets from official OFL Noto CJK fonts."""
from pathlib import Path
import sys
sys.path.insert(0, '/tmp/mindnb-font-tools')
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
css = ['/* Noto CJK (OFL 1.1), renamed Mind families for web subsetting. See public/fonts/LICENSE-*.txt. */']
for kind in ['sans', 'serif', 'mono']:
    source = Path(f'/tmp/mindnb-{kind}.otf')
    original = TTFont(source)
    unicodes = sorted(original.getBestCmap())
    groups = {}
    for code in unicodes: groups.setdefault(code // 512, []).append(code)
    family = f'Mind {kind.title()} SC'
    folder = ROOT / 'public/fonts' / kind
    folder.mkdir(parents=True, exist_ok=True)
    for index, codes in groups.items():
        filename = f'{index:x}.woff2'
        output = folder / filename
        if not output.exists():
            font = TTFont(source)
            options = subset.Options()
            options.flavor = 'woff2'
            options.layout_features = ['*']
            sub = subset.Subsetter(options=options)
            sub.populate(unicodes=codes); sub.subset(font)
            for record in font['name'].names:
                if record.nameID in [1, 4, 6, 16]:
                    value = family.replace(' ', '') if record.nameID == 6 else family
                    record.string = value.encode(record.getEncoding())
            font.flavor = 'woff2'; font.save(output)
        start, end = min(codes), max(codes)
        css.append(f'@font-face {{ font-family: "{family}"; font-style: normal; font-weight: 400; font-display: swap; src: url("/fonts/{kind}/{filename}") format("woff2"); unicode-range: U+{start:X}-{end:X}; }}')
    print(kind, len(groups), 'subsets', flush=True)
(ROOT / 'src/fonts.css').write_text('\n'.join(css) + '\n')
