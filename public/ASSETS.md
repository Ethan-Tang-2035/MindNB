# Bundled visual resources

The app serves these files locally; opening a document does not request illustration or font resources from third-party hosts.

- `illustrations/fluent`: 247 distinct flat SVG stickers selected from Microsoft Fluent Emoji, MIT. Original names, Chinese labels, categories and source links are in `illustrations/manifest.json`; full license in `illustrations/fluent/LICENSE`.
- `illustrations/scenes`: 30 original setting compositions, combining original environment drawings with Pablo Stanley's CC0 Open Doodles figures. See `illustrations/scenes/NOTICE.txt` and `illustrations/scenes/sources`. The compositions are distinct settings, not recolored copies.
- `fonts`: Noto CJK Regular fonts under SIL OFL 1.1. Sans and Mono use `LICENSE-Sans.txt`; Serif uses `LICENSE-Serif.txt`. Modified web subsets are renamed Mind Sans SC, Mind Serif SC, Mind Mono SC. Original Noto/Source Han reserved names are not used as the modified fonts' family names.
- The original 21 outline stickers remain in `src/stickers.ts`. LXGW WenKai remains supplied by the existing npm dependency.

## Product icon

`brand/` contains the approved colorful MindNB mark (color proposal 01): warm ivory tile, blue N and branches, orange/green B, and purple/yellow nodes. The production source is `docs/logo-proposals/mindnb-selected/nb-color-01-transparent.png`; the generation prompt and transparency fix are recorded beside it. Opaque preview images must not be used for app-icon export. PNG sizes and the multi-size favicon use the same image; desktop ICO, ICNS, and PNG resources are in `build/icons/`. Regenerate with `python3 scripts/build-brand-icons.py` (Pillow required). The script converts size and format and places the intact artwork at 84% scale on a transparent canvas for app-icon safe margins.

## Rebuilding resources

Generated resources are checked in, so normal `npm run build` does not need network access or Python tools.

The source scripts live under `scripts/`: `fetch-illustrations.py`, `build-scenes.py`, `build-fonts.py`. Sticker fetching expects the official Fluent Git tree JSON at `/tmp/mindnb-fluent-tree.json`. Font building needs Python `fonttools` and `brotli`, and these official OTF downloads:

| Local source | Official source |
| --- | --- |
| `/tmp/mindnb-sans.otf` | https://github.com/notofonts/noto-cjk/raw/refs/heads/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf |
| `/tmp/mindnb-serif.otf` | https://github.com/notofonts/noto-cjk/raw/refs/heads/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf |
| `/tmp/mindnb-mono.otf` | https://github.com/notofonts/noto-cjk/raw/refs/heads/main/Sans/Mono/NotoSansMonoCJKsc-Regular.otf |

Fonts are split into Unicode ranges, loaded on demand. Rebuilding changed fonts requires removing their old generated subset directory first; the script reuses existing output files. Font CSS is generated as `src/fonts.css`.
