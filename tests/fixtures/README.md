# Synthetic regression fixtures

The two portable documents use synthetic text and procedural raster patterns. No personal meal plans, recipes, photographs or externally supplied reference artwork are included. The legacy `meal-*` filenames remain stable for test callers.

- `meal-plan.template.json`: structural regression cases, explicit color overrides, image dimensions and collapsed detail nodes.
- `meal-journal.template.json`: journal structures, textured backgrounds, overlay placement and the same structured content cases.
- `.mindnb` files: generated portable packages with content-addressed raster assets.
- `monday.png` / `friday.png`: generated image-upload and replacement samples with transparent edges.

Regenerate with `python3 scripts/build-test-fixtures.py` (standard library only). The generator, synthetic text and procedural artwork are covered by the project's AGPL-3.0-only license. ZIP timestamps and image generation are deterministic. Runtime vaults and exports go to temporary directories or Playwright output.

`paper-pages.html` creates isolated paper-page examples for web tests. Fixtures are not part of the production application bundle.
