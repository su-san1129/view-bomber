# View Bomber

View Bomber is a local desktop document viewer built with Tauri + React. It is designed to open
multiple file types from a folder tree with fast preview, search, and format-specific rendering.

## Features

- Multi-format local file preview in a single app
- Plugin-style viewer architecture (format-specific renderers)
- Folder explorer with live file update watching
- In-file search (`Cmd/Ctrl + F`) for text-based viewers
- Sidebar text search across supported searchable formats
- Strict quality pipeline with formatting + lint + type/build checks

## Supported File Types

- Markdown: `.md`, `.markdown`
- HTML: `.html`, `.htm`
- JSON: `.json`, `.geojson` (tree view + GeoJSON map preview)
- CSV/TSV: `.csv`, `.tsv` (table view, auto delimiter detection: comma/tab/semicolon)
- DXF: `.dxf` (2D canvas preview for common entities: line/polyline/circle/arc)
- Text: `.txt`, `.text`, `.log`, `.ini`, `.cfg`, `.conf`, `.yaml`, `.yml`, `.toml`, `.xml`, `.sql`,
  `.sh`, `.bash`, `.zsh`, `.fish`, `.ps1`, `.bat`, `.cmd`, `.c`, `.h`, `.cpp`, `.hpp`, `.py`, `.rb`,
  `.go`, `.rs`, `.java`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.css`, `.scss`, `.less`,
  `.swift`, `.kt`, `.dart`, `.lua`, `.php`, `.r`, `.properties`, `.editorconfig`, `.gitignore`,
  `.ndjson`, plus special names `Dockerfile`, `Makefile`, `GNUmakefile`, `.env*`, `.gitignore`,
  `.editorconfig` (line numbers + wrap toggle + syntax highlight + large-file partial render)
- Spreadsheet: `.xlsx`, `.xlsm` (sheet tabs + table preview)
- Document: `.docx` (paragraph text extraction preview)
- Images: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.bmp`, `.ico`, `.avif`
- PDF: `.pdf` (embedded `pdf.js` viewer with continuous vertical scroll and zoom)

## Requirements

- `mise`
- `bun` `1.3.10` (pinned in `mise.toml`)
- Rust `1.93.0` toolchain (`cargo`) for Tauri
- OS with Tauri desktop runtime support (macOS / Linux / Windows)

## Quick Start

```bash
mise install
bun install
```

## Run the App

```bash
bun run tauri dev
```

## Quality & Validation

### Formatting

```bash
bun run format
bun run format:check
```

### Lint

```bash
bun run lint:frontend
bun run lint:rust
bun run lint
```

- Frontend lint uses `oxlint` with `--deny-warnings`
- Rust lint uses `clippy` with `-D warnings`

### Full Project Check

```bash
bun run check
```

This runs:

- format check
- frontend lint + rust lint
- TypeScript check
- Rust check

## CI Quality Gate

The CI workflow (`.github/workflows/quality.yml`) enforces:

1. `bun install --frozen-lockfile`
2. `bun run format:check`
3. `bun run lint:frontend`
4. `bunx tsc --noEmit`
5. `cargo clippy --all-targets --all-features -- -D warnings`
6. `cargo check`

## Pre-commit Automation

Pre-commit is managed with Husky + lint-staged. On commit, staged files are checked/formatted with:

- `dprint`
- `oxlint` (for frontend source files)

Hook entrypoint:

- `.husky/pre-commit`

## Troubleshooting

### GeoJSON map preview

- GeoJSON map preview uses OpenStreetMap tiles, so internet access is required for base map tiles.
- Even when tiles are unavailable, vector features are still rendered.

### PDF fails to render

- Make sure you are on the current code path that uses `pdf.js` byte loading via Tauri FS.
- If you see permission errors for file reads, verify Tauri FS capability scopes in:
  - `src-tauri/capabilities/default.json`

### App icon changes are not visible in dev

- `tauri dev` can show cached icons (especially on macOS Dock).
- Fully quit the app and restart; if needed, restart Dock (`killall Dock`).
- Final icon verification should be done with a built app (`tauri build`).

### Formatting command errors due to cache permissions

- `dprint` writes cache files under your user cache directory.
- If your environment is sandboxed/restricted, run commands with appropriate permissions.

## Repository Structure

- `src/` — React frontend application
- `src/viewers/` — viewer plugins and registry
- `src-tauri/` — Tauri/Rust backend and desktop config
- `.github/workflows/` — CI workflows
- `.husky/` — git hooks
- `mise.toml` — pinned local tool versions

## Tech Stack

- Tauri v2
- React 19 + TypeScript
- Vite
- Bun
- oxlint
- dprint
- pdf.js (`pdfjs-dist`)
