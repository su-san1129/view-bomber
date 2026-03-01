# DXF AutoCAD Gap CheckList

## Scope

- Target: DXF viewer implementation in `src/viewers/plugins/dxf.tsx`
- Baseline: AutoCAD rendering result for the same DXF files
- In scope: Rendering parity for 2D viewing fidelity
- Out of scope: Editing, DWG import, binary DXF support

## Goals

- Build a long-term roadmap that is executable phase-by-phase
- Prioritize 2D display fidelity first
- Track progress with clear Definition of Done (DoD)

## Task Metadata Rules

- Every task must include: `Priority`, `Phase`, `Owner`, `DoD`, `Tests`
- Priority levels:
  - `P0`: Required for immediate practical parity
  - `P1`: Important for technical drawing readability
  - `P2`: Long-term parity and platform completeness

## Gap Inventory

- Color fidelity:
  - ACI / TrueColor / ByLayer / ByBlock inheritance
  - Layer color and entity override behavior
- Linetype fidelity:
  - LTYPE table mapping
  - Global and per-entity scale (`LTSCALE` + entity scale)
- Lineweight fidelity:
  - ByLayer / ByBlock inheritance
  - Visual thickness parity
- Transparency fidelity:
  - Entity/layer transparency behavior
  - Compositing consistency
- Text fidelity:
  - TEXT/MTEXT style and formatting parity
  - Advanced MTEXT control handling
- Dimension fidelity:
  - DIMENSION style-driven arrows, text placement, extension lines
- Hatch fidelity:
  - Pattern definition accuracy, angle/origin/scale parity
- Block fidelity:
  - INSERT arrays, nested blocks, attribute behavior
- Display order and layout:
  - Draw order, viewport interactions, paperspace/modelspace gaps

## Execution Phases

### Phase 1: 2D Fidelity Foundation

- Focus: color, linetype, lineweight, transparency
- Exit criteria:
  - Baseline sample set has no major visual mismatch in these properties
  - Regression checks for existing supported entities pass

### Phase 2: Annotation Fidelity

- Focus: TEXT/MTEXT/DIMENSION/MLEADER readability and placement
- Exit criteria:
  - Annotation-heavy samples remain readable and stable across zoom
  - Representative dimension styles are visibly closer to AutoCAD output

### Phase 3: 2D Entity Coverage Expansion

- Focus: add missing 2D entities and improve fallback behavior
- Exit criteria:
  - Unsupported entity list reduced for priority customer/sample files

### Phase 4: External/Embedded References Strategy

- Focus: XREF/IMAGE/UNDERLAY policy and partial support strategy
- Exit criteria:
  - Unsupported policy is explicit in UI and docs
  - At least one pragmatic rendering path is implemented or deliberately excluded

### Phase 5: 3D and Layout Strategy

- Focus: 3D and paper/model space roadmap and PoC
- Exit criteria:
  - Spec is decision-complete
  - Feasibility and risk documented with a PoC result

## Detailed Backlog

- [x] P0-001 Replace hash-based color rendering with DXF-resolved color
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Entity/layer colors are resolved from DXF attributes with fallback policy
  - Tests: Open sample with ACI + trueColor and verify color variance by entity/layer

- [x] P0-002 Introduce linetype scale handling (global + entity-level)
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Dashed/center/hidden lines respond to `LTSCALE` and per-entity scale
  - Tests: Open mixed-linetype sample and compare dash pitch before/after

- [x] P0-003 Normalize lineweight inheritance behavior
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: ByLayer/ByBlock behavior is deterministic and no regression in stroke visibility
  - Tests: Sample with mixed lineweights and block insertion

- [x] P0-004 Normalize transparency inheritance behavior
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Entity/layer transparency compositing is stable and explicit in renderer
  - Tests: Sample with layer transparency and entity override

- [x] P0-005 Add unsupported entity reporting surface
  - Priority: P0
  - Phase: 1
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Unsupported entity types are collected and shown to users
  - Tests: Open file containing unsupported entities and verify warning output

- [x] P1-001 Expand MTEXT formatting support
  - Priority: P1
  - Phase: 2
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Selected MTEXT control sequences are rendered predictably
  - Tests: MTEXT sample with formatting combinations

- [x] P1-002 Improve DIMENSION rendering parity
  - Priority: P1
  - Phase: 2
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Dimension line/arrow/text placement is visibly closer to AutoCAD
  - Tests: Dimension-heavy sample set

- [x] P1-003 Improve HATCH pattern fidelity
  - Priority: P1
  - Phase: 2
  - Owner: Agent
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: Pattern angle/scale/origin handling is stable on representative patterns
  - Tests: ANSI31/CROSS/solid samples

- [ ] P2-001 Add additional 2D entities (MLINE, RAY, XLINE, etc.)
  - Priority: P2
  - Phase: 3
  - Owner: TBD
  - Files: `src/viewers/plugins/dxf.tsx`
  - DoD: New entities have deterministic rendering or explicit fallback
  - Tests: Per-entity fixture samples

- [ ] P2-002 Define and implement XREF/UNDERLAY policy
  - Priority: P2
  - Phase: 4
  - Owner: TBD
  - Files: `src/viewers/plugins/dxf.tsx`, docs
  - DoD: UX and docs clearly state behavior (render, partial, or unsupported)
  - Tests: Files containing XREF/UNDERLAY references

- [ ] P3-001 3D/layout technical spec and PoC
  - Priority: P2
  - Phase: 5
  - Owner: TBD
  - Files: `plans/` spec docs + optional PoC code
  - DoD: Decision-complete design with feasibility notes and known risks
  - Tests: PoC acceptance criteria documented in plan

## Public Interface / Type Changes (Track)

- [x] Extend `StrokeStyle` with color field
- [x] Extend `ParsedDxf` with `unsupportedEntities` and `renderWarnings`
- [ ] Add renderer metrics schema for future snapshot comparison

## Validation Scenarios

- [ ] Golden image comparison against AutoCAD captures for key fixtures
- [ ] Regression smoke tests across currently supported entities
- [ ] Large-file performance sanity check (render time and interaction responsiveness)

## Assumptions and Defaults

- ASCII DXF is primary target; binary DXF remains unsupported
- Full AutoCAD parity is not immediate goal; practical 2D fidelity is
- 3D and paper-space are long-term items requiring dedicated design

## Progress Log

- 2026-03-01:
  - Created long-term checklist and phase-based execution structure
  - Completed initial Phase 1 implementation tasks: P0-001..P0-005
  - Completed Phase 2 implementation tasks: P1-001..P1-003
