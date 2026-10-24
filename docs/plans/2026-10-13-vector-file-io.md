# AI / DXF import and dimensioned layer export

Goal: open AI/DXF line art as editable curves, preserve physical dimensions, and export visible artwork or selected layer subtrees as AI/DXF/SVG.

The current checkout contains the user's ongoing source changes; modify only the needed files in place. Do not reset, commit unrelated changes, refresh user canvases, or alter saved artwork. Local AGENTS.md authorizes proportional implementation without repeated design approvals and automatic skill publication after verification.

Architecture: local Python codecs (`vector_ai.py`, `vector_dxf.py`), shared selection/export coordinator (`vector_io.py`), existing same-origin server routes, browser import/export dialogs. No cloud or runtime package install. Bundle BSD pypdf for PDF-container AI. AI output is genuine legacy compatible Illustrator vector syntax. DXF output is millimetre 2D polylines with explicitly bounded curve approximation. Imported units set calibration; unknown DXF units require a user choice. Unsupported artwork fails with a clear explanation, never silently drops content. SVG dimensional export uses explicit mm dimensions.

- [x] Independent AI codec and unit/roundtrip tests, including user's CorelDRAW AI private data.
- [x] Independent DXF codec and tests for layers, units, common geometry, unsupported input.
- [x] Test and implement shared layer selection, dimensional SVG, secure import/export HTTP routes.
- [x] Integrate file chooser / drag-drop AI/DXF, unknown-unit prompt, atomic import preserving unsaved canvas until confirmed.
- [x] Export dialog: format, all visible / selected layers, dimensions in mm, clear uncalibrated / unsupported-element errors; layer right-click and toolbar entry.
- [x] Show physical selection size alongside existing pixel controls; retain JSON/history compatibility.
- [x] Browser verification in isolated temporary projects; codec roundtrip against real sample and known dimensioned fixtures; full required Node/Python suites.
- [x] Independent focused review, fix findings, docs, publish skill and verify source/installed hashes. Existing user pages remain intact; new version opens through explicit project launch.

Acceptance: 56 sample paths retain their geometry and physical size; exported selected layers exclude hidden/out-of-scope items and include visible locked items; AI/DXF roundtrips retain dimensions, closure and layer identity; failed/cancelled imports leave canvas/history intact; no guessing of unitless sizes; dimensional exports block until a valid scale exists.
