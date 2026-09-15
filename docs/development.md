# Development

## Getting started

Use Node.js 24 or newer.

```bash
npm ci
npm run dev        # start dev server
npm test           # run test suite (vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build to dist/
```

For browser tests, run `npx playwright install chromium` once, then `npm run test:web`.
To use an installed Chrome instead, set `PLAYWRIGHT_CHANNEL=chrome`.

`npm run build:desktop` builds Electron and the standalone MCP server. macOS requires a working Swift/Xcode command-line toolchain with its license accepted. `npm run package:desktop` creates installers in `release/`.

`npm run clean` removes generated `dist/`, `dist-desktop/`, `release/`, `test-results/`, and `playwright-report/`. Rebuild before starting the desktop app or MCP server. See [maintenance notes](maintenance.md) for retired checks and their replacements.

## Project layout

```
src/
  model.ts        # tree data model & structural ops (add/move/delete/fold)
  docs.ts         # document store: index, per-doc persistence, migration
  layout.ts       # node-level structures, boxes, tree bounds
  render.ts       # SVG rendering: nodes, links, decorations
  theme.ts        # themes & document-level style defaults
  panel.ts        # format panel (style & canvas controls)
  objects.ts      # canvas objects: images, stickers, group boxes, links
  drag.ts         # magnet resolver: landing placeholder, edge snapping
  selection.ts    # single & multi selection, marquee
  editing.ts      # text editing, word wrap
  nav.ts          # keyboard navigation
  history.ts      # undo/redo snapshots
  exporter.ts     # PNG export
  home.ts         # document home page
  ...
api/
  ping.ts         # auth probe: 204 / 401 / 500 (remote-truth ticket 01)
server/
  auth.ts         # shared Bearer-key auth for API routes (outside api/ so it is not a function)
vercel.json       # vite build + api/ functions on Vercel
docs/
  adr/            # architecture decision records
  screenshots/    # images used by the READMEs
CONTEXT.md        # ubiquitous-language glossary (the project's vocabulary)
.scratch/         # local-only specs and tickets (ignored; may be absent)
```

## Deployment (Vercel)

Remote-truth storage ([ADR-0005](adr/0005-remote-truth-on-vercel-blob.md)): static Vite build + `api/` functions + Vercel Blob. Two environment variables (only their names live in this repo; values are set at deploy time):

| Variable | Set by | Meaning |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Vercel, automatically once a Blob store is connected to the project (dashboard → Storage → Blob → Connect) | Server-side access to the private Blob store |
| `MINDNB_ACCESS_KEY` | You: `vercel env add MINDNB_ACCESS_KEY` | The shared secret — the one **access password** every device must type in (CONTEXT.md glossary; no accounts) |

The password typed in the app must equal `MINDNB_ACCESS_KEY`; rotating the env var rotates the password for all devices at once.

One-time setup & deploy:

```bash
npx vercel link                                   # link this repo to a Vercel project
# connect a Blob store (dashboard → Storage → Blob → Connect to project)
npx vercel env add MINDNB_ACCESS_KEY production  # set the shared secret
npx vercel env pull .env.local                    # local dev env (*.local is gitignored)
npx vercel dev                                    # Vite page + /api functions, together
npx vercel --prod                                 # deploy
```

Plain `npm run dev` serves no `/api` — the sync engine fails soft into cache-only mode (see the remote-truth spec).

## Development workflow

This project is built agent-first: milestone specs, tickets, and acceptance evidence live locally in the ignored `.scratch/<milestone>/` directory, terminology is governed by the glossary in [`CONTEXT.md`](../CONTEXT.md), and significant design decisions are recorded as ADRs in [`docs/adr/`](adr/). See [`AGENTS.md`](../AGENTS.md) and [`docs/agents/`](agents/) for conventions.

Run `npm test` for the current unit and integration results and `npm run test:web` for browser regressions. Desktop verification uses `npm run test:desktop`.

## Branding and existing data

The project is now **MindNB**. Portable editable documents use `.mindnb`; previous document packages can still be imported. Existing browser data migrates within the same origin while retaining the original copy. Desktop migration preserves vault, document and device identity. Existing vault files remain readable; new documents use `.mindnb.json`.

Use `MINDNB_ACCESS_KEY` for deployment configuration. The previous setting remains readable during the transition. See `private rebrand implementation notes (not included in the public source export)` for scope and compatibility details.
