# Bundled PDF Export Binaries

Build-time provisioning (`bun run prepare:pdf-tools`) places platform-specific binaries in:

- `resources/bin/macos/pandoc`
- `resources/bin/macos/tectonic`
- `resources/bin/linux/pandoc`
- `resources/bin/linux/tectonic`
- `resources/bin/windows/pandoc.exe`
- `resources/bin/windows/tectonic.exe`

These binaries are generated for packaging and typically not committed because of size and
license-management concerns.
