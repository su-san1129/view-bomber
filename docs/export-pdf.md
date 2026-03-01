# Markdown PDF Export

View Bomber can export `.md` / `.markdown` files to PDF from the Markdown viewer header.

## Runtime behavior

- Output format: PDF
- Page size: A4
- Margin: 25mm
- Table of contents: disabled
- Mermaid blocks: rendered as code blocks (diagram conversion is a future phase)

## Bundled engine layout

The app expects bundled binaries at runtime:

- macOS: `resources/bin/macos/pandoc`, `resources/bin/macos/tectonic`
- Linux: `resources/bin/linux/pandoc`, `resources/bin/linux/tectonic`
- Windows: `resources/bin/windows/pandoc.exe`, `resources/bin/windows/tectonic.exe`

`src-tauri/tauri.conf.json` includes `../resources/bin` in bundle resources.

## Automatic provisioning (build time)

- `tauri build` runs `bun run prepare:pdf-tools` automatically.
- The script reads `tools/pdf-tools.lock.json` (fixed URL + SHA-256).
- Archives are downloaded into `tools/cache/`, verified, extracted, then copied to
  `resources/bin/<platform>/`.
- On failure (network, SHA mismatch, missing binary), build fails immediately.

## Developer notes

1. Setup (recommended): `mise run init`
2. Manual run (optional): `bun run prepare:pdf-tools`
3. Validate compile:
   - `bunx tsc --noEmit`
   - `cd src-tauri && cargo check`
4. Validate export from a Markdown file in `mise run tauri-dev` (or `bun run tauri dev`).
5. To bump versions, update `tools/pdf-tools.lock.json` only.
