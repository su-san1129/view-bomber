# File Extension Roadmap

## Scope

- Target: extension support expansion for `view-bomber`
- In scope:
  - File extension support in frontend plugin registry and backend capability definitions
  - Search target consistency and file type filter consistency
  - Documentation and quality-gate updates
- Out of scope:
  - File editing features
  - Cloud storage integrations
  - Full legacy binary office compatibility guarantees

## Goals

- Expand practical coverage based on usage frequency
- Keep extension behavior consistent across UI, backend, search, and docs
- Operate the roadmap as a long-term plan with explicit phases and DoD

## Planning Rules

- Every task must define:
  - `Priority`
  - `Phase`
  - `Owner`
  - `Files`
  - `DoD`
  - `Tests`
- Priority levels:
  - `P0`: immediate practical value and low-risk extension
  - `P1`: medium effort with strong real-world value
  - `P2`: strategic expansion with new parser/format complexity
  - `P3`: high-risk/high-cost feasibility-first targets

## Phase Model (4-phase)

### Phase 1: Low-Cost, High-Frequency Extensions

- Focus: extensions that can leverage existing parser/viewer paths
- Exit criteria:
  - Added extensions are fully wired in frontend + backend + search + docs
  - No fallback inconsistency in file type filter and icon mapping

### Phase 2: Mid-Cost Document/DB Expansion

- Focus: formats requiring parser additions but with clear user demand
- Exit criteria:
  - New Tauri commands and TS types are integrated with stable error handling
  - Representative fixtures for normal/invalid/large files are validated

### Phase 3: Data/Geo Expansion

- Focus: interoperability with common geo/data exchange formats
- Exit criteria:
  - Stable conversion/preview pipeline is defined
  - Unsupported subsets are explicitly surfaced in UI/docs

### Phase 4: Feasibility-First Advanced Formats

- Focus: high-complexity formats that may increase dependency/runtime cost
- Exit criteria:
  - Decision-complete spec exists for adopt/defer
  - PoC and risk notes are captured before production commitment

## Long-Term Backlog

- [x] EXT-001 Add `.jsonl` as text format
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files:
    - `src/viewers/textFormats.ts`
    - `src-tauri/src/commands.rs`
    - `README.md`
  - DoD: `.jsonl` opens in text viewer and is searchable via text filter
  - Tests: text filter includes `.jsonl` in backend unit tests

- [x] EXT-002 Add `.xls` and `.ods` to spreadsheet support
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files:
    - `src/viewers/plugins/xlsx.tsx`
    - `src/context/AppContext.tsx`
    - `src-tauri/src/commands.rs`
    - `README.md`
  - DoD: `.xls`/`.ods` open with spreadsheet viewer and are searchable as spreadsheet files
  - Tests:
    - read_xlsx extension gate accepts `.xls`/`.ods`
    - search path for spreadsheet files includes `.xls`/`.ods`

- [x] EXT-003 Add `.tif` and `.tiff` to image support
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files:
    - `src/viewers/plugins/image.tsx`
    - `src/components/fileIcon.tsx`
    - `src/context/AppContext.tsx`
    - `src-tauri/src/commands.rs`
    - `README.md`
  - DoD: TIFF images resolve via image viewer path and appear as image type in UI metadata
  - Tests: extension list includes `.tif`/`.tiff` across frontend and backend lists

- [ ] EXT-004 Add `.odt` document text extraction
  - Priority: P1
  - Phase: 2
  - Owner: TBD
  - Files:
    - `src-tauri/src/commands.rs`
    - `src/lib/tauri.ts`
    - `src/types/index.ts`
    - `src/viewers/plugins/docx.tsx` (or renamed document plugin)
  - DoD: ODT paragraph text is extracted and displayed in document viewer
  - Tests: fixture-based checks for paragraph, tab, line-break behavior

- [ ] EXT-005 Add `.rtf` document text extraction
  - Priority: P1
  - Phase: 2
  - Owner: TBD
  - Files:
    - parser implementation path in `src-tauri/src/commands.rs`
    - frontend bridge/types/plugins
  - DoD: text preview is readable with control words safely handled
  - Tests: fixture checks for escaped characters and mixed formatting control words

- [ ] EXT-006 Add `.sqlite`/`.sqlite3`/`.db` table preview support
  - Priority: P1
  - Phase: 2
  - Owner: TBD
  - Files:
    - new sqlite backend commands
    - frontend plugin + types + registry
  - DoD: table list + row preview works with predictable limits
  - Tests: schema/table discovery + paged preview + error handling

- [ ] EXT-007 Add `.gpx` support via geo conversion
  - Priority: P2
  - Phase: 3
  - Owner: TBD
  - Files:
    - geo parser/conversion path
    - geo viewer plugin integration
  - DoD: waypoint/track geometry renders with basic attribute display
  - Tests: sample GPX with points + track segments

- [ ] EXT-008 Add `.kml`/`.kmz` support via geo conversion
  - Priority: P2
  - Phase: 3
  - Owner: TBD
  - Files:
    - KML/KMZ parser/conversion path
    - geo viewer integration
  - DoD: placemark/line/polygon render for representative KML/KMZ files
  - Tests: zipped and plain KML fixtures

- [ ] EXT-009 Evaluate `.heic`/`.heif` support policy
  - Priority: P2
  - Phase: 3
  - Owner: TBD
  - Files:
    - image viewer path and/or conversion pipeline docs
  - DoD: explicit supported/unsupported policy with UI error guidance
  - Tests: platform matrix validation document

- [ ] EXT-010 Evaluate `.orc`, `.feather`, `.arrow`, `.ipc`
  - Priority: P3
  - Phase: 4
  - Owner: TBD
  - Files:
    - `plans/` decision records
    - optional PoC code
  - DoD: adopt/defer decisions with dependency/performance tradeoff notes
  - Tests: PoC acceptance criteria document

## Interface Change Checklist

- Frontend extension declarations:
  - plugin `extensions` arrays
  - `src/viewers/textFormats.ts`
  - `src/context/AppContext.tsx` fallback support list
  - `src/components/fileIcon.tsx`
- Backend extension declarations:
  - `supported_file_types()`
  - extension guard checks in per-format commands
  - search branch rules for format-specific search handlers
- Type/bridge contracts:
  - `src/types/index.ts`
  - `src/lib/tauri.ts`
- Documentation:
  - `README.md` supported file types

## Validation Scenarios

- Functional:
  - Open each new extension from file tree
  - Verify correct viewer resolution
  - Verify no regression on existing formats
- Search:
  - New searchable extensions are included in filter and results
- Error behavior:
  - Corrupt/unsupported files show deterministic and descriptive errors
- Performance:
  - Large text and large spreadsheet files remain responsive in preview mode

## Quality Gates

- Run `bun run check` before merging extension support changes
- Run `cargo test` for Rust command-level extension behavior
- Keep frontend/backed extension lists synchronized in same PR
- Update roadmap progress and README in the same change set

## Assumptions and Defaults

- Priority axis: usage frequency first
- Roadmap scope: extension implementation plus operational/documentation tasks
- Timeline model: 4 phases (short to long term)
- Existing parser stack is preferred before adding heavy new dependencies
- Platform-dependent image formats (e.g. HEIC/HEIF) may remain partial support

## Progress Log

- 2026-03-01:
  - Created long-term extension roadmap document
  - Completed Phase 1 tasks:
    - EXT-001 `.jsonl`
    - EXT-002 `.xls`/`.ods`
    - EXT-003 `.tif`/`.tiff`
