# Journal node textures

`brush-wash.png` and `torn-paper.png` are original assets generated with the built-in ImageGen tool for the Mediterranean journal task on 2026-09-12, using the user's approved scrapbook concept as visual direction.

Original outputs and prompt records are in `output/mediterranean-week/v2/assets/`. Both files contain real RGBA transparency; measurements are recorded in that directory's parent `alpha-validation.json`.

`src/node-backdrop.ts` embeds these raster images. The brush uses the source alpha to tint the texture with the node's fill color. The SVG wrapper handles color and coordinates; the visible paper and brush art is the generated raster, not an SVG drawing.

Keep the files embedded for desktop/offline use and export parity. These are not third-party stock-library assets.
